// censored.js - historic floods, censored and interval data.
//
// Data model (Bulletin 17C's "flow interval" representation, App. 3): every year of the
// analysis period is an interval [lo, hi] for the annual peak:
//   exact systematic peak        : lo = hi = Q
//   "less than threshold" (PILF, or year in a historic period when no flood exceeded T):
//                                  lo = 0 (or -Inf), hi = T
//   "greater than"                : lo = Q, hi = +Inf
//   interval estimate (paleo etc.): lo < hi
//
// Two estimators:
//   censoredMLE : maximum likelihood with the censored likelihood (any distribution).
//                 Verified against an independent SciPy implementation.
//   ema         : Expected Moments Algorithm for LP3 (Cohn et al. 1997; Bulletin 17C App. 7)
//                 - EXPERIMENTAL: the core iteration is implemented as published, but the
//                 Bulletin 17C refinements (EMA-based skew MSE, confidence intervals,
//                 low-outlier-adjusted regional skew weighting) are NOT reproduced, and the
//                 results have not been compared with PeakFQ. Verified only in the
//                 uncensored case (where EMA must equal the method of moments).
//   weightedSkew: B17B/C weighting of station and regional skew by their MSEs
//                 (station-skew MSE from the Bulletin 17B approximation).

import { DISTRIBUTIONS, PE3, pe3Internal } from './distributions.js';
import { bootLimits } from './bootci.js';
import { RNG } from './rng.js';
import { nelderMead } from './optim.js';
import { gammaP, lgamma } from './special.js';
import { mean, sd, skew } from './stats.js';
import { fitDistribution } from './fit.js';

/** Build interval data from exact values, plus optional censored/historic information. */
export function makeIntervals(exact, { lessThan = [], greaterThan = [], intervals = [] } = {}) {
  const out = exact.map((q) => ({ lo: q, hi: q }));
  for (const t of lessThan) out.push({ lo: -Infinity, hi: t });       // value below t
  for (const t of greaterThan) out.push({ lo: t, hi: Infinity });     // value above t
  for (const [a, b] of intervals) out.push({ lo: a, hi: b });
  return out;
}

/**
 * Historic period: h years, perception threshold T, with the historic floods above T known.
 * Years of the historic period with no recorded flood are "< T".
 */
export function historicIntervals(systematic, { historicYears = 0, threshold = null, historicPeaks = [] } = {}) {
  const extra = Math.max(0, historicYears - historicPeaks.length);
  return makeIntervals([...systematic, ...historicPeaks], { lessThan: threshold != null ? new Array(extra).fill(threshold) : [] });
}

export function intervalLogLik(dist, iv, p) {
  let s = 0;
  for (const { lo, hi } of iv) {
    let l;
    if (lo === hi) l = dist.logpdf(lo, p);
    else {
      const Fh = hi === Infinity ? 1 : dist.cdf(hi, p);
      const Fl = lo === -Infinity || lo <= 0 && dist.transform ? 0 : dist.cdf(lo, p);
      l = Math.log(Math.max(Fh - Fl, 0));
    }
    if (!(l > -Infinity)) return -Infinity;
    s += l;
  }
  return s;
}

