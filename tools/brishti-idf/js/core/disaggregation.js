/**
 * disaggregation.js — estimating sub-daily design depths when only DAILY data exist.
 *
 * All methods work on DESIGN QUANTILES (depth for a given T), not on time series:
 *   P_T(t) = P_T(24 h) * r(t[, T])
 * so the frequency analysis is done once on the (fixed-interval-corrected) daily maxima.
 *
 * Methods and their verification status (shown in the UI):
 *  'imd'        IMD empirical reduction formula  P_t = P_24 (t/24)^(1/3), t in hours.
 *               VERIFIED formula (quoted in IJIRT 2019 eq. 3.1 and Academia.edu paper, both opened).
 *               Accuracy for Bangladesh is NOT established: Saiara et al. (2026) compared it with WMO
 *               ratios only, and Galoie (2021) reports low accuracy in some regions, worsening at short durations.
 *  'power'      P_t = P_24 (t/24)^n with n calibrated on local sub-daily data (simple-scaling exponent of
 *               quantiles). The IMD formula is the special case n = 1/3. Requires sub-daily data somewhere.
 *  'scaling'    simple scaling of annual-maximum moments (Menabde et al. 1999 framework): exponent H from the
 *               log-log slope of mean AMS depth vs duration over the calibration durations; P_T(t) = P_T(D) (t/D)^H.
 *               Includes a multiscaling diagnostic (moment-scaling exponents K(q) should be linear in q).
 *  'ratios'     user-supplied ratio table r(t) (e.g. a local or published table typed in by the user).
 *  'ratioTransfer' depth ratios r(t) = P_T(t)/P_T(24 h) measured at a nearby station WITH sub-daily data
 *               (geometric mean over return periods; log-log interpolation between its durations), applied to
 *               this station's 24-h quantiles. Unlike a single power law it keeps the curvature of the local
 *               depth-duration relationship (standard regional-ratio practice; cf. the WMO depth-ratio approach
 *               compared for Bangladesh by Saiara et al. 2026). Assumes the ratios are regionally transferable.
 *  'bell'       Bell (1969): P_t^T / P_60^10 = (0.54 t^0.25 - 0.50)(0.21 ln T + 0.52), 5 <= t <= 120 min.
 *               EXPERIMENTAL: coefficients recalled, could not be verified from an opened source; needs the
 *               10-yr 1-h depth, which itself must come from local data or another method.
 */
import { linearFit, mean } from './stats.js';

export const DISAGG_METHODS = {
  imd: { label: 'IMD reduction formula (t/24)^(1/3)', status: 'verified-formula', needs: [] },
  power: { label: 'Power law with locally calibrated exponent', status: 'verified', needs: ['subdaily'] },
  scaling: { label: 'Simple scaling of AMS moments', status: 'verified', needs: ['subdaily'] },
  ratioTransfer: { label: 'Depth ratios transferred from a sub-daily station', status: 'verified', needs: ['subdaily'] },
  ratios: { label: 'User-supplied ratio table', status: 'user', needs: ['ratios'] },
  bell: { label: 'Bell (1969) generalised ratios', status: 'experimental', needs: ['p60_10'] },
};

/** IMD ratio r(t) = (t/24)^(1/3), t in minutes here. */
export const imdRatio = (tMin) => Math.pow(tMin / 1440, 1 / 3);

/** Bell (1969) ratio relative to the 10-yr 1-h depth (EXPERIMENTAL). */
export function bellRatio(tMin, T) {
  return (0.54 * Math.pow(tMin, 0.25) - 0.5) * (0.21 * Math.log(T) + 0.52);
}

/**
 * Calibrate the power-law exponent n from local quantiles: least squares of ln(P_T(t)/P_T(24h)) on ln(t/24h),
 * pooled over the supplied return periods and durations (through the origin, since r(24h)=1).
 * @param {{d:number, depth:number[]}[]} rows quantile-table rows (depth for each T) including d = 1440
 */
export function calibratePowerExponent(rows, returnPeriods) {
  const ref = rows.find((r) => r.d === 1440);
  if (!ref) throw new Error('calibration needs the 24-h duration in the local sub-daily data');
  let sxy = 0; let sxx = 0;
  const perT = returnPeriods.map((T, k) => {
    let a = 0; let b = 0;
    for (const r of rows) {
      if (r.d === 1440 || !(r.depth[k] > 0)) continue;
      const x = Math.log(r.d / 1440); const y = Math.log(r.depth[k] / ref.depth[k]);
      sxy += x * y; sxx += x * x; a += x * y; b += x * x;
    }
    return { T, n: a / b };
  });
  return { n: sxy / sxx, perT };
}

/**
 * Depth ratios r(t) = P_T(t) / P_T(24 h) from a station with sub-daily quantiles.
 * Geometric mean over the return periods; target durations between calibration durations are interpolated
 * linearly in log(ratio) vs log(duration); targets outside the calibrated range get NaN (no extrapolation).
 * @param {{d:number, depth:number[]}[]} rows quantile-table rows including d = 1440
 * @param {number[]} returnPeriods
 * @param {number[]} [targets] durations (min) to return ratios for; default: the calibration durations
 * @returns {{ratios:Object<number,number>, perT:{T:number, ratios:Object<number,number>}[]}}
 */
