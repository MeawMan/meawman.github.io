// distributions.js - probability distributions used in flood frequency analysis.
//
// Every distribution object has the same interface (parameters are plain arrays,
// ordered as in `paramNames`):
//   cdf(x, p), pdf(x, p), logpdf(x, p), quantile(F, p)     (F = non-exceedance probability)
//   inSupport(x, p)  : is x inside the support?
//   validParams(p)   : parameter sanity check
//   lmoments(p)      : theoretical {l1, l2, t3} where available (used by tests)
//   fromLmom(l)      : parameters from sample L-moments {l1,l2,t3,t4} (null if unsupported)
//   transform        : null | 'log10' | 'ln' (log distributions are defined on x but fitted on log x)
//
// Parameter conventions follow Hosking & Wallis (1997) so results can be compared directly
// with the R packages lmom/lmomco and the Python package lmoments3:
//   GEV, GLO, GPA : (xi = location, alpha = scale, k = shape)  [k > 0 -> bounded above]
//   PE3           : (mu = mean, sigma = sd, gamma = skewness)
//   Gumbel        : (xi, alpha);  Normal: (mu, sigma)
//   LN2           : (mu, sigma) of ln(x);  LN3 : (zeta, mu, sigma)  x = zeta + exp(mu + sigma z)
//   LP3           : (mu, sigma, gamma) of log10(x)
//   Gamma         : (shape a, scale b);   Weibull: (scale lambda, shape k)

import {
  lgamma, gamma, gammaP, gammaPpf, normCdf, normPdf, normPpf, normSf, betaI, EULER_GAMMA,
} from './special.js';
import { findRoot, brent } from './optim.js';

const LN10 = Math.LN10;
const SMALL = 1e-8; // |shape| below this is treated as the limiting (k = 0) distribution

// ------------------------------------------------------------------ Normal
export const NOR = {
  id: 'NOR', name: 'Normal', paramNames: ['mu', 'sigma'], nPar: 2, transform: null,
  cdf: (x, [m, s]) => normCdf((x - m) / s),
  pdf: (x, [m, s]) => normPdf((x - m) / s) / s,
  logpdf: (x, [m, s]) => -0.5 * Math.log(2 * Math.PI) - Math.log(s) - 0.5 * ((x - m) / s) ** 2,
  quantile: (F, [m, s]) => m + s * normPpf(F),
  inSupport: () => true,
  validParams: ([m, s]) => isFinite(m) && s > 0,
  lmoments: ([m, s]) => ({ l1: m, l2: s / Math.sqrt(Math.PI), t3: 0 }),
  fromLmom: (l) => [l.l1, Math.sqrt(Math.PI) * l.l2],
};

// ------------------------------------------------------------------ Gumbel (EV1)
export const GUM = {
  id: 'GUM', name: 'Gumbel (EV1)', paramNames: ['xi', 'alpha'], nPar: 2, transform: null,
  cdf: (x, [xi, a]) => Math.exp(-Math.exp(-(x - xi) / a)),
  pdf: (x, [xi, a]) => { const z = (x - xi) / a; return Math.exp(-z - Math.exp(-z)) / a; },
  logpdf: (x, [xi, a]) => { const z = (x - xi) / a; return -z - Math.exp(-z) - Math.log(a); },
  quantile: (F, [xi, a]) => xi - a * Math.log(-Math.log(F)),
  inSupport: () => true,
  validParams: ([xi, a]) => isFinite(xi) && a > 0,
  lmoments: ([xi, a]) => ({ l1: xi + EULER_GAMMA * a, l2: a * Math.LN2, t3: 2 * Math.log(3) / Math.LN2 - 3 }),
  fromLmom: (l) => { const a = l.l2 / Math.LN2; return [l.l1 - EULER_GAMMA * a, a]; },
};

