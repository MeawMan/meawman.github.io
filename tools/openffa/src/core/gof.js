// gof.js - goodness-of-fit statistics and bootstrap-calibrated p-values.
//
// IMPORTANT (stated in the UI): the classical tables / asymptotic p-values of KS, AD and CvM
// assume the distribution parameters are KNOWN. When parameters are estimated from the same
// data, the statistics are systematically smaller and table p-values are far too large
// (Lilliefors 1967; Stephens 1974; D'Agostino & Stephens 1986). This module therefore
// computes p-values by parametric bootstrap: simulate n values from the fitted model,
// RE-FIT with the same method, recompute the statistic (Babu & Rao 2004; Stute et al. 1993).
// No GOF test proves a distribution is correct; with small n all tests have low power.

import { DISTRIBUTIONS } from './distributions.js';
import { plottingPositions } from './plotpos.js';
import { corr, sortedCopy } from './stats.js';
import { gammaQ } from './special.js';
import { RNG } from './rng.js';

const clampU = (u) => Math.min(Math.max(u, 1e-15), 1 - 1e-15);

/** Kolmogorov-Smirnov D, Anderson-Darling A2 and Cramer-von Mises W2 for a fitted cdf. */
export function edfStatistics(data, cdf) {
  const xs = sortedCopy(data), n = xs.length;
  const u = Array.from(xs, (x) => clampU(cdf(x)));
  let D = 0, A = 0, W = 1 / (12 * n);
  for (let i = 0; i < n; i++) {
    D = Math.max(D, (i + 1) / n - u[i], u[i] - i / n);
    A += (2 * i + 1) * (Math.log(u[i]) + Math.log(1 - u[n - 1 - i]));
    W += (u[i] - (2 * i + 1) / (2 * n)) ** 2;
  }
  return { ks: D, ad: -n - A / n, cvm: W };
}

/** Probability-plot correlation coefficient (data vs fitted quantiles at plotting positions). */
export function ppcc(data, quantile, ppType = 'gringorten') {
  const xs = sortedCopy(data), p = plottingPositions(xs.length, ppType);
  return corr(Array.from(xs), p.map((pp) => quantile(pp)));
}

/**
 * Chi-square with k equiprobable classes under the fitted model.
 * df = k - 1 - nPar. Approximate; needs >= 5 expected per class (k <= n/5).
 */
export function chiSquare(data, quantile, nPar, k) {
  const n = data.length;
  k = k ?? Math.max(3, Math.min(Math.floor(n / 5), Math.round(2 * Math.pow(n, 0.4))));
  const edges = [];
  for (let j = 1; j < k; j++) edges.push(quantile(j / k));
  const obs = new Array(k).fill(0);
  for (const x of data) { let j = 0; while (j < k - 1 && x > edges[j]) j++; obs[j]++; }
  const e = n / k;
  const stat = obs.reduce((s, o) => s + (o - e) ** 2 / e, 0);
  const df = k - 1 - nPar;
  const p = df > 0 ? gammaQ(df / 2, stat / 2) : NaN;
  return { stat, df, classes: k, p, expectedPerClass: e };
}

export function allStatistics(data, distId, params) {
  const d = DISTRIBUTIONS[distId];
  const cdf = (x) => d.cdf(x, params), q = (F) => d.quantile(F, params);
  const e = edfStatistics(data, cdf);
  return { ...e, ppcc: ppcc(data, q) };
}

/**
 * Parametric-bootstrap p-values for KS, AD, CvM and PPCC.
 * fitFn(sample) -> params | null   (must use the SAME method as the original fit)
 * onProgress(fraction) optional; returns { stats, p, nValid, nBoot }.
 * p for KS/AD/CvM = P(T* >= T); for PPCC (small = bad) = P(r* <= r). (+1 correction.)
 */
export function bootstrapGof(data, distId, params, fitFn, { nBoot = 500, seed = 1, onProgress } = {}) {
  const d = DISTRIBUTIONS[distId], n = data.length, rng = new RNG(seed);
  const obs = allStatistics(data, distId, params);
  const cnt = { ks: 0, ad: 0, cvm: 0, ppcc: 0 };
  let valid = 0;
  for (let b = 0; b < nBoot; b++) {
    const sim = new Array(n);
    for (let i = 0; i < n; i++) sim[i] = d.quantile(rng.uniformOpen(), params);
    const pb = fitFn(sim);
    if (pb) {
      const s = allStatistics(sim, distId, pb);
      if ([s.ks, s.ad, s.cvm, s.ppcc].every(Number.isFinite)) {
        valid++;
        if (s.ks >= obs.ks) cnt.ks++;
        if (s.ad >= obs.ad) cnt.ad++;
        if (s.cvm >= obs.cvm) cnt.cvm++;
        if (s.ppcc <= obs.ppcc) cnt.ppcc++;
      }
    }
    if (onProgress && b % 25 === 0) onProgress(b / nBoot);
  }
  const p = {};
  for (const k of Object.keys(cnt)) p[k] = (cnt[k] + 1) / (valid + 1);
  return { stats: obs, p, nValid: valid, nBoot };
}

/** Asymptotic KS p-value assuming KNOWN parameters (shown only to illustrate the problem). */
export function ksPvalueKnownParams(D, n) {
  const t = (Math.sqrt(n) + 0.12 + 0.11 / Math.sqrt(n)) * D; // Stephens (1970) modification
  let s = 0;
  for (let j = 1; j <= 100; j++) s += 2 * (j % 2 ? 1 : -1) * Math.exp(-2 * j * j * t * t);
  return Math.min(1, Math.max(0, s));
}
