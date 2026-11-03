/**
 * idf.js — IDF relationships: quantile tables, empirical formulas, unified (distribution-consistent)
 * models after Koutsoyiannis, Kozonis & Manetas (1998, J. Hydrol. 206:118-135), fitting and diagnostics.
 *
 * Units: intensity i in mm/h; duration t in the unit chosen by the user ('min' or 'h'); the unit is stored
 * with every fitted model because parameter values depend on it.
 *
 * Two families of models:
 *  1. Empirical forms fitted to a QUANTILE TABLE i(d_j, T_k) obtained from per-duration frequency fits
 *     ("typical procedure", Koutsoyiannis et al. 1998 sec. 3.1). Either per return period (one parameter
 *     set per T) or unified in T with a(T) = K T^m or c + lambda ln T.
 *  2. Distribution-consistent unified models i = a(T)/(t + theta)^eta where a(T) is the quantile of the
 *     distribution of Y = I(d) (d + theta)^eta (Koutsoyiannis et al. 1998 eqs 12-22), fitted DIRECTLY to
 *     the annual maxima of all durations by
 *       'robust'  : Kruskal-Wallis minimisation for (theta, eta), then L-moments on the pooled sample (sec. 3.2)
 *       'onestep' : one-step least squares on log intensities with Gringorten plotting positions (sec. 3.3)
 *       'mle'     : maximum likelihood of the duration-dependent GEV (as in the R package IDF, Ulrich et al.
 *                   2020); assumes maxima of different durations are independent, which they are not, so
 *                   its standard errors are too small (stated in the report).
 */
import { DISTRIBUTIONS, fitDistribution, quantileT } from './distributions.js';
import { nelderMead, multiStart, differentialEvolution } from './optim.js';
import { sampleLmoments, mean, plottingPositions } from './stats.js';

export const DEFAULT_DURATIONS = [5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880];
export const DEFAULT_RETURN_PERIODS = [2, 5, 10, 25, 50, 100];

/** Convert minutes to the formula's time unit. */
export const tUnit = (dMin, unit) => (unit === 'h' ? dMin / 60 : dMin);

/** Gumbel reduced variate. */
const gumbelY = (T) => -Math.log(-Math.log(1 - 1 / T));

// ===========================================================================
// Quantile table from per-duration fits
// ===========================================================================

/**
 * Fit the chosen distribution per duration and tabulate intensities.
 * @param {{durations:number[], depth:Object<number, number[]>}} ams depth AMS (mm), NaN = missing
 * @param {{dist:string, method:string, perDuration?:Object<number,{dist:string,method:string}>,
 *          returnPeriods:number[], factor?:(d:number)=>number}} opt  factor: multiplier on depths (e.g. fixed-interval correction)
 */
export function quantileTable(ams, opt) {
  const T = opt.returnPeriods ?? DEFAULT_RETURN_PERIODS;
  const rows = [];
  for (const d of ams.durations) {
    const f = opt.factor ? opt.factor(d) : 1;
    const x = ams.depth[d].filter(Number.isFinite).map((v) => v * f);
    const choice = opt.perDuration?.[d] ?? { dist: opt.dist, method: opt.method };
    const fit = fitDistribution(choice.dist, x, choice.method, { k: choice.k ?? opt.fixedK });
    const depth = fit.ok ? T.map((t) => quantileT(fit, t)) : T.map(() => NaN);
    rows.push({ d, n: x.length, fit, depth, intensity: depth.map((v) => v / (d / 60)), factor: f });
  }
  return { returnPeriods: T, rows };
}

// ===========================================================================
// Empirical formula definitions
// ===========================================================================

/**
 * Each form: params, bounds builder, eval(t, p[, T]). `perT` forms are fitted to one return period at a time.
 * `unified` forms include T. Bounds are generous but keep the curves physically sensible:
 *  b, theta >= 0 ; 0 < n, eta < 1.5 (n < 1 needed for depth increasing with duration; flagged if violated).
 */
