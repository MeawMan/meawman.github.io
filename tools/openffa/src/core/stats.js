// stats.js - basic sample statistics used throughout.

export const sum = (x) => { let s = 0; for (const v of x) s += v; return s; };
export const mean = (x) => sum(x) / x.length;
/** Sample variance with divisor n-1 (or n if ddof = 0). */
export function variance(x, ddof = 1) {
  const m = mean(x); let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (x.length - ddof);
}
export const sd = (x, ddof = 1) => Math.sqrt(variance(x, ddof));
/**
 * Sample skewness. type 'unbiased' = G1 = n/((n-1)(n-2)) * sum(z^3) with s (n-1),
 * the estimator used in Bulletin 17B/C for the station skew. type 'moment' = g1.
 */
export function skew(x, type = 'unbiased') {
  const n = x.length, m = mean(x);
  let m2 = 0, m3 = 0;
  for (const v of x) { const d = v - m; m2 += d * d; m3 += d * d * d; }
  if (m2 === 0) return 0;
  if (type === 'moment') return (m3 / n) / Math.pow(m2 / n, 1.5);
  const s = Math.sqrt(m2 / (n - 1));
  return (n / ((n - 1) * (n - 2))) * (m3 / (s * s * s));
}
export function sortedCopy(x) { return Float64Array.from(x).sort(); }
export function quantileSorted(xs, p) { // type 7 (R default)
  const h = (xs.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return xs[lo] + (h - lo) * (xs[hi] - xs[lo]);
}
export function median(x) { return quantileSorted(sortedCopy(x), 0.5); }
export function corr(x, y) {
  const mx = mean(x), my = mean(y); let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) {
    const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b;
  }
  return sxy / Math.sqrt(sxx * syy);
}
