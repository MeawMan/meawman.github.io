// mgbt.js - Multiple Grubbs-Beck low-outlier test (Cohn et al. 2013; Bulletin 17C App. 6).
//
// This is a line-by-line port of the USGS R package MGBT (Asquith, Kiang & Cohn; functions
// MGBT17c, RthOrderPValueOrthoT, peta, EMS, VMS, V, gtmoms, CondMomsChi2, mgbt.sweeper),
// which implements Tim Cohn's algorithm. It is validated against MGBT 1.1.8 in tests/mgbt.test.js.
//
// For the r-th smallest log10 value: omega_r = (y_(r) - mean(y_(r+1..n))) / sd(y_(r+1..n)).
// Its p-value integrates, over the distribution of the r-th order statistic of a normal sample,
// a non-central t probability for omega given the conditional moments of the (n - r) values
// above it. Sweeps (17C): outward from the median at alphaout = 0.005, inward from the
// smallest at alphazeroin = 0.10; the number of PILFs is the larger count.

import { normCdf, normPdf, normPpf, betaI, lgamma } from './special.js';
import { mean, sd } from './stats.js';
import { adaptiveSimpsonGK } from './quadrature.js';
import { pnct } from './nct.js';

/** Inverse regularised incomplete beta: x with I_x(a, b) = p (bisection + Newton). */
export function qbeta(p, a, b) {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0, hi = 1, x = a / (a + b);
  const lbeta = lgamma(a) + lgamma(b) - lgamma(a + b);
  for (let i = 0; i < 200; i++) {
    const f = betaI(a, b, x) - p;
    if (Math.abs(f) < 1e-15) break;
    if (f > 0) hi = x; else lo = x;
    const dens = Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - lbeta);
    let xn = x - f / dens;
    if (!(xn > lo && xn < hi)) xn = 0.5 * (lo + hi);
    if (Math.abs(xn - x) < 1e-16 * Math.max(x, 1e-300)) { x = xn; break; }
    x = xn;
  }
  return x;
}

/** E[Z^r | Z > xsi], Z standard normal (gtmoms). */
function gtmoms(xsi, r) {
  const H = normPdf(xsi) / (1 - normCdf(xsi));
  if (r === 0) return 1;
  if (r === 1) return H;
  return (r - 1) * gtmoms(xsi, r - 2) + H * xsi ** (r - 1);
}
/** Covariance matrix of M and S^2 for the k = n - r values above xsi (V). */
function Vmat(n, r, qmin) {
  const k = n - r, z = normPpf(qmin), E = [1, 2, 3, 4].map((i) => gtmoms(z, i));
  const cm = [E[0], E[1] - E[0] ** 2, E[2] - 3 * E[1] * E[0] + 2 * E[0] ** 3,
    E[3] - 4 * E[2] * E[0] + 6 * E[1] * E[0] ** 2 - 3 * E[0] ** 4];
  return [[cm[1] / k, cm[2] / Math.sqrt(k * (k - 1))], [cm[2] / Math.sqrt(k * (k - 1)), (cm[3] - cm[1] ** 2) / k + 2 / ((k - 1) * k) * cm[1] ** 2]];
}
function condMomsChi2(n, r, xsi) {
  return [gtmoms(xsi, 2) - gtmoms(xsi, 1) ** 2, Vmat(n, r, normCdf(xsi))[1][1]];
}
function EMS(n, r, qmin) {
  const zr = normPpf(qmin), Em = gtmoms(zr, 1), m = condMomsChi2(n, r, zr);
  const alpha = m[0] ** 2 / m[1], beta = m[1] / m[0];
  return [Em, Math.sqrt(beta) * Math.exp(lgamma(alpha + 0.5) - lgamma(alpha))];
}
function VMS(n, r, qmin) {
  const z = normPpf(qmin), E1 = gtmoms(z, 1), E2 = gtmoms(z, 2);
  const Es = EMS(n, r, qmin)[1], V2 = Vmat(n, r, qmin);
  return [[V2[0][0], V2[0][1] / (2 * Es)], [V2[0][1] / (2 * Es), E2 - E1 * E1 - Es * Es]];
}
function peta(pzr, n, r, eta) {
  const br = qbeta(pzr, r, n + 1 - r), zr = normPpf(br);
  const COV = VMS(n, r, br), EMp = EMS(n, r, br);
  const lambda = COV[0][1] / COV[1][1];
  const etap = eta + lambda, muMp = EMp[0] - lambda * EMp[1];
  const SigmaMp = Math.sqrt(COV[0][0] - COV[0][1] ** 2 / COV[1][1]);
  if (!Number.isFinite(SigmaMp)) return 1;
  const m = condMomsChi2(n, r, zr);
  const q = -(Math.sqrt(m[0]) / SigmaMp) * etap;
  const df = 2 * (m[0] ** 2 / m[1]);
  const ncp = (muMp - zr) / SigmaMp;
  return 1 - pnct(q, df, ncp);
}
/** p-value of omega_r for the r-th smallest of n (RthOrderPValueOrthoT). */
export function mgbtPvalue(n, r, eta) {
  const A = Math.sqrt(Number.EPSILON);
  return adaptiveSimpsonGK((u) => peta(u, n, r, eta), A, 1 - A, 1e-9);
}

/** Sweeps exactly as mgbt.sweeper (alphain = 0 means the second sweep equals the first). */
export function mgbtSweeper(pv, { alphaout = 0.005, alphain = 0, alphazeroin = 0.10 } = {}) {
  const n2 = pv.length;
  let j1 = 0, j2 = 0, j3 = 0;
  for (let i = n2; i >= 1; i--) if (pv[i - 1] < alphaout) { j1 = i; break; }
  if (j1 < n2) for (let i = j1 + 1; i <= n2; i++) if (pv[i - 1] >= alphain) { j2 = i - 1; break; }
  // note: as in the R code, if every p-value is < alphazeroin this sweep leaves j3 = 0
  for (let i = 1; i <= n2; i++) if (pv[i - 1] >= alphazeroin) { j3 = i - 1; break; }
  return { index: Math.max(j1, j2, j3), sweeps: [j1, j2, j3] };
}

/** Full test (MGBT17c). x: annual peaks (> 0). Returns klow and the low-outlier threshold. */
export function mgbt(x, opts = {}) {
  const small = Math.sqrt(Number.EPSILON);
  const xs = x.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const n = xs.length, n2 = opts.n2 ?? Math.floor(n / 2);
  if (new Set(xs).size === 1 || n < 4) return { klow: 0, threshold: 0, pvalues: [], omegas: [], message: 'too few or identical data' };
  const z = xs.map((v) => Math.log10(Math.max(small, v)));
  const w = [], pv = [];
  for (let i = 1; i <= n2; i++) {
    const rest = z.slice(i);
    w.push((z[i - 1] - mean(rest)) / sd(rest));
    pv.push(mgbtPvalue(n, i, w[i - 1]));
  }
  const sw = mgbtSweeper(pv, opts);
  const k = sw.index;
  return {
    klow: k, nPilf: k, sweeps: sw.sweeps, omegas: w, pvalues: pv, x: xs.slice(0, n2),
    threshold: k > 0 ? xs[k] : 0, // LOThresh: values below this are PILFs
    pilfs: xs.slice(0, k),
  };
}