// ------------------------------------------------------------------ GEV
function gevArg(x, xi, a, k) { return 1 - k * (x - xi) / a; }
export const GEV = {
  id: 'GEV', name: 'Generalized Extreme Value (GEV)', paramNames: ['xi', 'alpha', 'k'], nPar: 3, transform: null,
  cdf(x, [xi, a, k]) {
    if (Math.abs(k) < SMALL) return Math.exp(-Math.exp(-(x - xi) / a));
    const arg = gevArg(x, xi, a, k);
    if (arg <= 0) return k > 0 ? 1 : 0;
    return Math.exp(-Math.exp(Math.log(arg) / k)); // exp(-y) with y = -ln(arg)/k
  },
  logpdf(x, [xi, a, k]) {
    if (Math.abs(k) < SMALL) { const z = (x - xi) / a; return -z - Math.exp(-z) - Math.log(a); }
    const arg = gevArg(x, xi, a, k);
    if (arg <= 0) return -Infinity;
    const y = -Math.log(arg) / k;
    return -Math.log(a) - (1 - k) * y - Math.exp(-y);
  },
  pdf(x, p) { return Math.exp(GEV.logpdf(x, p)); },
  quantile(F, [xi, a, k]) {
    if (Math.abs(k) < SMALL) return xi - a * Math.log(-Math.log(F));
    return xi + a * (1 - Math.pow(-Math.log(F), k)) / k;
  },
  inSupport(x, [xi, a, k]) { return Math.abs(k) < SMALL || gevArg(x, xi, a, k) > 0; },
  validParams: ([xi, a, k]) => isFinite(xi) && a > 0 && isFinite(k) && k > -1,
  lmoments([xi, a, k]) {
    if (Math.abs(k) < SMALL) return GUM.lmoments([xi, a]);
    const g = gamma(1 + k);
    return {
      l1: xi + a * (1 - g) / k, l2: a * (1 - Math.pow(2, -k)) * g / k,
      t3: 2 * (1 - Math.pow(3, -k)) / (1 - Math.pow(2, -k)) - 3,
    };
  },
  fromLmom(l) {
    const t3 = l.t3;
    if (!(Math.abs(t3) < 1) || !(l.l2 > 0)) return null;
    // exact tau3(k) = 2(1-3^-k)/(1-2^-k) - 3 is decreasing in k; solve it numerically.
    const tau3 = (k) => (Math.abs(k) < 1e-7 ? 2 * Math.log(3) / Math.LN2 - 3
      : 2 * (1 - Math.pow(3, -k)) / (1 - Math.pow(2, -k)) - 3);
    // Hosking et al. (1985) approximation as the starting bracket centre
    const c = 2 / (3 + t3) - Math.LN2 / Math.log(3);
    const k0 = 7.859 * c + 2.9554 * c * c;
    let k = findRoot((kk) => tau3(kk) - t3, Math.max(-0.999, k0 - 0.5), k0 + 0.5, 20, 1e-14);
    if (Number.isNaN(k)) k = findRoot((kk) => tau3(kk) - t3, -0.999, 20, 400, 1e-14);
    if (Number.isNaN(k)) return null;
    if (Math.abs(k) < 1e-7) return GUM.fromLmom(l).concat([0]);
    const g = gamma(1 + k);
    const a = l.l2 * k / ((1 - Math.pow(2, -k)) * g);
    return [l.l1 - a * (1 - g) / k, a, k];
  },
};

