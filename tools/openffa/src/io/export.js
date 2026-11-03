// export.js - tables (CSV/XLSX) and the methods-and-results report (self-contained HTML).
import { DISTRIBUTIONS } from '../core/distributions.js';
import { PLOTTING_POSITIONS } from '../core/plotpos.js';
import { CI_METHODS } from '../core/uncertainty.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, sig = 5) => (v === null || v === undefined || !Number.isFinite(v) ? '' : Number(v.toPrecision(sig)));
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toCSV = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export function quantileRows(res) {
  const out = [['distribution', 'method', 'return_period_yr', 'aep', 'quantile', 'ci_lower', 'ci_upper', 'ci_level', 'ci_method', 'se']];
  for (const f of res.fits) if (f.ok) for (const q of f.quantiles) out.push([f.distId, f.method, q.T, num(1 / q.T, 6), num(q.q), num(q.lo), num(q.hi), f.ci?.level ?? '', f.ci?.method ?? '', num(q.se, 4)]);
  return out;
}
export function fitRows(res) {
  const out = [['rank', 'distribution', 'method', 'ok', 'parameters', 'loglik', 'aic', 'aicc', 'bic', 'ks', 'ad', 'cvm', 'ppcc', 'p_ks_boot', 'p_ad_boot', 'p_cvm_boot', 'warnings_or_reason']];
  res.fits.forEach((f, i) => {
    const r = res.ranking.order.indexOf(i);
    out.push([r >= 0 ? r + 1 : '', f.distId, f.method, f.ok, f.ok ? f.params.map((v, k) => `${f.paramNames[k]}=${num(v, 7)}`).join('; ') : '',
      num(f.loglik, 7), num(f.aic, 7), num(f.aicc, 7), num(f.bic, 7), num(f.gof?.stats.ks, 5), num(f.gof?.stats.ad, 5), num(f.gof?.stats.cvm, 5), num(f.gof?.stats.ppcc, 5),
      num(f.gof?.p?.ks, 3), num(f.gof?.p?.ad, 3), num(f.gof?.p?.cvm, 3), f.ok ? (f.warnings ?? []).join(' | ') : f.reason]);
  });
  return out;
}
export function dataRows(state) {
  const s = state.data.series, out = [['year', `value_${state.data.units || 'units'}`]];
  s.values.forEach((v, i) => out.push([s.years ? s.years[i] : i + 1, v]));
  return out;
}
export function diagnosticRows(res) {
  const out = [['level', 'finding']];
  for (const f of res.diagnostics.findings) out.push([f.level, f.text]);
  out.push(['recommendation', res.diagnostics.recommendation]);
  return out;
}

export function workbook(state) {
  const XLSX = globalThis.XLSX, res = state.results, wb = XLSX.utils.book_new();
  const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  add('Data', dataRows(state)); add('Fits', fitRows(res)); add('Quantiles', quantileRows(res)); add('Diagnostics', diagnosticRows(res));
  add('Settings', Object.entries(res.settings).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v]).concat([['software', `${res.software.name} ${res.software.version}`], ['created', res.created]]));
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

