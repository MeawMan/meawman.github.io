// fit.js - parameter estimation for every distribution and method.
//
// fitDistribution(distId, data, method, opts) -> result object
//   method : 'mom' | 'lmom' | 'pwm' | 'mle'
//   opts   : { skew: number          fixed skew for PE3/LP3 'mom' (e.g. regional/weighted skew)
//              skewType: 'unbiased'|'moment'   sample skew estimator for PE3/LP3 'mom'
//              loc: number           fixed location (GPA, e.g. POT threshold)
//              kRange: [lo, hi]      shape bounds for MLE of GEV/GLO/GPA (default [-1, 1])
//              n: sample size used for AIC (default data.length) }
// The result always has {ok, params, warnings, loglik, aic, aicc, bic}. Nothing throws on
// "hard" data: failures are reported as ok:false with a plain-language reason.

import { DISTRIBUTIONS, GEV, GUM, GLO, GPA, PE3, LN3, NOR, GAM, WEI, pe3Tau3 } from './distributions.js';
import { sampleLmoments } from './lmoments.js';
import { mean, sd, skew, variance } from './stats.js';
import { lgamma, gamma, digamma, EULER_GAMMA } from './special.js';
import { nelderMead, brent, findRoot } from './optim.js';

export const METHOD_LABELS = {
  mom: 'Method of moments', lmom: 'L-moments', pwm: 'Probability-weighted moments (plotting-position)', mle: 'Maximum likelihood',
};

/** Which estimation methods are implemented for each distribution. */
export const AVAILABLE_METHODS = {
  NOR: ['mom', 'lmom', 'mle'], LN2: ['mom', 'lmom', 'mle'], LN3: ['mom', 'lmom', 'mle'],
  GUM: ['mom', 'lmom', 'pwm', 'mle'], GEV: ['mom', 'lmom', 'pwm', 'mle'],
  PE3: ['mom', 'lmom', 'pwm', 'mle'], LP3: ['mom', 'lmom', 'pwm', 'mle'],
  GAM: ['mom', 'lmom', 'mle'], WEI: ['mom', 'lmom', 'mle'],
  GLO: ['lmom', 'pwm', 'mle'], GPA: ['mom', 'lmom', 'pwm', 'mle'],
};

const MIN_N = { NOR: 3, LN2: 3, LN3: 4, GUM: 3, GEV: 5, PE3: 4, LP3: 4, GAM: 3, WEI: 3, GLO: 5, GPA: 5 };

export function negLogLik(dist, data, p) {
  let s = 0;
  for (let i = 0; i < data.length; i++) {
    const l = dist.logpdf(data[i], p);
    if (!(l > -Infinity)) return Infinity;
    s -= l;
  }
  return s;
}

function logTransform(dist, data) {
  if (dist.transform === 'log10') return data.map(Math.log10);
  if (dist.transform === 'ln') return data.map(Math.log);
  return data;
}

// ---------------------------------------------------------------- method of moments
function gevSkewOfK(k) {
  if (Math.abs(k) < 1e-6) return 1.1395470994046486;
  const g1 = gamma(1 + k), g2 = gamma(1 + 2 * k), g3 = gamma(1 + 3 * k);
  return Math.sign(k) * (-g3 + 3 * g1 * g2 - 2 * g1 ** 3) / Math.pow(g2 - g1 * g1, 1.5);
}