// ------------------------------------------------------------------ Generalized Logistic
export const GLO = {
  id: 'GLO', name: 'Generalized Logistic (GLO)', paramNames: ['xi', 'alpha', 'k'], nPar: 3, transform: null,
  cdf(x, [xi, a, k]) {
    let y;
    if (Math.abs(k) < SMALL) y = (x - xi) / a;
    else { const arg = gevArg(x, xi, a, k); if (arg <= 0) return k > 0 ? 1 : 0; y = -Math.log(arg) / k; }
    return 1 / (1 + Math.exp(-y));
  },
  logpdf(x, [xi, a, k]) {
    let y;
    if (Math.abs(k) < SMALL) y = (x - xi) / a;
    else { const arg = gevArg(x, xi, a, k); if (arg <= 0) return -Infinity; y = -Math.log(arg) / k; }
    // log f = -ln a - (1-k) y - 2 ln(1 + e^{-y})
    const e = -y;
    const l1pe = e > 0 ? e + Math.log1p(Math.exp(-e)) : Math.log1p(Math.exp(e));
    return -Math.log(a) - (1 - k) * y - 2 * l1pe;
  },
  pdf(x, p) { return Math.exp(GLO.logpdf(x, p)); },
  quantile(F, [xi, a, k]) {
    if (Math.abs(k) < SMALL) return xi + a * Math.log(F / (1 - F));
    return xi + a * (1 - Math.pow((1 - F) / F, k)) / k;
  },
  inSupport(x, [xi, a, k]) { return Math.abs(k) < SMALL || gevArg(x, xi, a, k) > 0; },
  validParams: ([xi, a, k]) => isFinite(xi) && a > 0 && Math.abs(k) < 1,
  lmoments([xi, a, k]) {
    if (Math.abs(k) < SMALL) return { l1: xi, l2: a, t3: 0 };
    return { l1: xi + a * (1 / k - Math.PI / Math.sin(Math.PI * k)), l2: a * k * Math.PI / Math.sin(k * Math.PI), t3: -k };
  },
  fromLmom(l) {
    const k = -l.t3;
    if (!(Math.abs(k) < 1) || !(l.l2 > 0)) return null;
    if (Math.abs(k) < SMALL) return [l.l1, l.l2, 0];
    const a = l.l2 * Math.sin(Math.PI * k) / (k * Math.PI);
    return [l.l1 - a * (1 / k - Math.PI / Math.sin(Math.PI * k)), a, k];
  },
};

// ------------------------------------------------------------------ Generalized Pareto
export const GPA = {
  id: 'GPA', name: 'Generalized Pareto (GPA / POT)', paramNames: ['xi', 'alpha', 'k'], nPar: 3, transform: null,
  cdf(x, [xi, a, k]) {
    if (x <= xi) return 0;
    const z = (x - xi) / a;
    if (Math.abs(k) < SMALL) return 1 - Math.exp(-z);
    const arg = 1 - k * z;
    if (arg <= 0) return 1;
    return 1 - Math.pow(arg, 1 / k);
  },
  logpdf(x, [xi, a, k]) {
    if (x < xi) return -Infinity;
    const z = (x - xi) / a;
    if (Math.abs(k) < SMALL) return -z - Math.log(a);
    const arg = 1 - k * z;
    if (arg <= 0) return -Infinity;
    return -Math.log(a) + (1 / k - 1) * Math.log(arg);
  },
  pdf(x, p) { return Math.exp(GPA.logpdf(x, p)); },
  quantile(F, [xi, a, k]) {
    if (Math.abs(k) < SMALL) return xi - a * Math.log(1 - F);
    return xi + a * (1 - Math.pow(1 - F, k)) / k;
  },
  inSupport(x, [xi, a, k]) { return x >= xi && (k <= 0 || x <= xi + a / k); },
  validParams: ([xi, a, k]) => isFinite(xi) && a > 0 && isFinite(k) && k > -1,
  lmoments([xi, a, k]) {
    return { l1: xi + a / (1 + k), l2: a / ((1 + k) * (2 + k)), t3: (1 - k) / (3 + k) };
  },
  fromLmom(l) {
    if (!(l.l2 > 0) || !(Math.abs(l.t3) < 1)) return null;
    const k = (1 - 3 * l.t3) / (1 + l.t3);
    return [l.l1 - (2 + k) * l.l2, (1 + k) * (2 + k) * l.l2, k];
  },
};

