// plotpos.js - plotting positions p_i = (i - a) / (n + 1 - 2a) for ascending ranks i = 1..n.
// p is the NON-EXCEEDANCE probability; the return period is T = 1 / (1 - p).
//
// Guidance (general literature, e.g. Cunnane 1978; Stedinger et al. 1993 in
// Handbook of Hydrology): Weibull (a=0) is unbiased for the exceedance probability of
// any distribution; Gringorten (a=0.44) is tuned for Gumbel/GEV; Blom (a=0.375) for the
// normal; Cunnane (a=0.4) is a compromise for several distributions; Hazen (a=0.5) is
// simple and widely used in agency practice; median (a=0.3175) gives the median
// exceedance probability of each order statistic.
export const PLOTTING_POSITIONS = {
  weibull: { a: 0, label: 'Weibull', note: 'Unbiased exceedance probability; distribution-free. Common default.' },
  hazen: { a: 0.5, label: 'Hazen', note: 'Simple, widely used in agency practice; tends to overstate probability of the largest events.' },
  blom: { a: 0.375, label: 'Blom', note: 'Designed for normal (and log-normal) data.' },
  cunnane: { a: 0.4, label: 'Cunnane', note: 'Good general-purpose compromise for several distributions.' },
  gringorten: { a: 0.44, label: 'Gringorten', note: 'Designed for Gumbel / GEV (EV1-like) data.' },
  median: { a: 0.3175, label: 'Median', note: 'Median exceedance probability of each order statistic.' },
};

export function plottingPositions(n, type = 'weibull') {
  const a = PLOTTING_POSITIONS[type]?.a ?? Number(type);
  const p = new Array(n);
  for (let i = 1; i <= n; i++) p[i - 1] = (i - a) / (n + 1 - 2 * a);
  return p;
}
export const returnPeriodFromP = (p) => 1 / (1 - p);

/**
 * Threshold-exceedance plotting positions for a record with one historic period (Hirsch 1987;
 * Hirsch & Stedinger 1987; Bulletin 17C App. 5, eqs. 5-1 and 5-2).
 *   systematic : the ns gauged annual peaks;  historicPeaks : floods above T in the nh historic years
 *   T : perception threshold; a : plotting-position parameter (0 = Weibull)
 * k floods exceed T in n = ns + nh years; pe = k/n.
 *   above T (i = 1..k, largest first):        p_i = pe (i - a)/(k + 1 - 2a)
 *   below T (r = 1..ns-es, largest first):    p_r = pe + (1 - pe)(r - a)/(ns - es + 1 - 2a)
 * Returns [{x, F}] with F = 1 - p (non-exceedance), sorted ascending in x.
 */
export function thresholdExceedancePositions(systematic, historicPeaks, nh, T, a = 0) {
  const ns = systematic.length, n = ns + nh;
  const above = [...systematic.filter((v) => v >= T), ...historicPeaks.filter((v) => v >= T)].sort((x, y) => y - x); // floods at the threshold count as exceeding it (B17C Ex. 6)
  const below = systematic.filter((v) => v < T).sort((x, y) => y - x);
  const k = above.length, es = ns - below.length, pe = k / n;
  const out = above.map((x, i) => ({ x, F: 1 - pe * ((i + 1 - a) / (k + 1 - 2 * a)), historic: !systematic.includes(x) }));
  below.forEach((x, r) => out.push({ x, F: 1 - (pe + (1 - pe) * ((r + 1 - a) / (ns - es + 1 - 2 * a))) }));
  return out.sort((p, q) => p.x - q.x);
}