/** Censored maximum likelihood. Start from the uncensored L-moment/ML fit of the exact values. */
export function censoredMLE(distId, iv, opts = {}) {
  const dist = DISTRIBUTIONS[distId];
  const exact = iv.filter((v) => v.lo === v.hi).map((v) => v.lo);
  const res = { distId, method: 'mle-censored', ok: false, warnings: [], paramNames: dist.paramNames, n: iv.length };
  const starts = [];
  for (const m of ['mle', 'lmom', 'mom']) {
    const f = fitDistribution(distId, exact, m, opts);
    if (f.ok) starts.push(f.params);
  }
  if (!starts.length) { res.reason = 'Could not obtain a starting fit from the exact values.'; return res; }
  const pos = dist.paramNames.map((nm) => ['alpha', 'sigma', 'scale', 'shape'].includes(nm)); // optimise on log scale
  const enc = (p) => p.map((v, i) => (pos[i] ? Math.log(v) : v));
  const dec = (v) => v.map((t, i) => (pos[i] ? Math.exp(t) : t));
  const f = (v) => { const p = dec(v); if (!dist.validParams(p)) return Infinity; const l = intervalLogLik(dist, iv, p); return -l; };
  let best = null;
  for (const st of starts) {
    let v0 = enc(st);
    if (!isFinite(f(v0))) continue;
    const r = nelderMead(f, v0, { restarts: 5 });
    if (!best || r.fx < best.fx) best = r;
  }
  if (!best || !isFinite(best.fx)) { res.reason = 'The censored likelihood is not finite at any starting point (do some exact values lie outside the support?).'; return res; }
  res.params = dec(best.x); res.ok = true; res.loglik = -best.fx;
  const k = dist.nPar, N = iv.length;
  res.aic = 2 * k - 2 * res.loglik; res.bic = k * Math.log(N) - 2 * res.loglik;
  res.aicc = N - k - 1 > 0 ? res.aic + 2 * k * (k + 1) / (N - k - 1) : Infinity;
  if (!best.converged) res.warnings.push('Optimiser did not fully converge.');
  return res;
}

// ---------------------------------------------------------------------------- EMA
/** E[(Y - c)^r | a < Y < b] for Y ~ PE3(mu, sigma, gamma), r = 0..3 (r=0 gives the probability). */
function pe3TruncatedMoments(p, a, b, c) {
  if (Math.abs(p[2]) < 1e-4) p = [p[0], p[1], 1e-4 * (p[2] >= 0 ? 1 : -1)];
  const { alpha, beta, xi, s } = pe3Internal(p);
  // Y = xi + s*beta*Z, Z ~ Gamma(alpha,1). Map (a,b) to z-limits.
  let za = s * (a - xi) / beta, zb = s * (b - xi) / beta;
  if (s < 0) [za, zb] = [zb, za];
  za = Math.max(za, 0); zb = Math.max(zb, 0);
  const P = (aa, z) => (z === Infinity ? 1 : z <= 0 ? 0 : gammaP(aa, z));
  const prob = P(alpha, zb) - P(alpha, za);
  if (!(prob > 1e-300)) return null;
  // raw moments of Z on (za, zb): E[Z^j] = Gamma(alpha+j)/Gamma(alpha) * (P(alpha+j) diff) / prob
  const ez = [1];
  for (let j = 1; j <= 3; j++) ez.push(Math.exp(lgamma(alpha + j) - lgamma(alpha)) * (P(alpha + j, zb) - P(alpha + j, za)) / prob);
  // (Y - c) = d + e Z, d = xi - c, e = s*beta
  const d = xi - c, e = s * beta;
  const m = [1, d + e * ez[1], d * d + 2 * d * e * ez[1] + e * e * ez[2],
    d ** 3 + 3 * d * d * e * ez[1] + 3 * d * e * e * ez[2] + e ** 3 * ez[3]];
  return { prob, m };
}

/**
 * Expected Moments Algorithm for LP3 in log10 space (Cohn et al. 1997; Bulletin 17C App. 7).
 * Follows PeakFQ's emafit.f (subroutines p3est_ema, moms_p3, momsadj, dist_p3; default bcf = 1997).
 * iv: intervals in flow units ({lo, hi}; lo = hi for exact values, lo <= 0 for "less than hi").
 * opts.regionalSkew / opts.regionalSkewMSE: weighted skew through B17C eq. 7-10 with
 *   nG = N * MSE(station skew) / MSE(regional) (Griffis et al. 2004, as in PeakFQ).
 */
