/**
 * parse.js — reading delimited text / spreadsheet rows into rainfall records.
 *
 * Supported layouts (chosen in the column-mapping UI, auto-guessed when possible):
 *  'datetime'   one date-time column + value column            (sub-daily or daily series)
 *  'date+time'  separate date and time columns + value
 *  'ymd'        year, month, day [, hour [, minute]] columns + value
 *  'wide-daily' year, month, then day-1 ... day-31 columns     (common BMD/BWDB daily sheet layout)
 *  'ams-table'  year + one column per duration (header names like 15min, 1h, 24 h, 1d)
 *  'tips'       one row per tipping-bucket tip (date-time [, depth per tip])
 * Any layout may carry a station column -> multi-station.
 *
 * Dates are returned as naive-local milliseconds (Date.UTC fields), see timeseries.js.
 */

const MISSING_TOKENS = new Set(['', 'na', 'n/a', 'nan', 'null', '-', '--', '***', '-999', '-9999', '-99', 'm', 'missing']);

/** Guess the delimiter from the first lines. */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  const candidates = [',', ';', '\t', '|'];
  let best = ','; let bestScore = -1;
  for (const c of candidates) {
    const counts = lines.map((l) => splitLine(l, c).length);
    const mode = mostCommon(counts);
    const consistent = counts.filter((k) => k === mode).length / counts.length;
    const score = mode > 1 ? consistent * mode : 0;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  // whitespace-separated (fixed-width style) if no delimiter gives >1 column
  if (bestScore <= 0) return 'whitespace';
  return best;
}

function mostCommon(arr) {
  const m = new Map();
  for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
  let b = arr[0]; let c = 0;
  for (const [k, v] of m) if (v > c) { b = k; c = v; }
  return b;
}

/** Split one line honouring double quotes. */
export function splitLine(line, delim) {
  if (delim === 'whitespace') return line.trim().split(/\s+/);
  const out = [];
  let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parse delimited text into rows. Detects a header row (first row with mostly non-numeric cells).
 * @returns {{delimiter:string, header:string[]|null, rows:string[][], decimalComma:boolean}}
 */
export function parseDelimited(text, delimiter) {
  text = text.replace(/^﻿/, '');
  const delim = delimiter || detectDelimiter(text);
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
  const rows = lines.map((l) => splitLine(l, delim));
  let header = null;
  if (rows.length) {
    // header if the first row has more alphabetic cells than the next row
    // (handles BMD sheets whose day columns are named 1..31)
    const alpha = (r) => r.filter((c) => /[a-z]/i.test(c) && !looksLikeDate(c) && !isNumericLike(c)).length;
    if (alpha(rows[0]) > (rows.length > 1 ? alpha(rows[1]) : 0)) header = rows.shift();
  }
  // decimal comma: delimiter is ; and numbers like 12,5 appear
  const sample = rows.slice(0, 50).flat();
  const decimalComma = delim !== ',' && sample.some((c) => /^-?\d+,\d+$/.test(c));
  return { delimiter: delim, header, rows, decimalComma };
}

function isNumericLike(s) { return /^-?\d+([.,]\d+)?([eE][-+]?\d+)?$/.test(String(s).trim()); }
function looksLikeDate(s) { return /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/.test(String(s)); }

/**
 * Parse a rainfall value. Trace ('T', 'tr') -> 0 by default (BMD records trace as T).
 * @returns {number} NaN for missing
 */
export function parseValue(s, { decimalComma = false, traceAs = 0, missingTokens = MISSING_TOKENS } = {}) {
  if (s == null) return NaN;
  if (typeof s === 'number') return s;
  let t = String(s).trim().toLowerCase();
  if (missingTokens.has(t)) return NaN;
  if (t === 't' || t === 'tr' || t === 'trace') return traceAs;
  if (decimalComma) t = t.replace(',', '.');
  t = t.replace(/[^0-9eE.+-]/g, '');
  const v = Number(t);
  return t === '' ? NaN : v;
}

/** Excel serial date (1900 system) to naive-local ms. */
export function excelSerialToMs(serial) {
  return Math.round((serial - 25569) * 86400000);
}

/**
 * Guess day/month order from a sample of date strings.
 * @returns {'ymd'|'dmy'|'mdy'} and an ambiguity flag
 */
export function guessDateOrder(samples) {
  let firstBig = false; let secondBig = false; let yearFirst = 0;
  for (const s of samples) {
    const m = String(s).match(/(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})/);
    if (!m) continue;
    if (m[1].length === 4) { yearFirst++; continue; }
    if (+m[1] > 12) firstBig = true;
    if (+m[2] > 12) secondBig = true;
  }
  if (yearFirst > 0) return { order: 'ymd', ambiguous: false };
  if (firstBig && !secondBig) return { order: 'dmy', ambiguous: false };
  if (secondBig && !firstBig) return { order: 'mdy', ambiguous: false };
  return { order: 'dmy', ambiguous: true }; // Bangladesh/UK convention as default
}

