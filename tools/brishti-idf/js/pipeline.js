/**
 * pipeline.js — the complete analysis for one station, as a pure function of (station data, settings).
 * Runs in the Web Worker (js/worker/worker.js) and in Node tests. Results contain only plain data
 * (no functions), so they can be posted between threads and saved.
 */
import { buildRegularSeries, qualityReport, annualMaxima, fixedIntervalFactor, empiricalHershfield, mannKendall } from './core/timeseries.js';
import { compareFits, AMS_DISTRIBUTIONS, DISTRIBUTIONS, FIXED_SHAPE_DISTS } from './core/distributions.js';
import { grubbsBeck } from './core/outliers.js';
import { potAnalysis, potStability } from './core/pot.js';
import { quantileTable, fitForm, fitKModel, rankModels, DEFAULT_DURATIONS, DEFAULT_RETURN_PERIODS, empiricalPoints } from './core/idf.js';
import { disaggregate, calibratePowerExponent, calibrateRatios, scalingAnalysis } from './core/disaggregation.js';

export const TOOL_VERSION = '0.2.0';

export const DEFAULT_SETTINGS = {
  durations: DEFAULT_DURATIONS.slice(),
  returnPeriods: DEFAULT_RETURN_PERIODS.slice(),
  yearStartMonth: 1,
  minCoverage: 0.8,
  includeIncomplete: false,
  maxMissingFraction: 0,
  amsMode: 'sliding',
  fixedFactor: { method: 'table', table: { 1: 1.13, 2: 1.04 }, applyToAmsTables: false },
  dist: 'gev',
  method: 'lmom',
  fixedShape: null,              // k for 'L-moments, shape fixed' (GEV), e.g. a regional value; null = not used
  criterion: 'aicc',             // ranking of candidate distributions: aicc | bic | ad | ppcc | ks
  pot: { enabled: false, use: false, eventsPerYear: 3, separationHours: 24, method: 'lmom', shape: 'free' },
  perDuration: {},
  compareAll: true,
  plotting: 'gringorten',
  unit: 'h',
  fitSpace: 'log',
  models: ['kgumbel:robust', 'kgev:mle', 'sherman', 'talbot', 'bernard', 'kimijima', 'shermanT'],
  selectedModel: null,
  fixTheta: 'auto',
  disagg: { method: 'imd', n: null, H: null, ratios: {}, p60_10: null, calibStation: null, fillBelowResolution: false },
  climate: { mode: 'none', percent: 20, rate: 7, warming: 1.5, shortRate: null, shortDuration: 60, linear: false },
  arf: { mode: 'none', value: 1, areaKm2: 0 },
  storm: { method: 'alternatingBlock', T: 10, duration: 180, dt: 5, peak: 0.5, scsType: 'II', quartile: 2, adjusted: true },
  uncertainty: { nBoot: 500, level: 0.9, seed: 20261026 },
  qc: { fix: true, wetMonths: [6, 7, 8, 9], zeroRunDays: 30, flatlineMinutes: null },
};

/** Deep merge of defaults with user settings (arrays replaced, objects merged). */
export function withDefaults(s = {}) {
  const out = structuredClone(DEFAULT_SETTINGS);
  for (const [k, v] of Object.entries(s)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) out[k] = { ...out[k], ...v };
    else out[k] = v;
  }
  return out;
}

/** Strip closures (model.predict) so results are structured-cloneable. */
/** True for Koutsoyiannis model keys ('kgumbel:robust', 'kgev:mle', ...). NOT a prefix test: 'kimijima' also starts with 'k'. */
export function isKModelKey(key) { return /^(kgumbel|kgev):/.test(key); }

function plain(model) {
  const { predict, ...rest } = model;
  return rest;
}

/**
 * Build the regular series of a station.
 * station.data: { kind:'records', records:[{t,v}], step?, convention, tipping?, tipDepth? } |
 *               { kind:'series', origin, step, values } | { kind:'ams', years, depth }
 */