export function ema(iv, opts = {}) {
  const res = { distId: 'LP3', method: 'ema', ok: false, paramNames: PE3.paramNames, experimental: false,
    warnings: ['EMA point estimates follow PeakFQ (emafit.f) and are checked against the Bulletin 17C Appendix 10 examples. EMA confidence intervals and the EMA skew MSE of Bulletin 17C are NOT implemented (station-skew MSE uses the Bulletin 17B formula).'] };
  const Lg = (v) => (v === Infinity ? Infinity : v <= 0 || v === -Infinity ? -Infinity : Math.log10(v));
  const y = iv.map(({ lo, hi }) => ({ lo: Lg(lo), hi: Lg(hi) }));
  const exact = y.filter((v) => v.lo === v.hi);
  if (exact.length < 3) { res.reason = 'EMA needs at least 3 exact observations.'; return res; }
  const stepOpts = { skewFloor: opts.skewFloor ?? -1.41 };
  if (opts.regionalSkew != null && opts.regionalSkewMSE > 0) {
    const mseG = opts.stationSkewMSE ?? stationSkewMSE(skew(exact.map((v) => v.lo)), y.length);
    stepOpts.nG = y.length * mseG / opts.regionalSkewMSE;
    stepOpts.regionalSkew = opts.regionalSkew;
    res.nG = stepOpts.nG; res.stationSkewMSE = mseG;
  }
  let p = opts.start ?? [0, 1, 0]; // PeakFQ's starting moments
  let it = 0, dPrev = 0;
  for (; it < 20000; it++) {
    let np = emaStep(y, p, stepOpts);
    if (!np) { res.reason = 'EMA failed: an interval has zero probability under the current fit.'; return res; }
    if (it > 10000) np = np.map((v, k) => 0.5 * (v + p[k])); // damp cycling (PeakFQ averages iterates)
    const d = distP3(p, np);
    p = np;
    if (d <= 1e-10 && d >= dPrev) break;
    dPrev = d;
  }
  res.iterations = it;
  if (it >= 20000) res.warnings.push('EMA did not converge.');
  if (p[2] <= -1.41 + 1e-12) res.warnings.push('Skew reached the Bulletin 17C lower limit of -1.41.');
  res.params = p; res.ok = true;
  return res;
}

/**
 * One EMA update, as PeakFQ's moms_p3 (expectations under the previous fit p):
 *   M  = (1/N) sum E[X | interval]
 *   S2 = (c2 * sum_exact (x - M)^2 + sum_cens E[(X - M)^2 | interval]) / N
 *   G  = (c3 * sum_exact (x - M)^3 + sum_cens E[(X - M)^3 | interval] + nG*Gr*S^3) / ((N + nG) S^3)
 *   c2 = ne/(ne - 1), c3 = ne^2/((ne - 1)(ne - 2)), ne = number of EXACT values. Note that the bias
 *   factors multiply only the exact-value sums. Then G = max(G, -1.41) (momsadj).
 */
export function emaStep(y, p, opts = {}) {
  const N = y.length;
  let ne = 0, S1 = 0;
  const tm = y.map((v) => (v.lo === v.hi ? null : pe3TruncatedMoments(p, v.lo, v.hi, 0)));
  for (let i = 0; i < N; i++) {
    if (tm[i] === null) { ne++; S1 += y[i].lo; } else { if (!tm[i]) return null; S1 += tm[i].m[1]; }
  }
  const mu = S1 / N;
  let se2 = 0, se3 = 0, sc2 = 0, sc3 = 0;
  for (let i = 0; i < N; i++) {
    const v = y[i];
    if (tm[i] === null) { se2 += (v.lo - mu) ** 2; se3 += (v.lo - mu) ** 3; }
    else { const t = pe3TruncatedMoments(p, v.lo, v.hi, mu); sc2 += t.m[2]; sc3 += t.m[3]; }
  }
  const c2 = ne / (ne - 1), c3 = ne * ne / ((ne - 1) * (ne - 2));
  const S2 = (c2 * se2 + sc2) / N, S3 = S2 ** 1.5;
  const nG = opts.nG ?? 0, Gr = opts.regionalSkew ?? 0;
  let g = (c3 * se3 + sc3 + nG * Gr * S3) / ((N + nG) * S3);
  g = Math.max(g, opts.skewFloor ?? -1.41);
  return [mu, Math.sqrt(S2), g];
}

