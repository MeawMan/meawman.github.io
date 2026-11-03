// bootci.js - turning bootstrap replicates into confidence limits.
//
//   percentile : the (1-level)/2 and (1+level)/2 quantiles of the replicates (Efron & Tibshirani 1993, ch. 13).
//   bc         : bias-corrected percentile. z0 = Phi^-1(share of replicates below the estimate); the limits are
//                taken at Phi(2 z0 -/+ z) instead of Phi(-/+ z) (Efron & Tibshirani 1993, sec. 14.3 with a = 0).
//                It corrects the downward median bias of skewed estimators such as LP3/EMA quantiles.
//   bca        : BC with an acceleration a from the jackknife (non-parametric bootstrap only):
//                a = sum(d^3) / (6 (sum d^2)^1.5), d = mean(jack) - jack_i  (Efron 1987).
//
// Limits are interpolated in the sorted replicates (R type 7), as for the percentile method.

import { normCdf, normPpf } from './special.js';
import { quantileSorted } from './stats.js';

export const CI_CORRECTIONS = { percentile: 'Percentile', bc: 'Bias-corrected (BC)', bca: 'Bias-corrected and accelerated (BCa)' };

/** Acceleration constant from jackknife estimates. */
export function jackknifeAcceleration(jack) {
  const m = jack.reduce((s, v) => s + v, 0) / jack.length;
  let s2 = 0, s3 = 0;
  for (const v of jack) { const d = m - v; s2 += d * d; s3 += d * d * d; }
  return s2 > 0 ? s3 / (6 * Math.pow(s2, 1.5)) : 0;
}

/**
 * @param {Float64Array} sorted   replicates, ascending
 * @param {number} estimate       the point estimate from the original sample
 * @param {number} level          e.g. 0.9
 * @param {'percentile'|'bc'|'bca'} correction
 * @param {number} [accel]        acceleration (bca only)
 */
export function bootLimits(sorted, estimate, level, correction = 'percentile', accel = 0) {
  const a = (1 - level) / 2;
  if (correction === 'percentile' || !Number.isFinite(estimate)) return { lo: quantileSorted(sorted, a), hi: quantileSorted(sorted, 1 - a), z0: 0 };
  const n = sorted.length;
  let below = 0, ties = 0;
  for (const v of sorted) { if (v < estimate) below++; else if (v === estimate) ties++; }
  const p = Math.min(1 - 0.5 / n, Math.max(0.5 / n, (below + 0.5 * ties) / n));
  const z0 = normPpf(p);
  const acc = correction === 'bca' && Number.isFinite(accel) ? accel : 0;
  const adj = (alpha) => { const z = normPpf(alpha); return normCdf(z0 + (z0 + z) / (1 - acc * (z0 + z))); };
  const clamp = (q) => Math.min(1, Math.max(0, q));
  return { lo: quantileSorted(sorted, clamp(adj(a))), hi: quantileSorted(sorted, clamp(adj(1 - a))), z0, accel: acc };
}
