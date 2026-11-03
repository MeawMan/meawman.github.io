/**
 * special.js — special functions needed by the frequency-analysis code.
 * Everything here is plain double-precision JavaScript with no dependencies.
 * Accuracy targets (checked against SciPy in tests/special.test.js):
 *   lgamma, gamma  ~1e-13 relative
 *   erf/erfc, normal cdf  ~1e-14 absolute
 *   normal ppf  ~1e-13
 *   regularised incomplete gamma P(a,x) and its inverse  ~1e-12
 */

export const EULER_GAMMA = 0.5772156649015329;
const SQRT_2 = Math.SQRT2;
const SQRT_PI = Math.sqrt(Math.PI);

// ---------------------------------------------------------------------------
// Gamma function family
// ---------------------------------------------------------------------------

// Lanczos approximation, g = 7, n = 9 (Godfrey coefficients).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** Natural log of |Gamma(x)|. */
export function lgamma(x) {
  if (x < 0.5) {
    // reflection formula
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Gamma function (any real x that is not a non-positive integer). */
export function gamma(x) {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  return Math.exp(lgamma(x));
}

/** Digamma function psi(x), x > 0. */
export function digamma(x) {
  let r = 0;
  while (x < 10) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  // asymptotic series
  return r + Math.log(x) - 0.5 / x
    - f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f * (1 / 132)))));
}

/** Trigamma function psi'(x), x > 0. */
export function trigamma(x) {
  let r = 0;
  while (x < 10) { r += 1 / (x * x); x += 1; }
  const f = 1 / (x * x);
  return r + 1 / x + 0.5 * f
    + (1 / x) * f * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f * (1 / 30))));
}

// ---------------------------------------------------------------------------
// Error function and normal distribution
// ---------------------------------------------------------------------------

/** erf(x) via a non-alternating series (|x| < 2.5) or the erfc continued fraction. */
export function erf(x) {
  if (x < 0) return -erf(-x);
  if (x < 2.5) return erfSeries(x);
  return 1 - erfcPositive(x);
}

/** erfc(x), accurate in both tails. */
export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  if (x < 2.5) return 1 - erfSeries(x);
  return erfcPositive(x);
}

function erfSeries(x) {
  // erf(x) = 2/sqrt(pi) * exp(-x^2) * sum_{n>=0} 2^n x^(2n+1) / (1*3*5*...*(2n+1))
  const x2 = x * x;
  let term = x;
  let sum = x;
  for (let n = 1; n < 200; n++) {
    term *= 2 * x2 / (2 * n + 1);
    sum += term;
    if (term < 1e-17 * sum) break;
  }
  return (2 / SQRT_PI) * Math.exp(-x2) * sum;
}

function erfcPositive(x) {
  // continued fraction (modified Lentz) for x >= 2.5:
  // erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + ...)))))
  const tiny = 1e-300;
  let f = x;
  let C = x;
  let D = 0;
  for (let k = 1; k < 500; k++) {
    const a = k / 2;
    D = x + a * D;
    D = D === 0 ? tiny : D;
    C = x + a / C;
    C = C === 0 ? tiny : C;
    D = 1 / D;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (SQRT_PI * f);
}

/** Standard normal CDF. */
export function normalCdf(z) {
  return 0.5 * erfc(-z / SQRT_2);
}

/** Standard normal PDF. */
export function normalPdf(z) {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}

// Acklam's rational approximation, then two Halley steps on the exact CDF.
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
  1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
  6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
  -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const Dd = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
  3.754408661907416e+00];

/** Standard normal quantile function (inverse CDF). */
export function normalPpf(p) {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  let x;
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((Dd[0] * q + Dd[1]) * q + Dd[2]) * q + Dd[3]) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
      (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
      ((((Dd[0] * q + Dd[1]) * q + Dd[2]) * q + Dd[3]) * q + 1);
  }
  for (let i = 0; i < 2; i++) {
    const e = (x < 0 ? normalCdf(x) - p : -(normalCdf(-x) - (1 - p)));
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp(0.5 * x * x);
    x = x - u / (1 + 0.5 * x * u);
  }
  return x;
}

// ---------------------------------------------------------------------------
// Regularised incomplete gamma function and its inverse
// ---------------------------------------------------------------------------

/** Regularised lower incomplete gamma P(a, x). */
export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (!isFinite(x)) return 1;
  if (x < a + 1) {
    // series
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 2000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  return 1 - gammaQcf(a, x);
}

/** Regularised upper incomplete gamma Q(a, x) = 1 - P(a, x). */
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (!isFinite(x)) return 0;
  if (x < a + 1) return 1 - gammaP(a, x);
  return gammaQcf(a, x);
}

function gammaQcf(a, x) {
  // continued fraction, modified Lentz
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 2000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}

/** Inverse of P(a, x) with respect to x: returns x such that P(a, x) = p. */
export function gammaPinv(a, p) {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  // bracket
  let lo = 0;
  let hi = Math.max(a, 1);
  while (gammaP(a, hi) < p) { lo = hi; hi *= 2; if (hi > 1e300) return Infinity; }
  // starting guess: Wilson-Hilferty
  const z = normalPpf(p);
  let x = a * Math.pow(Math.max(1 - 1 / (9 * a) + z / (3 * Math.sqrt(a)), 1e-3), 3);
  if (!(x > lo && x < hi)) x = 0.5 * (lo + hi);
  const lg = lgamma(a);
  for (let it = 0; it < 200; it++) {
    const f = gammaP(a, x) - p;
    if (f > 0) hi = x; else lo = x;
    const pdf = Math.exp((a - 1) * Math.log(x) - x - lg);
    let xn = pdf > 0 ? x - f / pdf : NaN;
    if (!(xn > lo && xn < hi)) xn = 0.5 * (lo + hi); // safeguard: bisection
    if (Math.abs(xn - x) < 1e-15 * Math.max(1, x)) { x = xn; break; }
    x = xn;
  }
  return x;
}

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/**
 * Brent-style bracketed root finder (bisection + secant safeguard).
 * @param {(x:number)=>number} f  function with a sign change on [a, b]
 * @returns {number} root, or NaN when no sign change exists
 */
export function findRoot(f, a, b, tol = 1e-13, maxIter = 300) {
  let fa = f(a);
  let fb = f(b);
  if (fa === 0) return a;
  if (fb === 0) return b;
  if (fa * fb > 0) return NaN;
  for (let i = 0; i < maxIter; i++) {
    // secant guess, fall back to bisection when it leaves the bracket
    let m = b - fb * (b - a) / (fb - fa);
    if (!(m > Math.min(a, b) && m < Math.max(a, b))) m = 0.5 * (a + b);
    const fm = f(m);
    if (fm === 0) return m;
    if (fa * fm < 0) { b = m; fb = fm; } else { a = m; fa = fm; }
    // always also halve the bracket occasionally so convergence is guaranteed
    if (i % 3 === 2) {
      const mid = 0.5 * (a + b);
      const fmid = f(mid);
      if (fa * fmid <= 0) { b = mid; fb = fmid; } else { a = mid; fa = fmid; }
    }
    if (Math.abs(b - a) < tol * Math.max(1, Math.abs(a), Math.abs(b))) return 0.5 * (a + b);
  }
  return 0.5 * (a + b);
}
