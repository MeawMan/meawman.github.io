// uncertainty.js - confidence intervals for quantiles (design floods).
//
//   bootstrapQuantiles : parametric or non-parametric bootstrap, percentile intervals
//   deltaMethod        : MLE only; observed information from a numerical Hessian
//   profileLikelihood  : MLE only; for distributions whose first parameter is a location
//                        shift (in transformed space). Usually best for long return periods
//                        because the interval is asymmetric (Coles 2001, sec. 3.3.3).
//
// All CIs describe SAMPLING uncertainty under the chosen model; they do not include the
// uncertainty of choosing the model itself.

import { DISTRIBUTIONS } from './distributions.js';
import { fitDistribution, negLogLik } from './fit.js';
import { numHessian, invertMatrix, nelderMead, numGradient, brent } from './optim.js';
import { normPpf, gammaPpf } from './special.js';
import { quantileSorted } from './stats.js';
import { RNG } from './rng.js';
import { bootLimits, jackknifeAcceleration } from './bootci.js';

export const CI_METHODS = {
  'boot-param': 'Parametric bootstrap',
  'boot-nonparam': 'Non-parametric bootstrap',
  delta: 'Delta method (ML only)',
  profile: 'Profile likelihood (ML only)',
};

const chi2_1 = (level) => 2 * gammaPpf(0.5, level); // chi-square(1) quantile

/** Quantiles x_T for the given non-exceedance probabilities. */
export function quantiles(distId, params, Fs) {
  const d = DISTRIBUTIONS[distId];
  return Fs.map((F) => d.quantile(F, params));
}

export function bootstrapQuantiles(data, fit, Fs, opts = {}) {
  const { nBoot = 1000, seed = 1, level = 0.9, type = 'boot-param', fitOpts = {}, onProgress, shouldStop } = opts;
  // 'bca' needs jackknife re-fits of the original sample, which only make sense for the non-parametric bootstrap
  const correction = opts.correction === 'bca' && type !== 'boot-nonparam' ? 'bc' : (opts.correction ?? 'percentile');
  const d = DISTRIBUTIONS[fit.distId], n = data.length, rng = new RNG(seed);
  const reps = Fs.map(() => []);
  let failed = 0;
  for (let b = 0; b < nBoot; b++) {
    if (shouldStop && shouldStop()) break;
    const sim = type === 'boot-nonparam' ? rng.resample(data)
      : Array.from({ length: n }, () => d.quantile(rng.uniformOpen(), fit.params));
    const r = fitDistribution(fit.distId, sim, fit.method, fitOpts);
    if (!r.ok) { failed++; continue; }
    Fs.forEach((F, j) => { const q = d.quantile(F, r.params); if (Number.isFinite(q)) reps[j].push(q); });
    if (onProgress && b % 20 === 0) onProgress(b / nBoot);
  }
  let accel = Fs.map(() => 0);
  if (correction === 'bca') {
    const jack = Fs.map(() => []);
    for (let i = 0; i < n; i++) {
      const r = fitDistribution(fit.distId, data.filter((_, k) => k !== i), fit.method, fitOpts);
      if (r.ok) Fs.forEach((F, j) => jack[j].push(d.quantile(F, r.params)));
    }
    accel = jack.map((v) => (v.length > 2 ? jackknifeAcceleration(v.filter(Number.isFinite)) : 0));
  }
  const out = Fs.map((F, j) => {
    const s = Float64Array.from(reps[j]).sort();
    if (s.length < 20) return { lo: NaN, hi: NaN, se: NaN };
    let m = 0; for (const v of s) m += v; m /= s.length;
    let v2 = 0; for (const v of s) v2 += (v - m) ** 2;
    const lim = bootLimits(s, d.quantile(F, fit.params), level, correction, accel[j]);
    return { lo: lim.lo, hi: lim.hi, se: Math.sqrt(v2 / (s.length - 1)), z0: lim.z0 };
  });
  return { intervals: out, nBoot, failed, method: type, correction, level };
}

function mleNll(distId, data, fixedLoc) {
  const d = DISTRIBUTIONS[distId];
  return (p) => (d.validParams(p) ? negLogLik(d, data, p) : Infinity);
}

/**
 * Delta method for ML fits: var(x_T) = g' V g, V = H^-1 of the negative log-likelihood.
 * Log-based distributions (LN2 on ln x, LP3 on log10 x) are fitted in log space, where the
 * quantile is close to normal; the interval is formed there and transformed back, so it is
 * asymmetric and always positive (as in Kite 1977 and Bulletin 17B for LP3). The SE reported is
 * that of x_T itself (first-order).
 */