export const FORMS = {
  talbot: {
    label: 'Talbot', kind: 'perT', expr: 'i = a / (t + b)', params: ['a', 'b'],
    f: (t, [a, b]) => a / (t + b),
    bounds: (s) => [[1e-6, 1e7], [0, 10 * s.tmax]],
  },
  bernard: {
    label: 'Bernard (Montana)', kind: 'perT', expr: 'i = a / t^n', params: ['a', 'n'],
    f: (t, [a, n]) => a / Math.pow(t, n),
    bounds: () => [[1e-6, 1e7], [0.01, 1.5]],
  },
  sherman: {
    label: 'Sherman', kind: 'perT', expr: 'i = a / (t + b)^n', params: ['a', 'b', 'n'],
    f: (t, [a, b, n]) => a / Math.pow(t + b, n),
    bounds: (s) => [[1e-6, 1e8], [0, 5 * s.tmax], [0.01, 1.5]],
  },
  kimijima: {
    label: 'Kimijima', kind: 'perT', expr: 'i = a / (t^n + b)', params: ['a', 'b', 'n'],
    f: (t, [a, b, n]) => a / (Math.pow(t, n) + b),
    bounds: (s) => [[1e-6, 1e8], [0, 10 * Math.pow(s.tmax, 1.5)], [0.01, 1.5]],
  },
  general: {
    label: 'General 4-parameter', kind: 'perT', expr: 'i = a / (t^m + b)^n', params: ['a', 'b', 'm', 'n'],
    note: 'Over-parameterised: Koutsoyiannis et al. (1998) show (t^m+b)^n is approximated by (t+b\')^n\' within ~2%. Expect weak identifiability.',
    f: (t, [a, b, m, n]) => a / Math.pow(Math.pow(t, m) + b, n),
    bounds: (s) => [[1e-6, 1e8], [0, 5 * s.tmax], [0.1, 1.5], [0.01, 1.5]],
  },
  shermanT: {
    label: 'Sherman with power-law T (unified)', kind: 'unified', expr: 'i = K T^m / (t + b)^n', params: ['K', 'm', 'b', 'n'],
    note: 'Widely used, but Koutsoyiannis et al. (1998) show a(T) = K T^m is inconsistent with a Gumbel/GEV parent and departs from it at large T.',
    f: (t, [K, m, b, n], T) => K * Math.pow(T, m) / Math.pow(t + b, n),
    bounds: (s) => [[1e-6, 1e8], [0.01, 1], [0, 5 * s.tmax], [0.01, 1.5]],
  },
  bernardT: {
    label: 'Bernard with power-law T (unified)', kind: 'unified', expr: 'i = K T^m / t^n', params: ['K', 'm', 'n'],
    f: (t, [K, m, n], T) => K * Math.pow(T, m) / Math.pow(t, n),
    bounds: () => [[1e-6, 1e8], [0.01, 1], [0.01, 1.5]],
  },
  logT: {
    label: 'Logarithmic in T (unified)', kind: 'unified', expr: 'i = (c + lambda ln T) / (t + theta)^eta', params: ['c', 'lambda', 'theta', 'eta'],
    f: (t, [c, l, th, e], T) => (c + l * Math.log(T)) / Math.pow(t + th, e),
    bounds: (s) => [[-1e7, 1e7], [1e-6, 1e7], [0, 5 * s.tmax], [0.01, 1.5]],
  },
};

/** Distribution-consistent models (Koutsoyiannis et al. 1998). */
export const KMODELS = {
  kgumbel: {
    label: 'Koutsoyiannis general IDF, Gumbel', dist: 'gumbel',
    expr: 'i = lambda [psi - ln(-ln(1 - 1/T))] / (t + theta)^eta', params: ['lambda', 'psi', 'theta', 'eta'],
  },
  kgev: {
    label: 'Koutsoyiannis general IDF, GEV', dist: 'gev',
    expr: 'i = Q_GEV(1 - 1/T; xi, alpha, k) / (t + theta)^eta', params: ['xi', 'alpha', 'k', 'theta', 'eta'],
  },
};

