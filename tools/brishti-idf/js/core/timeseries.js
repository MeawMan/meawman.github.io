/**
 * timeseries.js — regular rainfall series, data-quality checks, annual-maximum and
 * peaks-over-threshold extraction for many durations.
 *
 * TIME CONVENTION
 *  Times are stored as milliseconds of a "naive" local clock encoded with Date.UTC(...), so
 *  no time-zone or daylight-saving shift can ever be applied by the browser.
 *  A regular series has `origin` (start of interval 0), `step` (minutes) and `values`
 *  (depth in mm per interval; NaN = missing). Interval i covers [origin + i*step, origin + (i+1)*step).
 *
 * YEAR ASSIGNMENT
 *  A window (or interval) belongs to the year containing the START of its LAST interval, so a
 *  window ending exactly at 00:00 on 1 January belongs to the previous year.
 *  Hydrological years start on `yearStartMonth` (1 = calendar year; e.g. 4 = April-March).
 *  A hydrological year is labelled by the calendar year in which it starts.
 */

const MS_MIN = 60000;

// ---------------------------------------------------------------------------
// Building a regular series
// ---------------------------------------------------------------------------

/**
 * Most common positive spacing (minutes) between consecutive timestamps.
 * @param {number[]} times sorted ms
 */
export function inferStep(times) {
  const counts = new Map();
  for (let i = 1; i < times.length; i++) {
    const d = Math.round((times[i] - times[i - 1]) / MS_MIN);
    if (d > 0) counts.set(d, (counts.get(d) || 0) + 1);
  }
  let best = null; let bc = -1;
  for (const [d, c] of counts) if (c > bc || (c === bc && d < best)) { best = d; bc = c; }
  const total = times.length - 1;
  return { step: best, regularity: total > 0 ? bc / total : 0 };
}

/**
 * Build a regular series from (time, value) records.
 * @param {{t:number, v:number|null}[]} records time in ms (naive local), value in mm
 * @param {{step?:number, convention?:'end'|'start', kind?:'depth'|'tips', tipDepth?:number}} opt
 *   convention 'end'   : value at t is the depth over (t - step, t]  (most loggers, BMD-style daily totals
 *                        are labelled by the observation day -> use 'start' for daily totals dated by day)
 *   convention 'start' : value at t is the depth over [t, t + step)
 *   kind 'tips'        : records are tipping-bucket tips (v ignored if tipDepth given) aggregated into `step` bins.
 *                        Gaps cannot be detected in tip data: periods without tips are zero rain.
 * @returns {{origin:number, step:number, values:Float64Array, log:string[], duplicates:number, unsorted:boolean}}
 */
