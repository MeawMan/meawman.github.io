// series.js - turning daily / sub-daily records into AMS or POT samples.
//
//  annualMaxima(records, {waterYearStartMonth, minCompleteness})
//      Water year labelled by the calendar year in which it STARTS (e.g. April 2020 - March
//      2021 = "2020"). Default start month is 4 (April) - see DECISIONS.md: BWDB hydrological
//      years commonly run April-March, which keeps the whole monsoon in one year.
//      Years with less than minCompleteness (fraction of days with data) are flagged and
//      excluded by default, unless their maximum exceeds every complete year's maximum
//      (a flood might be why data are missing: user decides).
//  peaksOverThreshold(records, threshold, {minSeparationDays, minDropFraction})
//      Independence (declustering) criteria in the spirit of the FEH/USWRC rules: two peaks
//      are separate events if they are at least minSeparationDays apart AND the flow
//      between them falls below minDropFraction x the smaller peak. Otherwise the larger
//      peak of the cluster is kept.
//  meanResidualLife / parameterStability : threshold selection aids (Coles 2001, 4.3.1).

import { fitDistribution } from './fit.js';
import { mean, sd } from './stats.js';
import { normPpf } from './special.js';
import { DISTRIBUTIONS } from './distributions.js';
import { RNG } from './rng.js';
import { bootLimits } from './bootci.js';

const DAY = 86400000;

export function waterYearOf(date, startMonth = 4) {
  const y = date.getUTCFullYear(), m = date.getUTCMonth() + 1;
  return m >= startMonth ? y : y - 1;
}

/** records: [{date: Date, value: number|NaN}] sorted or not. */
export function annualMaxima(records, { waterYearStartMonth = 4, minCompleteness = 0.8 } = {}) {
  const byYear = new Map();
  let step = Infinity;
  const sorted = records.filter((r) => r.date instanceof Date && !isNaN(r.date)).sort((a, b) => a.date - b.date);
  for (let i = 1; i < sorted.length; i++) { const d = sorted[i].date - sorted[i - 1].date; if (d > 0) step = Math.min(step, d); }
  if (!isFinite(step)) step = DAY;
  const perYear = Math.round(365.25 * DAY / step);
  for (const r of sorted) {
    const wy = waterYearOf(r.date, waterYearStartMonth);
    if (!byYear.has(wy)) byYear.set(wy, { year: wy, max: -Infinity, date: null, count: 0 });
    const e = byYear.get(wy);
    if (Number.isFinite(r.value)) { e.count++; if (r.value > e.max) { e.max = r.value; e.date = r.date; } }
  }
  const years = [...byYear.values()].sort((a, b) => a.year - b.year).map((e) => ({ ...e, completeness: e.count / perYear }));
  const complete = years.filter((e) => e.completeness >= minCompleteness && Number.isFinite(e.max));
  const maxComplete = Math.max(...complete.map((e) => e.max));
  for (const e of years) {
    e.included = e.completeness >= minCompleteness && Number.isFinite(e.max);
    e.flag = !e.included && e.max > maxComplete ? 'Incomplete year whose maximum exceeds every complete year: probably a real flood - consider including it.' : (!e.included ? 'Excluded: incomplete year' : '');
  }
  return { years, stepMs: step, perYear };
}