/** Evaluate a distribution-consistent model. p = [...distParams, theta, eta] where distParams are of Y. */
export function kEval(model, t, T, p) {
  const nd = model === 'kgumbel' ? 2 : 3;
  const th = p[nd]; const eta = p[nd + 1];
  const b = Math.pow(t + th, eta);
  if (model === 'kgumbel') {
    // stored as Gumbel location/scale of Y: a(T) = xi + alpha*y_T  (== lambda (psi + y_T) with lambda=alpha, psi=xi/alpha)
    return (p[0] + p[1] * gumbelY(T)) / b;
  }
  return DISTRIBUTIONS.gev.ppf(1 - 1 / T, [p[0], p[1], p[2]]) / b;
}

/** Koutsoyiannis (lambda, psi) presentation of Gumbel-model parameters. */
export function kGumbelLambdaPsi(p) { return { lambda: p[1], psi: p[0] / p[1] }; }

// ===========================================================================
// Fitting empirical forms to a quantile table
// ===========================================================================

function residualFn(space) {
  return space === 'log'
    ? (obs, sim) => (sim > 0 ? Math.log(obs) - Math.log(sim) : Infinity)
    : (obs, sim) => obs - sim;
}

/**
 * Fit an empirical form.
 * @param {string} formKey
 * @param {{rows:{d:number, intensity:number[]}[], returnPeriods:number[]}} table
 * @param {{unit?:'min'|'h', space?:'log'|'linear', returnPeriods?:number[], nStarts?:number, seed?:number,
 *          shouldCancel?:()=>boolean}} opt
 */
export function fitForm(formKey, table, opt = {}) {
  const form = FORMS[formKey];
  const unit = opt.unit ?? 'h';
  const space = opt.space ?? 'log';
  const res = residualFn(space);
  const Ts = opt.returnPeriods ?? table.returnPeriods;
  const pts = [];
  for (const row of table.rows) {
    table.returnPeriods.forEach((T, k) => {
      if (Ts.includes(T) && Number.isFinite(row.intensity[k]) && row.intensity[k] > 0) pts.push({ t: tUnit(row.d, unit), T, i: row.intensity[k] });
    });
  }
  const tmax = Math.max(...pts.map((p) => p.t));
  const bounds = form.bounds({ tmax });
  const fitOne = (sub) => {
    const sse = (p) => {
      let s = 0;
      for (const q of sub) {
        const r = res(q.i, form.f(q.t, p, q.T));
        if (!Number.isFinite(r)) return 1e30;
        s += r * r;
      }
      return s;
    };
    const ms = multiStart(sse, bounds, { nStarts: opt.nStarts ?? 24, seed: opt.seed ?? 7, shouldCancel: opt.shouldCancel, x0: opt.x0 ? [opt.x0] : undefined });
    // identifiability: distinct optima with SSE within 1% of the best
    const best = ms.best;
    const near = ms.all.filter((r) => r.fx <= best.fx * 1.01 + 1e-12);
    const spread = form.params.map((_, j) => {
      const v = near.map((r) => r.x[j]);
      const scale = Math.max(Math.abs(best.x[j]), 1e-9);
      return (Math.max(...v) - Math.min(...v)) / scale;
    });
    const atBound = best.x.map((v, j) => Math.abs(v - bounds[j][0]) < 1e-6 * Math.max(1, Math.abs(bounds[j][0])) || Math.abs(v - bounds[j][1]) < 1e-6 * Math.max(1, Math.abs(bounds[j][1])));
    return { params: best.x, sse: best.fx, n: sub.length, converged: best.converged, spread, atBound, weak: spread.some((s) => s > 0.1) };
  };
  if (form.kind === 'perT') {
    const perT = {};
    for (const T of Ts) perT[T] = fitOne(pts.filter((p) => p.T === T));
    const model = { type: 'form', form: formKey, unit, space, perT, returnPeriods: Ts };
    model.predict = (dMin, T) => predict(model, dMin, T);
    return model;
  }
  const one = fitOne(pts);
  const model = { type: 'form', form: formKey, unit, space, unified: one, returnPeriods: Ts };
  model.predict = (dMin, T) => predict(model, dMin, T);
  return model;
}