function momEstimate(distId, x, y, opts) {
  const m = mean(x), s = sd(x);
  switch (distId) {
    case 'NOR': return [m, s];
    case 'LN2': return [mean(y), sd(y)];
    case 'GUM': { const a = s * Math.sqrt(6) / Math.PI; return [m - EULER_GAMMA * a, a]; }
    case 'GEV': {
      const G = opts.skew ?? skew(x, opts.skewType ?? 'unbiased');
      const k = findRoot((kk) => gevSkewOfK(kk) - G, -0.33, 8, 400, 1e-13);
      if (Number.isNaN(k)) return { fail: 'The sample skewness is outside the range the GEV can reproduce by the method of moments (needs skew > -0.2 roughly and k > -1/3).' };
      if (Math.abs(k) < 1e-6) { const a = s * Math.sqrt(6) / Math.PI; return [m - EULER_GAMMA * a, a, 0]; }
      const g1 = gamma(1 + k), g2 = gamma(1 + 2 * k);
      const a = s * Math.abs(k) / Math.sqrt(g2 - g1 * g1);
      return [m - a * (1 - g1) / k, a, k];
    }
    case 'PE3': return [m, s, opts.skew ?? skew(x, opts.skewType ?? 'unbiased')];
    case 'LP3': return [mean(y), sd(y), opts.skew ?? skew(y, opts.skewType ?? 'unbiased')];
    case 'GAM': { const v = variance(x); return [m * m / v, v / m]; }
    case 'LN3': {
      const G = skew(x, 'unbiased');
      if (!(G > 0)) return { fail: 'The 3-parameter log-normal needs positive skew; this sample has skew <= 0.' };
      // skew = (w + 2) sqrt(w - 1), w = exp(sigma^2): solve for w
      const w = brent((ww) => (ww + 2) * Math.sqrt(ww - 1) - G, 1 + 1e-12, 1e8);
      const s2 = Math.log(w);
      const mu = 0.5 * (Math.log(s * s / (w - 1)) - s2);
      return [m - Math.exp(mu + s2 / 2), mu, Math.sqrt(s2)];
    }
    case 'WEI': {
      const cv2 = variance(x) / (m * m);
      const k = findRoot((kk) => gamma(1 + 2 / kk) / gamma(1 + 1 / kk) ** 2 - 1 - cv2, 0.05, 200, 400, 1e-13);
      if (Number.isNaN(k)) return { fail: 'Could not match the sample coefficient of variation with a Weibull shape.' };
      return [m / gamma(1 + 1 / k), k];
    }
    case 'GPA': {
      if (opts.loc === undefined) return { fail: 'Method of moments for the 3-parameter GPA needs a fixed location (POT threshold); use L-moments or MLE instead.' };
      const mm = m - opts.loc, r = mm * mm / variance(x);
      return [opts.loc, 0.5 * mm * (r + 1), 0.5 * (r - 1)];
    }
    default: return { fail: 'Method of moments is not available for this distribution.' };
  }
}

// ---------------------------------------------------------------- L-moments
function lmomEstimate(distId, dist, x, y, method, opts) {
  const base = dist.transform ? y : x;
  const l = sampleLmoments(base, method === 'pwm' ? 'pp' : 'unbiased');
  if (distId === 'GPA' && opts.loc !== undefined) {
    // two-parameter GPA with known location (Hosking & Wallis 1987)
    const l1 = l.l1 - opts.loc, k = l1 / l.l2 - 2;
    return [opts.loc, (1 + k) * l1, k];
  }
  const p = dist.fromLmom(l);
  if (!p) return { fail: `The sample L-moment ratios (L-skewness = ${l.t3.toFixed(3)}) are outside the range this distribution can represent.` };
  return p;
}

// ---------------------------------------------------------------- maximum likelihood
function nmFit(f, start, opts = {}) {
  return nelderMead(f, start, { restarts: 5, ...opts });
}