// ------------------------------------------------------------------ report
export const REFERENCES = {
  b17c: 'England, J.F., Jr., Cohn, T.A., Faber, B.A., Stedinger, J.R., Thomas, W.O., Jr., Veilleux, A.G., Kiang, J.E., Mason, R.R., Jr. (2018, v1.1 2019). Guidelines for determining flood flow frequency—Bulletin 17C. U.S. Geological Survey Techniques and Methods 4-B5. https://doi.org/10.3133/tm4B5',
  hosking1990: 'Hosking, J.R.M. (1990). L-moments: analysis and estimation of distributions using linear combinations of order statistics. Journal of the Royal Statistical Society B, 52(1), 105–124.',
  hw1997: 'Hosking, J.R.M., Wallis, J.R. (1997). Regional Frequency Analysis: An Approach Based on L-Moments. Cambridge University Press.',
  hww1985: 'Hosking, J.R.M., Wallis, J.R., Wood, E.F. (1985). Estimation of the generalized extreme-value distribution by the method of probability-weighted moments. Technometrics, 27(3), 251–261.',
  coles2001: 'Coles, S. (2001). An Introduction to Statistical Modeling of Extreme Values. Springer, London.',
  cohn1997: 'Cohn, T.A., Lane, W.L., Baier, W.G. (1997). An algorithm for computing moments-based flood quantile estimates when historical flood information is available. Water Resources Research, 33(9), 2089–2096.',
  cohn2013: 'Cohn, T.A., England, J.F., Berenbrock, C.E., Mason, R.R., Stedinger, J.R., Lamontagne, J.R. (2013). A generalized Grubbs-Beck test statistic for detecting multiple potentially influential low outliers in flood series. Water Resources Research, 49(8), 5047–5058.',
  b17b: 'Interagency Advisory Committee on Water Data (1982). Guidelines for Determining Flood Flow Frequency, Bulletin 17B. U.S. Geological Survey, Reston, VA.',
  stedinger1993: 'Stedinger, J.R., Vogel, R.M., Foufoula-Georgiou, E. (1993). Frequency analysis of extreme events. In: Maidment, D.R. (ed.), Handbook of Hydrology, ch. 18. McGraw-Hill.',
  mk: 'Mann, H.B. (1945). Nonparametric tests against trend. Econometrica, 13, 245–259; Kendall, M.G. (1975). Rank Correlation Methods. Griffin, London.',
  hamedrao: 'Hamed, K.H., Rao, A.R. (1998). A modified Mann-Kendall trend test for autocorrelated data. Journal of Hydrology, 204, 182–196.',
  sen: 'Sen, P.K. (1968). Estimates of the regression coefficient based on Kendall\'s tau. Journal of the American Statistical Association, 63, 1379–1389.',
  pettitt: 'Pettitt, A.N. (1979). A non-parametric approach to the change-point problem. Applied Statistics, 28(2), 126–135.',
  ww: 'Wald, A., Wolfowitz, J. (1943). An exact test for randomness in the non-parametric case based on serial correlation. Annals of Mathematical Statistics, 14, 378–388.',
  lilliefors: 'Lilliefors, H.W. (1967). On the Kolmogorov-Smirnov test for normality with mean and variance unknown. Journal of the American Statistical Association, 62, 399–402.',
  efron: 'Efron, B., Tibshirani, R.J. (1993). An Introduction to the Bootstrap. Chapman & Hall, New York.',
  akaike: 'Akaike, H. (1974). A new look at the statistical model identification. IEEE Transactions on Automatic Control, 19(6), 716–723; Hurvich, C.M., Tsai, C.-L. (1989). Regression and time series model selection in small samples. Biometrika, 76(2), 297–307.',
  cunnane: 'Cunnane, C. (1978). Unbiased plotting positions—a review. Journal of Hydrology, 37, 205–222.',
  griffis: 'Griffis, V.W., Stedinger, J.R., Cohn, T.A. (2004). Log Pearson type 3 quantile estimators with regional skew information and low outlier adjustments. Water Resources Research, 40, W07503.',
};