/**
 * Predict intensity (mm/h) at duration dMin (minutes) and return period T from any fitted model.
 * For per-T forms, T must be one of the fitted return periods.
 */
export function predict(model, dMin, T) {
  const t = tUnit(dMin, model.unit);
  if (model.type === 'form') {
    const form = FORMS[model.form];
    if (form.kind === 'perT') {
      const pT = model.perT[T];
      return pT ? form.f(t, pT.params) : NaN;
    }
    return form.f(t, model.unified.params, T);
  }
  if (model.type === 'kmodel') return kEval(model.model, t, T, model.params);
  return NaN;
}

// ===========================================================================
// Distribution-consistent (Koutsoyiannis) models fitted to the annual maxima
// ===========================================================================

/** Collect raw AMS intensities by duration. */
function amsIntensities(ams, unit, factor) {
  return ams.durations.map((d) => ({
    d, t: tUnit(d, unit),
    i: ams.depth[d].filter(Number.isFinite).map((v) => (v * (factor ? factor(d) : 1)) / (d / 60)),
  })).filter((g) => g.i.length > 0);
}

/** Kruskal-Wallis statistic of groups y_j = i_j (t_j + theta)^eta, using the top `fraction` of each group. */
export function kruskalWallis(groups, theta, eta, fraction = 1) {
  const all = [];
  groups.forEach((g, j) => {
    const sorted = [...g.i].sort((a, b) => b - a);
    const m = Math.max(1, Math.round(sorted.length * fraction));
    const b = Math.pow(g.t + theta, eta);
    for (let q = 0; q < m; q++) all.push({ y: sorted[q] * b, j });
  });
  const m = all.length;
  all.sort((a, b) => a.y - b.y);
  // average ranks for ties
  const rank = new Float64Array(m);
  for (let a = 0; a < m;) {
    let b = a;
    while (b + 1 < m && all[b + 1].y === all[a].y) b++;
    const r = (a + b) / 2 + 1;
    for (let q = a; q <= b; q++) rank[q] = r;
    a = b + 1;
  }
  const sum = new Float64Array(groups.length); const cnt = new Float64Array(groups.length);
  all.forEach((v, q) => { sum[v.j] += rank[q]; cnt[v.j]++; });
  let h = 0;
  const mid = (m + 1) / 2;
  for (let j = 0; j < groups.length; j++) if (cnt[j]) h += cnt[j] * (sum[j] / cnt[j] - mid) ** 2;
  return (12 / (m * (m + 1))) * h;
}

/**
 * Fit a distribution-consistent model.
 * @param {'kgumbel'|'kgev'} model
 * @param {object} ams depth AMS
 * @param {{method:'robust'|'onestep'|'mle', unit?:'min'|'h', fraction?:number, factor?:Function, seed?:number,
 *          fixTheta?:number|null, shouldCancel?:()=>boolean}} opt
 *   fixTheta: set theta to a constant (e.g. 0 when the shortest duration is >= 1 h, as Koutsoyiannis et al.
 *   did for hourly data: theta is not estimable without sub-hourly data).
 */
