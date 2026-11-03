// parse.js - reading tabular data pasted or uploaded by the user.
//   parseText(text)        -> { header: [..] | null, rows: [[..]], delimiter, comments: [..] }
//   parseXlsx(arrayBuffer) -> same shape (needs the vendored SheetJS global `XLSX`)
//   detectColumns(table)   -> guesses { date, year, value } column indices and the date format
//   toSeries(table, map)   -> { kind: 'annual' | 'daily', years | dates, values, problems }
// No external dependencies except SheetJS for .xlsx.

const DELIMS = [',', '\t', ';', '|'];

/** Parse a number that may contain thousands separators, spaces or a decimal comma. */
export function parseNumber(s) {
  if (s === null || s === undefined) return NaN;
  if (typeof s === 'number') return s;
  let t = String(s).trim();
  if (t === '' || /^(na|nan|null|-|--|n\/a|missing)$/i.test(t)) return NaN;
  t = t.replace(/\s/g, '');
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, '');        // 1,234.5
  else if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,5
  else if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');                    // 12,5
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

function splitLine(line, d) {
  if (d === ' ') return line.trim().split(/\s+/);
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === d && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseText(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const comments = [], body = [];
  for (const l of lines) {
    if (/^\s*#/.test(l)) comments.push(l.replace(/^\s*#\s?/, ''));
    else if (l.trim() !== '') body.push(l);
  }
  if (!body.length) return { header: null, rows: [], delimiter: ',', comments };
  // choose the delimiter that gives the most consistent column count (>1)
  let best = { d: ' ', score: -1 };
  for (const d of [...DELIMS, ' ']) {
    const counts = body.slice(0, 50).map((l) => splitLine(l, d).length);
    const mode = counts.sort((a, b) => counts.filter((v) => v === b).length - counts.filter((v) => v === a).length)[0];
    const consistent = counts.filter((c) => c === mode).length / counts.length;
    const score = mode > 1 ? consistent * 10 + Math.min(mode, 5) * 0.01 : (d === ' ' ? 0.5 : 0);
    if (score > best.score) best = { d, score };
  }
  let rows = body.map((l) => splitLine(l, best.d));
  // a header row is one where most cells are not numbers/dates while the next rows are
  const isDataCell = (c) => Number.isFinite(parseNumber(c)) || parseDate(c) !== null;
  const first = rows[0], second = rows[1] ?? [];
  const headerLike = first.filter((c) => !isDataCell(c)).length > first.length / 2 && second.filter(isDataCell).length >= second.length / 2;
  const header = headerLike ? first : null;
  if (headerLike) rows = rows.slice(1);
  return { header, rows, delimiter: best.d, comments };
}

export function parseXlsx(buf, sheetIndex = 0) {
  const XLSX = globalThis.XLSX;
  if (!XLSX) throw new Error('The spreadsheet reader (vendor/xlsx.core.min.js) is not loaded.');
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[sheetIndex]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: '' });
  const rows = aoa.map((r) => r.map((c) => (c instanceof Date ? isoDate(c) : c)));
  const first = rows[0] ?? [];
  const headerLike = first.some((c) => typeof c === 'string' && c !== '' && !Number.isFinite(parseNumber(c)) && parseDate(c) === null);
  return { header: headerLike ? first.map(String) : null, rows: headerLike ? rows.slice(1) : rows, delimiter: 'xlsx', comments: [], sheets: wb.SheetNames };
}

const isoDate = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/**
 * Parse one date string. order: 'ymd' | 'dmy' | 'mdy' | null (auto).
 * Returns a UTC Date or null. Accepts ISO dates with optional time, d/m/y with / - . separators,
 * month names (12-Aug-1998), and Excel serial day numbers (when allowSerial).
 */
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(s, order = null, allowSerial = false) {
  if (s instanceof Date) return s;
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  let m;
  const mk = (y, mo, d, hh = 0, mi = 0) => {
    if (y < 100) y += y < 50 ? 2000 : 1900;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d, hh, mi));
    return dt.getUTCDate() === d ? dt : null;
  };
  if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/))) return mk(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  if ((m = t.match(/^(\d{1,2})[-/. ]([A-Za-z]{3})[A-Za-z]*[-/. ](\d{2,4})/))) { const mo = MONTHS[m[2].toLowerCase()]; return mo ? mk(+m[3], mo, +m[1]) : null; }
  if ((m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/))) {
    const a = +m[1], b = +m[2], y = +m[3];
    const o = order ?? (a > 12 ? 'dmy' : b > 12 ? 'mdy' : 'dmy');
    return o === 'mdy' ? mk(y, a, b, +(m[4] ?? 0), +(m[5] ?? 0)) : mk(y, b, a, +(m[4] ?? 0), +(m[5] ?? 0));
  }
  if (allowSerial && /^\d{5}(\.\d+)?$/.test(t)) { const v = Number(t); if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000); }
  return null;
}