export function methodsText(state) {
  const res = state.results, S = res.settings, d = state.data, n = res.input.n;
  const cites = new Set(['hosking1990', 'hw1997', 'stedinger1993']);
  const P = [];
  const s = d.series;
  P.push(`<p>The analysis used ${n} annual maximum ${d.units ? `values (${esc(d.units)})` : 'values'}${s.years ? ` for the water years ${Math.min(...s.years)}–${Math.max(...s.years)}` : ''}${d.site ? ` at ${esc(d.site)}` : ''}.${d.map?.kind === 'daily' ? ` The annual maxima were extracted from a daily record using a water year starting in month ${d.waterYearStart}; years with less than ${Math.round(d.minCompleteness * 100)} % of days recorded were excluded unless included manually.` : ''}</p>`);
  cites.add('mk'); cites.add('hamedrao'); cites.add('sen'); cites.add('pettitt'); cites.add('ww'); cites.add('cohn2013'); cites.add('b17b');
  P.push(`<p>Before fitting, the series was checked for monotonic trend (Mann-Kendall test with the Hamed-Rao correction for autocorrelation and the Theil-Sen slope), for a change point (Pettitt test), for serial dependence (lag-1 autocorrelation and the Wald-Wolfowitz test), for homogeneity between the two halves of the record (Mann-Whitney test) and for low outliers (Multiple Grubbs-Beck test of Bulletin 17C, Cohn et al. 2013; single Grubbs-Beck test of Bulletin 17B for high outliers). ${esc(res.diagnostics.recommendation)}</p>`);
  const methods = [...new Set(res.fits.map((f) => f.methodLabel))];
  P.push(`<p>The following distribution and estimation-method combinations were fitted: ${res.fits.map((f) => `${f.distId} (${esc(f.methodLabel)})`).join('; ')}. Parameter conventions follow Hosking &amp; Wallis (1997). L-moment estimates use the unbiased probability-weighted moments and exact inversion of the theoretical L-moment ratios. Maximum-likelihood estimates were obtained numerically; for Pearson type III the likelihood was restricted to |skew| ≤ 2, where it is regular.</p>`);
  if (methods.some((m) => /EMA/.test(m))) { cites.add('b17c'); cites.add('cohn1997'); P.push('<p>The log-Pearson type III distribution was also fitted with the Expected Moments Algorithm (EMA) of Bulletin 17C (Cohn et al. 1997; England et al. 2018), which represents censored, historic and low-outlier information as flow intervals.</p>'); }
  if (res.p0 > 0) P.push(`<p>Zero annual peaks were treated with the conditional-probability adjustment (p0 = ${res.p0.toFixed(3)}) for the methods that do not model them as censored values.</p>`);
  if (res.pilf) P.push(`<p>${res.pilf.n} annual peaks below ${num(res.pilf.threshold, 5)} (${esc(res.pilf.source)} threshold) were treated as potentially influential low floods and censored in the EMA and censored maximum-likelihood fits.</p>`);
  if (S.historic) P.push(`<p>Historic information: a ${S.historic.years}-year historic period with a perception threshold of ${S.historic.threshold}${S.historic.peaks?.length ? ` and ${S.historic.peaks.length} historic floods (${S.historic.peaks.join(', ')})` : ' and no floods above it'}.</p>`);
  if (S.regionalSkew) { cites.add('griffis'); P.push(`<p>A regional skew of ${S.regionalSkew.value} (MSE ${S.regionalSkew.mse}) was combined with the station skew by inverse-MSE weighting (method of moments) and through the equivalent record length of Bulletin 17C eq. 7-10 (EMA); the station-skew MSE was computed with the Bulletin 17B formula.</p>`); }
  cites.add('lilliefors'); cites.add('efron'); cites.add('akaike'); cites.add('cunnane');
  P.push(`<p>Goodness of fit was assessed with the Kolmogorov-Smirnov, Anderson-Darling and Cramér-von Mises statistics and the probability-plot correlation coefficient. Because the parameters are estimated from the same data, p-values were obtained by parametric bootstrap (${S.gofBoot} replicates, re-fitting each replicate with the same method) rather than from tables that assume known parameters (Lilliefors 1967). Fits were ranked by ${esc(res.ranking.label)}; AIC, AICc and BIC are exact comparisons only between maximum-likelihood fits. Observed values were plotted with the ${esc(PLOTTING_POSITIONS[S.plottingPosition]?.label ?? S.plottingPosition)} plotting position.</p>`);
  if (S.ciMethod !== 'none') { cites.add('coles2001'); P.push(`<p>${Math.round(S.ciLevel * 100)} % confidence intervals for the design floods were computed by ${esc((CI_METHODS[S.ciMethod] ?? S.ciMethod).toLowerCase())}${S.ciMethod.startsWith('boot') ? ` with ${S.nBoot} replicates (seed ${S.seed}); for censored or EMA fits the bootstrap re-simulates the same censoring design` : ''}. The intervals describe sampling uncertainty under each fitted model and do not include the uncertainty of choosing the model.</p>`); }
  P.push(`<p>Calculations were made with ${res.software.name} ${res.software.version}, which runs in the web browser; the numerical routines are validated against R (lmom, extRemes, ismev, MGBT, trend), SciPy and the worked examples of Bulletin 17C (see the validation report distributed with the software). The full settings are listed in the appendix and in the saved project file, so the analysis can be reproduced exactly.</p>`);
  return { html: P.join('\n'), cites: [...cites] };
}

