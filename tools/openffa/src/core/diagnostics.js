// diagnostics.js - data checks done BEFORE fitting (iid assumption, outliers, record length).
//
//  mannKendall      : monotonic trend test (Mann 1945; Kendall 1975), tie-corrected variance,
//                     optional Hamed & Rao (1998) variance correction for autocorrelation
//  senSlope         : Theil-Sen slope estimate
//  pettitt          : change-point test (Pettitt 1979), approximate p-value
//  lag1             : lag-1 autocorrelation with the Anderson (1942) 95% limits
//  waldWolfowitz    : independence test on the serial product statistic (Wald & Wolfowitz 1943),
//                     the form used in HYFRAN (Bobee & Ashkar 1991)
//  mannWhitney      : homogeneity of two sub-periods (Wilcoxon rank-sum), normal approximation
//  grubbsBeck       : single low/high outlier test of Bulletin 17B (10 % level, log10 space)
//  mgbt             : Multiple Grubbs-Beck low-outlier test (Cohn et al. 2013; Bulletin 17C),
//                     ported from the USGS MGBT R package (see mgbt.js)
//  diagnoseSeries   : runs everything and returns plain-language findings

import { mean, sd, sortedCopy, median } from './stats.js';
import { normCdf, normSf, normPpf } from './special.js';
import { mgbt } from './mgbt.js';

const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const twoSidedP = (z) => 2 * normSf(Math.abs(z));

function tieGroups(x) {
  const m = new Map();
  for (const v of x) m.set(v, (m.get(v) || 0) + 1);
  return [...m.values()].filter((t) => t > 1);
}

/** Ranks (average for ties), 1-based. */
export function ranks(x) {
  const idx = x.map((v, i) => i).sort((a, b) => x[a] - x[b]);
  const r = new Array(x.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && x[idx[j + 1]] === x[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]] = avg;
    i = j + 1;
  }
  return r;
}

export function senSlope(t, x) {
  const s = [];
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (t[j] !== t[i]) s.push((x[j] - x[i]) / (t[j] - t[i]));
  s.sort((a, b) => a - b);
  const m = s.length;
  return m ? (m % 2 ? s[(m - 1) / 2] : 0.5 * (s[m / 2 - 1] + s[m / 2])) : NaN;
}

export function mannKendall(x, { t, hamedRao = false } = {}) {
  const n = x.length;
  t = t ?? x.map((_, i) => i);
  let S = 0;
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) S += sgn(x[j] - x[i]);
  let varS = (n * (n - 1) * (2 * n + 5) - tieGroups(x).reduce((a, g) => a + g * (g - 1) * (2 * g + 5), 0)) / 18;
  let correction = 1;
  if (hamedRao && n > 10) {
    // Hamed & Rao (1998): autocorrelation of ranks of the detrended series, significant lags only
    const b = senSlope(t, x), res = x.map((v, i) => v - b * t[i]), r = ranks(res);
    const rm = mean(r), den = r.reduce((a, v) => a + (v - rm) ** 2, 0);
    let sum = 0; const lim = normPpf(0.975) / Math.sqrt(n);
    for (let k = 1; k < n; k++) {
      let c = 0; for (let i = 0; i < n - k; i++) c += (r[i] - rm) * (r[i + k] - rm);
      const rk = c / den;
      if (Math.abs(rk) > lim) sum += (n - k) * (n - k - 1) * (n - k - 2) * rk;
    }
    correction = 1 + 2 / (n * (n - 1) * (n - 2)) * sum;
    if (correction > 0) varS *= correction;
    else correction = NaN; // the correction can go negative when many lags are used; fall back to the plain test
  }
  const Z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const tau = S / (0.5 * n * (n - 1));
  return { S, varS, Z, p: twoSidedP(Z), tau, slope: senSlope(t, x), correction };
}

export function pettitt(x) {
  const n = x.length; let best = 0, at = -1;
  for (let k = 0; k < n - 1; k++) {
    let U = 0;
    for (let i = 0; i <= k; i++) for (let j = k + 1; j < n; j++) U += sgn(x[i] - x[j]);
    if (Math.abs(U) > Math.abs(best)) { best = U; at = k; }
  }
  const K = Math.abs(best);
  const p = Math.min(1, 2 * Math.exp(-6 * K * K / (n ** 3 + n ** 2)));
  return { K, U: best, index: at, p }; // change after position `index` (0-based)
}

