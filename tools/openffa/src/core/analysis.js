// analysis.js - one entry point that runs a complete, reproducible analysis.
// Used by the Web Worker (src/worker/worker.js) and by the tests; contains no DOM code.
//
// runAnalysis(input, settings, onProgress) -> results (plain JSON-serialisable object)

import { DISTRIBUTIONS, DIST_ORDER } from './distributions.js';
import { fitDistribution, AVAILABLE_METHODS, METHOD_LABELS } from './fit.js';
import { sampleLmoments } from './lmoments.js';
import { bootstrapGof, allStatistics, chiSquare } from './gof.js';
import { confidenceIntervals } from './uncertainty.js';
import { diagnoseSeries } from './diagnostics.js';
import { censoredMLE, ema, makeIntervals, weightedSkew, bootstrapCensoredQuantiles, intervalLogLik } from './censored.js';
import { mgbt } from './mgbt.js';
import { plottingPositions, thresholdExceedancePositions, PLOTTING_POSITIONS } from './plotpos.js';
import { skew } from './stats.js';

export const SOFTWARE = { name: 'OpenFFA', version: '0.1.0' };

export const DEFAULT_SETTINGS = {
  fits: DIST_ORDER.filter((d) => d !== 'GPA').map((d) => ({ distId: d, method: AVAILABLE_METHODS[d].includes('lmom') ? 'lmom' : 'mle' })),
  returnPeriods: [2, 5, 10, 25, 50, 100, 200, 500, 1000],
  plottingPosition: 'weibull',
  ciMethod: 'boot-param',
  ciLevel: 0.9,
  nBoot: 1000,
  gofBoot: 300,
  seed: 20261026,
  zeroHandling: 'conditional', // 'conditional' (zero-flow adjustment) | 'none'
  censorPILFs: false,          // censor MGBT potentially-influential low floods (Bulletin 17C)
  pilfThreshold: null,         // manual PILF threshold (overrides MGBT)
  historic: null,              // { years, threshold, peaks: [] }
  regionalSkew: null,          // { value, mse } used by LP3 (method of moments / EMA)
  rankBy: 'aicc',
};

const tToF = (T) => 1 - 1 / T;

