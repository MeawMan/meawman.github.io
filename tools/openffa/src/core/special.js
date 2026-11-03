// special.js - special functions used by the distributions.
// Every function here is checked against scipy.special / scipy.stats in tests/special.test.js.
//
// Contents: lgamma, gamma, digamma, trigamma, gammaP/gammaQ (regularised incomplete
// gamma), erfc, normCdf, normPdf, normPpf, gammaPpf (inverse of gammaP).

export const EULER_GAMMA = 0.5772156649015329;

// Lanczos approximation (g = 7, n = 9); relative error ~1e-15 for x > 0.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** log |Gamma(x)| for real x (reflection formula for x < 0.5). */
export function lgamma(x) {
  if (x < 0.5) {
    // Gamma(x) Gamma(1-x) = pi / sin(pi x)
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  }
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Gamma(x) for real x (sign handled for negative non-integers). */
export function gamma(x) {
  if (Number.isInteger(x) && x <= 0) return NaN;
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  return Math.exp(lgamma(x));
}

/** Digamma function psi(x), x > 0 (recurrence + asymptotic series). */
export function digamma(x) {
  if (x <= 0 && Number.isInteger(x)) return NaN;
  if (x < 0) return digamma(1 - x) - Math.PI / Math.tan(Math.PI * x);
  let r = 0;
  while (x < 10) { r -= 1 / x; x += 1; }
  const f = 1 / (x * x);
  return r + Math.log(x) - 0.5 / x -
    f * (1 / 12 - f * (1 / 120 - f * (1 / 252 - f * (1 / 240 - f * (1 / 132)))));
}

/** Trigamma function psi'(x), x > 0. */
export function trigamma(x) {
  let r = 0;
  while (x < 10) { r += 1 / (x * x); x += 1; }
  const f = 1 / (x * x);
  return r + 1 / x + f / 2 +
    (1 / x) * f * (1 / 6 - f * (1 / 30 - f * (1 / 42 - f * (1 / 30))));
}

// Regularised incomplete gamma P(a, x) and Q(a, x) = 1 - P (Numerical-Recipes style
// series / continued fraction; accurate to ~1e-14).
function gammaSeries(a, x) {
  let ap = a, sum = 1 / a, del = sum;
  for (let n = 0; n < 500000; n++) {
    ap += 1; del *= x / ap; sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
}
function gammaContFrac(a, x) {
  const FPMIN = 1e-300;
  let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
  for (let i = 1; i < 500000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
export function gammaP(a, x) {
  if (x <= 0) return 0;
  if (!isFinite(x)) return 1;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContFrac(a, x);
}
export function gammaQ(a, x) {
  if (x <= 0) return 1;
  if (!isFinite(x)) return 0;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContFrac(a, x);
}

/** Complementary error function (via incomplete gamma, relative accuracy ~1e-14). */
export function erfc(x) {
  if (x >= 0) return gammaQ(0.5, x * x);
  return 2 - gammaQ(0.5, x * x);
}
export function erf(x) { return 1 - erfc(x); }

export function normPdf(z) { return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI); }
export function normCdf(z) { return 0.5 * erfc(-z / Math.SQRT2); }
/** Upper tail 1 - Phi(z), accurate in the far tail. */
export function normSf(z) { return 0.5 * erfc(z / Math.SQRT2); }

// Acklam's rational approximation (rel. error 1.2e-9) followed by one Halley step.
const A = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
  1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
const B = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
  6.680131188771972e+01, -1.328068155288572e+01];
const C = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
  -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
const D = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
  3.754408661907416e+00];

/** Standard normal quantile. */
export function normPpf(p) {
  if (p <= 0) return p === 0 ? -Infinity : NaN;
  if (p >= 1) return p === 1 ? Infinity : NaN;
  let x;
  const plow = 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
        ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5, r = q * q;
    x = (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q /
        (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) /
         ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1);
  }
  // one Halley refinement (use the tail that is accurate)
  const e = (x < 0 ? normCdf(x) - p : -(normSf(x) - (1 - p)));
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp(0.5 * x * x);
  return x - u / (1 + 0.5 * x * u);
}

/** Inverse of the regularised incomplete gamma: x such that P(a, x) = p. */
export function gammaPpf(a, p) {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  // Wilson-Hilferty starting guess, then safeguarded Newton.
  const z = normPpf(p);
  let x = a * Math.pow(1 - 1 / (9 * a) + z / (3 * Math.sqrt(a)), 3);
  if (!(x > 0) || !isFinite(x)) x = Math.exp((Math.log(p * a) + lgamma(a)) / a);
  let lo = 0, hi = Infinity;
  for (let it = 0; it < 200; it++) {
    const f = gammaP(a, x) - p;
    if (f > 0) hi = x; else lo = x;
    const dens = Math.exp((a - 1) * Math.log(x) - x - lgamma(a));
    let xn = x - f / dens;
    if (!(xn > lo) || !(xn < hi)) {
      xn = isFinite(hi) ? 0.5 * (lo + hi) : x * 2;
    }
    if (Math.abs(xn - x) < 1e-14 * Math.max(1, x)) { x = xn; break; }
    x = xn;
  }
  return x;
}

// Regularised incomplete beta I_x(a, b) (continued fraction, Numerical-Recipes style).
function betacf(a, b, x) {
  const FPMIN = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 100000; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}
export function betaI(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
}