export function reportHTML(state, figs = {}) {
  const res = state.results, d = state.data, sel = res.fits[state.selected];
  const { html: methods, cites } = methodsText(state);
  const units = esc(d.units);
  const t = (head, rows, cls = []) => `<table><thead><tr>${head.map((c, i) => `<th class="${cls[i] || ''}">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td class="${cls[i] || ''}">${c === null || c === undefined ? '' : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const f4 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : String(Number(v.toPrecision(4))));
  const fitTable = t(['Rank', 'Distribution', 'Method', 'Parameters', 'AICc', 'BIC', 'AD A²', 'AD p', 'PPCC'],
    [...res.ranking.order, ...res.fits.map((_, i) => i).filter((i) => !res.ranking.order.includes(i))].map((i, r) => {
      const f = res.fits[i];
      return f.ok ? [r < res.ranking.order.length ? r + 1 : '', f.distName, f.methodLabel, f.params.map((v, k) => `${f.paramNames[k]} = ${Number(v.toPrecision(5))}`).join(', '), f4(f.aicc), f4(f.bic), f4(f.gof?.stats.ad), f.gof?.p ? f.gof.p.ad.toFixed(3) : '–', f4(f.gof?.stats.ppcc)]
        : ['', f.distName, f.methodLabel, `not fitted: ${f.reason}`, '', '', '', '', ''];
    }), ['', 'l', 'l', 'l']);
  const qTable = sel ? t(['Return period (yr)', 'AEP', `Q (${d.units})`, 'Lower', 'Upper'], sel.quantiles.map((q) => [q.T, `${Number((100 / q.T).toPrecision(3))} %`, f4(q.q), f4(q.lo), f4(q.hi)])) : '';
  const ok = res.fits.filter((f) => f.ok);
  const cmpTable = t(['T (yr)', ...ok.map((f) => `${f.distId} ${f.method}`)], res.settings.returnPeriods.map((T, k) => [T, ...ok.map((f) => f4(f.quantiles[k]?.q))]));
  const img = (k, cap) => (figs[k] ? `<figure><img src="${figs[k]}" alt="${esc(cap)}"><figcaption>${esc(cap)}</figcaption></figure>` : '');
  const refs = cites.map((c) => REFERENCES[c]).filter(Boolean).sort().map((r) => `<li>${esc(r)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Flood frequency analysis${d.site ? ` – ${esc(d.site)}` : ''}</title>
<style>body{font-family:'Public Sans',system-ui,sans-serif;color:#13293D;max-width:900px;margin:2rem auto;padding:0 1.5rem;line-height:1.55;font-variant-numeric:tabular-nums}
h1{font-size:1.8rem;margin-bottom:.2rem}h2{font-size:1.25rem;margin-top:2rem;border-bottom:1.5px solid #13293D;padding-bottom:.2rem}
table{border-collapse:collapse;width:100%;font-size:.85rem;margin:.75rem 0}th,td{padding:.3rem .5rem;border-bottom:1px solid #D5DDDC;text-align:right}th{border-bottom:1.5px solid #13293D}td.l,th.l{text-align:left}
figure{margin:1rem 0}img{max-width:100%}figcaption{font-size:.85rem;color:#5B6B78}.meta{color:#5B6B78;font-size:.9rem}.warn{border-left:4px solid #8A5A00;background:#FFF4DA;padding:.4rem .8rem;font-size:.9rem}
@media print{body{margin:0}h2{break-after:avoid}figure,table{break-inside:avoid}}</style></head><body>
<h1>Flood frequency analysis${d.site ? `: ${esc(d.site)}` : ''}</h1>
<p class="meta">${esc(res.software.name)} ${esc(res.software.version)} · ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC · data: ${esc(d.name)}</p>
<h2>Summary</h2>
${sel ? `<p>Selected model: <strong>${esc(sel.distName)}</strong> fitted by ${esc(sel.methodLabel)}. The 100-year (1 % AEP) flood is ${f4(sel.quantiles.find((q) => q.T === 100)?.q)} ${units}${sel.quantiles.find((q) => q.T === 100)?.lo ? ` (${Math.round((sel.ci?.level ?? 0.9) * 100)} % interval ${f4(sel.quantiles.find((q) => q.T === 100).lo)} to ${f4(sel.quantiles.find((q) => q.T === 100).hi)})` : ''}.</p>` : ''}
${res.warnings.map((w) => `<p class="warn">${esc(w)}</p>`).join('')}
<h2>Methods</h2>${methods}
<h2>Data checks</h2>${t(['', 'Finding'], res.diagnostics.findings.map((f) => [f.level === 'ok' ? '✓' : f.level === 'warn' ? '!' : '✕', f.text]), ['', 'l'])}
${img('series', 'Annual maximum series with Theil-Sen trend line.')}
<h2>Fitted distributions</h2>${fitTable}
<p class="meta">${esc(res.ranking.caveat)}</p>
${img('lmrd', 'L-moment ratio diagram with the sample L-skewness and L-kurtosis.')}
<h2>Design floods</h2>${qTable}
${img('freq', 'Frequency curve of the selected model with confidence interval, other fits and the observed values.')}
<h3>All fitted models</h3>${cmpTable}
<p class="meta">The spread between models at long return periods is model uncertainty and is not included in the confidence intervals. Return periods beyond about twice the record length (${2 * res.input.n} years) are extrapolations.</p>
${img('qq', 'Q-Q plot of the selected model.')}
<h2>References</h2><ol>${refs}</ol>
<h2>Appendix: settings for reproduction</h2><pre style="font-size:.75rem;white-space:pre-wrap">${esc(JSON.stringify(res.settings, null, 1))}</pre>
</body></html>`;
}
