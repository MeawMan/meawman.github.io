/**
 * stats.js — descriptive statistics, plotting positions and sample L-moments.
 */

/** Arithmetic mean. */
export function mean(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / x.length;
}

/** Sample variance with divisor n-1 (or n when ddof = 0). */
export function variance(x, ddof = 1) {
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < x.length; i++) s += (x[i] - m) * (x[i] - m);
  return s / (x.length - ddof);
}

export function sd(x, ddof = 1) { return Math.sqrt(variance(x, ddof)); }

/**
 * Bias-adjusted sample skewness G1 = n/((n-1)(n-2)) * sum(z^3) / s^3
 * (the estimator used for the station skew in US Bulletin 17B-style Log-Pearson III work).
 */
export function skewAdjusted(x) {
  const n = x.length;
  if (n < 3) return NaN;
  const m = mean(x);
  const s = sd(x);
  if (s === 0) return 0;
  let c = 0;
  for (let i = 0; i < n; i++) c += ((x[i] - m) / s) ** 3;
  return (n / ((n - 1) * (n - 2))) * c;
}

export function sortedCopy(x) {
  return Float64Array.from(x).sort();
}

export function min(x) { let m = Infinity; for (const v of x) if (v < m) m = v; return m; }
export function max(x) { let m = -Infinity; for (const v of x) if (v > m) m = v; return m; }

/** Empirical quantile with linear interpolation (type 7, the R/NumPy default). */
export function quantile(x, p) {
  const s = sortedCopy(x);
  const n = s.length;
  if (n === 0) return NaN;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}

/**
 * Plotting-position (non-exceedance probability) for rank i = 1..n of ascending data.
 * kinds: weibull a=0, hazen a=.5, blom a=.375, cunnane a=.4, gringorten a=.44 (Koutsoyiannis 1998 uses Gringorten).
 * p_i = (i - a) / (n + 1 - 2a)
 */
export const PLOTTING_A = { weibull: 0, hazen: 0.5, blom: 0.375, cunnane: 0.4, gringorten: 0.44 };
export function plottingPositions(n, kind = 'gringorten') {
  const a = PLOTTING_A[kind];
  if (a === undefined) throw new Error(`unknown plotting position '${kind}'`);
  const p = new Float64Array(n);
  for (let i = 1; i <= n; i++) p[i - 1] = (i - a) / (n + 1 - 2 * a);
  return p;
}

/**
 * Sample L-moments l1..l4 and ratios t (= l2/l1, L-CV), t3, t4, from unbiased
 * probability-weighted moments (Hosking 1990; same estimators as IDF_CC eqs 7-12).
 * Requires n >= 4 for l4; returns NaN entries when n is too small.
 */
export function sampleLmoments(x) {
  const s = sortedCopy(x);
  const n = s.length;
  let b0 = 0; let b1 = 0; let b2 = 0; let b3 = 0;
  for (let j = 1; j <= n; j++) {
    const v = s[j - 1];
    b0 += v;
    if (n > 1) b1 += ((j - 1) / (n - 1)) * v;
    if (n > 2) b2 += (((j - 1) * (j - 2)) / ((n - 1) * (n - 2))) * v;
    if (n > 3) b3 += (((j - 1) * (j - 2) * (j - 3)) / ((n - 1) * (n - 2) * (n - 3))) * v;
  }
  b0 /= n; b1 /= n; b2 /= n; b3 /= n;
  const l1 = b0;
  const l2 = n > 1 ? 2 * b1 - b0 : NaN;
  const l3 = n > 2 ? 6 * b2 - 6 * b1 + b0 : NaN;
  const l4 = n > 3 ? 20 * b3 - 30 * b2 + 12 * b1 - b0 : NaN;
  return { l1, l2, l3, l4, t: l2 / l1, t3: l3 / l2, t4: l4 / l2, n };
}

/** Correlation coefficient. */
export function correlation(x, y) {
  const mx = mean(x); const my = mean(y);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/** Ordinary least squares y = a + b x. */
export function linearFit(x, y) {
  const mx = mean(x); const my = mean(y);
  let sxy = 0; let sxx = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const b = sxy / sxx;
  return { a: my - b * mx, b };
}
