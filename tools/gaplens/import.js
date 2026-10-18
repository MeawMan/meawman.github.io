/* GapLens file import, in the page before the data reach Python.
   - Excel (.xlsx / .xlsm / .xls): the sheet with the most rows is read (SheetJS, loaded only when needed).
   - Hydrometric downloads such as BWDB files: title rows above the table are skipped, HIGH / LOW rows are left out
     (REGULAR only), a separate time column is joined to the date, serial-number and Year / Month helper columns are dropped.
   - Several readings a day at irregular times (e.g. 6, 9, 12, 15, 18 h) become daily means, so the record does not
     turn into a fine grid that is mostly "missing".
   A plain CSV that needs none of this is passed on unchanged. Returns { buf, notes } where notes describe what was done. */
(function () {
  "use strict";
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var DAY = 86400000;

  function loadSheetJS() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      s.onload = function () { window.XLSX ? res(window.XLSX) : rej(new Error("The Excel reader did not load.")); };
      s.onerror = function () { rej(new Error("The Excel reader could not be downloaded. Save the sheet as CSV and load that instead.")); };
      document.head.appendChild(s);
    });
  }

  /* ------------------------------------------------------------------ cells */
  function toNumber(v) {
    if (typeof v === "number") return v;
    if (v == null) return NaN;
    var s = String(v).trim().replace(/\s/g, "");
    if (s === "") return NaN;
    if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", "."); else s = s.replace(/,/g, "");
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? Number(s) : NaN;
  }
  function mk(y, mo, d, h, mi, s) {
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return NaN;
    var t = Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
    return new Date(t).getUTCMonth() === mo - 1 ? t : NaN;
  }
  function parseDateText(str, order) {
    var s = String(str).trim(), m;
    if (!s) return NaN;
    if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s))) return mk(+m[1], +m[2], +m[3], +m[4], +m[5], +m[6]);
    if ((m = /^(\d{1,2})[-\/ ]([A-Za-z]{3,9})\.?[-\/ ,]+(\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s))) { var a = MON[m[2].slice(0, 3).toLowerCase()]; return a ? mk(+m[3], a, +m[1], +m[4], +m[5]) : NaN; }
    if ((m = /^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})/.exec(s))) { var b = MON[m[1].slice(0, 3).toLowerCase()]; return b ? mk(+m[3], b, +m[2]) : NaN; }
    if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s)))
      return order === "mdy" ? mk(+m[3], +m[1], +m[2], +m[4], +m[5], +m[6]) : mk(+m[3], +m[2], +m[1], +m[4], +m[5], +m[6]);
    if ((m = /^(\d{4})(\d{2})(\d{2})$/.exec(s))) return mk(+m[1], +m[2], +m[3]);
    return NaN;
  }
  function serial(n) { return n >= 20000 && n < 2958466 ? Math.round((n - 25569) * DAY) : NaN; }
  function toTime(v, order) {
    if (v == null || v === "") return NaN;
    if (v instanceof Date) return v.getTime();
    if (typeof v === "number") return serial(v);
    var s = String(v).trim();
    if (/^\d{5}(\.\d+)?$/.test(s)) return serial(Number(s));
    return parseDateText(s, order);
  }
  function timeOf(v) {
    if (v == null || v === "") return 0;
    if (typeof v === "number") return v >= 0 && v < 1 ? Math.round(v * DAY) : 0;
    var m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(v).trim());
    if (!m) return 0;
    var h = +m[1]; if (m[4]) { var ap = m[4].toLowerCase(); if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0; }
    return ((h * 60 + +m[2]) * 60 + +(m[3] || 0)) * 1000;
  }
  function isTimeCell(v) { return v == null || v === "" || (typeof v === "number" && v >= 0 && v < 1) || /^\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?$/i.test(String(v).trim()); }
  function isText(c) { return typeof c === "string" && c.trim() !== "" && isNaN(toNumber(c)) && isNaN(parseDateText(c, "dmy")); }
  function detectOrder(vals) {
    var a = 0, b = 0;
    vals.slice(0, 3000).forEach(function (v) { var m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.]\d{2,4}/.exec(String(v == null ? "" : v).trim()); if (m) { if (+m[1] > 12) a++; if (+m[2] > 12) b++; } });
    return b && !a ? "mdy" : "dmy";
  }

  /* ------------------------------------------------------------------ text tables */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    var lines = text.split(/\r\n|\n|\r/).filter(function (l) { return l.trim() !== ""; }), sample = lines.slice(0, 30), delim = ",", best = 0;
    ["\t", ",", ";", "|"].forEach(function (c) {
      var counts = sample.map(function (l) { return l.split(c).length - 1; }).sort(function (x, y) { return x - y; }), med = counts[Math.floor(counts.length / 2)] || 0;
      if (med > best) { best = med; delim = c; }
    });
    return lines.map(function (l) {
      var row = [], cur = "", q = false;
      for (var i = 0; i < l.length; i++) {
        var ch = l[i];
        if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
        else if (ch === '"') q = true; else if (ch === delim) { row.push(cur.trim()); cur = ""; } else cur += ch;
      }
      row.push(cur.trim());
      return row.map(function (x) { return x === "" ? null : x; });
    });
  }
  function findHeader(rows) {
    var lim = Math.min(rows.length - 2, 60);
    for (var r = 0; r < lim; r++) {
      var cells = (rows[r] || []).filter(function (c) { return c !== null && c !== ""; });
      if (cells.length < 2 || !cells.every(isText)) continue;
      var next = rows.slice(r + 1, r + 4);
      if (next.length && next.every(function (nr) { return nr.some(function (c) { return !isNaN(toTime(c, "dmy")); }) && nr.some(function (c) { return !isNaN(toNumber(c)); }); })) return r;
    }
    return (rows[0] || []).some(isText) ? 0 : -1;
  }
  function csvCell(v) { var s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function iso(t, withTime) {
    var s = new Date(t).toISOString();
    return withTime ? s.slice(0, 16).replace("T", " ") : s.slice(0, 10);
  }

  /* ------------------------------------------------------------------ main */
  function shape(rows, kind, notes) {
    rows = rows.filter(function (r) { return r && r.some(function (x) { return x !== null && x !== ""; }); });
    var hr = findHeader(rows), changed = false;
    if (hr > 0) { notes.push(hr + " title row" + (hr > 1 ? "s" : "") + " above the table " + (hr > 1 ? "were" : "was") + " skipped."); rows = rows.slice(hr); changed = true; }
    if (hr < 0) return { rows: rows, changed: changed };  // no header row: leave it to the reader
    var width = 0; rows.forEach(function (r) { if (r.length > width) width = r.length; });
    var head = []; for (var j = 0; j < width; j++) { var h = rows[0][j] == null ? "" : String(rows[0][j]).replace(/\s+/g, " ").trim(); head.push(h || "Column " + (j + 1)); }
    var body = rows.slice(1);
    if (kind !== "data") return { rows: [head].concat(body), changed: changed };
    // date column: best share of readable dates, named date/time preferred
    var dateJ = -1, bestScore = 0;
    for (j = 0; j < width; j++) {
      var tot = 0, ok = 0;
      for (var r = 0; r < Math.min(body.length, 300); r++) { var v = body[r][j]; if (v == null || v === "") continue; tot++; if (!isNaN(toTime(v, "dmy"))) ok++; }
      var sc = tot ? ok / tot + (/date|time|day/i.test(head[j]) ? 0.05 : 0) : 0;
      if (sc > bestScore) { bestScore = sc; dateJ = j; }
    }
    if (dateJ < 0 || bestScore < 0.8) return { rows: [head].concat(body), changed: changed };
    var order = detectOrder(body.map(function (r) { return r[dateJ]; }));
    var timeJ = -1, typeJ = -1, drop = {};
    head.forEach(function (h, k) {
      if (k === dateJ) return;
      if (timeJ < 0 && /time|hour|hh:mm/i.test(h) && !/date/i.test(h) && body.slice(0, 60).every(function (r) { return isTimeCell(r[k]); })) timeJ = k;
      if (typeJ < 0 && /type/i.test(h) && body.slice(0, 300).some(function (r) { return /^regular$/i.test(String(r[k] == null ? "" : r[k]).trim()); })) typeJ = k;
    });
    // helper columns that are not series: serial numbers, year / month / day parts, text columns
    head.forEach(function (h, k) {
      if (k === dateJ || k === timeJ || k === typeJ) return;
      var vals = body.slice(0, 400).map(function (r) { return r[k]; }).filter(function (v) { return v != null && v !== ""; });
      var nums = vals.map(toNumber).filter(function (x) { return !isNaN(x); });
      if (/^(sl|s\.?\s?l\.?(\s?no\.?)?|no\.?|serial|index|id|#|year|yr|month|mon|day|hour)$/i.test(h)) { drop[k] = h; return; }
      if (vals.length && nums.length < 0.6 * vals.length) { drop[k] = h; return; }
      if (nums.length > 10 && nums.every(function (x, i) { return i === 0 || x - nums[i - 1] === 1; })) { drop[k] = h; return; }
      if (nums.length > 10 && nums.every(function (x) { return x === Math.round(x) && x >= 1800 && x <= 2200; })) drop[k] = h;
    });
    var keep = []; head.forEach(function (h, k) { if (k !== dateJ && k !== timeJ && k !== typeJ && !(k in drop)) keep.push(k); });
    var dropped = Object.keys(drop).map(function (k) { return drop[k]; });
    if (dropped.length) { notes.push("Left out " + (dropped.length > 1 ? dropped.length + " columns that are not series: " : "a column that is not a series: ") + dropped.join(", ") + "."); changed = true; }
    // records
    var recs = [], skippedType = 0;
    body.forEach(function (row) {
      if (typeJ >= 0 && !/^regular$/i.test(String(row[typeJ] == null ? "" : row[typeJ]).trim())) { skippedType++; return; }
      var t = toTime(row[dateJ], order); if (isNaN(t)) return;
      if (timeJ >= 0) { var d = new Date(t); t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + timeOf(row[timeJ]); }
      recs.push({ t: t, v: keep.map(function (k) { return row[k]; }) });
    });
    if (skippedType) { notes.push(skippedType + " HIGH / LOW rows were left out; only REGULAR readings are used."); changed = true; }
    if (timeJ >= 0) { notes.push("The time column “" + head[timeJ] + "” was joined to the dates."); changed = true; }
    recs.sort(function (a, b) { return a.t - b.t; });
    // several readings a day at irregular times -> daily means
    var diffs = []; for (var i = 1; i < Math.min(recs.length, 3000); i++) diffs.push(recs[i].t - recs[i - 1].t);
    var sorted = diffs.slice().sort(function (a, b) { return a - b; }), med = sorted[Math.floor(sorted.length / 2)] || DAY;
    var regular = diffs.length ? diffs.filter(function (d) { return Math.abs(d - med) < 60000; }).length / diffs.length : 1;
    var daily = med < DAY && regular < 0.9, withTime = med < DAY && !daily;
    if (daily) {
      var byDay = new Map();
      recs.forEach(function (rc) {
        var key = Math.floor(rc.t / DAY), g = byDay.get(key);
        if (!g) { g = { s: keep.map(function () { return 0; }), n: keep.map(function () { return 0; }) }; byDay.set(key, g); }
        rc.v.forEach(function (x, c) { var y = toNumber(x); if (!isNaN(y)) { g.s[c] += y; g.n[c]++; } });
      });
      var n0 = recs.length;
      recs = Array.from(byDay.keys()).sort(function (a, b) { return a - b; }).map(function (key) {
        var g = byDay.get(key); return { t: key * DAY, v: g.s.map(function (s, c) { return g.n[c] ? +(s / g.n[c]).toPrecision(10) : null; }) };
      });
      notes.push(n0 + " readings at irregular times of day were averaged to " + recs.length + " daily values.");
      changed = true;
    }
    if (!changed) return { rows: null, changed: false };
    var out = [["date"].concat(keep.map(function (k) { return head[k]; }))];
    recs.forEach(function (rc) { out.push([iso(rc.t, withTime)].concat(rc.v)); });
    return { rows: out, changed: true };
  }

  async function prepare(buf, name, kind) {
    var notes = [], bytes = new Uint8Array(buf), isZip = bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b, isOle = bytes.length > 7 && bytes[0] === 0xd0 && bytes[1] === 0xcf;
    var rows, fromExcel = /\.(xlsx|xlsm|xls)$/i.test(name || "") || isZip || isOle;
    if (fromExcel) {
      var X = await loadSheetJS(), wb = X.read(bytes, { type: "array", cellDates: false }), best = wb.SheetNames[0], most = -1;
      wb.SheetNames.forEach(function (nm) { var ref = wb.Sheets[nm]["!ref"]; if (!ref) return; var rg = X.utils.decode_range(ref); if (rg.e.r - rg.s.r > most) { most = rg.e.r - rg.s.r; best = nm; } });
      rows = X.utils.sheet_to_json(wb.Sheets[best], { header: 1, raw: true, defval: null, blankrows: false });
      notes.push("Excel file: sheet “" + best + "” was read" + (wb.SheetNames.length > 1 ? " (the largest of " + wb.SheetNames.length + ")" : "") + ".");
    } else {
      rows = parseCSV(new TextDecoder("utf-8").decode(bytes));
    }
    var sh = shape(rows, kind, notes);
    if (!fromExcel && !sh.changed) return { buf: buf, notes: [] };
    var text = (sh.rows || rows).map(function (r) { return r.map(csvCell).join(","); }).join("\n");
    return { buf: new TextEncoder().encode(text).buffer, notes: notes };
  }

  window.GapLensImport = { prepare: prepare };
})();