/**
 * Parse a date or date-time string (or Excel serial number) into naive-local ms.
 * Accepts: 2019-07-01, 2019-07-01 13:45, 2019-07-01T13:45:00, 01/07/2019 13:45, 1.7.2019,
 *          20190701, 201907011345, Excel serials.
 */
export function parseDateTime(s, order = 'dmy') {
  if (s == null || s === '') return NaN;
  if (typeof s === 'number') return s > 20000 && s < 80000 ? excelSerialToMs(s) : NaN;
  const str = String(s).trim();
  if (/^\d{5}(\.\d+)?$/.test(str)) return excelSerialToMs(Number(str));
  let m = str.match(/^(\d{4})(\d{2})(\d{2})(?:(\d{2})(\d{2})(\d{2})?)?$/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = str.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,4})(?:[ T]+(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?(?:\.\d+)?\s*(am|pm)?)?/i);
  if (!m) return NaN;
  let y; let mo; let d;
  if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; } else if (order === 'mdy') { mo = +m[1]; d = +m[2]; y = +m[3]; } else { d = +m[1]; mo = +m[2]; y = +m[3]; }
  if (y < 100) y += y < 50 ? 2000 : 1900;
  let h = +(m[4] || 0);
  const mi = +(m[5] || 0);
  const se = +(m[6] || 0);
  if (m[7]) { const pm = m[7].toLowerCase() === 'pm'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 24) return NaN;
  return Date.UTC(y, mo - 1, d, h, mi, se);
}

/** Parse a time-of-day cell ('13:45', '1345', Excel fraction 0.5729) to minutes. */
export function parseTimeOfDay(s) {
  if (s == null || s === '') return 0;
  if (typeof s === 'number') return s < 1 ? Math.round(s * 1440) : Math.floor(s / 100) * 60 + (s % 100);
  const str = String(s).trim();
  let m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = +m[1];
    if (m[4]) { const pm = m[4].toLowerCase() === 'pm'; if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    return h * 60 + +m[2];
  }
  m = str.match(/^(\d{1,2})(\d{2})$/);
  if (m) return +m[1] * 60 + +m[2];
  if (/^\d+(\.\d+)?$/.test(str)) { const v = +str; return v < 1 ? Math.round(v * 1440) : v <= 24 ? v * 60 : NaN; }
  return NaN;
}

/**
 * Parse a duration label to minutes: '5', '5min', '15 m', '1h', '1 hr', '24 h', '1d', '2 days', 'd=30'.
 * Bare numbers are minutes.
 */
export function parseDurationLabel(label) {
  const s = String(label).trim().toLowerCase().replace(/^d\s*=\s*/, '');
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(min(?:ute)?s?|m|h(?:ou)?rs?|h|hr|d(?:ays?)?|day)?$/);
  if (!m) return NaN;
  const v = +m[1];
  const u = m[2] || 'min';
  if (u.startsWith('h')) return v * 60;
  if (u.startsWith('d')) return v * 1440;
  return v;
}

/** Guess a column-mapping from header names and the first data rows. */
export function guessMapping(header, rows) {
  const h = (header || []).map((x) => String(x).toLowerCase());
  const find = (re) => h.findIndex((x) => re.test(x));
  const map = { layout: 'datetime', station: find(/^(station|stn|site|gauge|id)\b/) };
  const durCols = h.map((x, i) => [i, parseDurationLabel(x)]).filter(([, d]) => Number.isFinite(d) && d > 0);
  const dayCols = h.map((x, i) => [i, x.match(/^(?:day[ _]?)?(\d{1,2})$/)]).filter(([, m]) => m && +m[1] >= 1 && +m[1] <= 31);
  const yearCol = find(/^(year|yr|yyyy)$/);
  const monthCol = find(/^(month|mon|mm)$/);
  const dayCol = find(/^(day|dd|date of month)$/);
  if (yearCol >= 0 && monthCol >= 0 && dayCols.length >= 28) {
    return { ...map, layout: 'wide-daily', year: yearCol, month: monthCol, dayCols: dayCols.map(([i, m]) => [i, +m[1]]) };
  }
  if (yearCol >= 0 && durCols.length >= 1 && monthCol < 0) {
    return { ...map, layout: 'ams-table', year: yearCol, durationCols: durCols.filter(([i]) => i !== yearCol) };
  }
  if (yearCol >= 0 && monthCol >= 0 && dayCol >= 0) {
    return {
      ...map, layout: 'ymd', year: yearCol, month: monthCol, day: dayCol,
      hour: find(/^(hour|hr|hh)$/), minute: find(/^(minute|min|mi)$/),
      value: pickValueCol(h, [yearCol, monthCol, dayCol, map.station]),
    };
  }
  const dateCol = find(/(date|time|timestamp|datetime)/);
  const timeCol = h.findIndex((x, i) => i !== dateCol && /^(time|hh:mm|clock)$/.test(x));
  const r0 = rows[0] || [];
  const dt = dateCol >= 0 ? dateCol : r0.findIndex((c) => looksLikeDate(c));
  if (timeCol >= 0 && dt >= 0) return { ...map, layout: 'date+time', date: dt, time: timeCol, value: pickValueCol(h, [dt, timeCol, map.station], r0) };
  return { ...map, layout: 'datetime', date: dt >= 0 ? dt : 0, value: pickValueCol(h, [dt, map.station], r0) };
}

