// nct.js - CDF of the non-central t distribution, algorithm AS 243 (Lenth 1989), the same
// algorithm used by R's pt(q, df, ncp). Validated against scipy.stats.nct.cdf.

import { betaI, lgamma, normCdf } from './special.js';

export function pnct(t, df, ncp) {
  if (!Number.isFinite(t)) return t > 0 ? 1 : 0;
  if (df > 4e5 || !Number.isFinite(df)) { // essentially normal
    const s = 1 / (4 * df);
    return normCdf((t * (1 - s) - ncp) / Math.sqrt(1 + t * t * 2 * s));
  }
  let negdel = false, tt = t, del = ncp;
  if (t < 0) { negdel = true; tt = -t; del = -ncp; }
  const ERRMAX = 1e-13, ITRMAX = 5000;
  const x = tt * tt / (tt * tt + df);
  let tnc = 0;
  if (x > 0) {
    const lambda = del * del;
    let p = 0.5 * Math.exp(-0.5 * lambda);
    let q = Math.sqrt(2 / Math.PI) * p * del;
    let s = 0.5 - p;
    if (s < 1e-7) s = -0.5 * Math.expm1(-0.5 * lambda); // accuracy for small lambda
    let a = 0.5;
    const b = 0.5 * df;
    const rxb = Math.pow(1 - x, b);
    const albeta = 0.5 * Math.log(Math.PI) + lgamma(b) - lgamma(0.5 + b);
    let xodd = betaI(a, b, x);
    let godd = 2 * rxb * Math.exp(a * Math.log(x) - albeta);
    let xeven = 1 - rxb;
    let geven = b * x * rxb;
    tnc = p * xodd + q * xeven;
    for (let en = 1; en <= ITRMAX; en++) {
      a += 1;
      xodd -= godd;
      xeven -= geven;
      godd *= x * (a + b - 1) / a;
      geven *= x * (a + b - 0.5) / (a + 0.5);
      p *= lambda / (2 * en);
      q *= lambda / (2 * en + 1);
      s -= p;
      tnc += p * xodd + q * xeven;
      const errbd = 2 * s * (xodd - godd);
      if (Math.abs(errbd) <= ERRMAX && en > 2) break;
    }
  }
  tnc += normCdf(-del);
  if (negdel) tnc = 1 - tnc;
  return Math.min(1, Math.max(0, tnc));
}