function mleEstimate(distId, dist, x, y, opts, startFromOther) {
  const n = x.length;
  switch (distId) {
    case 'NOR': return [mean(x), sd(x, 0)];
    case 'LN2': return [mean(y), sd(y, 0)];
    case 'GUM': {
      const xmin = Math.min(...x), z = x.map((v) => v - xmin), mz = mean(z), s0 = sd(x);
      const g = (a) => { let sw = 0, swx = 0; for (const v of z) { const w = Math.exp(-v / a); sw += w; swx += w * v; } return a - mz + swx / sw; };
      let a = findRoot(g, s0 * 1e-3, s0 * 100, 300, 1e-13);
      if (Number.isNaN(a)) return { fail: 'Gumbel ML did not converge.' };
      let sw = 0; for (const v of z) sw += Math.exp(-v / a);
      return [xmin - a * Math.log(sw / n), a];
    }
    case 'GAM': {
      const s = Math.log(mean(x)) - mean(y0(x));
      const a = findRoot((aa) => Math.log(aa) - digamma(aa) - s, 1e-4, 1e8, 600, 1e-13);
      if (Number.isNaN(a)) return { fail: 'Gamma ML did not converge (sample may be nearly constant).' };
      return [a, mean(x) / a];
    }
    case 'WEI': {
      const lx = x.map(Math.log), ml = mean(lx);
      const g = (k) => { let a = 0, b = 0; for (let i = 0; i < n; i++) { const w = Math.pow(x[i], k); a += w * lx[i]; b += w; } return a / b - 1 / k - ml; };
      const k = findRoot(g, 0.05, 200, 600, 1e-13);
      if (Number.isNaN(k)) return { fail: 'Weibull ML did not converge.' };
      let sk = 0; for (const v of x) sk += Math.pow(v, k);
      return [Math.pow(sk / n, 1 / k), k];
    }
    case 'LN3': return ln3Mle(x, opts);
    case 'PE3': case 'LP3': return pe3Mle(dist, distId === 'LP3' ? y : x, x, opts, startFromOther);
    case 'GEV': case 'GLO': case 'GPA': return lss3Mle(dist, distId, x, opts, startFromOther);
    default: return { fail: 'Maximum likelihood is not available for this distribution.' };
  }
}
const y0 = (x) => x.map(Math.log);

/** Location-scale-shape families (GEV, GLO, GPA): simplex on (xi, ln alpha, k). */
function lss3Mle(dist, distId, x, opts, starts) {
  const [kLo, kHi] = opts.kRange ?? [-1, 1];
  const fixedLoc = distId === 'GPA' && opts.loc !== undefined;
  const nll = (v) => {
    const k = v[v.length - 1];
    if (k <= kLo || k >= kHi) return Infinity;
    const p = fixedLoc ? [opts.loc, Math.exp(v[0]), k] : [v[0], Math.exp(v[1]), k];
    return negLogLik(dist, x, p);
  };
  const m = mean(x), s = sd(x);
  const cand = [];
  for (const st of starts) cand.push(st);
  // generic fall-back starts
  cand.push(distId === 'GPA' ? [fixedLoc ? opts.loc : Math.min(...x) - 0.01 * s, s, 0.1] : [m - 0.45 * s, s * 0.78, 0.0]);
  let best = null;
  for (const st of cand) {
    if (!st) continue;
    const k0 = Math.min(Math.max(st[2], kLo + 0.02), kHi - 0.02);
    const v0 = fixedLoc ? [Math.log(st[1]), k0] : [st[0], Math.log(st[1]), k0];
    if (!isFinite(nll(v0))) {
      // try shrinking the shape towards 0 to find a feasible start
      let ok = false;
      for (const kk of [0, -0.1, 0.1, -0.3, 0.3]) { v0[v0.length - 1] = kk; if (isFinite(nll(v0))) { ok = true; break; } }
      if (!ok) continue;
    }
    const r = nmFit(nll, v0, { step: fixedLoc ? [0.2, 0.1] : [0.2 * s, 0.2, 0.1] });
    if (!best || r.fx < best.fx) best = r;
  }
  if (!best || !isFinite(best.fx)) return { fail: 'ML could not find a feasible starting point inside the data support; try L-moments.' };
  const k = best.x[best.x.length - 1];
  const p = fixedLoc ? [opts.loc, Math.exp(best.x[0]), k] : [best.x[0], Math.exp(best.x[1]), k];
  p.converged = best.converged;
  p.boundary = (k < kLo + 1e-3 || k > kHi - 1e-3);
  return p;
}

