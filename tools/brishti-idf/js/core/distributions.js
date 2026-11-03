/**
 * distributions.js — probability distributions for annual-maximum (and POT) rainfall,
 * with parameter estimation and goodness-of-fit.
 *
 * CONVENTIONS (see DECISIONS.md D3)
 *  - GEV, GLO, GPA (generalised Pareto) and Kappa use Hosking's shape k:
 *      k > 0  -> bounded upper tail,  k < 0 -> heavy upper tail,  k = 0 -> Gumbel/logistic/exponential.
 *    (Many R packages use xi = -k.)  Quantile functions follow Hosking & Wallis (1997, App. A).
 *  - Parameters are stored as plain arrays, in the order given by `paramNames`.
 *  - All functions take the NON-EXCEEDANCE probability F. Return period T = 1/(1-F) for annual maxima.
 *
 * ESTIMATION METHODS
 *  'lmom' L-moments (Hosking 1990); 'mom' method of moments; 'mle' maximum likelihood.
 *  Log-Pearson III is fitted on natural logs of the data ('mom' = Bulletin-17B-style station skew).
 *
 * Every estimator is checked in tests/distributions.test.js against SciPy and/or lmoments3.
 */
import {
  gamma as G, lgamma, digamma, trigamma, normalCdf, normalPdf, normalPpf, gammaP, gammaPinv,
  findRoot, EULER_GAMMA,
} from './special.js';
import { mean, sd, variance, skewAdjusted, sampleLmoments, sortedCopy, plottingPositions } from './stats.js';
import { nelderMead } from './optim.js';

const LN2 = Math.LN2;
const LN3 = Math.log(3);
const SMALL_K = 1e-7; // |k| below this is treated as the k = 0 limit

/** y transform shared by GEV/GLO/GPA/Kappa: y = -ln(1 - k (x - xi)/alpha)/k  (y = (x-xi)/alpha when k=0) */
function yOf(x, xi, alpha, k) {
  const z = (x - xi) / alpha;
  if (Math.abs(k) < SMALL_K) return z;
  const arg = 1 - k * z;
  if (arg <= 0) return k > 0 ? Infinity : -Infinity;
  return -Math.log(arg) / k;
}

/** error function inverse via the normal quantile. */
function erfinv(y) { return normalPpf((y + 1) / 2) / Math.SQRT2; }

// ===========================================================================
// Distribution definitions
// ===========================================================================