// ------------------------------------------------------------------ Pearson type III
// Hosking parametrisation (mu, sigma, gamma) -> gamma(alpha, beta) with a location shift.
export function pe3Internal([mu, sigma, g]) {
  const alpha = 4 / (g * g), beta = sigma * Math.abs(g) / 2;
  const xi = mu - 2 * sigma / g;
  return { alpha, beta, xi, s: g > 0 ? 1 : -1 };
}
const PE3_NORMAL_EPS = 1e-4; // |skew| below this: use the normal distribution

export const PE3 = {
  id: 'PE3', name: 'Pearson type III (P3)', paramNames: ['mu', 'sigma', 'gamma'], nPar: 3, transform: null,
  cdf(x, p) {
    if (Math.abs(p[2]) < PE3_NORMAL_EPS) return NOR.cdf(x, p);
    const { alpha, beta, xi, s } = pe3Internal(p);
    const z = s * (x - xi) / beta;
    if (z <= 0) return s > 0 ? 0 : 1;
    const P = gammaP(alpha, z);
    return s > 0 ? P : 1 - P;
  },
  logpdf(x, p) {
    if (Math.abs(p[2]) < PE3_NORMAL_EPS) return NOR.logpdf(x, p);
    const { alpha, beta, xi, s } = pe3Internal(p);
    const z = s * (x - xi) / beta;
    if (z <= 0) return -Infinity;
    return (alpha - 1) * Math.log(z) - z - lgamma(alpha) - Math.log(beta);
  },
  pdf(x, p) { return Math.exp(PE3.logpdf(x, p)); },
  quantile(F, p) {
    if (Math.abs(p[2]) < PE3_NORMAL_EPS) return NOR.quantile(F, p);
    const { alpha, beta, xi, s } = pe3Internal(p);
    return s > 0 ? xi + beta * gammaPpf(alpha, F) : xi - beta * gammaPpf(alpha, 1 - F);
  },
  inSupport(x, p) {
    if (Math.abs(p[2]) < PE3_NORMAL_EPS) return true;
    const { beta, xi, s } = pe3Internal(p); return s * (x - xi) / beta > 0;
  },
  validParams: ([m, s, g]) => isFinite(m) && s > 0 && isFinite(g),
  lmoments([mu, sigma, g]) {
    if (Math.abs(g) < PE3_NORMAL_EPS) return NOR.lmoments([mu, sigma]);
    const alpha = 4 / (g * g);
    const l2 = sigma * Math.exp(lgamma(alpha + 0.5) - lgamma(alpha)) / Math.sqrt(Math.PI * alpha);
    return { l1: mu, l2, t3: Math.sign(g) * pe3Tau3(alpha) };
  },
  fromLmom(l) {
    const t3 = l.t3;
    if (!(Math.abs(t3) < 1) || !(l.l2 > 0)) return null;
    if (Math.abs(t3) < 1e-6) return [l.l1, Math.sqrt(Math.PI) * l.l2, 0];
    // Hosking (1990) rational approximation as starting point ...
    const at = Math.abs(t3);
    let alpha;
    if (at < 1 / 3) { const z = 3 * Math.PI * t3 * t3; alpha = (1 + 0.2906 * z) / (z + 0.1882 * z * z + 0.0442 * z ** 3); }
    else { const z = 1 - at; alpha = (0.36067 * z - 0.59567 * z * z + 0.25361 * z ** 3) / (1 - 2.78861 * z + 2.56096 * z * z - 0.77045 * z ** 3); }
    // ... refined with the exact relation tau3 = 6 I_{1/3}(alpha, 2 alpha) - 3 (gamma, alpha = shape)
    const f = (la) => pe3Tau3(Math.exp(la)) - at;
    const la0 = Math.log(alpha);
    const r = findRoot(f, la0 - 0.3, la0 + 0.3, 12, 1e-13);
    if (!Number.isNaN(r)) alpha = Math.exp(r);
    const g = Math.sign(t3) * 2 / Math.sqrt(alpha);
    const sigma = l.l2 * Math.sqrt(Math.PI * alpha) * Math.exp(lgamma(alpha) - lgamma(alpha + 0.5));
    return [l.l1, sigma, g];
  },
};
/** tau3 of a gamma(alpha) distribution (exact): 6 I_{1/3}(alpha, 2 alpha) - 3. */
export function pe3Tau3(alpha) { return 6 * betaI(alpha, 2 * alpha, 1 / 3) - 3; }

