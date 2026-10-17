/* Hydro ML Studio — file input/output without libraries.
   Reads .xlsx (via the browser's DecompressionStream), .csv/.tsv/.txt and pasted text.
   Writes .xlsx (uncompressed zip). Parses many date formats. */
(function (root) {
  'use strict';
  const IO = {};

  // ---------------------------------------------------------------- delimited text
  IO.parseDelimited = function (text) {
    text = text.replace(/^﻿/, '');
    const lines = text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== '');
    const sample = lines.slice(0, 20);
    const cands = ['\t', ',', ';', '|'];
    let delim = ',', best = -1;
    for (const c of cands) {
      // median count per line, so a title / letterhead line above the table does not hide the delimiter
      const counts = sample.map((l) => l.split(c).length - 1).sort((a, b) => a - b);
      const min = counts[Math.floor(counts.length / 2)];
      if (min > 0 && min >= best) { if (min > best || c === '\t') { best = min; delim = c; } }
    }
    if (best <= 0) delim = /\s{2,}|\t/.test(sample[0] || '') ? /\s{2,}|\t/ : /\s+/;
    const rows = lines.map((l) => (typeof delim === 'string' ? splitQuoted(l, delim) : l.trim().split(delim)));
    return [{ name: 'Data', rows }];
  };
  function splitQuoted(line, d) {
    if (line.indexOf('"') < 0) return line.split(d).map((s) => s.trim());
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  // ---------------------------------------------------------------- xlsx reader
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files. Save the sheet as .csv, or use a current Chrome, Edge, Firefox or Safari.');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a valid .xlsx file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const files = {}, td = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true), name = td.decode(u8.subarray(p + 46, p + 46 + nlen));
      files[name] = { method, csize, off };
      p += 46 + nlen + elen + clen;
    }
    return {
      has: (n) => !!files[n],
      async text(n) {
        const f = files[n]; if (!f) return null;
        const lnl = dv.getUint16(f.off + 26, true), lel = dv.getUint16(f.off + 28, true);
        const data = u8.subarray(f.off + 30 + lnl + lel, f.off + 30 + lnl + lel + f.csize);
        return td.decode(f.method === 0 ? data : await inflateRaw(data));
      },
    };
  }
  const xmlDecode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

  IO.readXlsx = async function (buf) {
    const z = await unzip(buf);
    const wb = await z.text('xl/workbook.xml'), rels = await z.text('xl/_rels/workbook.xml.rels');
    if (!wb) throw new Error('Not a valid .xlsx workbook');
    const relMap = {};
    for (const m of (rels || '').matchAll(/<Relationship\b[^>]*>/g)) {
      const id = /Id="([^"]+)"/.exec(m[0]), tg = /Target="([^"]+)"/.exec(m[0]);
      if (id && tg) relMap[id[1]] = tg[1];
    }
    const shared = [];
    const ss = await z.text('xl/sharedStrings.xml');
    if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlDecode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
    // date styles
    const dateStyle = new Set();
    const st = await z.text('xl/styles.xml');
    if (st) {
      const custom = {};
      for (const m of st.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) custom[m[1]] = xmlDecode(m[2]);
      const xfs = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(st);
      if (xfs) {
        let i = 0;
        for (const m of xfs[1].matchAll(/<xf\b[^>]*>/g)) {
          const id = +((/numFmtId="(\d+)"/.exec(m[0]) || [])[1] || 0);
          const code = (custom[id] || '').replace(/"[^"]*"|\[[^\]]*\]/g, '');
          if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || /[dmyhs]/i.test(code) && !/^[#0.,%\s]*$/.test(code)) dateStyle.add(i);
          i++;
        }
      }
    }
    const sheets = [];
    for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const name = xmlDecode((/name="([^"]*)"/.exec(m[0]) || [])[1] || 'Sheet');
      const rid = (/r:id="([^"]+)"/.exec(m[0]) || [])[1];
      let target = relMap[rid] || '';
      target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
      const xml = await z.text('xl/' + target);
      if (!xml) continue;
      const rows = [];
      for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
        const r = [];
        const body = rm[1] || '';
        for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = cm[1], inner = cm[2] || '';
          const ref = (/r="([A-Z]+\d+)"/.exec(attrs) || [])[1];
          const t = (/\st="([^"]+)"/.exec(attrs) || [])[1];
          const s = +((/\ss="(\d+)"/.exec(attrs) || [])[1] || -1);
          const v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
          let val = '';
          if (t === 's') val = shared[+v] ?? '';
          else if (t === 'inlineStr') val = xmlDecode([...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
          else if (t === 'str' || t === 'e') val = xmlDecode(v || '');
          else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
          else if (v != null) { const num = +v; val = dateStyle.has(s) && isFinite(num) ? { serial: num } : num; }
          const ci = ref ? colIndex(ref) : r.length;
          while (r.length < ci) r.push('');
          r[ci] = val;
        }
        rows.push(r);
      }
      sheets.push({ name, rows: rows.filter((r) => r.some((c) => c !== '' && c != null)) });
    }
    return sheets.filter((s) => s.rows.length);
  };

  // ---------------------------------------------------------------- dates
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const serialToMs = (s) => Math.round((s - 25569) * 86400000);
  IO.serialToMs = serialToMs;
  // order: 'auto' | 'dmy' | 'mdy'; returns UTC ms or NaN
  IO.parseDate = function (v, order) {
    if (v == null || v === '') return NaN;
    if (typeof v === 'object' && v.serial != null) return serialToMs(v.serial);
    if (typeof v === 'number') return v > 1000 && v < 120000 ? serialToMs(v) : NaN;
    const s = String(v).trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(s);
    if (m) return mk(+m[1], +m[2], +m[3], m[4], m[5], m[6], m[7]);
    m = /^(\d{1,2})[-/. ]([A-Za-z]{3,9})[-/. ,]+(\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(s);
    if (m) { const mo = MON[m[2].toLowerCase().slice(0, 4)] || MON[m[2].toLowerCase().slice(0, 3)]; return mo ? mk(yr(+m[3]), mo, +m[1], m[4], m[5], m[6], m[7]) : NaN; }
    m = /^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{2,4})/i.exec(s);
    if (m) { const mo = MON[m[1].toLowerCase().slice(0, 3)]; return mo ? mk(yr(+m[3]), mo, +m[2]) : NaN; }
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i.exec(s);
    if (m) {
      let a = +m[1], b = +m[2];
      const mdy = order === 'mdy' || (order !== 'dmy' && a <= 12 && b > 12);
      return mdy ? mk(yr(+m[3]), a, b, m[4], m[5], m[6], m[7]) : mk(yr(+m[3]), b, a, m[4], m[5], m[6], m[7]);
    }
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return mk(+m[1], +m[2], +m[3]);
    m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
    if (m) return mk(+m[1], +m[2], 1);
    if (/^\d+(\.\d+)?$/.test(s)) return IO.parseDate(+s, order);
    return NaN;
  };
  const yr = (y) => (y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y);
  function mk(y, mo, d, h, mi, se, ap) {
    let hh = +(h || 0);
    if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
    return Date.UTC(y, mo - 1, d, hh, +(mi || 0), +(se || 0));
  }
  IO.fmtDate = function (ms, withTime) {
    if (!isFinite(ms)) return '';
    const t = new Date(ms), p = (n) => String(n).padStart(2, '0');
    const d = t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
    return withTime ? d + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) : d;
  };
  IO.toNumber = function (v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    if (typeof v === 'object') return NaN;
    const s = String(v).trim().replace(/,/g, '');
    if (s === '' || /^(na|n\/a|nan|null|-|--|#n\/a|#value!)$/i.test(s)) return NaN;
    return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s) ? +s : NaN;
  };

  // ---------------------------------------------------------------- xlsx writer
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  // files: [{ name, text } | { name, data: Uint8Array }] — stored (no compression), UTF-8 names
  function zip(files, mime) {
    const enc = new TextEncoder(), parts = [], central = [];
    let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data instanceof Uint8Array ? f.data : enc.encode(f.text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    }
    const csize = central.reduce((a, c) => a + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  IO.zip = (files) => zip(files, 'application/zip');
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colName = (i) => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  // sheets: [{ name, rows: [[cell]] }]; cell: number | string | { date: ms } ; first row is bold header
  IO.writeXlsx = function (sheets) {
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const files = [
      { name: '[Content_Types].xml', text: X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', text: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', text: X + '<workbook xmlns="' + NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + esc(s.name.slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', text: X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', text: X + '<styleSheet xmlns="' + NS + '"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd\\ hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf numFmtId="164" applyNumberFormat="1"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>' },
    ];
    sheets.forEach((s, si) => {
      const rows = s.rows.map((r, ri) => '<row r="' + (ri + 1) + '">' + r.map((c, ci) => {
        const ref = colName(ci) + (ri + 1);
        if (c == null || c === '' || (typeof c === 'number' && !isFinite(c))) return '';
        if (typeof c === 'number') return '<c r="' + ref + '"><v>' + c + '</v></c>';
        if (typeof c === 'object' && c.date != null) return '<c r="' + ref + '" s="1"><v>' + (c.date / 86400000 + 25569) + '</v></c>';
        return '<c r="' + ref + '" t="inlineStr"' + (ri === 0 ? ' s="2"' : '') + '><is><t xml:space="preserve">' + esc(c) + '</t></is></c>';
      }).join('') + '</row>').join('');
      files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', text: X + '<worksheet xmlns="' + NS + '"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="1" width="18" customWidth="1"/></cols><sheetData>' + rows + '</sheetData></worksheet>' });
    });
    return zip(files);
  };

  IO.download = function (blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  root.HIO = IO;
})(typeof self !== 'undefined' ? self : this);
