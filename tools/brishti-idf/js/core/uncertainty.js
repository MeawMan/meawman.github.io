/**
 * uncertainty.js — confidence intervals for quantiles and IDF parameters.
 *
 *  bootstrapQuantiles : non-parametric bootstrap resampling WHOLE YEARS jointly across durations,
 *                       so the dependence between durations is preserved; percentile intervals.
 *                       Optionally refits an IDF model per replicate to give parameter intervals.
 *  parametricBootstrapGof : calibrated p-value for the Anderson-Darling (or KS) statistic of a fitted
 *                       distribution (critical values for estimated parameters are not otherwise known).
 *  deltaMethod        : normal-approximation CI for a quantile from an ML fit (numerical Hessian).
 *
 * All routines take a seed and optional progress/cancel callbacks (run them in the Web Worker).
 */
import { Rng } from './rng.js';
import { DISTRIBUTIONS, fitDistribution, quantileT, goodnessOfFit } from './distributions.js';
import { quantile as empQuantile } from './stats.js';
import { fitForm, fitKModel, predict } from './idf.js';
import { normalPpf } from './special.js';

/**
 * @param {object} ams depth AMS {durations, years, depth}
 * @param {{dist:string, method:string, perDuration?:object, returnPeriods:number[], factor?:Function}} freq
 * @param {{nBoot?:number, seed?:number, level?:number, idf?:{kind:'form'|'kmodel', key:string, opt:object, point?:object},
 *          onProgress?:Function, shouldCancel?:Function}} opt
 */
export function bootstrapQuantiles(ams, freq, opt = {}) {
  const nBoot = opt.nBoot ?? 500;
  const rng = new Rng(opt.seed ?? 20261026);
  const level = opt.level ?? 0.9;
  const Ts = freq.returnPeriods;
  const nYears = ams.years.length;
  // replicate -> duration -> T -> depth
  const reps = ams.durations.map(() => Ts.map(() => []));
  const idfParams = [];
  let failures = 0;
  for (let b = 0; b < nBoot; b++) {
    if (opt.shouldCancel && opt.shouldCancel()) break;
    const idx = Array.from({ length: nYears }, () => rng.int(nYears));
    const depth = {};
    for (const d of ams.durations) depth[d] = idx.map((j) => ams.depth[d][j]);
    const bAms = { durations: ams.durations, years: idx.map((j) => ams.years[j]), depth };
    ams.durations.forEach((d, j) => {
      const f = freq.factor ? freq.factor(d) : 1;
      const x = depth[d].filter(Number.isFinite).map((v) => v * f);
      const choice = freq.perDuration?.[d] ?? { dist: freq.dist, method: freq.method };
      const fit = fitDistribution(choice.dist, x, choice.method, { k: choice.k ?? freq.fixedK });
      if (!fit.ok) { failures++; return; }
      Ts.forEach((T, k) => reps[j][k].push(quantileT(fit, T)));
    });
    if (opt.idf) {
      try {
        let m;
        if (opt.idf.kind === 'kmodel') {
          m = fitKModel(opt.idf.key, bAms, { ...opt.idf.opt, factor: freq.factor });
          idfParams.push(m.params);
        } else {
          // refit the empirical form to the replicate's quantile table, starting from the point estimate
          const table = { returnPeriods: Ts, rows: ams.durations.map((d, j) => ({ d, intensity: Ts.map((T, k) => reps[j][k].at(-1) / (d / 60)) })) };
          m = fitForm(opt.idf.key, table, { ...opt.idf.opt, nStarts: 4 });
          idfParams.push(m.unified ? m.unified.params : Object.fromEntries(Object.entries(m.perT).map(([T, v]) => [T, v.params])));
        }
      } catch { failures++; }
    }
    if (opt.onProgress && (b % 10 === 0 || b === nBoot - 1)) opt.onProgress({ done: b + 1, of: nBoot });
  }
  const lo = (1 - level) / 2; const hi = 1 - lo;
  const table = ams.durations.map((d, j) => ({
    d,
    lower: Ts.map((_, k) => empQuantile(reps[j][k], lo)),
    upper: Ts.map((_, k) => empQuantile(reps[j][k], hi)),
    se: Ts.map((_, k) => sdOf(reps[j][k])),
    nValid: Ts.map((_, k) => reps[j][k].length),
  }));
  let paramCI = null;
  if (idfParams.length && Array.isArray(idfParams[0])) {
    const np = idfParams[0].length;
    paramCI = Array.from({ length: np }, (_, q) => {
      const v = idfParams.map((p) => p[q]).filter(Number.isFinite);
      return { lower: empQuantile(v, lo), upper: empQuantile(v, hi), se: sdOf(v) };
    });
    paramCI.correlation = corrMatrix(idfParams);
  }
  return { level, nBoot, returnPeriods: Ts, table, failures, paramCI, idfParams, method: 'non-parametric bootstrap (joint resampling of years), percentile intervals' };
}

function sdOf(v) {
  const n = v.length; if (n < 2) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / n;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
}

