/**
 * regional.js — regional (index-storm) frequency analysis with L-moments, after Hosking & Wallis (1997),
 * and spatial interpolation of IDF parameters.
 *
 * STATUS: the formulas below follow Hosking & Wallis (1993, 1997) as summarised in the lmomRFA
 * documentation (regtst) and secondary sources; they were NOT cross-checked against lmomRFA output on a
 * published dataset (R was unavailable in the build environment). Their mathematical identities are
 * unit-tested (e.g. mean discordancy = 1), but the module is labelled EXPERIMENTAL in the UI.
 *
 *  discordancy(sites)       D_i on (L-CV, L-skew, L-kurtosis); critical value by number of sites
 *  heterogeneity(sites)     H1 based on the weighted s.d. of L-CV, simulated from a kappa parent (Nsim)
 *  regionalGrowthCurve      record-length-weighted regional L-moment ratios -> growth curve q(F)
 *  idwInterpolate           inverse-distance weighting of parameters (EXPERIMENTAL; no physical basis)
 */
import { sampleLmoments } from './stats.js';
import { DISTRIBUTIONS } from './distributions.js';
import { invert } from './uncertainty.js';
import { Rng } from './rng.js';

/** Critical D_i values by number of sites (Hosking & Wallis 1997, Table 3.1 as recalled; capped at 3). */
const D_CRIT = { 5: 1.333, 6: 1.648, 7: 1.917, 8: 2.140, 9: 2.329, 10: 2.491, 11: 2.632, 12: 2.757, 13: 2.869, 14: 2.971 };
export const discordancyCritical = (N) => (N >= 15 ? 3 : D_CRIT[N] ?? NaN);

/** Per-site L-moment summary. */
export function siteLmoments(name, x) {
  const v = x.filter(Number.isFinite);
  const L = sampleLmoments(v);
  return { name, n: v.length, mean: L.l1, t: L.t, t3: L.t3, t4: L.t4 };
}

/** Discordancy measure D_i (Hosking & Wallis 1993). */
export function discordancy(sites) {
  const N = sites.length;
  const u = sites.map((s) => [s.t, s.t3, s.t4]);
  const ub = [0, 1, 2].map((j) => u.reduce((a, r) => a + r[j], 0) / N);
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const r of u) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) A[i][j] += (r[i] - ub[i]) * (r[j] - ub[j]);
  const Ai = invert(A);
  if (!Ai) return sites.map((s) => ({ name: s.name, D: NaN }));
  const crit = discordancyCritical(N);
  return u.map((r, k) => {
    const d = r.map((v, i) => v - ub[i]);
    let q = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) q += d[i] * Ai[i][j] * d[j];
    const D = (N / 3) * q;
    return { name: sites[k].name, D, discordant: D > crit, critical: crit };
  });
}

/** Record-length-weighted regional average L-moment ratios. */
export function regionalAverage(sites) {
  const W = sites.reduce((a, s) => a + s.n, 0);
  const w = (k) => sites.reduce((a, s) => a + s.n * s[k], 0) / W;
  return { t: w('t'), t3: w('t3'), t4: w('t4'), totalYears: W };
}

/**
 * Heterogeneity measure H1 (Hosking & Wallis 1993): V = sqrt(sum n_i (t_i - tR)^2 / sum n_i),
 * simulated under a homogeneous region with a kappa parent having the regional ratios (1, tR, t3R, t4R).
 * H < 1 "acceptably homogeneous", 1-2 "possibly heterogeneous", >= 2 "definitely heterogeneous".
 */
export function heterogeneity(sites, opt = {}) {
  const nSim = opt.nSim ?? 500;
  const rng = new Rng(opt.seed ?? 31);
  const R = regionalAverage(sites);
  const V = (ts) => {
    let num = 0; let den = 0;
    const tR = ts.reduce((a, s) => a + s.n * s.t, 0) / ts.reduce((a, s) => a + s.n, 0);
    for (const s of ts) { num += s.n * (s.t - tR) ** 2; den += s.n; }
    return Math.sqrt(num / den);
  };
  const Vobs = V(sites);
  const kap = DISTRIBUTIONS.kap.lmomFit({ l1: 1, l2: R.t, t: R.t, t3: R.t3, t4: R.t4 });
  let parent; let parentName;
  if (kap) { parent = (u) => DISTRIBUTIONS.kap.ppf(u, kap); parentName = 'kappa'; } else {
    // outside the kappa region: Hosking & Wallis fall back to the generalised logistic
    const g = DISTRIBUTIONS.glo.lmomFit({ l1: 1, l2: R.t, t: R.t, t3: R.t3 });
    parent = (u) => DISTRIBUTIONS.glo.ppf(u, g); parentName = 'generalised logistic (tau3/tau4 outside kappa region)';
  }
  const sims = [];
  for (let s = 0; s < nSim; s++) {
    if (opt.shouldCancel && opt.shouldCancel()) break;
    const simSites = sites.map((st) => {
      const x = Array.from({ length: st.n }, () => parent(rng.uniformOpen()));
      const L = sampleLmoments(x);
      return { n: st.n, t: L.t };
    });
    sims.push(V(simSites));
    if (opt.onProgress && s % 25 === 0) opt.onProgress({ done: s + 1, of: nSim });
  }
  const mu = sims.reduce((a, b) => a + b, 0) / sims.length;
  const sd = Math.sqrt(sims.reduce((a, b) => a + (b - mu) ** 2, 0) / (sims.length - 1));
  const H = (Vobs - mu) / sd;
  return {
    H, V: Vobs, muV: mu, sdV: sd, nSim: sims.length, parent: parentName,
    verdict: H < 1 ? 'acceptably homogeneous' : H < 2 ? 'possibly heterogeneous' : 'definitely heterogeneous',
  };
}

/**
 * Regional growth curve: fit `dist` by L-moments to the regional ratios with mean 1.
 * Site quantile = index (site mean annual maximum) x growth factor q(F).
 */
export function regionalGrowthCurve(sites, dist = 'gev') {
  const R = regionalAverage(sites);
  const L = { l1: 1, l2: R.t, t: R.t, t3: R.t3, t4: R.t4 };
  const d = DISTRIBUTIONS[dist];
  let params;
  if (dist === 'lp3' || dist === 'ln2' || dist === 'gam') throw new Error('regional growth curves use GEV, GLO, PE3 or Gumbel');
  params = d.lmomFit(L);
  return { dist, params, regional: R, growth: (T) => d.ppf(1 - 1 / T, params) };
}

/**
 * Inverse-distance-weighted interpolation of parameter vectors (EXPERIMENTAL).
 * @param {{x:number, y:number, params:number[]}[]} pts  coordinates in km (or degrees: haversine used if `geo`)
 */
export function idwInterpolate(pts, x, y, { power = 2, geo = true } = {}) {
  const dist = (a, b) => {
    if (!geo) return Math.hypot(a.x - b.x, a.y - b.y);
    const R = 6371; const toR = Math.PI / 180;
    const dLat = (b.y - a.y) * toR; const dLon = (b.x - a.x) * toR;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.y * toR) * Math.cos(b.y * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  const target = { x, y };
  const ws = pts.map((p) => { const d = dist(p, target); return d < 1e-9 ? Infinity : 1 / Math.pow(d, power); });
  const exact = ws.findIndex((w) => w === Infinity);
  if (exact >= 0) return pts[exact].params.slice();
  const W = ws.reduce((a, b) => a + b, 0);
  return pts[0].params.map((_, j) => pts.reduce((a, p, i) => a + ws[i] * p.params[j], 0) / W);
}