export function fitKModel(model, ams, opt = {}) {
  const unit = opt.unit ?? 'h';
  const groups = amsIntensities(ams, unit, opt.factor);
  const dist = KMODELS[model].dist;
  const tmin = Math.min(...groups.map((g) => g.t));
  const thetaMax = 5 * Math.max(tmin, unit === 'h' ? 1 : 60);
  const fixTheta = opt.fixTheta ?? null;
  const method = opt.method ?? 'robust';
  const pooledFit = (th, eta) => {
    const y = [];
    for (const g of groups) { const b = Math.pow(g.t + th, eta); for (const v of g.i) y.push(v * b); }
    const f = fitDistribution(dist, y, dist === 'gev' ? 'lmom' : 'lmom');
    return { f, y };
  };
  let theta; let eta; let distParams; let objective; let extra = {};

  if (method === 'robust') {
    const frac = opt.fraction ?? 1;
    const kw = (th, e) => kruskalWallis(groups, th, e, frac);
    // KW is piecewise constant in (theta, eta): coarse grid then two zoomed grids
    let best = { v: Infinity, th: 0, e: 0.7 };
    let thLo = 0; let thHi = fixTheta == null ? thetaMax : 0; let eLo = 0.01; let eHi = 1.2;
    for (let level = 0; level < 4; level++) {
      const nTh = fixTheta == null ? 41 : 1; const nE = 61;
      for (let a = 0; a < nTh; a++) {
        const th = fixTheta == null ? thLo + (thHi - thLo) * a / (nTh - 1) : fixTheta;
        for (let b = 0; b < nE; b++) {
          const e = eLo + (eHi - eLo) * b / (nE - 1);
          const v = kw(th, e);
          if (v < best.v - 1e-12) best = { v, th, e };
        }
      }
      const wTh = (thHi - thLo) / 8; const wE = (eHi - eLo) / 8;
      thLo = Math.max(0, best.th - wTh); thHi = best.th + wTh; eLo = Math.max(0.005, best.e - wE); eHi = Math.min(1.5, best.e + wE);
    }
    theta = best.th; eta = best.e;
    const pf = pooledFit(theta, eta);
    distParams = pf.f.params;
    objective = best.v;
    extra = { kruskalWallis: best.v, fraction: frac, pooledN: pf.y.length };
  } else if (method === 'onestep') {
    // data triplets with Gringorten empirical T (eq. 44), error on ln i (eq. 46-47)
    const trip = groups.map((g) => {
      const s = [...g.i].sort((a, b) => b - a);
      const n = s.length;
      return { t: g.t, pts: s.map((v, l) => ({ i: v, T: (n + 0.12) / (l + 1 - 0.44) })) };
    });
    const nd = dist === 'gumbel' ? 2 : 3;
    const err = (p) => {
      const th = fixTheta ?? p[nd]; const e = p[nd + 1];
      if (th < 0 || e <= 0 || e > 1.5) return Infinity;
      if (dist === 'gumbel' && p[1] <= 0) return Infinity;
      if (dist === 'gev' && (p[1] <= 0 || p[2] <= -0.5 || p[2] >= 0.5)) return Infinity;
      const full = [...p.slice(0, nd), th, e];
      let tot = 0;
      for (const g of trip) {
        let s = 0;
        for (const q of g.pts) {
          const sim = kEval(dist === 'gumbel' ? 'kgumbel' : 'kgev', g.t, q.T, full);
          if (!(sim > 0)) return Infinity;
          s += (Math.log(q.i) - Math.log(sim)) ** 2;
        }
        tot += s / g.pts.length;
      }
      return Math.sqrt(tot / trip.length);
    };
    const start = fitKModel(model, ams, { ...opt, method: 'robust' });
    const s0 = [...start.params.slice(0, nd), start.params[nd], start.params[nd + 1]];
    const de = differentialEvolution(err, boundsAround(s0, nd, dist, thetaMax, fixTheta), { seed: opt.seed ?? 3, maxGen: 200, x0: [s0], shouldCancel: opt.shouldCancel });
    const nm = nelderMead(err, de.x, { maxIter: 4000, tol: 1e-13, restarts: 2 });
    const p = nm.fx <= de.fx ? nm.x : de.x;
    distParams = p.slice(0, nd); theta = fixTheta ?? p[nd]; eta = p[nd + 1];
    objective = Math.min(nm.fx, de.fx);
    extra = { rmsLogError: objective };
  } else if (method === 'mle') {
    const nd = dist === 'gumbel' ? 2 : 3;
    const D = DISTRIBUTIONS[dist];
    const nll = (p) => {
      const th = fixTheta ?? p[nd]; const e = p[nd + 1];
      if (th < 0 || e <= 0 || e > 1.5) return Infinity;
      const dp = p.slice(0, nd);
      if (!D.valid(dp) || (dist === 'gev' && (dp[2] <= -0.5 || dp[2] >= 0.5))) return Infinity;
      let ll = 0;
      for (const g of groups) {
        const b = Math.pow(g.t + th, e);
        for (const v of g.i) {
          const f = D.pdf(v * b, dp) * b; // density of I(d) = f_Y(i b) b
          if (!(f > 0)) return Infinity;
          ll += Math.log(f);
        }
      }
      return -ll;
    };
    const start = fitKModel(model, ams, { ...opt, method: 'robust' });
    const s0 = [...start.params.slice(0, nd), start.params[nd], start.params[nd + 1]];
    const de = differentialEvolution(nll, boundsAround(s0, nd, dist, thetaMax, fixTheta), { seed: opt.seed ?? 3, maxGen: 200, x0: [s0], shouldCancel: opt.shouldCancel });
    const nm = nelderMead(nll, de.x, { maxIter: 5000, tol: 1e-14, restarts: 3 });
    const p = nm.fx <= de.fx ? nm.x : de.x;
    distParams = p.slice(0, nd); theta = fixTheta ?? p[nd]; eta = p[nd + 1];
    objective = Math.min(nm.fx, de.fx);
    extra = { negLogLik: objective, note: 'Assumes independence of maxima across durations (they are dependent); likelihood-based SEs would be too small.' };
  } else throw new Error(`unknown method ${method}`);

  const params = [...distParams, theta, eta];
  const fitted = { type: 'kmodel', model, method, unit, params, objective, fixTheta, ...extra };
  fitted.predict = (dMin, T) => predict(fitted, dMin, T);
  if (eta >= 1) fitted.warning = 'eta >= 1: depth would decrease with duration at long durations (Koutsoyiannis et al. 1998 require 0 < eta < 1).';
  return fitted;
}