function corrMatrix(rows) {
  const np = rows[0].length;
  const m = Array.from({ length: np }, (_, i) => rows.reduce((a, r) => a + r[i], 0) / rows.length);
  const c = Array.from({ length: np }, () => new Array(np).fill(0));
  for (let i = 0; i < np; i++) for (let j = 0; j < np; j++) {
    let sxy = 0; let sxx = 0; let syy = 0;
    for (const r of rows) { sxy += (r[i] - m[i]) * (r[j] - m[j]); sxx += (r[i] - m[i]) ** 2; syy += (r[j] - m[j]) ** 2; }
    c[i][j] = sxy / Math.sqrt(sxx * syy);
  }
  return c;
}

/**
 * Parametric-bootstrap p-value of a goodness-of-fit statistic (default Anderson-Darling).
 * Simulate samples of the same size from the fitted model, refit with the SAME method,
 * recompute the statistic; p = share of simulated statistics >= observed.
 */
export function parametricBootstrapGof(fit, x, opt = {}) {
  const nSim = opt.nSim ?? 500;
  const stat = opt.stat ?? 'ad';
  const rng = new Rng(opt.seed ?? 77);
  const d = DISTRIBUTIONS[fit.dist];
  const obs = goodnessOfFit(fit, x)[stat];
  let ge = 0; let done = 0;
  for (let s = 0; s < nSim; s++) {
    if (opt.shouldCancel && opt.shouldCancel()) break;
    const sim = Array.from({ length: x.length }, () => d.ppf(rng.uniformOpen(), fit.params));
    const f2 = fitDistribution(fit.dist, sim, fit.method, { k: fit.fixedK });
    if (!f2.ok) continue;
    done++;
    if (goodnessOfFit(f2, sim)[stat] >= obs) ge++;
    if (opt.onProgress && s % 20 === 0) opt.onProgress({ done: s + 1, of: nSim });
  }
  return { statistic: stat, observed: obs, p: (ge + 1) / (done + 1), nSim: done };
}

/**
 * Delta-method CI for quantiles of an ML fit: Var(x_T) ~ g' H^-1 g with H the numerical Hessian of
 * the negative log-likelihood and g the numerical gradient of x_T w.r.t. the parameters.
 * Normal approximation; poor for small samples and for the GEV shape — prefer the bootstrap.
 */
export function deltaMethod(fit, x, Ts, level = 0.9) {
  const d = DISTRIBUTIONS[fit.dist];
  const p0 = fit.params;
  const k = p0.length;
  const nll = (p) => { let s = 0; for (const v of x) { const f = d.pdf(v, p); if (!(f > 0)) return Infinity; s -= Math.log(f); } return s; };
  const h = p0.map((v) => 1e-4 * Math.max(Math.abs(v), 0.01));
  const H = Array.from({ length: k }, () => new Array(k).fill(0));
  const f0 = nll(p0);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const pp = p0.slice(); pp[i] += h[i]; pp[j] += h[j];
      const pm = p0.slice(); pm[i] += h[i]; pm[j] -= h[j];
      const mp = p0.slice(); mp[i] -= h[i]; mp[j] += h[j];
      const mm = p0.slice(); mm[i] -= h[i]; mm[j] -= h[j];
      H[i][j] = H[j][i] = i === j
        ? (nll(Object.assign(p0.slice(), { [i]: p0[i] + h[i] })) - 2 * f0 + nll(Object.assign(p0.slice(), { [i]: p0[i] - h[i] }))) / (h[i] * h[i])
        : (nll(pp) - nll(pm) - nll(mp) + nll(mm)) / (4 * h[i] * h[j]);
    }
  }
  const cov = invert(H);
  if (!cov) return null;
  const z = normalPpf(1 - (1 - level) / 2);
  return Ts.map((T) => {
    const q0 = d.ppf(1 - 1 / T, p0);
    const g = p0.map((_, i) => {
      const a = p0.slice(); a[i] += h[i];
      const b = p0.slice(); b[i] -= h[i];
      return (d.ppf(1 - 1 / T, a) - d.ppf(1 - 1 / T, b)) / (2 * h[i]);
    });
    let v = 0;
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) v += g[i] * cov[i][j] * g[j];
    const se = Math.sqrt(Math.max(v, 0));
    return { T, quantile: q0, se, lower: q0 - z * se, upper: q0 + z * se };
  });
}

/** Gauss-Jordan inverse of a small symmetric matrix; null if singular. */
export function invert(A) {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-300) return null;
    [M[c], M[p]] = [M[p], M[c]];
    const piv = M[c][c];
    for (let j = 0; j < 2 * n; j++) M[c][j] /= piv;
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
  }
  return M.map((r) => r.slice(n));
}

/** Intensity confidence band for a fitted IDF model from bootstrap parameter sets (unified models only). */
export function idfBandFromParams(model, paramSets, Ts, ds, level = 0.9) {
  const lo = (1 - level) / 2; const hi = 1 - lo;
  return Ts.map((T) => ({
    T,
    lower: ds.map((d) => empQuantile(paramSets.map((p) => predict({ ...model, params: p, unified: model.unified ? { params: p } : undefined }, d, T)).filter(Number.isFinite), lo)),
    upper: ds.map((d) => empQuantile(paramSets.map((p) => predict({ ...model, params: p, unified: model.unified ? { params: p } : undefined }, d, T)).filter(Number.isFinite), hi)),
  }));
}