export function buildRegularSeries(records, opt = {}) {
  const log = [];
  const recs = records.filter((r) => Number.isFinite(r.t));
  let unsorted = false;
  for (let i = 1; i < recs.length; i++) if (recs[i].t < recs[i - 1].t) { unsorted = true; break; }
  if (unsorted) { recs.sort((a, b) => a.t - b.t); log.push('Timestamps were not in order; they were sorted.'); }
  if (recs.length === 0) throw new Error('no valid timestamps');

  const kind = opt.kind || 'depth';
  let step = opt.step;
  if (!step) {
    if (kind === 'tips') throw new Error('tipping-bucket data need an aggregation step (minutes)');
    const inf = inferStep(recs.map((r) => r.t));
    step = inf.step;
    if (!step) throw new Error('could not infer the time step');
    log.push(`Inferred time step: ${step} min (${(100 * inf.regularity).toFixed(1)}% of spacings).`);
    if (inf.regularity < 0.9) log.push('WARNING: spacing is irregular; check the step or use tipping-bucket mode.');
  }
  const stepMs = step * MS_MIN;
  const convention = opt.convention || 'end';
  const shift = convention === 'end' ? -stepMs : 0; // convert label time to interval start

  if (kind === 'tips') {
    const tip = opt.tipDepth;
    const t0 = Math.floor((recs[0].t) / stepMs) * stepMs;
    const t1 = Math.floor((recs[recs.length - 1].t) / stepMs) * stepMs;
    const n = Math.round((t1 - t0) / stepMs) + 1;
    const values = new Float64Array(n);
    for (const r of recs) {
      const i = Math.floor((r.t - t0) / stepMs);
      values[i] += tip != null ? tip : (Number.isFinite(r.v) ? r.v : 0);
    }
    log.push(`Aggregated ${recs.length} tips into ${n} intervals of ${step} min. Gaps cannot be detected in tip data.`);
    return { origin: t0, step, values, log, duplicates: 0, unsorted };
  }

  const origin = recs[0].t + shift;
  const last = recs[recs.length - 1].t + shift;
  const n = Math.round((last - origin) / stepMs) + 1;
  const values = new Float64Array(n).fill(NaN);
  let duplicates = 0; let offGrid = 0;
  for (const r of recs) {
    const pos = (r.t + shift - origin) / stepMs;
    const i = Math.round(pos);
    if (Math.abs(pos - i) > 1e-6) offGrid++;
    if (i < 0 || i >= n) continue;
    const v = r.v == null || r.v === '' ? NaN : Number(r.v);
    if (!Number.isNaN(values[i])) duplicates++;
    values[i] = v; // last one wins for duplicates (reported)
  }
  if (duplicates) log.push(`WARNING: ${duplicates} duplicate timestamps (the last value was kept).`);
  if (offGrid) log.push(`WARNING: ${offGrid} timestamps were not on the ${step}-min grid and were snapped to it.`);
  return { origin, step, values, log, duplicates, unsorted };
}

/** Aggregate a regular series to a coarser step (must be a multiple). Missing if any part is missing. */
export function aggregate(series, newStep, offsetMin = 0) {
  if (newStep % series.step !== 0) throw new Error('new step must be a multiple of the old step');
  const k = newStep / series.step;
  const newStepMs = newStep * MS_MIN;
  // align block boundaries to midnight + offset
  const firstBoundary = Math.ceil((series.origin - offsetMin * MS_MIN) / newStepMs) * newStepMs + offsetMin * MS_MIN;
  const i0 = Math.round((firstBoundary - series.origin) / (series.step * MS_MIN));
  const nb = Math.floor((series.values.length - i0) / k);
  const out = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    let s = 0;
    for (let j = 0; j < k; j++) s += series.values[i0 + b * k + j];
    out[b] = s; // NaN propagates
  }
  return { origin: firstBoundary, step: newStep, values: out, log: [] };
}

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

/** Hydrological-year label of a naive-UTC time. */
export function yearOf(t, yearStartMonth = 1) {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= yearStartMonth ? y : y - 1;
}
export function monthOf(t) { return new Date(t).getUTCMonth() + 1; }
export function fmtTime(t) { return new Date(t).toISOString().slice(0, 16).replace('T', ' '); }

/** Number of intervals of `step` minutes in a hydrological year (handles leap years). */
function intervalsInYear(y, yearStartMonth, step) {
  const a = Date.UTC(y, yearStartMonth - 1, 1);
  const b = Date.UTC(y + 1, yearStartMonth - 1, 1);
  return Math.round((b - a) / (step * MS_MIN));
}

// ---------------------------------------------------------------------------
// Data-quality checks
// ---------------------------------------------------------------------------

/**
 * Approximate world-record point-rainfall envelope P(mm) = 422 * D(h)^0.475, used ONLY as an
 * implausibility flag (Jennings 1950 envelope as commonly reproduced; coefficients recalled,
 * not verified against the original — see docs/LIMITATIONS.md). Never used in calculations.
 */
export function worldRecordEnvelope(durationMin) {
  return 422 * Math.pow(durationMin / 60, 0.475);
}