// ------------------------------------------------------------------ Log-Pearson III (log10)
export const LP3 = {
  id: 'LP3', name: 'Log-Pearson type III (LP3, log10)', paramNames: ['mu', 'sigma', 'gamma'], nPar: 3, transform: 'log10',
  cdf: (x, p) => (x <= 0 ? 0 : PE3.cdf(Math.log10(x), p)),
  logpdf: (x, p) => (x <= 0 ? -Infinity : PE3.logpdf(Math.log10(x), p) - Math.log(x * LN10)),
  pdf: (x, p) => Math.exp(LP3.logpdf(x, p)),
  quantile: (F, p) => Math.pow(10, PE3.quantile(F, p)),
  inSupport: (x, p) => x > 0 && PE3.inSupport(Math.log10(x), p),
  validParams: (p) => PE3.validParams(p),
  fromLmom: (l) => PE3.fromLmom(l), // L-moments of log10(x)
};

// ------------------------------------------------------------------ Log-normal (2 parameter)
export const LN2 = {
  id: 'LN2', name: 'Log-Normal (2-parameter)', paramNames: ['mu', 'sigma'], nPar: 2, transform: 'ln',
  cdf: (x, [m, s]) => (x <= 0 ? 0 : normCdf((Math.log(x) - m) / s)),
  logpdf: (x, [m, s]) => (x <= 0 ? -Infinity : NOR.logpdf(Math.log(x), [m, s]) - Math.log(x)),
  pdf: (x, p) => Math.exp(LN2.logpdf(x, p)),
  quantile: (F, [m, s]) => Math.exp(m + s * normPpf(F)),
  inSupport: (x) => x > 0,
  validParams: ([m, s]) => isFinite(m) && s > 0,
  fromLmom: (l) => NOR.fromLmom(l), // L-moments of ln(x)
};

// ------------------------------------------------------------------ Log-normal (3 parameter)
// x = zeta + exp(mu + sigma z).  tau3 depends on sigma only (numerical integral, Simpson).
export function ln3Tau3(sigma) {
  // lambda3 / lambda2 with lambda_r = int x(u) P*_{r-1}(u) du, u = Phi(z)
  const N = 240, lo = -12, hi = 12, h = (hi - lo) / N; // Simpson; N = 240 agrees with N = 4000 to 1e-14
  let i3 = 0, i2 = 0;
  for (let i = 0; i <= N; i++) {
    const t = lo + i * h; // t = z - sigma, density phi(t)
    const w = (i === 0 || i === N) ? 1 : (i % 2 ? 4 : 2);
    const u = normCdf(t + sigma), ph = normPdf(t);
    i3 += w * (6 * u * u - 6 * u + 1) * ph;
    i2 += w * (2 * u - 1) * ph;
  }
  return i3 / i2;
}
export const LN3 = {
  id: 'LN3', name: 'Log-Normal (3-parameter)', paramNames: ['zeta', 'mu', 'sigma'], nPar: 3, transform: null,
  cdf: (x, [z, m, s]) => (x <= z ? 0 : normCdf((Math.log(x - z) - m) / s)),
  logpdf: (x, [z, m, s]) => (x <= z ? -Infinity : NOR.logpdf(Math.log(x - z), [m, s]) - Math.log(x - z)),
  pdf: (x, p) => Math.exp(LN3.logpdf(x, p)),
  quantile: (F, [z, m, s]) => z + Math.exp(m + s * normPpf(F)),
  inSupport: (x, [z]) => x > z,
  validParams: ([z, m, s]) => isFinite(z) && isFinite(m) && s > 0,
  lmoments([z, m, s]) {
    const e = Math.exp(m + s * s / 2);
    const l2 = e * (2 * normCdf(s / Math.SQRT2) - 1);
    return { l1: z + e, l2, t3: ln3Tau3(s) };
  },
  fromLmom(l) {
    if (!(l.t3 > 0) || !(l.t3 < 1) || !(l.l2 > 0)) return null;
    const s = brent((sg) => ln3Tau3(sg) - l.t3, 1e-4, 8, 1e-13); // tau3 increases with sigma
    if (Number.isNaN(s)) return null;
    const e = l.l2 / (2 * normCdf(s / Math.SQRT2) - 1);
    const m = Math.log(e) - s * s / 2;
    return [l.l1 - e, m, s];
  },
};