function boundsAround(s0, nd, dist, thetaMax, fixTheta) {
  const b = [];
  b.push([s0[0] - 3 * Math.abs(s0[1]) - 1, s0[0] + 3 * Math.abs(s0[1]) + 1]);
  b.push([s0[1] * 0.2, s0[1] * 5]);
  if (dist === 'gev') b.push([-0.49, 0.49]);
  b.push(fixTheta != null ? [fixTheta, fixTheta] : [0, Math.max(thetaMax, 2 * s0[nd])]);
  b.push([0.01, 1.2]);
  return b;
}

// ===========================================================================
// Diagnostics
// ===========================================================================

/**
 * Goodness-of-fit of any fitted model against a quantile table.
 * R2 = squared Pearson correlation; NSE = 1 - SSE/SST (linear space);
 * KGE (Gupta et al. 2009) = 1 - sqrt((r-1)^2 + (sd_s/sd_o - 1)^2 + (mean_s/mean_o - 1)^2);
 * PBIAS = 100 * sum(sim - obs)/sum(obs); MAPE and max |% error|;
 * AICc computed on log residuals: n ln(SSE_log/n) + 2k + 2k(k+1)/(n-k-1)
 * (comparable across models fitted to the same table; k = total number of fitted parameters).
 */
export function modelMetrics(model, table, Ts) {
  const obs = []; const sim = []; const resid = [];
  for (const row of table.rows) {
    table.returnPeriods.forEach((T, k) => {
      if ((Ts && !Ts.includes(T)) || !Number.isFinite(row.intensity[k])) return;
      const s = predict(model, row.d, T);
      obs.push(row.intensity[k]); sim.push(s);
      resid.push({ d: row.d, T, obs: row.intensity[k], sim: s, pct: 100 * (s - row.intensity[k]) / row.intensity[k] });
    });
  }
  const n = obs.length;
  const mo = mean(obs); const ms = mean(sim);
  let sse = 0; let sst = 0; let sseLog = 0; let cov = 0; let vo = 0; let vs = 0; let sAbsPct = 0; let maxPct = 0; let sumDiff = 0;
  for (let q = 0; q < n; q++) {
    sse += (obs[q] - sim[q]) ** 2; sst += (obs[q] - mo) ** 2;
    sseLog += (Math.log(obs[q]) - Math.log(sim[q])) ** 2;
    cov += (obs[q] - mo) * (sim[q] - ms); vo += (obs[q] - mo) ** 2; vs += (sim[q] - ms) ** 2;
    const pct = Math.abs(sim[q] - obs[q]) / obs[q] * 100;
    sAbsPct += pct; maxPct = Math.max(maxPct, pct); sumDiff += sim[q] - obs[q];
  }
  const r = cov / Math.sqrt(vo * vs);
  const k = countParams(model);
  const aicc = n - k - 1 > 0 ? n * Math.log(sseLog / n) + 2 * k + (2 * k * (k + 1)) / (n - k - 1) : NaN;
  return {
    n, k, r2: r * r, rmse: Math.sqrt(sse / n), nse: 1 - sse / sst,
    kge: 1 - Math.sqrt((r - 1) ** 2 + (Math.sqrt(vs / vo) - 1) ** 2 + (ms / mo - 1) ** 2),
    pbias: 100 * sumDiff / obs.reduce((a, b) => a + b, 0), mape: sAbsPct / n, maxAbsPct: maxPct, aicc, resid,
  };
}