function pickValueCol(h, exclude, r0 = []) {
  const want = h.findIndex((x, i) => !exclude.includes(i) && /(rain|precip|value|depth|mm|prcp|rf)/.test(x));
  if (want >= 0) return want;
  const n = Math.max(h.length, r0.length);
  for (let i = n - 1; i >= 0; i--) if (!exclude.includes(i)) return i;
  return 1;
}

/**
 * Apply a mapping to rows.
 * @returns {{stations: Map<string, {records?:{t:number,v:number}[], ams?:{years:number[], depth:Object}}>, warnings:string[]}}
 */
export function applyMapping(rows, mapping, opt = {}) {
  const warnings = [];
  const pv = (s) => parseValue(s, opt);
  const stations = new Map();
  const get = (st) => {
    const key = st == null || st === '' ? 'Station 1' : String(st);
    if (!stations.has(key)) stations.set(key, { records: [], ams: null });
    return stations.get(key);
  };
  let order = opt.dateOrder;
  if (!order && (mapping.layout === 'datetime' || mapping.layout === 'date+time' || mapping.layout === 'tips')) {
    const g = guessDateOrder(rows.slice(0, 500).map((r) => r[mapping.date]));
    order = g.order;
    if (g.ambiguous) warnings.push('Day/month order is ambiguous in the sample; assumed DD/MM/YYYY. Change it in the mapping if wrong.');
  }
  let bad = 0;
  const stCol = mapping.station;
  if (mapping.layout === 'ams-table') {
    for (const r of rows) {
      const st = get(stCol >= 0 ? r[stCol] : null);
      if (!st.ams) st.ams = { years: [], depth: {}, unit: mapping.amsUnit || 'depth' };
      const y = parseInt(r[mapping.year], 10);
      if (!Number.isFinite(y)) { bad++; continue; }
      st.ams.years.push(y);
      for (const [i, d] of mapping.durationCols) {
        (st.ams.depth[d] ||= []).push(pv(r[i]));
      }
    }
    // intensities given? convert to depth
    for (const st of stations.values()) {
      if (st.ams && mapping.amsUnit === 'intensity') {
        for (const d of Object.keys(st.ams.depth)) st.ams.depth[d] = st.ams.depth[d].map((v) => v * (+d / 60));
        st.ams.unit = 'depth';
      }
    }
  } else {
    for (const r of rows) {
      const st = get(stCol >= 0 ? r[stCol] : null);
      if (mapping.layout === 'wide-daily') {
        const y = parseInt(r[mapping.year], 10); const mo = parseInt(r[mapping.month], 10);
        if (!Number.isFinite(y) || !Number.isFinite(mo)) { bad++; continue; }
        const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        for (const [i, d] of mapping.dayCols) if (d <= dim) st.records.push({ t: Date.UTC(y, mo - 1, d), v: pv(r[i]) });
        continue;
      }
      let t;
      if (mapping.layout === 'datetime' || mapping.layout === 'tips') t = parseDateTime(r[mapping.date], order);
      else if (mapping.layout === 'date+time') t = parseDateTime(r[mapping.date], order) + parseTimeOfDay(r[mapping.time]) * 60000;
      else if (mapping.layout === 'ymd') {
        t = Date.UTC(+r[mapping.year], +r[mapping.month] - 1, +r[mapping.day],
          mapping.hour >= 0 ? +r[mapping.hour] : 0, mapping.minute >= 0 ? +r[mapping.minute] : 0);
      }
      if (!Number.isFinite(t)) { bad++; continue; }
      const v = mapping.layout === 'tips' ? (mapping.value >= 0 ? pv(r[mapping.value]) : NaN) : pv(r[mapping.value]);
      st.records.push({ t, v });
    }
  }
  if (bad) warnings.push(`${bad} row(s) had an unreadable date/year and were skipped.`);
  return { stations, warnings, dateOrder: order };
}