export function stationSeries(station) {
  const d = station.data;
  if (d.kind === 'series') return { origin: d.origin, step: d.step, values: Float64Array.from(d.values), log: [] };
  if (d.kind === 'records') return buildRegularSeries(d.records, { step: d.step || undefined, convention: d.convention || 'end', kind: d.tipping ? 'tips' : 'depth', tipDepth: d.tipDepth });
  return null;
}

/**
 * Run the analysis.
 * @param {object} station {id, name, data}
 * @param {object} settings user settings (merged with defaults)
 * @param {{calibration?:{rows:object[], returnPeriods:number[], ams?:object}, onProgress?:Function}} ctx
 */
export function analyseStation(station, settingsIn, ctx = {}) {
  const S = withDefaults(settingsIn);
  const progress = ctx.onProgress || (() => {});
  const out = { stationId: station.id, version: TOOL_VERSION, warnings: [], log: [] };
  const Ts = [...new Set([...S.returnPeriods])].sort((a, b) => a - b);

  // ---- 1. series, quality ---------------------------------------------------
  let ams; let step = null; let series = null;
  if (station.data.kind === 'ams') {
    const depth = {};
    const durs = Object.keys(station.data.depth).map(Number).sort((a, b) => a - b);
    for (const d of durs) depth[d] = station.data.depth[d].map((v) => (Number.isFinite(v) ? v : NaN));
    ams = { durations: durs, years: station.data.years.slice(), depth, when: {}, coverage: [], excluded: [], skipped: [], mode: 'given' };
    out.kind = 'ams';
    out.log.push(`Annual-maximum table supplied for ${durs.length} duration(s) and ${ams.years.length} year(s).`);
  } else {
    progress({ stage: 'Building series' });
    series = stationSeries(station);
    step = series.step;
    out.log.push(...series.log);
    const qc = qualityReport(series, { yearStartMonth: S.yearStartMonth, minCoverage: S.minCoverage, fix: S.qc.fix, wetMonths: S.qc.wetMonths, zeroRunDays: S.qc.zeroRunDays, flatlineMinutes: S.qc.flatlineMinutes ?? undefined });
    out.qc = { ...qc, gaps: qc.gaps.slice(0, 200), changed: qc.changed.slice(0, 500) };
    out.kind = step >= 1440 ? 'daily' : 'subdaily';
    out.series = { origin: series.origin, step: series.step, n: series.values.length, dailyStrip: dailyStrip(series, S.yearStartMonth) };
    progress({ stage: 'Extracting annual maxima' });
    const durs = S.durations.filter((d) => d % step === 0 && d >= step);
    if (out.kind === 'daily') for (const d of [1440, 2880, 4320]) if (!durs.includes(d) && d % step === 0) durs.push(d);
    durs.sort((a, b) => a - b);
    ams = annualMaxima(series, durs, { yearStartMonth: S.yearStartMonth, minCoverage: S.minCoverage, includeIncomplete: S.includeIncomplete, maxMissingFraction: S.maxMissingFraction, mode: S.amsMode });
    const skipped = S.durations.filter((d) => !durs.includes(d));
    if (skipped.length) out.log.push(`Durations not resolvable from ${step}-min data (need disaggregation or finer data): ${skipped.join(', ')} min.`);
    if (step <= 60 && durs.includes(1440)) {
      try { out.hershfield = empiricalHershfield(series, 1440, { yearStartMonth: S.yearStartMonth, minCoverage: S.minCoverage, includeIncomplete: S.includeIncomplete }); } catch { /* not enough data */ }
    }
  }
  out.ams = { durations: ams.durations, years: ams.years, depth: ams.depth, when: ams.when, coverage: ams.coverage, excluded: ams.excluded, mode: ams.mode };

  // ---- 2. fixed-interval factors -------------------------------------------
  const factors = {};
  for (const d of ams.durations) {
    if (out.kind === 'ams') factors[d] = S.fixedFactor.applyToAmsTables ? fixedIntervalFactor(1, S.fixedFactor.method, S.fixedFactor.table) : 1;
    else factors[d] = S.amsMode === 'sliding' || S.amsMode === 'fixed' ? fixedIntervalFactor(d / step, S.fixedFactor.method, S.fixedFactor.table) : 1;
  }
  out.factors = factors;
  const factor = (d) => factors[d] ?? 1;

  // ---- 3. trends ------------------------------------------------------------
  out.trends = ams.durations.map((d) => ({ d, ...mannKendall(ams.depth[d], ams.years) }));
  out.outliers = ams.durations.map((d) => ({ d, ...grubbsBeck(ams.depth[d].map((v) => v * factor(d)), ams.years) }));

  // ---- 4. distribution comparison per duration ------------------------------
  progress({ stage: 'Fitting distributions' });
  const combos = [];
  const dists = S.compareAll ? AMS_DISTRIBUTIONS : [S.dist];
  for (const dist of dists) for (const method of DISTRIBUTIONS[dist].methods) combos.push({ dist, method });
  if (Number.isFinite(S.fixedShape)) for (const dist of dists) if (FIXED_SHAPE_DISTS.includes(dist)) combos.push({ dist, method: 'lmomk', k: S.fixedShape });
  out.comparison = ams.durations.map((d) => {
    const x = ams.depth[d].filter(Number.isFinite).map((v) => v * factor(d));
    const rows = compareFits(x, combos, S.criterion, S.plotting).map((r) => ({ dist: r.dist, method: r.method, k: r.fit.fixedK, ok: r.fit.ok, message: r.fit.message, params: r.fit.params, nFree: r.fit.nFree, gof: r.gof }));
    return { d, n: x.length, rows };
  });

  // ---- 5. observed quantile table -------------------------------------------
  if (S.method === 'lmomk' && !Number.isFinite(S.fixedShape)) out.warnings.push('“L-moments, shape fixed” is selected but no shape k is set; enter k on the Frequency analysis screen.');
  const freq = { dist: S.dist, method: S.method, fixedK: S.fixedShape, perDuration: S.perDuration, returnPeriods: Ts, factor };
  const observed = quantileTable(ams, freq);
  out.observed = { returnPeriods: Ts, rows: observed.rows.map((r) => ({ d: r.d, n: r.n, depth: r.depth, intensity: r.intensity, factor: r.factor, fit: { dist: r.fit.dist, method: r.fit.method, params: r.fit.params, ok: r.fit.ok, message: r.fit.message, fixedK: r.fit.fixedK, nFree: r.fit.nFree } })) };
  out.freqChoice = { dist: S.dist, method: S.method, fixedK: S.fixedShape, criterion: S.criterion, plotting: S.plotting };
  for (const r of out.observed.rows) if (!r.fit.ok) out.warnings.push(`${r.d} min: ${r.fit.message}`);
  out.empirical = empiricalPoints(ams, S.plotting, factor);

  // ---- 5b. peaks over threshold (optional) ------------------------------------
  out.pot = null;
  if (S.pot.enabled || S.pot.use) {
    if (!series) out.warnings.push('Peaks-over-threshold needs a rainfall time series; it is not available for an annual-maximum table.');
    else {
      progress({ stage: 'Peaks over threshold' });
      const potOpt = { eventsPerYear: S.pot.eventsPerYear, separationHours: S.pot.separationHours, method: S.pot.method, shape: S.pot.shape, returnPeriods: Ts, factor };
      out.pot = potAnalysis(series, ams.durations, potOpt);
      const dStab = ams.durations.includes(1440) ? 1440 : ams.durations[0];
      out.pot.stability = { d: dStab, T: 10, rows: potStability(series, dStab, { ...potOpt, T: 10 }) };
      if (S.pot.use) {
        for (const r of out.observed.rows) {
          const p = out.pot.rows.find((q) => q.d === r.d);
          if (p && p.ok && p.depth.every(Number.isFinite)) { r.depth = p.depth; r.intensity = p.intensity; r.source = 'pot'; }
          else out.warnings.push(`${r.d} min: peaks-over-threshold failed (${p?.message || 'no result'}); the annual-maximum quantiles are used for this duration.`);
        }
        out.log.push(`Design quantiles from peaks over threshold: about ${S.pot.eventsPerYear} events/yr, ${S.pot.separationHours} h separation, ${S.pot.shape === 'exp' ? 'exponential' : 'GPA'} excesses (${S.pot.method === 'mle' ? 'maximum likelihood' : 'L-moments'}).`);
      }
    }
  }

  // ---- 6. sub-daily estimates for daily-only stations -----------------------
  const subDaily = S.durations.filter((d) => d < 1440 && !ams.durations.includes(d));
  const row24 = out.observed.rows.find((r) => r.d === 1440);
  out.disaggregation = null;
  // Disaggregation is for daily-only stations. A sub-daily station coarser than some requested durations
  // (e.g. hourly data and 5-30 min) does NOT get those rows by default: in the hold-out test the IMD formula
  // underestimated by 30-45%, and mixing such rows with observed quantiles would contaminate the IDF fit.
  // Expert opt-in (disagg.fillBelowResolution): extrapolate with a power law calibrated on the station's
  // own sub-daily quantiles, labelled EXPERIMENTAL.
  const fillSub = out.kind === 'subdaily' && S.disagg.fillBelowResolution;
  if (subDaily.length && out.kind === 'subdaily' && !fillSub) {
    out.warnings.push(`Durations shorter than the ${step}-min record resolution (${subDaily.join(', ')} min) are not estimated. Curves and equations cover ${Math.min(...ams.durations)} min and longer only. An experimental extrapolation is available on the “Short durations” screen (expert mode).`);
  }
  if (fillSub && subDaily.length && row24) {
    progress({ stage: 'Extrapolating below the record resolution' });
    const dg = { returnPeriods: Ts, durations: subDaily, methods: {}, belowResolution: true };
    try {
      const n = calibratePowerExponent(out.observed.rows.filter((r) => r.fit.ok && r.d <= 1440), Ts).n;
      dg.methods.power = { ...disaggregate(row24.depth, subDaily, Ts, { method: 'power', n }), n };
      dg.calibratedFrom = 'this station’s own sub-daily quantiles';
      dg.selected = 'power';
      out.disaggregation = dg;
      out.warnings.push(`EXPERIMENTAL: ${subDaily.join(', ')} min rows are extrapolated below the ${step}-min record resolution with a power law (n = ${n.toFixed(3)}) calibrated on this station's own quantiles.`);
    } catch (e) { out.warnings.push(`Extrapolation below the record resolution failed: ${e.message}`); }
  } else if (subDaily.length && row24 && out.kind !== 'subdaily') {
    progress({ stage: 'Disaggregating daily quantiles' });
    const p24 = row24.depth;
    const dg = { returnPeriods: Ts, durations: subDaily, methods: {} };
    dg.methods.imd = disaggregate(p24, subDaily, Ts, { method: 'imd' });
    let n = S.disagg.n; let H = S.disagg.H;
    if (ctx.calibration) {
      try { n = calibratePowerExponent(ctx.calibration.rows, ctx.calibration.returnPeriods).n; dg.calibratedFrom = ctx.calibration.name; } catch (e) { out.warnings.push(`Calibration failed: ${e.message}`); }
      if (ctx.calibration.ams) { try { H = scalingAnalysis(ctx.calibration.ams).H; } catch { /* ignore */ } }
    }
    if (ctx.calibration) {
      try {
        const rt = calibrateRatios(ctx.calibration.rows, ctx.calibration.returnPeriods, subDaily);
        dg.methods.ratioTransfer = { ...disaggregate(p24, subDaily, Ts, { method: 'ratioTransfer', ratios: rt.ratios }), ratios: rt.ratios };
        const miss = subDaily.filter((d) => !Number.isFinite(rt.ratios[d]));
        if (miss.length) out.warnings.push(`Ratio transfer: the calibration station does not cover ${miss.join(', ')} min (no extrapolation), so those rows are missing for this method.`);
      } catch (e) { out.warnings.push(`Ratio transfer failed: ${e.message}`); }
    }
    if (Number.isFinite(n)) dg.methods.power = { ...disaggregate(p24, subDaily, Ts, { method: 'power', n }), n };
    if (Number.isFinite(H)) dg.methods.scaling = { ...disaggregate(p24, subDaily, Ts, { method: 'scaling', H, refDuration: 1440 }), H };
    if (S.disagg.ratios && Object.keys(S.disagg.ratios).length) dg.methods.ratios = disaggregate(p24, subDaily, Ts, { method: 'ratios', ratios: S.disagg.ratios });
    if (Number.isFinite(S.disagg.p60_10)) dg.methods.bell = disaggregate(p24, subDaily.filter((d) => d >= 5 && d <= 120), Ts, { method: 'bell', p60_10: S.disagg.p60_10 });
    dg.selected = dg.methods[S.disagg.method] ? S.disagg.method : 'imd';
    if (dg.selected !== S.disagg.method) out.warnings.push(`Disaggregation method '${S.disagg.method}' needs inputs that are missing; using IMD instead.`);
    out.disaggregation = dg;
  }

  // ---- 7. design table = observed (+ disaggregated rows) --------------------
  const design = { returnPeriods: Ts, rows: out.observed.rows.filter((r) => r.fit.ok || r.source === 'pot').map((r) => ({ d: r.d, depth: r.depth, intensity: r.intensity, source: r.source === 'pot' ? 'observed (POT)' : 'observed' })) };
  if (out.disaggregation) {
    for (const r of out.disaggregation.methods[out.disaggregation.selected].rows) {
      if (r.depth.every(Number.isFinite)) design.rows.push({ d: r.d, depth: r.depth, intensity: r.intensity, source: `disaggregated (${out.disaggregation.selected})` });
    }
  }
  design.rows.sort((a, b) => a.d - b.d);
  out.design = design;

  // ---- 8. IDF model fitting --------------------------------------------------
  progress({ stage: 'Fitting IDF relationships' });
  const models = [];
  const minD = Math.min(...ams.durations);
  const theta = S.fixTheta === 'auto' ? (minD >= 60 ? 0 : null) : S.fixTheta;
  for (const key of S.models) {
    try {
      if (isKModelKey(key)) {
        if (S.pot.use && out.pot) { out.log.push(`${key}: skipped (the Koutsoyiannis models are fitted to annual maxima, but the design quantiles come from peaks over threshold).`); continue; }
        if (out.kind === 'daily' || ams.durations.length < 3) { out.log.push(`${key}: skipped (needs annual maxima at >= 3 durations; daily-only data use the formulas fitted to the disaggregated table).`); continue; }
        const [model, method] = key.split(':');
        const m = fitKModel(model, ams, { method, unit: S.unit, factor, fixTheta: theta });
        models.push({ key, ...plain(m) });
      } else {
        const m = fitForm(key, design, { unit: S.unit, space: S.fitSpace, nStarts: 16, seed: 7 });
        models.push({ key, ...plain(m) });
      }
      progress({ stage: `Fitted ${key}` });
    } catch (e) {
      out.warnings.push(`IDF model ${key} failed: ${e.message}`);
    }
  }
  if (theta === 0 && S.fixTheta === 'auto') out.log.push('Shortest duration >= 1 h: theta fixed at 0 for the Koutsoyiannis models (not estimable without sub-hourly data).');
  const ranked = rankModels(models, design);
  out.models = ranked.map((r) => ({ model: r.model, metrics: { ...r.metrics }, issues: r.issues, caution: r.caution ?? null }));
  const sel = S.selectedModel && out.models.find((r) => r.model.key === S.selectedModel);
  if (sel) {
    out.selectedKey = sel.model.key;
    out.selectionReason = 'Chosen by you.';
  } else {
    // Default choice (DECISIONS D4): prefer a Koutsoyiannis model, which is consistent with the fitted
    // distribution at every return period, provided it reproduces the per-duration quantiles where those
    // are reliable (T <= 10 yr) within 10%. Otherwise fall back to the best-AICc model and say why.
    const PREF = ['kgumbel:robust', 'kgev:robust', 'kgev:mle', 'kgumbel:mle', 'kgev:onestep', 'kgumbel:onestep'];
    const worstShort = (r) => Math.max(0, ...r.metrics.resid.filter((q) => q.T <= 10).map((q) => Math.abs(q.pct)));
    const kRows = PREF.map((k) => out.models.find((r) => r.model.key === k)).filter(Boolean);
    const kOk = kRows.find((r) => !r.issues.length && worstShort(r) <= 10);
    if (kOk) {
      out.selectedKey = kOk.model.key;
      out.selectionReason = `Koutsoyiannis general IDF selected by default: it is consistent with the frequency distribution at every return period, and it reproduces the per-duration quantiles within ${worstShort(kOk).toFixed(1)}% for T ≤ 10 yr.`;
    } else {
      // Fallback: the equation with the smallest worst-case error against the design table (an equation's job
      // is to reproduce that table; AICc on pooled log residuals can favour a form with large local errors).
      const pool = out.models.filter((r) => !r.issues.length);
      const best = (pool.length ? pool : out.models).slice().sort((a, b) => a.metrics.maxAbsPct - b.metrics.maxAbsPct)[0];
      out.selectedKey = best?.model.key ?? null;
      const why = kRows.length
        ? `No Koutsoyiannis model reproduced the per-duration quantiles within 10% for T ≤ 10 yr (closest: ${Math.min(...kRows.map(worstShort)).toFixed(1)}%), so the equation with the smallest worst-case error (${best.metrics.maxAbsPct.toFixed(1)}%) was selected.`
        : `Equation with the smallest worst-case error (${best?.metrics.maxAbsPct.toFixed(1)}%) selected (no Koutsoyiannis model was fitted).`;
      const extra = best && best.metrics.maxAbsPct > 10 ? ' No equation reproduces the quantiles within 10%: for design, consider reading values from the quantile table (curves screen, “Quantiles”) instead of an equation.' : '';
      const perT = best && best.model.type === 'form' && best.model.perT && !best.model.unified ? ' Do not extrapolate a per-return-period equation beyond the return periods it was fitted to.' : '';
      out.selectionReason = why + extra + perT;
    }
  }
  progress({ stage: 'Done' });
  return out;
}