/**
 * Data-quality report for a regular series. Does not modify the series unless `fix` is true,
 * in which case negative and implausible values are set to missing (NaN). Every change is listed.
 */
export function qualityReport(series, opt = {}) {
  const { values, step, origin } = series;
  const yearStartMonth = opt.yearStartMonth ?? 1;
  const flatlineMin = opt.flatlineMinutes ?? Math.max(6 * 60, 3 * step); // identical non-zero values for >= this long
  const wetMonths = opt.wetMonths ?? [6, 7, 8, 9];
  const zeroRunDays = opt.zeroRunDays ?? 30;
  const implausibleFactor = opt.implausibleFactor ?? 1.0;
  const fix = opt.fix ?? false;
  const stepMs = step * MS_MIN;
  const issues = [];
  const changed = [];

  // negatives and implausible values
  const env = worldRecordEnvelope(step) * implausibleFactor;
  let neg = 0; let impl = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < 0) { neg++; if (fix) { values[i] = NaN; changed.push({ t: origin + i * stepMs, from: v, reason: 'negative' }); } }
    else if (v > env) { impl++; if (fix) { values[i] = NaN; changed.push({ t: origin + i * stepMs, from: v, reason: 'exceeds world-record envelope' }); } }
  }
  if (neg) issues.push({ level: 'error', code: 'negative', count: neg, text: `${neg} negative value(s)${fix ? ' set to missing' : ''}.` });
  if (impl) issues.push({ level: 'error', code: 'implausible', count: impl, text: `${impl} value(s) exceed the approximate world-record envelope for a ${step}-min interval (${env.toFixed(0)} mm)${fix ? ' — set to missing' : ''}.` });

  // missing runs
  const gaps = [];
  let runStart = -1;
  for (let i = 0; i <= values.length; i++) {
    const miss = i < values.length && Number.isNaN(values[i]);
    if (miss && runStart < 0) runStart = i;
    if (!miss && runStart >= 0) { gaps.push({ start: origin + runStart * stepMs, end: origin + i * stepMs, n: i - runStart }); runStart = -1; }
  }
  const nMissing = gaps.reduce((s, g) => s + g.n, 0);
  if (nMissing) issues.push({ level: 'warning', code: 'gaps', count: gaps.length, text: `${gaps.length} gap(s), ${nMissing} missing intervals (${(100 * nMissing / values.length).toFixed(2)}% of record).` });

  // flat-lined sensor: identical non-zero values repeated
  const flatN = Math.max(2, Math.ceil(flatlineMin / step));
  const flats = [];
  let fs = 0;
  for (let i = 1; i <= values.length; i++) {
    const same = i < values.length && values[i] === values[i - 1] && values[i] > 0;
    if (!same) {
      if (i - fs >= flatN) flats.push({ start: origin + fs * stepMs, end: origin + i * stepMs, n: i - fs, value: values[fs] });
      fs = i;
    }
  }
  if (flats.length) issues.push({ level: 'warning', code: 'flatline', count: flats.length, text: `${flats.length} run(s) of identical non-zero values lasting >= ${flatN * step} min (possible stuck sensor or filled data).` });

  // long zero runs in the wet season (possible blocked gauge)
  const zeroN = Math.ceil(zeroRunDays * 1440 / step);
  const zeros = [];
  let zs = -1;
  for (let i = 0; i <= values.length; i++) {
    const z = i < values.length && values[i] === 0 && wetMonths.includes(monthOf(origin + i * stepMs));
    if (z && zs < 0) zs = i;
    if (!z && zs >= 0) { if (i - zs >= zeroN) zeros.push({ start: origin + zs * stepMs, end: origin + i * stepMs, n: i - zs }); zs = -1; }
  }
  if (zeros.length) issues.push({ level: 'warning', code: 'wetzeros', count: zeros.length, text: `${zeros.length} run(s) of >= ${zeroRunDays} consecutive zero-rain days inside wet-season months (${wetMonths.join(',')}) — check for a blocked or failed gauge.` });

  // per-year coverage
  const years = new Map();
  for (let i = 0; i < values.length; i++) {
    const y = yearOf(origin + i * stepMs, yearStartMonth);
    if (!years.has(y)) years.set(y, { year: y, valid: 0, present: 0, total: intervalsInYear(y, yearStartMonth, step), sum: 0 });
    const r = years.get(y);
    r.present++;
    if (!Number.isNaN(values[i])) { r.valid++; r.sum += values[i]; }
  }
  const coverage = [...years.values()].map((r) => ({ ...r, coverage: r.valid / r.total }));
  const minCov = opt.minCoverage ?? 0.8;
  const complete = coverage.filter((r) => r.coverage >= minCov).length;
  if (complete < 10) issues.push({ level: 'error', code: 'short', count: complete, text: `Only ${complete} year(s) meet the ${Math.round(minCov * 100)}% coverage threshold. Frequency estimates from fewer than ~10 years are highly uncertain; consider regional analysis.` });
  else if (complete < 30) issues.push({ level: 'info', code: 'shortish', count: complete, text: `${complete} usable years. A common rule of thumb is not to extrapolate far beyond 2-4x the record length (here roughly T <= ${2 * complete}-${4 * complete} yr); report confidence intervals.` });

  return { issues, gaps, flats, zeros, coverage, changed, nValues: values.length, nMissing, step };
}