export function runAnalysis(input, userSettings = {}, onProgress = () => {}) {
  const S = { ...DEFAULT_SETTINGS, ...userSettings };
  const t0 = Date.now();
  const all = input.values.map(Number);
  const years = input.years && input.years.length === all.length ? input.years.map(Number) : null;
  const out = {
    software: SOFTWARE, settings: S, input: { n: all.length, units: input.units ?? '', site: input.site ?? '' },
    warnings: [], fits: [], created: new Date().toISOString(),
  };

  // ---------------------------------------------------------------- zeros
  const pos = all.filter((v) => v > 0);
  const nZero = all.length - pos.length;
  let p0 = 0, sample = all;
  if (nZero > 0 && S.zeroHandling === 'conditional') {
    p0 = nZero / all.length; sample = pos;
    out.warnings.push(`${nZero} zero/negative value(s) handled by the conditional-probability adjustment: distributions are fitted to the ${pos.length} positive values and F(x) = p0 + (1 - p0) G(x), p0 = ${p0.toFixed(3)} (Bulletin 17B/C; Stedinger et al. 1993).`);
  }
  out.p0 = p0;

  // ---------------------------------------------------------------- diagnostics
  onProgress({ stage: 'Data diagnostics', frac: 0 });
  out.diagnostics = diagnoseSeries(all, years);
  out.lmoments = sample.length >= 4 ? sampleLmoments(sample) : null;
  out.lmomentsLog = sample.length >= 4 && sample.every((v) => v > 0) ? sampleLmoments(sample.map(Math.log10)) : null;
  out.skewLog10 = sample.every((v) => v > 0) && sample.length > 3 ? skew(sample.map(Math.log10)) : null;

  // ---------------------------------------------------------------- censoring information
  // Bulletin 17C representation: PILFs (and zeros) become "less than threshold" intervals and the
  // zero-flow adjustment is NOT used for censored-likelihood / EMA fits.
  let lessThan = [];
  let pilf = null;
  if (S.censorPILFs || S.pilfThreshold > 0) {
    let thr = null, source = 'manual';
    if (S.pilfThreshold > 0) thr = Number(S.pilfThreshold);
    else {
      const m = out.diagnostics.tests.mgbt ?? (pos.length > 5 ? mgbt(all) : null);
      source = 'MGBT';
      if (m && m.klow > 0) thr = m.threshold;
    }
    if (thr) {
      const below = all.filter((v) => v < thr);
      lessThan = below.map(() => thr);
      pilf = { threshold: thr, n: below.length, source, nZero };
      out.warnings.push(`${below.length} annual peak(s) below ${thr.toPrecision(5)} (${source}${nZero ? `, including ${nZero} zero(s)` : ''}) are treated as potentially influential low floods and censored ("less than" the threshold), as in Bulletin 17C. Only ML (censored likelihood) and EMA fits use this; other methods use the zero-flow adjustment.`);
    }
  }
  out.pilf = pilf;
  let exact = all.filter((v) => !(pilf && v < pilf.threshold));
  if (exact.some((v) => v <= 0)) { // zeros without a PILF threshold: censor them below the smallest positive value
    const mn = Math.min(...pos);
    lessThan = lessThan.concat(exact.filter((v) => v <= 0).map(() => mn));
    exact = exact.filter((v) => v > 0);
  }
  const hist = S.historic && S.historic.years > 0 && S.historic.threshold > 0 ? S.historic : null;
  if (hist) {
    const nh = hist.peaks?.length ?? 0;
    lessThan = lessThan.concat(new Array(Math.max(0, hist.years - nh)).fill(hist.threshold));
    out.warnings.push(`Historic information: ${hist.years}-year historic period with perception threshold ${hist.threshold}; ${nh} historic flood(s) above it. Only ML (censored likelihood) and EMA fits use it.`);
  }
  const censored = lessThan.length > 0 && (pilf || hist);
  const intervals = lessThan.length ? makeIntervals([...exact, ...(hist?.peaks ?? [])], { lessThan }) : null;
  out.censored = !!censored;
  out.nEffective = censored ? intervals.length : sample.length;

  // ---------------------------------------------------------------- fits
  const Fs = S.returnPeriods.map(tToF);
  const nFits = S.fits.length;
  S.fits.forEach((spec, idx) => {
    const { distId, method } = spec;
    const frac0 = idx / nFits;
    onProgress({ stage: `Fitting ${distId} (${METHOD_LABELS[method] ?? method})`, frac: frac0 });
    const opts = {};
    if (['LP3', 'PE3'].includes(distId) && method === 'mom' && S.regionalSkew && S.regionalSkew.value != null) {
      const base = distId === 'LP3' ? sample.map(Math.log10) : sample;
      const g = skew(base);
      const w = weightedSkew(g, base.length, Number(S.regionalSkew.value), Number(S.regionalSkew.mse));
      opts.skew = w.skew;
      spec.weightedSkew = w;
    }
    let f;
    // EMA always uses the Bulletin 17C interval representation (zeros/PILFs censored);
    // ML uses the censored likelihood only when there is PILF or historic information.
    const cmode = (method === 'ema' && intervals) || (method === 'mle' && censored);
    const emaOpts = S.regionalSkew && S.regionalSkew.value != null && Number(S.regionalSkew.mse) > 0
      ? { regionalSkew: Number(S.regionalSkew.value), regionalSkewMSE: Number(S.regionalSkew.mse) } : {};
    if (cmode) {
      f = method === 'ema' ? ema(intervals, emaOpts) : censoredMLE(distId, intervals, opts);
      if (f.ok) f.method = method === 'ema' ? 'ema' : 'mle-censored';
    } else if (method === 'ema') {
      f = ema(makeIntervals(sample), emaOpts);
    } else {
      f = fitDistribution(distId, sample, method, opts);
      if (censored && f.ok) f.warnings.push('This method cannot use censored/historic information; it was fitted to the systematic values only (with the zero-flow adjustment if there are zeros).');
    }
    const usedMethod = f.method ?? method;
    const fit = { ...f, distId, method: usedMethod, requestedMethod: method, distName: DISTRIBUTIONS[distId].name,
      methodLabel: usedMethod === 'ema' ? 'Expected Moments Algorithm (EMA, Bulletin 17C)' : usedMethod === 'mle-censored' ? 'Maximum likelihood (censored)' : METHOD_LABELS[method] };
    if (spec.weightedSkew) fit.weightedSkew = spec.weightedSkew;
    if (!f.ok) { out.fits.push(fit); return; }
    const d = DISTRIBUTIONS[distId];
    const fitSample = cmode ? exact : sample;
    if (!Number.isFinite(fit.loglik) || fit.method === 'ema') { // EMA is not a likelihood method: evaluate the likelihood at its estimates
      const ll = cmode ? intervalLogLik(d, intervals, f.params) : -sample.reduce((a, v) => a - d.logpdf(v, f.params), 0);
      const nn = cmode ? intervals.length : sample.length, k = d.nPar;
      fit.loglik = ll; fit.aic = 2 * k - 2 * ll; fit.bic = k * Math.log(nn) - 2 * ll; fit.aicc = nn - k - 1 > 0 ? fit.aic + 2 * k * (k + 1) / (nn - k - 1) : Infinity;
    }
    // likelihoods of censored fits use different data (intervals) from the others: do not rank them together
    fit.likelihoodData = cmode ? 'censored' : 'sample';
    const p0f = cmode ? 0 : p0;  // censored fits model the zeros/PILFs directly
    fit.p0 = p0f;

    // goodness of fit (on the values the model was fitted to)
    try {
      const st = allStatistics(fitSample, distId, f.params);
      fit.gof = { stats: st, chi2: chiSquare(fitSample, (F) => d.quantile(F, f.params), d.nPar) };
      if (S.gofBoot > 0 && !cmode) {
        const fitFn = (s) => { const r = fitDistribution(distId, s, method, opts); return r.ok ? r.params : null; };
        const b = bootstrapGof(fitSample, distId, f.params, fitFn, { nBoot: S.gofBoot, seed: S.seed + idx, onProgress: (q) => onProgress({ stage: `GOF bootstrap ${distId}`, frac: frac0 + q * 0.3 / nFits }) });
        fit.gof.p = b.p; fit.gof.nValid = b.nValid;
      }
    } catch (e) { fit.warnings.push('GOF statistics failed: ' + e.message); }

    // quantiles and confidence intervals
    const Fa = Fs.map((F) => (F <= p0f ? null : (F - p0f) / (1 - p0f)));
    const valid = Fa.map((F) => F !== null);
    const FaV = Fa.filter((F) => F !== null);
    let ci = null;
    if (S.ciMethod && S.ciMethod !== 'none') {
      try {
        if (cmode || method === 'ema') {
          if (S.ciMethod.startsWith('boot')) {
            ci = bootstrapCensoredQuantiles(f, {
              ns: all.length, pilfThreshold: pilf?.threshold ?? (nZero ? Math.min(...pos) : null),
              historicYears: hist ? hist.years : 0, historicThreshold: hist?.threshold,
            }, FaV, { nBoot: Math.min(S.nBoot, 500), seed: S.seed + 1000 + idx, level: S.ciLevel, opts: method === 'ema' ? emaOpts : opts,
              onProgress: (q) => onProgress({ stage: `Confidence intervals ${distId} (censored design)`, frac: frac0 + (0.3 + 0.7 * q) / nFits }) });
            ci.note = 'Parametric bootstrap that re-simulates the same censoring/historic design and refits by the same method (not the Bulletin 17C analytical EMA interval).';
          } else ci = { error: 'For censored and EMA fits choose the parametric bootstrap (it re-simulates the censoring design).' };
        } else {
          ci = confidenceIntervals(fitSample, { ...f, distId, method }, FaV, S.ciMethod, {
            level: S.ciLevel, nBoot: S.nBoot, seed: S.seed + 1000 + idx, fitOpts: opts,
            onProgress: (q) => onProgress({ stage: `Confidence intervals ${distId}`, frac: frac0 + (0.3 + 0.7 * q) / nFits }),
          });
        }
      } catch (e) { ci = { error: e.message }; }
    }
    let j = 0;
    fit.quantiles = S.returnPeriods.map((T, i) => {
      if (!valid[i]) return { T, F: Fs[i], q: 0, lo: 0, hi: 0, note: 'Below the zero-flow probability' };
      const q = d.quantile(Fa[i], f.params);
      const iv = ci && ci.intervals ? ci.intervals[j] : null; j++;
      return { T, F: Fs[i], q, lo: iv ? iv.lo : null, hi: iv ? iv.hi : null, se: iv ? iv.se : null };
    });
    fit.ci = ci ? { method: S.ciMethod, level: S.ciLevel, error: ci.error, note: ci.note, failed: ci.failed, nBoot: ci.nBoot } : null;
    if (fit.quantiles.some((q) => q.T > 2 * sample.length)) fit.extrapolation = 2 * sample.length;
    out.fits.push(fit);
  });

  // ---------------------------------------------------------------- empirical points
  if (hist) {
    // Bulletin 17C App. 5 threshold-exceedance plotting positions (single historic threshold)
    const a = PLOTTING_POSITIONS[S.plottingPosition]?.a ?? 0;
    out.empirical = thresholdExceedancePositions(all, hist.peaks ?? [], hist.years, hist.threshold, a)
      .filter((e) => e.x > 0).map((e) => ({ ...e, T: 1 / (1 - e.F) }));
    out.plottingNote = 'Threshold-exceedance plotting positions (Hirsch & Stedinger 1987; Bulletin 17C App. 5).';
  } else {
    const xs = [...sample].sort((a, b) => a - b);
    const pp = plottingPositions(all.length, S.plottingPosition).slice(nZero && S.zeroHandling === 'conditional' ? nZero : 0);
    out.empirical = xs.map((x, i) => ({ x, F: pp[i], T: 1 / (1 - pp[i]) })).filter((e) => e.x > 0 || S.zeroHandling === 'none');
  }

  // ---------------------------------------------------------------- ranking
  out.ranking = rankFits(out.fits, S.rankBy);
  out.elapsedMs = Date.now() - t0;
  onProgress({ stage: 'Done', frac: 1 });
  return out;
}