export const DISTRIBUTIONS = {
  // -------------------------------------------------------------------------
  gumbel: {
    label: 'Gumbel (EV1)',
    paramNames: ['xi (location)', 'alpha (scale)'],
    nParams: 2,
    methods: ['lmom', 'mom', 'mle'],
    valid: ([, a]) => a > 0,
    cdf: (x, [xi, a]) => Math.exp(-Math.exp(-(x - xi) / a)),
    pdf: (x, [xi, a]) => { const y = (x - xi) / a; return Math.exp(-y - Math.exp(-y)) / a; },
    ppf: (F, [xi, a]) => xi - a * Math.log(-Math.log(F)),
    lmomFit: (L) => { const a = L.l2 / LN2; return [L.l1 - EULER_GAMMA * a, a]; },
    momFit: (x) => { const a = Math.sqrt(6) * sd(x) / Math.PI; return [mean(x) - EULER_GAMMA * a, a]; },
    mleFit: gumbelMle,
    lmomTheory: ([xi, a]) => [xi + EULER_GAMMA * a, a * LN2, 0.1699250014423124, 0.1503718508] ,
  },

  // -------------------------------------------------------------------------
  gev: {
    label: 'Generalised Extreme Value (GEV)',
    paramNames: ['xi (location)', 'alpha (scale)', 'k (shape, Hosking)'],
    nParams: 3,
    methods: ['lmom', 'mle', 'gmle'],
    valid: ([, a, k]) => a > 0 && k > -1,
    cdf: (x, [xi, a, k]) => {
      const y = yOf(x, xi, a, k);
      if (y === Infinity) return 1;
      if (y === -Infinity) return 0;
      return Math.exp(-Math.exp(-y));
    },
    pdf: (x, [xi, a, k]) => {
      const y = yOf(x, xi, a, k);
      if (!isFinite(y)) return 0;
      return Math.exp(-(1 - k) * y - Math.exp(-y)) / a;
    },
    ppf: (F, [xi, a, k]) => {
      const w = -Math.log(F);
      if (Math.abs(k) < SMALL_K) return xi - a * Math.log(w);
      return xi + a * (1 - Math.pow(w, k)) / k;
    },
    lmomFit: gevLmom,
    mleFit: (x) => gevMle(x, false),
    gmleFit: (x) => gevMle(x, true),
  },

  // -------------------------------------------------------------------------
  glo: {
    label: 'Generalised Logistic (GLO)',
    paramNames: ['xi (location)', 'alpha (scale)', 'k (shape, Hosking)'],
    nParams: 3,
    methods: ['lmom', 'mle'],
    valid: ([, a, k]) => a > 0 && Math.abs(k) < 1,
    cdf: (x, [xi, a, k]) => {
      const y = yOf(x, xi, a, k);
      if (y === Infinity) return 1;
      if (y === -Infinity) return 0;
      return 1 / (1 + Math.exp(-y));
    },
    pdf: (x, [xi, a, k]) => {
      const y = yOf(x, xi, a, k);
      if (!isFinite(y)) return 0;
      const e = Math.exp(-y);
      return Math.exp(-(1 - k) * y) / (a * (1 + e) * (1 + e));
    },
    ppf: (F, [xi, a, k]) => {
      const r = (1 - F) / F;
      if (Math.abs(k) < SMALL_K) return xi - a * Math.log(r);
      return xi + a * (1 - Math.pow(r, k)) / k;
    },
    lmomFit: (L) => {
      const k = -L.t3;
      if (Math.abs(k) < SMALL_K) return [L.l1, L.l2, 0];
      const kp = k * Math.PI;
      const a = L.l2 * Math.sin(kp) / kp;
      return [L.l1 - a * (1 / k - Math.PI / Math.sin(kp)), a, k];
    },
    mleFit: (x) => genericMle('glo', x),
  },

  // -------------------------------------------------------------------------
  gpa: {
    label: 'Generalised Pareto (GPA, for peaks-over-threshold)',
    paramNames: ['xi (threshold/location)', 'alpha (scale)', 'k (shape, Hosking)'],
    nParams: 3,
    methods: ['lmom', 'mle'],
    valid: ([, a, k]) => a > 0 && k > -1,
    cdf: (x, [xi, a, k]) => {
      if (x < xi) return 0;
      const y = yOf(x, xi, a, k);
      if (y === Infinity) return 1;
      return 1 - Math.exp(-y);
    },
    pdf: (x, [xi, a, k]) => {
      if (x < xi) return 0;
      const y = yOf(x, xi, a, k);
      if (!isFinite(y)) return 0;
      return Math.exp(-(1 - k) * y) / a;
    },
    ppf: (F, [xi, a, k]) => {
      const r = 1 - F;
      if (Math.abs(k) < SMALL_K) return xi - a * Math.log(r);
      return xi + a * (1 - Math.pow(r, k)) / k;
    },
    lmomFit: (L) => {
      const k = (1 - 3 * L.t3) / (1 + L.t3);
      const a = (1 + k) * (2 + k) * L.l2;
      return [L.l1 - (2 + k) * L.l2, a, k];
    },
    mleFit: (x) => genericMle('gpa', x),
  },

  // -------------------------------------------------------------------------
  ln2: {
    label: 'Log-Normal (2-parameter)',
    paramNames: ['mu (mean of ln x)', 'sigma (sd of ln x)'],
    nParams: 2,
    methods: ['mle', 'mom', 'lmom'],
    positiveOnly: true,
    valid: ([, s]) => s > 0,
    cdf: (x, [m, s]) => (x <= 0 ? 0 : normalCdf((Math.log(x) - m) / s)),
    pdf: (x, [m, s]) => (x <= 0 ? 0 : normalPdf((Math.log(x) - m) / s) / (x * s)),
    ppf: (F, [m, s]) => Math.exp(m + s * normalPpf(F)),
    mleFit: (x) => { const lx = x.map(Math.log); return [mean(lx), sd(lx, 0)]; },
    momFit: (x) => {
      // moments of x itself: cv^2 = exp(s^2)-1
      const m = mean(x); const v = variance(x);
      const s2 = Math.log(1 + v / (m * m));
      return [Math.log(m) - s2 / 2, Math.sqrt(s2)];
    },
    lmomFit: (L) => {
      // lambda1 = exp(mu + s^2/2), lambda2 = lambda1 * erf(s/2)
      const s = 2 * erfinv(L.t);
      return [Math.log(L.l1) - s * s / 2, s];
    },
  },

  // -------------------------------------------------------------------------
  // Three-parameter log-normal in Hosking's "generalised normal" (GNO) form (Hosking & Wallis 1997, A.8):
  //   y = -ln(1 - k (x - xi)/alpha)/k,  F = Phi(y).  k < 0: LN3 with lower bound xi + alpha/k (sigma = -k);
  //   k = 0: normal; k > 0: reflected LN3 with an upper bound. Equivalent SciPy lognorm(s=-k, loc=xi+alpha/k, scale=-alpha/k).
  ln3: {
    label: 'Log-Normal (3-parameter, GNO form)',
    paramNames: ['xi (location)', 'alpha (scale)', 'k (shape, Hosking)'],
    nParams: 3,
    methods: ['lmom', 'mle'],
    valid: ([, a]) => a > 0,
    cdf: (x, [xi, a, k]) => {
      const y = yOf(x, xi, a, k);
      if (y === Infinity) return 1;
      if (y === -Infinity) return 0;
      return normalCdf(y);
    },
    pdf: (x, [xi, a, k]) => {
      const y = yOf(x, xi, a, k);
      if (!isFinite(y)) return 0;
      return Math.exp(k * y - y * y / 2) / (a * Math.sqrt(2 * Math.PI));
    },
    ppf: (F, [xi, a, k]) => {
      const z = normalPpf(F);
      if (Math.abs(k) < SMALL_K) return xi + a * z;
      return xi + a * (1 - Math.exp(-k * z)) / k;
    },
    lmomFit: gnoLmom,
    mleFit: (x) => genericMle('ln3', x),
    lmomTheory: ([xi, a, k]) => {
      if (Math.abs(k) < SMALL_K) return [xi, a / Math.sqrt(Math.PI)];
      const e = Math.exp(k * k / 2);
      return [xi + a * (1 - e) / k, (a / k) * e * (1 - 2 * normalCdf(-k / Math.SQRT2))];
    },
  },

  // -------------------------------------------------------------------------
  gam: {
    label: 'Gamma (2-parameter)',
    paramNames: ['shape', 'scale'],
    nParams: 2,
    methods: ['mle', 'mom', 'lmom'],
    positiveOnly: true,
    valid: ([a, b]) => a > 0 && b > 0,
    cdf: (x, [a, b]) => (x <= 0 ? 0 : gammaP(a, x / b)),
    pdf: (x, [a, b]) => (x <= 0 ? 0 : Math.exp((a - 1) * Math.log(x / b) - x / b - lgamma(a)) / b),
    ppf: (F, [a, b]) => b * gammaPinv(a, F),
    momFit: (x) => { const m = mean(x); const v = variance(x); return [m * m / v, v / m]; },
    mleFit: gammaMle,
    lmomFit: (L) => {
      // L-CV t = Gamma(a+1/2) / (sqrt(pi) Gamma(a+1)), decreasing in a
      const f = (la) => { const a = Math.exp(la); return Math.exp(lgamma(a + 0.5) - lgamma(a + 1)) / Math.sqrt(Math.PI) - L.t; };
      const la = findRoot(f, Math.log(1e-4), Math.log(1e6));
      const a = Math.exp(la);
      return [a, L.l1 / a];
    },
  },

  // -------------------------------------------------------------------------
  pe3: {
    label: 'Pearson Type III',
    paramNames: ['mu (mean)', 'sigma (sd)', 'gamma (skew)'],
    nParams: 3,
    methods: ['mom', 'lmom', 'mle'],
    valid: ([, s]) => s > 0,
    cdf: (x, p) => pe3Cdf(x, p),
    pdf: (x, p) => pe3Pdf(x, p),
    ppf: (F, p) => pe3Ppf(F, p),
    momFit: (x) => [mean(x), sd(x), skewAdjusted(x)],
    lmomFit: pe3Lmom,
    mleFit: (x) => genericMle('pe3', x),
  },

  // -------------------------------------------------------------------------
  lp3: {
    label: 'Log-Pearson Type III (on ln x)',
    paramNames: ['mu (mean of ln x)', 'sigma (sd of ln x)', 'gamma (skew of ln x)'],
    nParams: 3,
    methods: ['mom', 'lmom', 'mle'],
    positiveOnly: true,
    valid: ([, s]) => s > 0,
    cdf: (x, p) => (x <= 0 ? 0 : pe3Cdf(Math.log(x), p)),
    pdf: (x, p) => (x <= 0 ? 0 : pe3Pdf(Math.log(x), p) / x),
    ppf: (F, p) => Math.exp(pe3Ppf(F, p)),
    momFit: (x) => { const l = x.map(Math.log); return [mean(l), sd(l), skewAdjusted(l)]; },
    lmomFit: null, // handled in fitDistribution (L-moments of ln x)
    mleFit: (x) => genericMle('lp3', x),
  },

  // -------------------------------------------------------------------------
  kap: {
    label: 'Kappa (4-parameter; used for regional heterogeneity simulation)',
    paramNames: ['xi', 'alpha', 'k', 'h'],
    nParams: 4,
    methods: ['lmom'],
    internalOnly: true,
    valid: ([, a]) => a > 0,
    cdf: (x, [xi, a, k, h]) => {
      const y = yOf(x, xi, a, k);
      if (y === -Infinity) return 0;
      if (y === Infinity) return 1;
      const ey = Math.exp(-y);
      if (Math.abs(h) < SMALL_K) return Math.exp(-ey);
      const arg = 1 - h * ey;
      if (arg <= 0) return 0;
      return Math.pow(arg, 1 / h);
    },
    pdf: (x, p) => numericPdf(DISTRIBUTIONS.kap.cdf, x, p),
    ppf: (F, [xi, a, k, h]) => {
      const w = Math.abs(h) < SMALL_K ? -Math.log(F) : (1 - Math.pow(F, h)) / h;
      if (Math.abs(k) < SMALL_K) return xi - a * Math.log(w);
      return xi + (a / k) * (1 - Math.pow(w, k));
    },
    lmomFit: kappaLmom,
  },
};