// ---------------------------------------------------------------------------
// Annual maxima
// ---------------------------------------------------------------------------

/**
 * Annual-maximum depth series for several durations.
 * @param {{origin:number, step:number, values:Float64Array}} series
 * @param {number[]} durations minutes
 * @param {{yearStartMonth?:number, minCoverage?:number, maxMissingFraction?:number,
 *          mode?:'sliding'|'fixed', fixedOffsetMin?:number, includeIncomplete?:boolean}} opt
 *   mode 'sliding' : windows may start at any interval (true rolling maxima at the data resolution)
 *   mode 'fixed'   : non-overlapping blocks aligned to midnight + fixedOffsetMin (e.g. observation days)
 * @returns {object} { durations, years, depth: {d: number[]}, when: {d: number[]}, coverage, excluded, skipped }
 */
export function annualMaxima(series, durations, opt = {}) {
  const { values, step, origin } = series;
  const yearStartMonth = opt.yearStartMonth ?? 1;
  const minCoverage = opt.minCoverage ?? 0.8;
  const maxMissFrac = opt.maxMissingFraction ?? 0; // fraction of missing intervals tolerated inside a window
  const mode = opt.mode ?? 'sliding';
  const stepMs = step * MS_MIN;
  const n = values.length;

  // prefix sums of depth (missing as 0) and missing counts
  const cs = new Float64Array(n + 1);
  const cm = new Int32Array(n + 1);
  const yearIdx = new Int32Array(n);
  const yearsSet = new Map();
  for (let i = 0; i < n; i++) {
    const miss = Number.isNaN(values[i]);
    cs[i + 1] = cs[i] + (miss ? 0 : values[i]);
    cm[i + 1] = cm[i] + (miss ? 1 : 0);
    const y = yearOf(origin + i * stepMs, yearStartMonth);
    yearIdx[i] = y;
    if (!yearsSet.has(y)) yearsSet.set(y, { valid: 0 });
    if (!miss) yearsSet.get(y).valid++;
  }
  const years = [...yearsSet.keys()].sort((a, b) => a - b);
  const coverage = years.map((y) => yearsSet.get(y).valid / intervalsInYear(y, yearStartMonth, step));
  const usable = years.map((y, j) => coverage[j] >= minCoverage || !!opt.includeIncomplete);
  const excluded = years.filter((_, j) => !usable[j]).map((y) => ({ year: y, coverage: coverage[years.indexOf(y)] }));

  const depth = {}; const when = {}; const skipped = [];
  for (const d of durations) {
    if (d % step !== 0 || d < step) { skipped.push({ duration: d, reason: `not a multiple of the ${step}-min data step` }); continue; }
    const k = d / step;
    const maxMiss = Math.floor(maxMissFrac * k);
    const best = new Map(); const bestT = new Map();
    let i0 = k - 1;
    let inc = 1;
    if (mode === 'fixed') {
      const blockMs = d * MS_MIN;
      const off = (opt.fixedOffsetMin ?? 0) * MS_MIN;
      const firstBoundary = Math.ceil((origin - off) / blockMs) * blockMs + off;
      i0 = Math.round((firstBoundary - origin) / stepMs) + k - 1;
      inc = k;
    }
    for (let i = i0; i < n; i += inc) {
      const miss = cm[i + 1] - cm[i + 1 - k];
      if (miss > maxMiss) continue;
      let s = cs[i + 1] - cs[i + 1 - k];
      if (miss > 0) s *= k / (k - miss); // scale up partially missing windows (only if tolerated)
      const y = yearIdx[i];
      if (!best.has(y) || s > best.get(y)) { best.set(y, s); bestT.set(y, origin + (i + 1) * stepMs); }
    }
    depth[d] = years.map((y, j) => (usable[j] && best.has(y) ? best.get(y) : NaN));
    when[d] = years.map((y, j) => (usable[j] && best.has(y) ? bestT.get(y) : NaN));
  }
  return { durations: durations.filter((d) => depth[d]), years, depth, when, coverage, excluded, skipped, mode, step };
}