/** Pearson III (and LP3 on log10): simplex on (xi, ln beta, ln alpha) for a fixed skew sign. */
function pe3Mle(dist, base, x, opts, starts) {
  const n = base.length, mb = mean(base), sb = sd(base);
  const sgn0 = skew(base) >= 0 ? 1 : -1;
  const toParams = (v, s) => {
    const alpha = Math.exp(v[2]), beta = Math.exp(v[1]);
    return [v[0] + s * alpha * beta, beta * Math.sqrt(alpha), s * 2 / Math.sqrt(alpha)];
  };
  const nllBase = (v, s) => {
    const alpha = Math.exp(v[2]), beta = Math.exp(v[1]);
    // alpha < 1 (|skew| > 2) gives a J-shaped density whose likelihood is unbounded as the
    // bound approaches the extreme observation; restrict to alpha >= 1 (regular case).
    if (alpha > 1e7 || alpha < 1) return Infinity;
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const z = s * (base[i] - v[0]) / beta;
      if (z <= 0) return Infinity;
      sum += (alpha - 1) * Math.log(z) - z;
    }
    return -(sum - n * (lgamma(alpha) + Math.log(beta)));
  };
  let best = null;
  const candidates = [];
  for (const st of starts) if (st) candidates.push(st);
  candidates.push([mb, sb, sgn0 * 0.5]);
  for (const sgnTry of [sgn0, -sgn0]) {
    for (const st of candidates) {
      let [mu, sg, g] = st;
      const s = sgnTry;
      g = s * Math.min(Math.max(Math.abs(g), 0.05), 1.95); // force the orientation being tried, alpha > 1
      const alpha = 4 / (g * g), beta = sg * Math.abs(g) / 2;
      const xiMean = mu - s * alpha * beta; // location that reproduces the start mean
      const xi0 = s > 0 ? Math.min(...base) - 0.5 * sb : Math.max(...base) + 0.5 * sb;
      const v0 = [xiMean, Math.log(beta), Math.log(alpha)];
      if (!isFinite(nllBase(v0, s))) v0[0] = xi0;
      if (!isFinite(nllBase(v0, s))) continue;
      const r = nmFit((v) => nllBase(v, s), v0, { step: [0.3 * sb, 0.2, 0.2] });
      if (!best || r.fx < best.fx) best = { ...r, s };
    }
    if (best && sgnTry === sgn0 && best.fx < Infinity) break; // only try the opposite sign if the first failed
  }
  if (!best || !isFinite(best.fx)) return { fail: 'ML could not find a feasible Pearson III fit (the likelihood has no interior maximum for this sample).' };
  const p = toParams(best.x, best.s);
  p.converged = best.converged;
  if (Math.exp(best.x[2]) < 1.001) {
    p.note = '|skew| reached the ML limit of 2: the unconstrained likelihood is unbounded (J-shaped Pearson III). The fit is the constrained maximum; prefer L-moments or moments here.';
    p.boundary = true;
  }
  return p;
}

/** 3-parameter log-normal: profile likelihood over the lower bound zeta. */
function ln3Mle(x, opts) {
  const n = x.length, xmin = Math.min(...x), range = Math.max(...x) - xmin;
  const prof = (d) => { // d = xmin - zeta > 0
    const z = xmin - d, y = x.map((v) => Math.log(v - z));
    const mu = mean(y), s2 = variance(y, 0);
    if (!(s2 > 0)) return Infinity;
    let sy = 0; for (const v of y) sy += v;
    return sy + 0.5 * n * Math.log(2 * Math.PI * s2) + 0.5 * n; // negative log-lik
  };
  // scan log d on a grid, then refine
  let bestT = null, bestV = Infinity;
  const lo = Math.log(1e-6 * range), hi = Math.log(1e4 * range);
  const G = 400;
  for (let i = 0; i <= G; i++) { const t = lo + (hi - lo) * i / G, v = prof(Math.exp(t)); if (v < bestV) { bestV = v; bestT = t; } }
  const atLower = bestT <= lo + (hi - lo) * 2 / G;
  const atUpper = bestT >= hi - (hi - lo) * 2 / G;
  const r = nelderMead((v) => prof(Math.exp(v[0])), [bestT], { step: [(hi - lo) / G * 2], restarts: 3 });
  const d = Math.exp(r.x[0]), zeta = xmin - d, y = x.map((v) => Math.log(v - zeta));
  const p = [zeta, mean(y), sd(y, 0)];
  p.boundary = atLower || atUpper;
  p.converged = r.converged;
  if (atUpper) p.note = 'The likelihood prefers an (almost) unbounded lower limit: the sample is essentially 2-parameter log-normal.';
  if (atLower) p.note = 'The likelihood increases as the lower bound approaches the smallest observation (a known singularity of ML for the 3-parameter log-normal); treat with care.';
  return p;
}