/** Year x day-of-year matrix of daily totals for the record strip (NaN = missing). */
function dailyStrip(series, yearStartMonth) {
  const dayMs = 86400000;
  const perDay = Math.max(1, Math.round(1440 / series.step));
  const stepMs = series.step * 60000;
  const t0 = series.origin;
  const firstYear = new Date(t0).getUTCFullYear();
  const lastYear = new Date(t0 + series.values.length * stepMs).getUTCFullYear();
  const years = [];
  for (let y = firstYear; y <= lastYear; y++) years.push(y);
  const z = years.map(() => new Array(366).fill(null));
  const sums = new Map();
  for (let i = 0; i < series.values.length; i++) {
    const t = t0 + i * stepMs;
    const day = Math.floor(t / dayMs);
    const v = series.values[i];
    const s = sums.get(day) || { s: 0, n: 0, miss: 0 };
    if (Number.isNaN(v)) s.miss++; else { s.s += v; s.n++; }
    sums.set(day, s);
  }
  for (const [day, s] of sums) {
    const d = new Date(day * dayMs);
    const y = d.getUTCFullYear();
    const doy = Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / dayMs);
    const row = years.indexOf(y);
    if (row < 0) continue;
    z[row][doy] = s.miss > 0.2 * perDay ? -1 : s.s; // -1 marks a (mostly) missing day
  }
  return { years, z };
}