export function peaksOverThreshold(records, threshold, { minSeparationDays = 7, minDropFraction = 2 / 3 } = {}) {
  const s = records.filter((r) => Number.isFinite(r.value)).sort((a, b) => a.date - b.date);
  // 1. find local peaks of contiguous exceedance runs
  const runs = [];
  let cur = null;
  for (let i = 0; i < s.length; i++) {
    if (s[i].value > threshold) {
      if (!cur) cur = { peak: s[i], i0: i };
      else if (s[i].value > cur.peak.value) cur.peak = s[i];
      cur.i1 = i;
    } else if (cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  // 2. merge runs that are not independent
  const peaks = [];
  for (const r of runs) {
    const last = peaks[peaks.length - 1];
    if (last) {
      const sep = (r.peak.date - last.peak.date) / DAY;
      let trough = Infinity;
      const a = Math.min(last.idx, r.i0), b = Math.max(last.idx, r.i0);
      for (let j = a; j <= b; j++) trough = Math.min(trough, s[j].value);
      const independent = sep >= minSeparationDays && trough < minDropFraction * Math.min(last.peak.value, r.peak.value);
      if (!independent) {
        if (r.peak.value > last.peak.value) { last.peak = r.peak; last.idx = s.indexOf(r.peak); }
        continue;
      }
    }
    peaks.push({ peak: r.peak, idx: s.indexOf(r.peak) });
  }
  // The event rate must use the time actually OBSERVED: with gaps (common in BWDB records), the span
  // from the first to the last value overstates the record length and biases lambda, and every
  // return level, low. Observed time = number of values x the usual time step (median spacing).
  const spanYears = s.length ? (s[s.length - 1].date - s[0].date) / (365.25 * DAY) + (1 / 365.25) : 0;
  const step = medianStep(s);
  const observedYears = s.length && step ? Math.min(spanYears, (s.length * step) / (365.25 * DAY)) : spanYears;
  const values = peaks.map((p) => p.peak.value);
  return { peaks: peaks.map((p) => ({ date: p.peak.date, value: p.peak.value })), values, nYears: observedYears, spanYears, gapYears: spanYears - observedYears, stepDays: step / DAY, lambda: values.length / observedYears, threshold };
}

/** Median spacing between consecutive dated values (ms); robust to gaps. */
function medianStep(s) {
  const d = [];
  for (let i = 1; i < s.length; i++) { const v = s[i].date - s[i - 1].date; if (v > 0) d.push(v); }
  if (!d.length) return DAY;
  d.sort((a, b) => a - b);
  return d[Math.floor(d.length / 2)];
}

/** Mean excess over each threshold with approximate 95 % CI; linear in u above a valid threshold. */
export function meanResidualLife(values, thresholds) {
  return thresholds.map((u) => {
    const ex = values.filter((v) => v > u).map((v) => v - u);
    if (ex.length < 3) return { u, mean: NaN, lo: NaN, hi: NaN, n: ex.length };
    const m = mean(ex), se = sd(ex) / Math.sqrt(ex.length), z = normPpf(0.975);
    return { u, mean: m, lo: m - z * se, hi: m + z * se, n: ex.length };
  });
}

/** GPA shape k and modified scale across thresholds: both should be ~constant above a valid threshold. */
export function parameterStability(values, thresholds, method = 'mle') {
  return thresholds.map((u) => {
    const ex = values.filter((v) => v > u);
    if (ex.length < 10) return { u, n: ex.length, k: NaN, modScale: NaN };
    const f = fitDistribution('GPA', ex, method, { loc: u });
    if (!f.ok) return { u, n: ex.length, k: NaN, modScale: NaN };
    const [, a, k] = f.params;
    // Coles' modified scale sigma* = sigma_u - xi*u, with xi = -k (Hosking sign): alpha + k*u
    return { u, n: ex.length, k, modScale: a + k * u };
  });
}

/**
 * POT -> return level for T years with lambda events per year (GPA fitted to exceedances).
 *   basis 'pds' : T is the average interval between exceedances (partial-duration ARI): F = 1 - 1/(lambda T).
 *   basis 'ams' : T is an annual-maximum return period. With Poisson arrivals, P(annual max <= x) =
 *                 exp{-lambda [1 - G(x)]}, so G(x_T) = 1 + ln(1 - 1/T)/lambda (Stedinger et al. 1993, eq. 18.6.4;
 *                 Madsen et al. 1997). Directly comparable with the annual-maximum design floods.
 * NaN when the T-year level lies below the threshold.
 */
export function potReturnLevel(gpaParams, lambda, T, basis = 'pds') {
  const F = basis === 'ams' ? 1 + Math.log(1 - 1 / T) / lambda : 1 - 1 / (lambda * T);
  if (!(F > 0 && F < 1)) return NaN; // the T-year event is below the threshold
  const [xi, a, k] = gpaParams;
  return Math.abs(k) < 1e-8 ? xi - a * Math.log(1 - F) : xi + a * (1 - Math.pow(1 - F, k)) / k;
}
/** Langbein (1949): convert partial-duration return period to annual-maximum return period. */
export const langbeinAnnualT = (Tpds) => 1 / (1 - Math.exp(-1 / Tpds));
/** Inverse of langbeinAnnualT: partial-duration ARI for an annual-maximum return period. */
export const langbeinPdsT = (Tams) => -1 / Math.log(1 - 1 / Tams);

/**
 * Parametric bootstrap of POT return levels that includes the uncertainty of the event rate.
 * Each replicate draws the number of exceedances from Poisson(lambda * nYears), simulates that many
 * exceedances from the fitted GPA (location = threshold), refits by the same method with the threshold
 * fixed, and evaluates the T-year level with the replicate's own rate lambda* = n* / nYears.
 * (Holding lambda fixed, as a plain bootstrap of the exceedances does, understates the uncertainty
 * at short return periods; Coles 2001, sec. 4.4.1.)
 */
export function potBootstrap(fit, lambda, nYears, Ts, { nBoot = 500, seed = 1, level = 0.9, method = 'mle', threshold, correction = 'percentile', basis = 'pds' } = {}) {
  const rng = new RNG(seed);
  const gpa = DISTRIBUTIONS.GPA;
  const reps = Ts.map(() => []);
  let failed = 0;
  for (let b = 0; b < nBoot; b++) {
    const n = rng.poisson(lambda * nYears);
    if (n < 10) { failed++; continue; }
    const sim = Array.from({ length: n }, () => gpa.quantile(rng.uniformOpen(), fit.params));
    const r = fitDistribution('GPA', sim, method, { loc: threshold });
    if (!r.ok) { failed++; continue; }
    const lam = n / nYears;
    Ts.forEach((T, j) => { const q = potReturnLevel(r.params, lam, T, basis); if (Number.isFinite(q)) reps[j].push(q); });
  }
  const intervals = Ts.map((T, j) => {
    const s = Float64Array.from(reps[j]).sort();
    if (s.length < 20) return { lo: NaN, hi: NaN, se: NaN };
    let m = 0; for (const v of s) m += v; m /= s.length;
    let v2 = 0; for (const v of s) v2 += (v - m) ** 2;
    const lim = bootLimits(s, potReturnLevel(fit.params, lambda, T, basis), level, correction === 'bca' ? 'bc' : correction);
    return { lo: lim.lo, hi: lim.hi, se: Math.sqrt(v2 / (s.length - 1)) };
  });
  return { intervals, Ts, nBoot, failed, level, method: 'parametric bootstrap, Poisson event count', correction, basis };
}