// ------------------------------------------------------------------ Gamma (2 parameter)
export const GAM = {
  id: 'GAM', name: 'Gamma (2-parameter)', paramNames: ['shape', 'scale'], nPar: 2, transform: null,
  cdf: (x, [a, b]) => (x <= 0 ? 0 : gammaP(a, x / b)),
  logpdf: (x, [a, b]) => (x <= 0 ? -Infinity : (a - 1) * Math.log(x / b) - x / b - lgamma(a) - Math.log(b)),
  pdf: (x, p) => Math.exp(GAM.logpdf(x, p)),
  quantile: (F, [a, b]) => b * gammaPpf(a, F),
  inSupport: (x) => x > 0,
  validParams: ([a, b]) => a > 0 && b > 0,
  lmoments([a, b]) { return { l1: a * b, l2: b * Math.exp(lgamma(a + 0.5) - lgamma(a)) / Math.sqrt(Math.PI), t3: pe3Tau3(a) }; },
  fromLmom(l) {
    if (!(l.l2 > 0) || !(l.l1 > 0)) return null;
    const ratio = l.l2 / l.l1; // = Gamma(a+1/2) / (sqrt(pi) Gamma(a+1)), decreasing in a
    const f = (la) => { const a = Math.exp(la); return Math.exp(lgamma(a + 0.5) - lgamma(a + 1)) / Math.sqrt(Math.PI) - ratio; };
    const la = brent(f, Math.log(1e-3), Math.log(1e8));
    if (Number.isNaN(la)) return null;
    const a = Math.exp(la);
    return [a, l.l1 / a];
  },
};

// ------------------------------------------------------------------ Weibull (2 parameter)
export const WEI = {
  id: 'WEI', name: 'Weibull (2-parameter)', paramNames: ['scale', 'shape'], nPar: 2, transform: null,
  cdf: (x, [lam, k]) => (x <= 0 ? 0 : -Math.expm1(-Math.pow(x / lam, k))),
  logpdf: (x, [lam, k]) => (x <= 0 ? -Infinity : Math.log(k / lam) + (k - 1) * Math.log(x / lam) - Math.pow(x / lam, k)),
  pdf: (x, p) => Math.exp(WEI.logpdf(x, p)),
  quantile: (F, [lam, k]) => lam * Math.pow(-Math.log1p(-F), 1 / k),
  inSupport: (x) => x > 0,
  validParams: ([lam, k]) => lam > 0 && k > 0,
  lmoments([lam, k]) {
    const l1 = lam * gamma(1 + 1 / k);
    return { l1, l2: l1 * (1 - Math.pow(2, -1 / k)) };
  },
  fromLmom(l) {
    const t2 = l.l2 / l.l1;
    if (!(t2 > 0) || !(t2 < 1)) return null;
    const k = -Math.LN2 / Math.log(1 - t2);
    return [l.l1 / gamma(1 + 1 / k), k];
  },
};

export const DISTRIBUTIONS = { NOR, LN2, LN3, GUM, GEV, PE3, LP3, GAM, WEI, GLO, GPA };
export const DIST_ORDER = ['NOR', 'LN2', 'LN3', 'GUM', 'GEV', 'PE3', 'LP3', 'GAM', 'WEI', 'GLO', 'GPA'];
