/**
 * pot.js — peaks-over-threshold (partial-duration) frequency analysis.
 *
 * For each duration d:
 *  1. independent peaks of the d-duration rolling depth are selected (timeseries.peaksOverThreshold:
 *     largest first, windows at least max(separation, d) apart), aiming at a chosen number of events per year;
 *  2. the threshold u is the smallest selected peak; excesses y = peak − u of the peaks above u are fitted
 *     with a generalised Pareto distribution (GPA, Hosking's shape k; known threshold), or an exponential
 *     (k = 0). Estimation: L-moments (k = λ1/λ2 − 2, α = (1 + k) λ1 on the excesses) or maximum likelihood;
 *  3. with λ exceedances per year (Poisson arrivals), the annual-maximum return-period-T depth is
 *        x_T = u + Q_GPA(F*),   F* = 1 + ln(1 − 1/T)/λ
 *     (Madsen et al. 1997; Stedinger et al. 1993, eq. 18.6.4). This is exact for the AMS return period, so POT and
 *     AMS quantiles can be compared at the same T.
 *
 * The record length used for the rate is the time actually observed (missing intervals are not counted).
 */
import { peaksOverThreshold } from './timeseries.js';
import { nelderMead } from './optim.js';

const SMALL_K = 1e-7;

/** GPA quantile of the excess for non-exceedance probability F (Hosking shape k). */
export function gpaExcessQuantile(F, a, k) {
  const r = 1 - F;
  if (Math.abs(k) < SMALL_K) return -a * Math.log(r);
  return a * (1 - Math.pow(r, k)) / k;
}

/** Fit a GPA (or exponential) to threshold excesses. */
export function fitExcesses(y, { method = 'lmom', shape = 'free' } = {}) {
  const n = y.length;
  if (n < 5) throw new Error(`only ${n} peaks above the threshold (need at least 5)`);
  const m1 = y.reduce((a, b) => a + b, 0) / n;
  if (shape === 'exp') return { a: m1, k: 0, method: 'exponential (mean excess)' };
  if (method === 'lmom') {
    const s = y.slice().sort((p, q) => p - q);
    let b1 = 0;
    for (let i = 0; i < n; i++) b1 += (i / (n - 1)) * s[i];
    b1 /= n;
    const l1 = m1; const l2 = 2 * b1 - m1;
    const k = l1 / l2 - 2;
    return { a: (1 + k) * l1, k, method: 'L-moments' };
  }
  // maximum likelihood on (ln a, k), Hosking parametrisation, k > -1 (finite mean), support 1 - k y/a > 0
  const ymax = Math.max(...y);
  const nll = ([la, k]) => {
    const a = Math.exp(la);
    if (!(k > -1) || !(k < 1.5)) return Infinity;
    if (k > 0 && k * ymax / a >= 1) return Infinity;
    let s = n * la;
    for (const v of y) {
      if (Math.abs(k) < SMALL_K) s += v / a;
      else s -= (1 / k - 1) * Math.log(1 - k * v / a);
    }
    return s;
  };
  const start = fitExcesses(y, { method: 'lmom' });
  let x0 = [Math.log(start.a), Math.min(0.9, Math.max(-0.9, start.k))];
  if (!isFinite(nll(x0))) x0 = [Math.log(m1), 0];
  const r = nelderMead(nll, x0, { step: [0.1, 0.05], maxIter: 4000, tol: 1e-12, restarts: 3 });
  return { a: Math.exp(r.x[0]), k: r.x[1], method: 'maximum likelihood' };
}

/** Observed years: non-missing intervals × step. */
export function observedYears(series) {
  let ok = 0;
  for (const v of series.values) if (!Number.isNaN(v)) ok++;
  return (ok * series.step) / 525960;
}

/**
 * POT quantiles for several durations.
 * @param {{values:Float64Array, step:number, origin:number}} series
 * @param {number[]} durations minutes (multiples of the step)
 * @param {{eventsPerYear?:number, separationHours?:number, method?:'lmom'|'mle', shape?:'free'|'exp',
 *          returnPeriods:number[], factor?:(d:number)=>number}} opt
 */
export function potAnalysis(series, durations, opt) {
  const years = observedYears(series);
  const Ts = opt.returnPeriods;
  const rows = [];
  for (const d of durations) {
    const f = opt.factor ? opt.factor(d) : 1;
    const row = { d, ok: false, message: '', factor: f, years };
    try {
      const pk = peaksOverThreshold(series, d, { eventsPerYear: opt.eventsPerYear ?? 3, separationHours: opt.separationHours ?? 24, yearsUsed: years });
      const u = pk.threshold;
      const y = pk.peaks.map((p) => p.value - u).filter((v) => v > 0);
      const lambda = y.length / years;
      const fit = fitExcesses(y, { method: opt.method, shape: opt.shape });
      const depth = Ts.map((T) => {
        const F = 1 + Math.log(1 - 1 / T) / lambda;
        return F > 0 && F < 1 ? (u + gpaExcessQuantile(F, fit.a, fit.k)) * f : NaN;
      });
      Object.assign(row, { ok: true, threshold: u, nPeaks: y.length, rate: lambda, a: fit.a, k: fit.k, method: fit.method, depth, intensity: depth.map((v) => v / (d / 60)) });
      if (depth.some((v) => !Number.isFinite(v))) row.message = `rate ${lambda.toFixed(2)}/yr is too low for the shortest return period; raise the events per year`;
      if (fit.k < -0.5) row.message = (row.message ? row.message + '; ' : '') + 'very heavy tail (k < −0.5): long return periods are unreliable';
    } catch (e) {
      row.message = e.message;
      row.depth = Ts.map(() => NaN);
      row.intensity = row.depth.slice();
    }
    rows.push(row);
  }
  return { returnPeriods: Ts, years, eventsPerYear: opt.eventsPerYear ?? 3, separationHours: opt.separationHours ?? 24, method: opt.method ?? 'lmom', shape: opt.shape ?? 'free', rows };
}

/** Threshold stability: shape k and one quantile against the number of events per year. */
export function potStability(series, d, opt) {
  const rates = opt.rates ?? [1, 1.5, 2, 3, 4, 5];
  return rates.map((r) => {
    const res = potAnalysis(series, [d], { ...opt, eventsPerYear: r, returnPeriods: [opt.T ?? 10] }).rows[0];
    return { eventsPerYear: r, ok: res.ok, threshold: res.threshold, k: res.k, a: res.a, rate: res.rate, q: res.depth[0], message: res.message };
  });
}