/** Distributions offered to the user for annual-maximum analysis, in display order. */
export const AMS_DISTRIBUTIONS = ['gumbel', 'gev', 'lp3', 'ln2', 'ln3', 'gam', 'pe3', 'glo'];

export const METHOD_LABELS = {
  lmom: 'L-moments',
  mom: 'Method of moments',
  mle: 'Maximum likelihood',
  gmle: 'Penalised (generalised) ML — EXPERIMENTAL',
  lmomk: 'L-moments, shape fixed by you',
};

/** Distributions that accept a user-fixed shape k ('lmomk'): GEV (e.g. a regional shape) and GPA (k = 0 gives the exponential). */
export const FIXED_SHAPE_DISTS = ['gev', 'gpa'];

function numericPdf(cdf, x, p) {
  const h = 1e-5 * Math.max(1, Math.abs(x));
  return Math.max(0, (cdf(x + h, p) - cdf(x - h, p)) / (2 * h));
}

// ===========================================================================
// Gumbel MLE
// ===========================================================================
function gumbelMle(x) {
  const n = x.length;
  const m = mean(x);
  const s = sd(x);
  // alpha solves  alpha = mean(x) - sum(x e^{-x/alpha}) / sum(e^{-x/alpha})
  // (shift by the maximum inside exp for numerical stability)
  const xmax = Math.max(...x);
  const g = (a) => {
    let num = 0; let den = 0;
    for (let i = 0; i < n; i++) { const e = Math.exp(-(x[i] - xmax) / a); num += x[i] * e; den += e; }
    return m - num / den - a;
  };
  const a0 = Math.sqrt(6) * s / Math.PI;
  const a = findRoot(g, a0 * 0.05, a0 * 20);
  let den = 0;
  for (let i = 0; i < n; i++) den += Math.exp(-(x[i] - xmax) / a);
  const xi = xmax - a * Math.log(den / n);
  return [xi, a];
}