/** Convert annual-maximum depths (mm) to intensities (mm/h). */
export function toIntensity(depthMm, durationMin) { return depthMm / (durationMin / 60); }

/**
 * Fixed-to-sliding (Hershfield-type) correction factor for windows of n observation intervals.
 *  'table' : 1.13 for n=1, 1.04 for n=2, 1.0 otherwise (values cited by Koutsoyiannis et al. 1998,
 *            after Linsley et al. 1975); user-editable.
 *  'weiss' : n / (n - 1/8)  (Weiss 1964, as summarised by Papalexiou et al. 2016/2014 EGU poster).
 *  'none'  : 1
 */
export function fixedIntervalFactor(n, method = 'table', table = { 1: 1.13, 2: 1.04 }) {
  if (method === 'none') return 1;
  if (method === 'weiss') return n / (n - 1 / 8);
  return table[n] ?? 1;
}

/**
 * Empirical fixed-to-sliding ratio from data that resolve the duration finely:
 * mean over years of (sliding AMS / fixed AMS) for duration d with blocks aligned at `offsetMin`.
 */
export function empiricalHershfield(series, d, opt = {}) {
  const s = annualMaxima(series, [d], { ...opt, mode: 'sliding' });
  const f = annualMaxima(series, [d], { ...opt, mode: 'fixed' });
  const ratios = [];
  for (let j = 0; j < s.years.length; j++) {
    const a = s.depth[d]?.[j]; const b = f.depth[d]?.[j];
    if (a > 0 && b > 0) ratios.push(a / b);
  }
  const m = ratios.reduce((t, v) => t + v, 0) / ratios.length;
  // ratio of means is what scales the distribution mean
  const sa = s.depth[d].filter((v, j) => v > 0 && f.depth[d][j] > 0);
  const sb = f.depth[d].filter((v, j) => v > 0 && s.depth[d][j] > 0);
  const rom = sa.reduce((t, v) => t + v, 0) / sb.reduce((t, v) => t + v, 0);
  return { meanOfRatios: m, ratioOfMeans: rom, n: ratios.length, ratios };
}

// ---------------------------------------------------------------------------
// Peaks over threshold (partial duration series)
// ---------------------------------------------------------------------------