export function lag1(x) {
  const n = x.length, m = mean(x);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { den += (x[i] - m) ** 2; if (i < n - 1) num += (x[i] - m) * (x[i + 1] - m); }
  const r1 = num / den;
  // Anderson (1942) 95 % confidence limits for r1 of an independent series
  const z = normPpf(0.975);
  return { r1, lo: (-1 - z * Math.sqrt(n - 2)) / (n - 1), hi: (-1 + z * Math.sqrt(n - 2)) / (n - 1) };
}

/** Wald-Wolfowitz (1943) serial-correlation test as used in HYFRAN; Z ~ N(0,1) under iid. */
export function waldWolfowitz(x) {
  const n = x.length, m = mean(x), y = x.map((v) => v - m); // centring improves conditioning
  let R = y[0] * y[n - 1]; for (let i = 0; i < n - 1; i++) R += y[i] * y[i + 1];
  const s = [1, 2, 3, 4].map((r) => y.reduce((a, v) => a + v ** r, 0));
  const ER = (s[0] ** 2 - s[1]) / (n - 1);
  const VR = (s[1] ** 2 - s[3]) / (n - 1) - ER ** 2
    + (s[0] ** 4 - 4 * s[0] ** 2 * s[1] + 4 * s[0] * s[2] + s[1] ** 2 - 2 * s[3]) / ((n - 1) * (n - 2));
  const Z = (R - ER) / Math.sqrt(VR);
  return { R, Z, p: twoSidedP(Z) };
}

export function mannWhitney(a, b) {
  const all = [...a, ...b], r = ranks(all), n1 = a.length, n2 = b.length, N = n1 + n2;
  const R1 = r.slice(0, n1).reduce((s, v) => s + v, 0);
  const U = R1 - n1 * (n1 + 1) / 2, EU = n1 * n2 / 2;
  const tie = tieGroups(all).reduce((s, t) => s + t ** 3 - t, 0);
  const VU = n1 * n2 / 12 * ((N + 1) - tie / (N * (N - 1)));
  const Z = (U - EU) / Math.sqrt(VU);
  return { U, Z, p: twoSidedP(Z) };
}

/**
 * Bulletin 17B single Grubbs-Beck test (10 % one-sided), applied to log10 data.
 * K_N = -0.9043 + 3.345 sqrt(log10 N) - 0.4046 log10 N  (B17B approximation, 10 <= N <= 149).
 */
export function grubbsBeck(x) {
  const y = x.filter((v) => v > 0).map(Math.log10), n = y.length;
  const m = mean(y), s = sd(y), lg = Math.log10(n);
  const K = -0.9043 + 3.345 * Math.sqrt(lg) - 0.4046 * lg;
  const low = 10 ** (m - K * s), high = 10 ** (m + K * s);
  return { K, lowThreshold: low, highThreshold: high, low: x.filter((v) => v < low), high: x.filter((v) => v > high), validRange: n >= 10 && n <= 149 };
}

export { mgbt } from './mgbt.js'; // validated port of the USGS MGBT R package

