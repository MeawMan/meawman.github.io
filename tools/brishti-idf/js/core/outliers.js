/**
 * outliers.js — Grubbs–Beck screening of annual maxima for low and high outliers.
 *
 * Method: Bulletin 17B (IACWD 1982, Appendix 4). On base-10 logs of the positive values,
 *   threshold = 10^(mean ± K_N · sd),   K_N = −0.9043 + 3.345·√(log10 N) − 0.4046·log10 N
 * which reproduces the one-sided 10%-significance Grubbs–Beck table for 10 ≤ N ≤ 149 within ±0.001
 * (e.g. K_10 = 2.036, K_100 = 3.017).
 *
 * The test only FLAGS values; nothing is removed automatically. Rainfall maxima are rarely censored the
 * way low flood peaks are, so a flag is a prompt to check the record (transcription error, a year with a
 * failed gauge), not a reason to delete a real storm. The newer multiple Grubbs–Beck test of Bulletin 17C
 * (Cohn et al. 2013) is not implemented.
 */

/** Grubbs–Beck K_N at 10% significance (Bulletin 17B approximation). */
export function grubbsBeckK(n) {
  const l = Math.log10(n);
  return -0.9043 + 3.345 * Math.sqrt(l) - 0.4046 * l;
}

/**
 * @param {number[]} x values (annual maxima, any units); non-finite values are ignored
 * @param {number[]} [years] labels aligned with x
 * @returns {{n:number, applicable:boolean, message:string, K:number, low:number, high:number,
 *            lowFlags:{year:any, value:number}[], highFlags:{year:any, value:number}[], zeros:number}}
 */
export function grubbsBeck(x, years = null) {
  const pairs = x.map((v, i) => ({ v, year: years ? years[i] : i + 1 })).filter((p) => Number.isFinite(p.v));
  const zeros = pairs.filter((p) => p.v <= 0).length;
  const pos = pairs.filter((p) => p.v > 0);
  const n = pos.length;
  const out = { n, zeros, applicable: false, message: '', K: NaN, low: NaN, high: NaN, lowFlags: [], highFlags: [] };
  if (n < 10) { out.message = `needs at least 10 positive values (have ${n})`; return out; }
  if (n > 149) out.message = 'K_N extrapolated beyond N = 149';
  const lx = pos.map((p) => Math.log10(p.v));
  const m = lx.reduce((a, b) => a + b, 0) / n;
  const s = Math.sqrt(lx.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const K = grubbsBeckK(n);
  out.applicable = true;
  out.K = K;
  out.low = 10 ** (m - K * s);
  out.high = 10 ** (m + K * s);
  out.lowFlags = pos.filter((p) => p.v < out.low).map((p) => ({ year: p.year, value: p.v }));
  out.highFlags = pos.filter((p) => p.v > out.high).map((p) => ({ year: p.year, value: p.v }));
  return out;
}