/**
 * Independent peaks of the d-duration rolling depth.
 * Peaks are selected greedily (largest first); two selected windows must end at least
 * max(separationHours, d) apart, so windows never overlap.
 * @param {{eventsPerYear?:number, threshold?:number, separationHours?:number, yearsUsed?:number}} opt
 */
export function peaksOverThreshold(series, d, opt = {}) {
  const { values, step, origin } = series;
  if (d % step !== 0) throw new Error('duration must be a multiple of the data step');
  const k = d / step;
  const n = values.length;
  const stepMs = step * MS_MIN;
  const sepIdx = Math.max(k, Math.ceil(((opt.separationHours ?? 24) * 60) / step));
  const sums = new Float64Array(n).fill(NaN);
  let s = 0; let miss = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (Number.isNaN(v)) miss++; else s += v;
    if (i >= k) { const o = values[i - k]; if (Number.isNaN(o)) miss--; else s -= o; }
    if (i >= k - 1 && miss === 0) sums[i] = s;
  }
  const idx = [];
  for (let i = 0; i < n; i++) if (sums[i] > 0) idx.push(i);
  idx.sort((a, b) => sums[b] - sums[a]);
  const taken = new Uint8Array(n);
  const peaks = [];
  const nYears = opt.yearsUsed ?? (n * step) / 525960; // 525960 min = 365.25 days
  const target = opt.threshold == null ? Math.round((opt.eventsPerYear ?? 2) * nYears) : Infinity;
  for (const i of idx) {
    if (peaks.length >= target) break;
    if (opt.threshold != null && sums[i] <= opt.threshold) break;
    if (taken[i]) continue;
    peaks.push({ value: sums[i], t: origin + (i + 1) * stepMs });
    for (let j = Math.max(0, i - sepIdx + 1); j < Math.min(n, i + sepIdx); j++) taken[j] = 1;
  }
  const threshold = opt.threshold ?? (peaks.length ? peaks[peaks.length - 1].value : NaN);
  return { duration: d, peaks, threshold, rate: peaks.length / nYears, years: nYears };
}

/** AMS return period T from partial-duration (average recurrence) interval T' — Koutsoyiannis et al. (1998) eq. 6. */
export function amsFromPds(Tp) { return 1 / (1 - Math.exp(-1 / Tp)); }
/** Partial-duration ARI T' from AMS return period T. */
export function pdsFromAms(T) { return -1 / Math.log(1 - 1 / T); }

// ---------------------------------------------------------------------------
// Trend test
// ---------------------------------------------------------------------------

/**
 * Mann-Kendall trend test with tie correction and continuity correction, and Sen's slope.
 * Serial correlation is NOT corrected for (stated in the report).
 */
export function mannKendall(x, t) {
  const pts = x.map((v, i) => [t ? t[i] : i, v]).filter(([, v]) => Number.isFinite(v));
  const n = pts.length;
  if (n < 4) return { n, S: NaN, Z: NaN, p: NaN, sen: NaN };
  let S = 0;
  const slopes = [];
  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = pts[j][1] - pts[i][1];
      S += d > 0 ? 1 : d < 0 ? -1 : 0;
      const dt = pts[j][0] - pts[i][0];
      if (dt !== 0) slopes.push(d / dt);
    }
  }
  const counts = new Map();
  for (const [, v] of pts) counts.set(v, (counts.get(v) || 0) + 1);
  let tie = 0;
  for (const c of counts.values()) if (c > 1) tie += c * (c - 1) * (2 * c + 5);
  const varS = (n * (n - 1) * (2 * n + 5) - tie) / 18;
  const Z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normalCdfLocal(Math.abs(Z)));
  slopes.sort((a, b) => a - b);
  const m = slopes.length;
  const sen = m % 2 ? slopes[(m - 1) / 2] : 0.5 * (slopes[m / 2 - 1] + slopes[m / 2]);
  return { n, S, varS, Z, p, sen };
}

import { normalCdf as normalCdfLocal } from './special.js';