/** Run every check and return findings in plain language. */
export function diagnoseSeries(values, years) {
  const n = values.length, out = { n, findings: [], tests: {} };
  const add = (level, text) => out.findings.push({ level, text });
  if (n < 10) add('bad', `Only ${n} values. Frequency analysis with fewer than 10 annual maxima is not defensible (Bulletin 17C requires at least 10 years); use regional information.`);
  else if (n < 25) add('warn', `${n} values: estimates beyond ~2n years (${2 * n}-yr) are extrapolations with large uncertainty; 3-parameter shapes are poorly determined below ~25 values.`);
  else add('ok', `${n} values: adequate for at-site analysis; still treat return periods beyond ~2n (${2 * n} yr) as extrapolation.`);

  if (years) {
    const yrs = [...years].sort((a, b) => a - b), gaps = [];
    for (let i = 1; i < yrs.length; i++) if (yrs[i] - yrs[i - 1] > 1) gaps.push([yrs[i - 1] + 1, yrs[i] - 1]);
    out.tests.gaps = gaps;
    const missing = gaps.reduce((a, [s, e]) => a + e - s + 1, 0);
    if (missing) add('warn', `${missing} missing year(s) in ${gaps.length} gap(s) (${gaps.map(([s, e]) => (s === e ? s : `${s}-${e}`)).join(', ')}). Gaps are fine for stationary FFA if they are not caused by floods (e.g. a gauge washed away), which would bias the sample.`);
    const dup = yrs.filter((v, i) => i && v === yrs[i - 1]);
    if (dup.length) add('bad', `Duplicate years: ${[...new Set(dup)].join(', ')}. An annual maximum series must have one value per year.`);
  }
  const t = years ?? values.map((_, i) => i);
  if (n >= 4) {
    const mk = mannKendall(values, { t, hamedRao: n > 10 });
    out.tests.mannKendall = mk;
    if (mk.p < 0.05) add('warn', `Mann-Kendall trend test: significant ${mk.tau > 0 ? 'increasing' : 'decreasing'} trend (p = ${mk.p.toFixed(3)}, Sen slope = ${mk.slope.toPrecision(3)} per ${years ? 'year' : 'step'}${Number.isFinite(mk.correction) && mk.correction !== 1 ? ', Hamed-Rao autocorrelation-corrected' : ''}). Stationary FFA may be biased; consider the non-stationary GEV or analysing a homogeneous sub-period.`);
    else add('ok', `Mann-Kendall: no significant monotonic trend (p = ${mk.p.toFixed(3)}).`);
    const pt = pettitt(values);
    out.tests.pettitt = { ...pt, year: pt.index >= 0 ? t[pt.index] : null };
    if (pt.p < 0.05) add('warn', `Pettitt test: probable change point after ${years ? t[pt.index] : 'position ' + (pt.index + 1)} (p = ${pt.p.toFixed(3)}). Check for dams, embankments, rating-curve or gauge changes.`);
    else add('ok', `Pettitt: no significant change point (p = ${pt.p.toFixed(3)}).`);
    const l1 = lag1(values);
    out.tests.lag1 = l1;
    const ww = waldWolfowitz(values); out.tests.waldWolfowitz = ww;
    if (l1.r1 < l1.lo || l1.r1 > l1.hi || ww.p < 0.05) add('warn', `Serial dependence: lag-1 autocorrelation r1 = ${l1.r1.toFixed(3)} (95% limits ${l1.lo.toFixed(3)} to ${l1.hi.toFixed(3)}), Wald-Wolfowitz p = ${ww.p.toFixed(3)}. Annual maxima may not be independent (e.g. multi-year storage); effective sample size is smaller than n.`);
    else add('ok', `Independence: lag-1 r1 = ${l1.r1.toFixed(3)} within limits; Wald-Wolfowitz p = ${ww.p.toFixed(3)}.`);
    const h = Math.floor(n / 2), mw = mannWhitney(values.slice(0, h), values.slice(h));
    out.tests.mannWhitney = mw;
    if (mw.p < 0.05) add('warn', `Homogeneity (Mann-Whitney, first vs second half): significant difference (p = ${mw.p.toFixed(3)}).`);
    else add('ok', `Homogeneity (Mann-Whitney, halves): no significant difference (p = ${mw.p.toFixed(3)}).`);
  }
  if (values.some((v) => v <= 0)) add('warn', `${values.filter((v) => v <= 0).length} zero/negative value(s). Log-based distributions (LN2, LP3) cannot use them; treat zeros with the conditional-probability (zero-flow) option or censor them.`);
  if (n >= 10 && values.filter((v) => v > 0).length > 5) {
    const gb = grubbsBeck(values.filter((v) => v > 0)); out.tests.grubbsBeck = gb;
    if (gb.high.length) add('warn', `High outlier(s) by the B17B Grubbs-Beck test: ${gb.high.map((v) => v.toPrecision(4)).join(', ')}. Do NOT delete them without evidence; check against historic information. Large floods are the most informative data for the upper tail.`);
    const mg = mgbt(values); out.tests.mgbt = mg;
    if (mg.nPilf) add('warn', `Multiple Grubbs-Beck (Bulletin 17C): ${mg.nPilf} potentially influential low flood(s) below ${mg.threshold.toPrecision(4)}. Bulletin 17C censors these (treats them as "less than" the threshold) so they do not distort the upper tail. Enable censoring in the fit step.`);
    else add('ok', 'Multiple Grubbs-Beck (Bulletin 17C): no potentially influential low floods.');
  }
  const bad = out.findings.filter((f) => f.level === 'bad').length, warn = out.findings.filter((f) => f.level === 'warn' && /trend|change point|Homogeneity/.test(f.text)).length;
  out.recommendation = bad ? 'Stationary FFA is NOT defensible with these data as they stand; resolve the issues marked in red.'
    : warn ? 'Stationary FFA is questionable: there is evidence of non-stationarity or inhomogeneity. Investigate causes; compare with a non-stationary GEV or a homogeneous sub-period, and report the sensitivity.'
      : 'No evidence against the iid assumption at the 5 % level. Stationary FFA is defensible (absence of evidence is not proof, especially for short records).';
  return out;
}