// ---------------------------------------------------------------- driver
export function fitDistribution(distId, data, method = 'lmom', opts = {}) {
  const dist = DISTRIBUTIONS[distId];
  const res = { distId, method, ok: false, params: null, paramNames: dist.paramNames, nPar: dist.nPar, warnings: [], n: data.length };
  const x = Array.from(data);
  if (!AVAILABLE_METHODS[distId].includes(method)) { res.reason = `${METHOD_LABELS[method]} is not implemented for ${dist.name}.`; return res; }
  if (x.length < (MIN_N[distId] ?? 3)) { res.reason = `At least ${MIN_N[distId]} observations are needed to fit ${dist.name}; you have ${x.length}.`; return res; }
  if (x.some((v) => !isFinite(v))) { res.reason = 'The sample contains non-finite values.'; return res; }
  if (dist.transform && x.some((v) => v <= 0)) { res.reason = `${dist.name} needs strictly positive values (zero flows should be handled with the zero-flow option).`; return res; }
  if (['GAM', 'WEI'].includes(distId) && x.some((v) => v <= 0)) { res.reason = `${dist.name} needs strictly positive values.`; return res; }
  if (Math.max(...x) === Math.min(...x)) { res.reason = 'All values are identical; no distribution can be fitted.'; return res; }

  const y = logTransform(dist, x);
  let p;
  if (method === 'mom') p = momEstimate(distId, x, y, opts);
  else if (method === 'lmom' || method === 'pwm') p = lmomEstimate(distId, dist, x, y, method, opts);
  else {
    // ML: use the L-moment and moment solutions as starting points
    const starts = [];
    const l = lmomEstimate(distId, dist, x, y, 'lmom', opts);
    if (Array.isArray(l)) starts.push(distId === 'PE3' || distId === 'LP3' ? l : l);
    if (['PE3', 'LP3'].includes(distId)) { const m = momEstimate(distId, x, y, opts); if (Array.isArray(m)) starts.push(m); }
    p = mleEstimate(distId, dist, x, y, opts, starts);
  }
  if (p && p.fail) { res.reason = p.fail; return res; }
  if (!p || !dist.validParams(p) || p.some((v) => !isFinite(v))) { res.reason = 'The estimated parameters are outside the valid range of the distribution.'; return res; }

  res.params = Array.from(p);
  res.ok = true;
  if (p.converged === false) res.warnings.push('The numerical optimiser did not fully converge; treat the ML result with caution.');
  if (p.boundary) res.warnings.push('The ML estimate lies on the boundary of the allowed range, so it is not a regular interior maximum.');
  if (p.note) res.warnings.push(p.note);

  // support check: do all observations lie inside the fitted support?
  const bad = x.filter((v) => !dist.inSupport(v, res.params)).length;
  if (bad) res.warnings.push(`${bad} observation(s) lie outside the support of the fitted distribution (likelihood and GOF are not defined).`);
  const n = x.length;
  if (['GEV', 'GLO', 'GPA'].includes(distId)) {
    const k = res.params[2];
    if (Math.abs(k) > 0.5) res.warnings.push(`Shape k = ${k.toFixed(3)} is outside the usual hydrological range (-0.5, 0.5); quantiles at long return periods are very uncertain.`);
    if (n < 25) res.warnings.push(`Only ${n} observations: shape estimates for ${distId} are poor for n < ~25 (Hosking et al. 1985).`);
  }
  if (['PE3', 'LP3'].includes(distId) && n < 25) res.warnings.push(`Only ${n} observations: the skew coefficient is poorly determined for small samples; consider a regional skew.`);

  // information criteria (log-likelihood evaluated in x-space incl. Jacobian)
  const nll = bad ? Infinity : negLogLik(dist, x, res.params);
  res.loglik = isFinite(nll) ? -nll : -Infinity;
  const k = distId === 'GPA' && opts.loc !== undefined ? 2 : dist.nPar;
  res.kEff = k;
  res.aic = 2 * k - 2 * res.loglik;
  res.aicc = n - k - 1 > 0 ? res.aic + (2 * k * (k + 1)) / (n - k - 1) : Infinity;
  res.bic = k * Math.log(n) - 2 * res.loglik;
  return res;
}