export function calibrateRatios(rows, returnPeriods, targets) {
  const ref = rows.find((r) => r.d === 1440);
  if (!ref) throw new Error('ratio transfer needs the 24-h duration in the calibration station');
  const pts = rows.filter((r) => r.d !== 1440 && returnPeriods.every((_, k) => r.depth[k] > 0 && ref.depth[k] > 0))
    .map((r) => ({ d: r.d, lr: mean(returnPeriods.map((_, k) => Math.log(r.depth[k] / ref.depth[k]))) }))
    .concat([{ d: 1440, lr: 0 }])
    .sort((a, b) => a.d - b.d);
  if (pts.length < 2) throw new Error('ratio transfer needs at least one sub-daily duration with valid quantiles');
  const at = (d) => {
    const exact = pts.find((p) => p.d === d);
    if (exact) return Math.exp(exact.lr);
    if (d < pts[0].d || d > pts.at(-1).d) return NaN;
    const j = pts.findIndex((p) => p.d > d);
    const a = pts[j - 1]; const b = pts[j];
    const w = (Math.log(d) - Math.log(a.d)) / (Math.log(b.d) - Math.log(a.d));
    return Math.exp(a.lr + w * (b.lr - a.lr));
  };
  const ds = targets ?? pts.map((p) => p.d).filter((d) => d !== 1440);
  const ratios = Object.fromEntries(ds.map((d) => [d, at(d)]));
  const perT = returnPeriods.map((T, k) => ({ T, ratios: Object.fromEntries(rows.filter((r) => r.d !== 1440).map((r) => [r.d, r.depth[k] / ref.depth[k]])) }));
  return { ratios, perT };
}

/**
 * Simple-scaling analysis of annual maxima (depth). Returns H (slope of ln mean vs ln d) and the
 * moment-scaling function K(q) for q = 1..4; under simple scaling K(q) = q H (linear through origin).
 * @param {{durations:number[], depth:Object}} ams
 */
export function scalingAnalysis(ams, durations) {
  const ds = (durations ?? ams.durations).filter((d) => ams.depth[d]);
  const K = [1, 2, 3, 4].map((q) => {
    const x = []; const y = [];
    for (const d of ds) {
      const v = ams.depth[d].filter(Number.isFinite);
      if (!v.length) continue;
      x.push(Math.log(d)); y.push(Math.log(mean(v.map((u) => Math.pow(u, q)))));
    }
    const f = linearFit(x, y);
    return { q, slope: f.b, intercept: f.a };
  });
  const H = K[0].slope;
  // linearity of K(q): compare slopes to q*H
  const dev = K.map((k) => k.slope - k.q * H);
  const fq = linearFit(K.map((k) => k.q), K.map((k) => k.slope));
  return {
    H, K, deviationFromSimple: dev,
    verdict: Math.max(...dev.map(Math.abs)) < 0.05 * 4 * Math.abs(H)
      ? 'Moment-scaling exponents are close to linear in q: simple scaling is a reasonable working assumption.'
      : 'Moment-scaling exponents depart from linearity: evidence of multiscaling; simple-scaling transfer to shorter durations is less reliable.',
    kSlope: fq.b,
    durations: ds,
  };
}

/**
 * Disaggregate 24-h design depths to other durations.
 * @param {number[]} p24 24-h design depths for each T in returnPeriods (already fixed-interval corrected)
 * @param {number[]} durations target durations (min)
 * @param {number[]} returnPeriods
 * @param {{method:string, n?:number, H?:number, refDuration?:number, ratios?:Object<number,number>, p60_10?:number}} opt
 * @returns {{rows:{d:number, depth:number[], intensity:number[]}[], returnPeriods:number[], method:string, note:string}}
 */
export function disaggregate(p24, durations, returnPeriods, opt) {
  const m = opt.method;
  const rows = durations.map((d) => {
    let depth;
    if (m === 'imd') depth = p24.map((p) => p * imdRatio(d));
    else if (m === 'power') depth = p24.map((p) => p * Math.pow(d / 1440, opt.n));
    else if (m === 'scaling') depth = p24.map((p) => p * Math.pow(d / (opt.refDuration ?? 1440), opt.H));
    else if (m === 'ratios' || m === 'ratioTransfer') {
      const r = opt.ratios?.[d];
      depth = p24.map((p) => (r == null ? NaN : p * r));
    } else if (m === 'bell') {
      depth = returnPeriods.map((T) => (d >= 5 && d <= 120 ? opt.p60_10 * bellRatio(d, T) : NaN));
    } else throw new Error(`unknown disaggregation method ${m}`);
    return { d, depth, intensity: depth.map((v) => v / (d / 60)) };
  });
  return { rows, returnPeriods, method: m, note: DISAGG_METHODS[m]?.status ?? '' };
}

/**
 * Hold-out validation: compare disaggregated quantiles with quantiles from observed sub-daily data.
 * @param {{rows:{d:number, depth:number[]}[]}} observed  quantile table from sub-daily AMS (truth)
 * @param {{rows:{d:number, depth:number[]}[]}} estimated disaggregated quantile table
 * @returns per-duration, per-T percentage errors and summary statistics
 */
export function holdOutErrors(observed, estimated, returnPeriods) {
  const out = [];
  for (const e of estimated.rows) {
    const o = observed.rows.find((r) => r.d === e.d);
    if (!o) continue;
    returnPeriods.forEach((T, k) => {
      if (Number.isFinite(o.depth[k]) && Number.isFinite(e.depth[k])) out.push({ d: e.d, T, obs: o.depth[k], est: e.depth[k], pct: 100 * (e.depth[k] - o.depth[k]) / o.depth[k] });
    });
  }
  const abs = out.map((r) => Math.abs(r.pct));
  return {
    rows: out,
    mape: abs.reduce((a, b) => a + b, 0) / abs.length,
    bias: out.reduce((a, r) => a + r.pct, 0) / out.length,
    maxAbs: Math.max(...abs),
  };
}