/** PeakFQ convergence distance between parameter sets (dist_p3). */
function distP3(a, b) {
  return (a[0] - b[0]) ** 2 / b[1] + (a[1] - b[1]) ** 2 / b[1] ** 2 / 10 + (a[2] - b[2]) ** 2 / 100;
}

/** Bulletin 17B MSE of the station skew (log space) for record length n. */
export function stationSkewMSE(G, n) {
  const a = Math.abs(G);
  const A = a <= 0.9 ? -0.33 + 0.08 * a : -0.52 + 0.30 * a;
  const B = a <= 1.5 ? 0.94 - 0.26 * a : 0.55;
  return 10 ** (A - B * Math.log10(n / 10));
}

/** Weighted skew G_w = (MSE_r G + MSE_G G_r)/(MSE_r + MSE_G) (Bulletin 17B eq. 5 / 17C eq. 8). */
export function weightedSkew(G, n, Gr, mseR) {
  const mseG = stationSkewMSE(G, n);
  return { skew: (mseR * G + mseG * Gr) / (mseR + mseG), mseStation: mseG, weightStation: mseR / (mseR + mseG) };
}

/**
 * Parametric bootstrap for censored / historic designs (EMA or censored ML).
 * Each replicate simulates a complete record from the fitted model with the SAME design:
 *   ns systematic years (values below pilfThreshold become "< pilfThreshold") and
 *   h historic years observed only if above the perception threshold.
 * The replicate is refitted with the same estimator; percentile intervals are returned.
 * This is NOT the Bulletin 17C analytical EMA interval (Cohn et al. 2001); it is a simulation
 * alternative that reflects the same censoring and is stated as such in the report.
 */
export function bootstrapCensoredQuantiles(fit, design, Fs, { nBoot = 500, seed = 1, level = 0.9, opts = {}, onProgress, correction = 'percentile' } = {}) {
  const dist = DISTRIBUTIONS[fit.distId], rng = new RNG(seed);
  const reps = Fs.map(() => []);
  let failed = 0;
  for (let b = 0; b < nBoot; b++) {
    const exact = [], lessThan = [];
    for (let i = 0; i < design.ns; i++) {
      const v = dist.quantile(rng.uniformOpen(), fit.params);
      if (design.pilfThreshold && v < design.pilfThreshold) lessThan.push(design.pilfThreshold); else exact.push(v);
    }
    for (let i = 0; i < (design.historicYears || 0); i++) {
      const v = dist.quantile(rng.uniformOpen(), fit.params);
      if (v > design.historicThreshold) exact.push(v); else lessThan.push(design.historicThreshold);
    }
    const iv = makeIntervals(exact, { lessThan });
    const r = fit.method === 'ema' ? ema(iv, opts) : censoredMLE(fit.distId, iv, opts);
    if (!r.ok) { failed++; continue; }
    Fs.forEach((F, j) => { const q = dist.quantile(F, r.params); if (Number.isFinite(q)) reps[j].push(q); });
    if (onProgress && b % 10 === 0) onProgress(b / nBoot);
  }
  const corr = correction === 'bca' ? 'bc' : correction; // no jackknife for censored designs
  const intervals = reps.map((r, j) => {
    const s = Float64Array.from(r).sort();
    if (s.length < 20) return { lo: NaN, hi: NaN, se: NaN };
    let m = 0; for (const v of s) m += v; m /= s.length;
    let v2 = 0; for (const v of s) v2 += (v - m) ** 2;
    const lim = bootLimits(s, dist.quantile(Fs[j], fit.params), level, corr);
    return { lo: lim.lo, hi: lim.hi, se: Math.sqrt(v2 / (s.length - 1)), z0: lim.z0 };
  });
  return { intervals, nBoot, failed, method: 'boot-param-censored', correction: corr, level };
}