// ===========================================================================
// GEV
// ===========================================================================

/** GEV by L-moments, exact inversion of tau3(k) = 2(1-3^-k)/(1-2^-k) - 3 (Hosking's approximation as start). */
function gevLmom(L) {
  const t3 = L.t3;
  const z = 2 / (3 + t3) - LN2 / LN3;
  let k = 7.859 * z + 2.9554 * z * z; // Hosking (1985) approximation, accurate to ~1e-3 for -0.5<t3<0.5
  const tau3 = (kk) => (Math.abs(kk) < 1e-8 ? 0.1699250014423124 : 2 * (1 - Math.pow(3, -kk)) / (1 - Math.pow(2, -kk)) - 3);
  // Newton refinement with numeric derivative, safeguarded
  for (let it = 0; it < 50; it++) {
    const f = tau3(k) - t3;
    const h = 1e-6;
    const d = (tau3(k + h) - tau3(k - h)) / (2 * h);
    const step = f / d;
    k -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  if (!(k > -1)) k = -0.999;
  let a;
  let xi;
  if (Math.abs(k) < SMALL_K) {
    a = L.l2 / LN2;
    xi = L.l1 - EULER_GAMMA * a;
  } else {
    const g = G(1 + k);
    a = L.l2 * k / ((1 - Math.pow(2, -k)) * g);
    xi = L.l1 - a * (1 - g) / k;
  }
  return [xi, a, k];
}

/** GEV log-likelihood. */
export function gevLogLik(x, [xi, a, k]) {
  if (!(a > 0)) return -Infinity;
  let ll = 0;
  for (let i = 0; i < x.length; i++) {
    const y = yOf(x[i], xi, a, k);
    if (!isFinite(y)) return -Infinity;
    ll += -Math.log(a) - (1 - k) * y - Math.exp(-y);
  }
  return ll;
}

/**
 * Martins & Stedinger (2000) geophysical prior on the shape: Beta(6, 9) on k + 0.5 over [-0.5, 0.5]
 * (in Hosking's sign convention, mode near k ~ -0.1). EXPERIMENTAL: the prior's parameters were
 * recalled, not verified from the original paper (see DECISIONS.md D9).
 */
function gevShapePriorLog(k) {
  const u = k + 0.5;
  if (u <= 0 || u >= 1) return -Infinity;
  const p = 6; const q = 9;
  return (p - 1) * Math.log(u) + (q - 1) * Math.log(1 - u) - (lgamma(p) + lgamma(q) - lgamma(p + q));
}

function gevMle(x, penalised) {
  const L = sampleLmoments(x);
  const starts = [gevLmom(L), [...DISTRIBUTIONS.gumbel.mleFit(x), 0], [...DISTRIBUTIONS.gumbel.lmomFit(L), -0.1]];
  const objective = (p) => {
    if (p[2] <= -0.5 || p[2] >= 0.5 || p[1] <= 0) return Infinity; // shape bounded to (-0.5, 0.5)
    const ll = gevLogLik(x, p) + (penalised ? gevShapePriorLog(p[2]) : 0);
    return isFinite(ll) ? -ll : Infinity;
  };
  let best = null;
  for (const s0 of starts) {
    const s = [s0[0], s0[1], Math.min(0.45, Math.max(-0.45, s0[2]))];
    if (!isFinite(objective(s))) continue;
    const r = nelderMead(objective, s, { step: [0.1 * s[1], 0.1 * s[1], 0.05], maxIter: 3000, tol: 1e-13, restarts: 3 });
    if (!best || r.fx < best.fx) best = r;
  }
  if (!best) throw new Error('GEV maximum likelihood failed: no feasible starting point');
  return best.x;
}

// ===========================================================================
// Gamma MLE
// ===========================================================================
function gammaMle(x) {
  const m = mean(x);
  let ml = 0;
  for (const v of x) ml += Math.log(v);
  ml /= x.length;
  const s = Math.log(m) - ml; // > 0 unless all equal
  // solve ln(a) - digamma(a) = s ; good start (Minka 2002)
  let a = (3 - s + Math.sqrt((s - 3) ** 2 + 24 * s)) / (12 * s);
  for (let it = 0; it < 100; it++) {
    const f = Math.log(a) - digamma(a) - s;
    const d = 1 / a - trigamma(a);
    const an = a - f / d;
    a = an > 0 ? an : a / 2;
    if (Math.abs(f) < 1e-15) break;
  }
  return [a, m / a];
}

// ===========================================================================
// Pearson III (mu, sigma, gamma)  (Hosking & Wallis 1997, App. A.9 parameterisation)
// ===========================================================================
function pe3Shape(g) { return 4 / (g * g); }
function pe3Ppf(F, [mu, s, g]) {
  if (Math.abs(g) < 1e-6) return mu + s * normalPpf(F);
  const a = pe3Shape(g);
  const b = 0.5 * s * Math.abs(g);
  const xi = mu - 2 * s / g;
  return g > 0 ? xi + b * gammaPinv(a, F) : xi - b * gammaPinv(a, 1 - F);
}
function pe3Cdf(x, [mu, s, g]) {
  if (Math.abs(g) < 1e-6) return normalCdf((x - mu) / s);
  const a = pe3Shape(g);
  const b = 0.5 * s * Math.abs(g);
  const xi = mu - 2 * s / g;
  return g > 0 ? gammaP(a, Math.max(0, (x - xi) / b)) : 1 - gammaP(a, Math.max(0, (xi - x) / b));
}
function pe3Pdf(x, [mu, s, g]) {
  if (Math.abs(g) < 1e-6) return normalPdf((x - mu) / s) / s;
  const a = pe3Shape(g);
  const b = 0.5 * s * Math.abs(g);
  const xi = mu - 2 * s / g;
  const z = g > 0 ? (x - xi) / b : (xi - x) / b;
  if (z <= 0) return 0;
  return Math.exp((a - 1) * Math.log(z) - z - lgamma(a)) / b;
}

/** Pearson III by L-moments (Hosking & Wallis 1997 rational approximation for alpha(tau3)). */
function pe3Lmom(L) {
  const t3 = Math.abs(L.t3);
  if (t3 < 1e-6) return [L.l1, L.l2 * Math.sqrt(Math.PI), 0];
  let alpha;
  if (t3 >= 1 / 3) {
    const z = 1 - t3;
    alpha = (0.36067 * z - 0.59567 * z * z + 0.25361 * z ** 3) / (1 - 2.78861 * z + 2.56096 * z * z - 0.77045 * z ** 3);
  } else {
    const z = 3 * Math.PI * t3 * t3;
    alpha = (1 + 0.2906 * z) / (z + 0.1882 * z * z + 0.0442 * z ** 3);
  }
  const rtalf = Math.sqrt(alpha);
  const beta = Math.sqrt(Math.PI) * L.l2 * Math.exp(lgamma(alpha) - lgamma(alpha + 0.5));
  return [L.l1, beta * rtalf, Math.sign(L.t3) * 2 / rtalf];
}

// ===========================================================================
// Kappa by L-moments (Hosking 1994) — used only for heterogeneity simulation
// ===========================================================================

/** Theoretical L-moment ratios of the kappa distribution (xi=0, alpha=1). Returns null if undefined. */
export function kappaLmomentRatios(k, h) {
  if (k <= -1) return null;
  if (h < 0 && k >= -1 / h) return null; // need k < -1/h for h<0
  const g = [0, 0, 0, 0];
  for (let r = 1; r <= 4; r++) {
    if (Math.abs(h) < 1e-8) {
      // GEV limit: g_r = Gamma(1+k) r^{-k}
      g[r - 1] = G(1 + k) * Math.pow(r, -k);
    } else if (h > 0) {
      g[r - 1] = r * Math.exp(lgamma(1 + k) + lgamma(r / h) - (1 + k) * Math.log(h) - lgamma(1 + k + r / h));
    } else {
      const arg = -k - r / h;
      if (arg <= 0) return null;
      g[r - 1] = r * Math.exp(lgamma(1 + k) + lgamma(arg) - (1 + k) * Math.log(-h) - lgamma(1 - r / h));
    }
  }
  if (Math.abs(k) < 1e-8) return null; // ratios via k->0 limit not needed for our use; avoid 0/0
  const [g1, g2, g3, g4] = g;
  const l1 = (1 - g1) / k;
  const l2 = (g1 - g2) / k;
  const t3 = (-g1 + 3 * g2 - 2 * g3) / (g1 - g2);
  const t4 = (g1 - 6 * g2 + 10 * g3 - 5 * g4) / (g1 - g2);
  return { l1, l2, t3, t4 };
}

function kappaLmom(L) {
  // solve (k,h) for tau3, tau4 by minimising squared error from several starts
  const obj = ([k, h]) => {
    if (Math.abs(k) < 1e-6) k = 1e-6;
    const r = kappaLmomentRatios(k, h);
    if (!r || !isFinite(r.t3) || !isFinite(r.t4)) return 1e6;
    return (r.t3 - L.t3) ** 2 + (r.t4 - L.t4) ** 2;
  };
  let best = null;
  for (const k0 of [-0.3, -0.05, 0.1, 0.3, 0.6]) {
    for (const h0 of [-0.6, -0.2, 0.2, 0.6, 1.0]) {
      const r = nelderMead(obj, [k0, h0], { step: [0.1, 0.1], maxIter: 2000, tol: 1e-16, restarts: 2 });
      if (!best || r.fx < best.fx) best = r;
    }
  }
  if (!best || best.fx > 1e-10) return null; // tau3,tau4 outside the kappa-feasible region
  let [k, h] = best.x;
  if (Math.abs(k) < 1e-6) k = 1e-6;
  const r = kappaLmomentRatios(k, h);
  const a = L.l2 / r.l2;
  const xi = L.l1 - a * r.l1;
  return [xi, a, k, h];
}

// ===========================================================================
// Generic maximum likelihood (Nelder-Mead from the L-moment / moment estimate)
// ===========================================================================
/** Generalised normal (LN3) by L-moments: Hosking's rational approximation for k(tau3) (routine PELGNO, |tau3| < 0.95). */
function gnoLmom(L) {
  const t3 = L.t3;
  if (!(Math.abs(t3) < 0.95)) throw new Error('L-skewness outside the range the log-normal (GNO) can represent');
  const A0 = 2.0466534, A1 = -3.6544371, A2 = 1.8396733, A3 = -0.20360244;
  const B1 = -2.0182173, B2 = 1.2420401, B3 = -0.21741801;
  const tt = t3 * t3;
  const g = -t3 * (A0 + tt * (A1 + tt * (A2 + tt * A3))) / (1 + tt * (B1 + tt * (B2 + tt * B3)));
  if (Math.abs(g) < SMALL_K) return [L.l1, L.l2 * Math.sqrt(Math.PI), 0];
  const e = Math.exp(0.5 * g * g);
  const a = L.l2 * g / (e * (1 - 2 * normalCdf(-g / Math.SQRT2))); // erf(g/2) = 1 - 2 Phi(-g/sqrt 2)
  return [L.l1 + a * (e - 1) / g, a, g];
}

/** GEV location and scale from l1, l2 with the shape k fixed (Hosking & Wallis 1997, A.4). */
function gevLmomFixedK(L, k) {
  if (!(k > -1)) throw new Error('fixed GEV shape must be > -1');
  if (Math.abs(k) < SMALL_K) { const a = L.l2 / LN2; return [L.l1 - EULER_GAMMA * a, a, 0]; }
  const g = G(1 + k);
  const a = L.l2 * k / ((1 - Math.pow(2, -k)) * g);
  return [L.l1 - a * (1 - g) / k, a, k];
}

/** GPA location and scale from l1, l2 with the shape k fixed (k = 0: two-parameter exponential). */
function gpaLmomFixedK(L, k) {
  if (!(k > -1)) throw new Error('fixed GPA shape must be > -1');
  const a = (1 + k) * (2 + k) * L.l2;
  return [L.l1 - (2 + k) * L.l2, a, k];
}

function genericMle(name, x) {
  const d = DISTRIBUTIONS[name];
  let start;
  try { start = fitDistribution(name, x, d.methods.includes('lmom') ? 'lmom' : 'mom').params; } catch { start = null; }
  if (!start || !start.every(Number.isFinite)) start = fitDistribution(name, x, 'mom').params;
  const nll = (p) => {
    if (!d.valid(p)) return Infinity;
    let ll = 0;
    for (const v of x) {
      const f = d.pdf(v, p);
      if (!(f > 0)) return Infinity;
      ll += Math.log(f);
    }
    return -ll;
  };
  // nudge infeasible start (e.g. support boundary at a sample point)
  let s = start.slice();
  for (let tries = 0; tries < 20 && !isFinite(nll(s)); tries++) {
    if (name === 'gpa' || name === 'glo' || name === 'gev' || name === 'ln3') { s[0] -= 0.05 * s[1]; s[2] *= 0.8; } else { s[2] *= 0.8; s[1] *= 1.1; }
  }
  if (!isFinite(nll(s))) throw new Error(`${d.label}: maximum likelihood has no feasible start`);
  const step = s.map((v, i) => (i === s.length - 1 ? 0.05 : 0.1 * Math.max(Math.abs(v), 1e-3)));
  const r = nelderMead(nll, s, { step, maxIter: 4000, tol: 1e-13, restarts: 3 });
  return r.x;
}

// ===========================================================================
// Public API
// ===========================================================================

/**
 * Fit a distribution to a sample.
 * @param {string} name  key of DISTRIBUTIONS
 * @param {number[]} x   sample (annual maxima)
 * @param {'lmom'|'mom'|'mle'|'gmle'|'lmomk'} method   'lmomk' = L-moments with the shape fixed at opt.k (GEV, GPA)
 * @param {{k?:number}} opt
 * @returns {{dist:string, method:string, params:number[], n:number, nFree:number, ok:boolean, message:string}}
 */
export function fitDistribution(name, x, method = 'lmom', opt = {}) {
  const d = DISTRIBUTIONS[name];
  if (!d) throw new Error(`unknown distribution '${name}'`);
  const xs = Array.from(x).filter(Number.isFinite);
  const n = xs.length;
  const nFree = method === 'lmomk' ? d.nParams - 1 : d.nParams;
  const res = { dist: name, method, params: null, n, nFree, ok: false, message: '' };
  if (method === 'lmomk') res.fixedK = opt.k;
  if (n < nFree + 1) { res.message = `need at least ${d.nParams + 1} values (have ${n})`; return res; }
  if (d.positiveOnly && xs.some((v) => v <= 0)) {
    res.message = `${d.label} requires all values > 0 (zero-rain years present). Use a mixed/conditional approach or another distribution.`;
    return res;
  }
  if (sd(xs) === 0) { res.message = 'all values identical — cannot fit'; return res; }
  try {
    let p;
    if (method === 'lmom') {
      if (name === 'lp3') p = pe3Lmom(sampleLmoments(xs.map(Math.log)));
      else if (d.lmomFit) p = d.lmomFit(sampleLmoments(xs));
      else throw new Error('L-moments not available');
    } else if (method === 'mom') {
      if (!d.momFit) throw new Error('method of moments not available');
      p = d.momFit(xs);
    } else if (method === 'mle') {
      if (!d.mleFit) throw new Error('maximum likelihood not available');
      p = d.mleFit(xs);
    } else if (method === 'lmomk') {
      if (!Number.isFinite(opt.k)) throw new Error('set the fixed shape k first');
      if (name === 'gev') p = gevLmomFixedK(sampleLmoments(xs), opt.k);
      else if (name === 'gpa') p = gpaLmomFixedK(sampleLmoments(xs), opt.k);
      else throw new Error(`a fixed shape is not available for ${d.label}`);
    } else if (method === 'gmle') {
      if (!d.gmleFit) throw new Error('penalised ML not available');
      p = d.gmleFit(xs);
    } else throw new Error(`unknown method '${method}'`);
    if (!p || !p.every(Number.isFinite) || !d.valid(p)) throw new Error('estimation produced invalid parameters');
    res.params = p;
    res.ok = true;
    // warn if any observation lies outside the fitted support (e.g. GEV with k>0 below the upper bound)
    const outside = xs.filter((v) => { const F = d.cdf(v, p); return F <= 0 || F >= 1; }).length;
    if (outside) res.message = `${outside} observation(s) fall outside the fitted distribution's support`;
  } catch (e) {
    res.message = e.message;
  }
  return res;
}

/** Quantile for return period T (years) from a fit result. */
export function quantileT(fit, T) {
  return DISTRIBUTIONS[fit.dist].ppf(1 - 1 / T, fit.params);
}

/** Log-likelihood of a fitted model. */
export function logLik(fit, x) {
  const d = DISTRIBUTIONS[fit.dist];
  let ll = 0;
  for (const v of x) {
    const f = d.pdf(v, fit.params);
    ll += f > 0 ? Math.log(f) : -1e6; // heavy penalty for points outside support
  }
  return ll;
}

/**
 * Goodness-of-fit statistics for a fitted model.
 * KS D and Anderson-Darling A^2 are computed against the FITTED distribution; standard critical
 * values assume known parameters, so p-values are not reported here (use the parametric bootstrap
 * in uncertainty.js for calibrated p-values). AIC/BIC use the log-likelihood at the fitted
 * parameters regardless of estimation method. PPCC: correlation between ordered data and fitted
 * quantiles at Gringorten plotting positions. RMSE on the same plotting positions.
 */
export function goodnessOfFit(fit, x, plotting = 'gringorten') {
  const d = DISTRIBUTIONS[fit.dist];
  const s = sortedCopy(x);
  const n = s.length;
  const p = fit.params;
  // KS
  let D = 0;
  for (let i = 0; i < n; i++) {
    const F = d.cdf(s[i], p);
    D = Math.max(D, (i + 1) / n - F, F - i / n);
  }
  // AD
  let A2 = 0;
  const eps = 1e-12;
  for (let i = 0; i < n; i++) {
    const Fi = Math.min(1 - eps, Math.max(eps, d.cdf(s[i], p)));
    const Fj = Math.min(1 - eps, Math.max(eps, d.cdf(s[n - 1 - i], p)));
    A2 += (2 * (i + 1) - 1) * (Math.log(Fi) + Math.log(1 - Fj));
  }
  A2 = -n - A2 / n;
  // PPCC + RMSE
  const pp = plottingPositions(n, plotting);
  const q = Array.from(pp, (F) => d.ppf(F, p));
  let sx = 0; let sq = 0;
  for (let i = 0; i < n; i++) { sx += s[i]; sq += q[i]; }
  sx /= n; sq /= n;
  let cxy = 0; let cxx = 0; let cyy = 0; let se = 0;
  for (let i = 0; i < n; i++) {
    cxy += (s[i] - sx) * (q[i] - sq); cxx += (s[i] - sx) ** 2; cyy += (q[i] - sq) ** 2;
    se += (s[i] - q[i]) ** 2;
  }
  const ll = logLik(fit, s);
  const k = fit.nFree ?? d.nParams;
  return {
    ks: D,
    ad: A2,
    ppcc: cxy / Math.sqrt(cxx * cyy),
    rmse: Math.sqrt(se / n),
    logLik: ll,
    aic: -2 * ll + 2 * k,
    aicc: n - k - 1 > 0 ? -2 * ll + 2 * k + (2 * k * (k + 1)) / (n - k - 1) : NaN,
    bic: -2 * ll + k * Math.log(n),
  };
}

/**
 * Fit several distribution/method combinations and rank them.
 * Ranking criterion defaults to AICc; ties and near-ties are common for short records,
 * so the UI shows the full table rather than only the "winner".
 */
export function compareFits(x, combos, criterion = 'aicc', plotting = 'gringorten') {
  const rows = [];
  for (const { dist, method, k } of combos) {
    const fit = fitDistribution(dist, x, method, { k });
    const row = { dist, method, fit, gof: null };
    if (fit.ok) row.gof = goodnessOfFit(fit, x, plotting);
    rows.push(row);
  }
  const key = (r) => (r.gof ? (criterion === 'ppcc' ? -r.gof.ppcc : r.gof[criterion]) : Infinity);
  rows.sort((a, b) => key(a) - key(b));
  return rows;
}

/** Theoretical L-moment ratio curves (tau3 -> tau4) for the L-moment ratio diagram. */
export function lmomentRatioCurves() {
  const t3 = [];
  for (let v = -0.4; v <= 0.6 + 1e-9; v += 0.01) t3.push(+v.toFixed(2));
  const gev = t3.map((t) => {
    // invert tau3 for k, then tau4 = (5(1-4^-k) - 10(1-3^-k) + 6(1-2^-k)) / (1-2^-k)
    const k = gevLmom({ l1: 1, l2: 1, t3: t }).at(2);
    if (Math.abs(k) < 1e-6) return 0.1503718508;
    return (5 * (1 - Math.pow(4, -k)) - 10 * (1 - Math.pow(3, -k)) + 6 * (1 - Math.pow(2, -k))) / (1 - Math.pow(2, -k));
  });
  const glo = t3.map((t) => (1 + 5 * t * t) / 6);
  const gpa = t3.map((t) => (t * (1 + 5 * t)) / (5 + t));
  const ln3 = t3.map((t) => 0.12282 + 0.77518 * t * t + 0.12279 * t ** 4 - 0.13638 * t ** 6 + 0.11368 * t ** 8);
  const pe3 = t3.map((t) => 0.12240 + 0.30115 * t * t + 0.95812 * t ** 4 - 0.57488 * t ** 6 + 0.19383 * t ** 8);
  return { t3, gev, glo, gpa, ln3, pe3, gumbel: { t3: 0.1699, t4: 0.1504 } };
}