export function deltaMethod(data, fit, Fs, level = 0.9) {
  if (fit.method !== 'mle') return { error: 'The delta method here uses the observed information matrix, so it needs a maximum-likelihood fit.' };
  const d = DISTRIBUTIONS[fit.distId];
  const H = numHessian(mleNll(fit.distId, data), fit.params);
  const V = invertMatrix(H);
  if (!V || V.some((r, i) => !(r[i] > 0))) return { error: 'The information matrix is not positive definite (ML estimate on a boundary?).' };
  const z = normPpf(1 - (1 - level) / 2);
  const t = d.transform === 'log10' ? { f: Math.log10, inv: (y) => 10 ** y } : d.transform === 'ln' ? { f: Math.log, inv: Math.exp } : null;
  const qv = (fn) => {
    const g = numGradient(fn, fit.params, 1e-7);
    let v = 0;
    for (let i = 0; i < g.length; i++) for (let j = 0; j < g.length; j++) v += g[i] * V[i][j] * g[j];
    return Math.sqrt(Math.max(v, 0));
  };
  const intervals = Fs.map((F) => {
    const q = d.quantile(F, fit.params), se = qv((p) => d.quantile(F, p));
    if (!t) return { lo: q - z * se, hi: q + z * se, se };
    const y = t.f(q), sey = qv((p) => t.f(d.quantile(F, p)));
    return { lo: t.inv(y - z * sey), hi: t.inv(y + z * sey), se };
  });
  return { intervals, cov: V, method: 'delta', level, space: t ? 'log' : 'data' };
}

// distributions whose params[0] is a pure location shift in (possibly transformed) space
const LOCATION_FIRST = new Set(['NOR', 'GUM', 'GEV', 'GLO', 'PE3', 'LP3', 'LN2', 'LN3', 'GPA']);
const fwd = (d, x) => (d.transform === 'log10' ? Math.log10(x) : d.transform === 'ln' ? Math.log(x) : x);

/**
 * Profile-likelihood interval for x_T. With the location parameter eliminated through
 * x_T = loc + q0(F; other params), the profile is maximised over the other parameters.
 */
export function profileLikelihood(data, fit, Fs, level = 0.9) {
  if (fit.method !== 'mle') return { error: 'Profile likelihood needs a maximum-likelihood fit.' };
  if (!LOCATION_FIRST.has(fit.distId)) return { error: 'Profile likelihood is implemented for location-scale(-shape) distributions only; use the bootstrap.' };
  // GPA with a free location: the likelihood is unbounded as the location approaches the smallest value,
  // so the profile is not a regular likelihood-ratio interval (Smith 1985). Fix the location (POT page) instead.
  if (fit.distId === 'GPA' && !fit.fixedLoc) return { error: 'Profile likelihood is not defined for a 3-parameter generalised Pareto with a free location (its likelihood is unbounded). Use the bootstrap, or the Peaks over threshold page where the location is the threshold.' };
  const d = DISTRIBUTIONS[fit.distId];
  const nll = mleNll(fit.distId, data);
  const nll0 = nll(fit.params);
  const crit = 0.5 * chi2_1(level);
  const intervals = Fs.map((F) => {
    const qHat = d.quantile(F, fit.params);
    const yHat = fwd(d, qHat);
    const paramsFor = (y, rest) => {
      // location giving transformed quantile y
      if (d.transform) {
        const loc = y - (d.transform === 'log10' ? Math.log10(d.quantile(F, [0, ...rest])) : Math.log(d.quantile(F, [0, ...rest])));
        return [loc, ...rest];
      }
      return [y - d.quantile(F, [0, ...rest]), ...rest];
    };
    // optimise positive (scale) parameters on the log scale
    const pos = d.paramNames.slice(1).map((nm) => ['alpha', 'sigma', 'scale'].includes(nm));
    const enc = (rest) => rest.map((v, i) => (pos[i] ? Math.log(v) : v));
    const dec = (v) => v.map((t, i) => (pos[i] ? Math.exp(t) : t));
    let warm = enc(fit.params.slice(1));
    const prof = (y) => {
      const r = nelderMead((v) => nll(paramsFor(y, dec(v))), warm, { restarts: 2 });
      if (Number.isFinite(r.fx)) warm = r.x;
      return r.fx;
    };
    // search outward from the estimate in transformed space
    const scaleY = Math.abs(yHat) * 1e-3 + (d.transform ? 0.01 : Math.abs(fit.params[1]) * 0.05);
    const g = (y) => prof(y) - nll0 - crit;
    const search = (dir) => {
      warm = enc(fit.params.slice(1));
      let step = scaleY, y0 = yHat, y1 = yHat + dir * step;
      for (let i = 0; i < 60; i++) {
        const v = g(y1);
        if (v > 0) return brent((y) => { const r = g(y); return Number.isFinite(r) ? r : 1e10; }, y0, y1, 1e-9 * (1 + Math.abs(yHat)));
        if (!Number.isFinite(v)) return NaN;
        y0 = y1; step *= 1.6; y1 = yHat + dir * step;
      }
      return dir > 0 ? Infinity : NaN;
    };
    const lo = search(-1), hi = search(1);
    const inv = (y) => (d.transform === 'log10' ? 10 ** y : d.transform === 'ln' ? Math.exp(y) : y);
    return { lo: inv(lo), hi: inv(hi), se: NaN };
  });
  return { intervals, method: 'profile', level };
}

export function confidenceIntervals(data, fit, Fs, method, opts = {}) {
  const level = opts.level ?? 0.9;
  if (method === 'delta') return deltaMethod(data, fit, Fs, level);
  if (method === 'profile') return profileLikelihood(data, fit, Fs, level);
  return bootstrapQuantiles(data, fit, Fs, { ...opts, type: method, level });
}