export const RANK_CRITERIA = {
  aicc: { label: 'AICc (lower is better)', get: (f) => f.aicc, better: 'low' },
  aic: { label: 'AIC (lower is better)', get: (f) => f.aic, better: 'low' },
  bic: { label: 'BIC (lower is better)', get: (f) => f.bic, better: 'low' },
  ad: { label: 'Anderson-Darling A2 (lower is better)', get: (f) => f.gof?.stats.ad, better: 'low' },
  ppcc: { label: 'PPCC (higher is better)', get: (f) => f.gof?.stats.ppcc, better: 'high' },
};

export function rankFits(fits, by = 'aicc') {
  const c = RANK_CRITERIA[by] ?? RANK_CRITERIA.aicc;
  const ic = ['aic', 'aicc', 'bic'].includes(by);
  // information criteria from censored likelihoods are not comparable with uncensored ones
  const majority = fits.filter((f) => f.ok && f.likelihoodData === 'censored').length > fits.filter((f) => f.ok && f.likelihoodData !== 'censored').length ? 'censored' : 'sample';
  const ok = fits.map((f, i) => ({ i, v: f.ok && (!ic || (f.likelihoodData ?? 'sample') === majority) ? c.get(f) : NaN })).filter((e) => Number.isFinite(e.v));
  ok.sort((a, b) => (c.better === 'low' ? a.v - b.v : b.v - a.v));
  return { by, label: c.label, order: ok.map((e) => e.i), values: ok.map((e) => e.v),
    caveat: 'Rankings summarise relative fit to this sample only. No test proves a distribution is correct; with short records several distributions are usually statistically indistinguishable, while their long-return-period quantiles may differ greatly. Information criteria evaluated at non-ML parameters favour ML fits.' };
}