export function countParams(model) {
  if (model.type === 'kmodel') return model.params.length - (model.fixTheta != null ? 1 : 0);
  const form = FORMS[model.form];
  return form.kind === 'perT' ? form.params.length * Object.keys(model.perT).length : form.params.length;
}

/**
 * Physical consistency checks over a duration range:
 *  - depth must not decrease with duration, for every T;
 *  - curves for larger T must lie above smaller T (no crossing).
 */
export function consistencyChecks(model, Ts, dMin = 5, dMax = 2880) {
  const issues = [];
  const ds = [];
  for (let d = dMin; d <= dMax; d *= 1.05) ds.push(d);
  for (const T of Ts) {
    let prev = -Infinity;
    for (const d of ds) {
      const depth = predict(model, d, T) * d / 60;
      if (depth < prev - 1e-9) { issues.push(`Depth decreases with duration for T=${T} yr near ${Math.round(d)} min.`); break; }
      prev = depth;
    }
  }
  const sorted = [...Ts].sort((a, b) => a - b);
  for (let q = 1; q < sorted.length; q++) {
    for (const d of ds) {
      if (predict(model, d, sorted[q]) < predict(model, d, sorted[q - 1]) - 1e-9) {
        issues.push(`Curves cross: T=${sorted[q]} lies below T=${sorted[q - 1]} near ${Math.round(d)} min.`);
        break;
      }
    }
  }
  return issues;
}

/**
 * Compare and rank models on a common quantile table (by AICc of log residuals).
 * Adds an overfitting caution where a more complex model improves RMSE by < 2% over a simpler one.
 */
export function rankModels(models, table, Ts) {
  const rows = models.map((m) => ({ model: m, metrics: modelMetrics(m, table, Ts), issues: consistencyChecks(m, Ts ?? table.returnPeriods, Math.min(...table.rows.map((r) => r.d)), Math.max(...table.rows.map((r) => r.d))) }));
  rows.sort((a, b) => (a.metrics.aicc ?? Infinity) - (b.metrics.aicc ?? Infinity));
  for (const r of rows) {
    const simpler = rows.filter((o) => o.metrics.k < r.metrics.k);
    const bestSimple = simpler.sort((a, b) => a.metrics.rmse - b.metrics.rmse)[0];
    if (bestSimple && r.metrics.rmse > 0.98 * bestSimple.metrics.rmse) {
      r.caution = r.metrics.rmse >= bestSimple.metrics.rmse
        ? `Uses ${r.metrics.k} parameters yet fits worse (RMSE) than a ${bestSimple.metrics.k}-parameter model.`
        : `Uses ${r.metrics.k} parameters but reduces RMSE by < 2% versus a ${bestSimple.metrics.k}-parameter model; likely over-fitting.`;
    }
  }
  return rows;
}

/** Plotting positions of each duration's AMS for empirical-points display. */
export function empiricalPoints(ams, kind = 'gringorten', factor) {
  return ams.durations.map((d) => {
    const x = ams.depth[d].filter(Number.isFinite).map((v) => v * (factor ? factor(d) : 1)).sort((a, b) => a - b);
    const p = plottingPositions(x.length, kind);
    return { d, depth: x, T: Array.from(p, (F) => 1 / (1 - F)), plotting: kind };
  });
}