/** Decide day/month order for a column of d/m/y-style strings. */
export function detectDateOrder(cells) {
  let dmy = 0, mdy = 0;
  for (const c of cells) {
    const m = String(c).trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

const isYear = (v) => Number.isInteger(v) && v >= 1000 && v <= 2200;

/** Guess column roles: a date column (daily data) or a year column (annual series) and a value column. */
export function detectColumns(table) {
  const { rows, header } = table;
  const ncol = Math.max(...rows.slice(0, 50).map((r) => r.length));
  const sample = rows.slice(0, 200);
  const cols = [];
  for (let j = 0; j < ncol; j++) {
    const cells = sample.map((r) => r[j]).filter((c) => c !== undefined && String(c).trim() !== '');
    const nums = cells.map(parseNumber);
    const dates = cells.map((c) => parseDate(c, null, false));
    const name = header ? String(header[j] ?? '') : '';
    cols.push({
      j, name,
      fracNum: nums.filter(Number.isFinite).length / Math.max(cells.length, 1),
      fracDate: dates.filter((d) => d !== null && !/^\d+(\.\d+)?$/.test(String(cells[dates.indexOf(d)]).trim())).length / Math.max(cells.length, 1),
      fracYear: nums.filter(isYear).length / Math.max(cells.length, 1),
    });
  }
  const dateCol = cols.find((c) => c.fracDate > 0.8);
  const yearCol = cols.find((c) => c.fracYear > 0.9 && (!header || /year|yr|wy|সাল/i.test(c.name) || c.j === 0));
  const candidates = cols.filter((c) => c.fracNum > 0.6 && c !== yearCol && c !== dateCol);
  const named = candidates.find((c) => /peak|flow|discharge|q\b|cumec|m3|cfs|level|stage|wl|value|max/i.test(c.name));
  const valueCol = named ?? candidates[0];
  const kind = dateCol ? 'daily' : 'annual';
  const order = dateCol ? detectDateOrder(sample.map((r) => r[dateCol.j])) : null;
  return { kind, date: dateCol?.j ?? null, year: yearCol?.j ?? null, value: valueCol?.j ?? null, dateOrder: order, columns: cols };
}

/**
 * Convert the table to a series with a column mapping.
 * map: { kind, date, year, value, dateOrder }
 */
export function toSeries(table, map) {
  const problems = [];
  if (map.value === null || map.value === undefined) return { problems: ['Choose the column that holds the values.'] };
  if (map.kind === 'daily') {
    const recs = [];
    table.rows.forEach((r, i) => {
      const d = parseDate(r[map.date], map.dateOrder, true);
      const v = parseNumber(r[map.value]);
      if (!d) { if (String(r[map.date] ?? '').trim() !== '') problems.push(`Row ${i + 1}: cannot read the date "${r[map.date]}".`); return; }
      recs.push({ date: d, value: v });
    });
    recs.sort((a, b) => a.date - b.date);
    const nMissing = recs.filter((r) => !Number.isFinite(r.value)).length;
    return { kind: 'daily', records: recs, nMissing, problems: problems.slice(0, 20), nProblems: problems.length };
  }
  const years = [], values = [];
  table.rows.forEach((r, i) => {
    const v = parseNumber(r[map.value]);
    const y = map.year !== null && map.year !== undefined ? parseNumber(r[map.year]) : null;
    if (!Number.isFinite(v)) { problems.push(`Row ${i + 1}: "${r[map.value]}" is not a number; row skipped.`); return; }
    values.push(v); years.push(Number.isFinite(y) ? y : null);
  });
  const hasYears = years.every((y) => y !== null);
  return { kind: 'annual', values, years: hasYears ? years : null, problems: problems.slice(0, 20), nProblems: problems.length };
}
