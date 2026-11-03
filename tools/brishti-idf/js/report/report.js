/**
 * report.js — self-contained, printable HTML methods-and-results report.
 * States every analysis choice, cites the methods actually used, embeds figures as PNG data URLs,
 * and appends the full settings so the analysis can be reproduced.
 */
import { DISTRIBUTIONS, METHOD_LABELS } from '../core/distributions.js';
import { DISAGG_METHODS } from '../core/disaggregation.js';
import { equationText, modelLabel } from '../io/export.js';
import { TOOL_VERSION } from '../pipeline.js';
import { fmtTime } from '../core/timeseries.js';
import { upliftFactor, arfFactor } from '../core/adjustments.js';

export const REFS = {
  kout98: 'Koutsoyiannis, D., Kozonis, D., Manetas, A. (1998). A mathematical framework for studying rainfall intensity-duration-frequency relationships. Journal of Hydrology 206, 118–135. https://doi.org/10.1016/S0022-1694(98)00097-3',
  hosking90: 'Hosking, J.R.M. (1990). L-moments: analysis and estimation of distributions using linear combinations of order statistics. Journal of the Royal Statistical Society B 52, 105–124.',
  hw97: 'Hosking, J.R.M., Wallis, J.R. (1997). Regional Frequency Analysis: An Approach Based on L-Moments. Cambridge University Press.',
  hww85: 'Hosking, J.R.M., Wallis, J.R., Wood, E.F. (1985). Estimation of the generalized extreme-value distribution by the method of probability-weighted moments. Technometrics 27, 251–261.',
  schardong20: 'Schardong, A., Simonovic, S.P., Gaur, A., Sandink, D. (2020). Web-based tool for the development of intensity duration frequency curves under changing climate at gauged and ungauged locations. Water 12, 1243. https://doi.org/10.3390/w12051243',
  papalexiou16: 'Papalexiou, S.M., Dialynas, Y.G., Grimaldi, S. (2016). Hershfield factor revisited: correcting annual maximum precipitation. Journal of Hydrology 542, 884–895. https://doi.org/10.1016/j.jhydrol.2016.09.058',
  chow88: 'Chow, V.T., Maidment, D.R., Mays, L.W. (1988). Applied Hydrology. McGraw-Hill.',
  keifer57: 'Keifer, C.J., Chu, H.H. (1957). Synthetic storm pattern for drainage design. Journal of the Hydraulics Division (ASCE) 83(HY4).',
  huff90: 'Huff, F.A. (1990). Time Distributions of Heavy Rainstorms in Illinois. Illinois State Water Survey Circular 173.',
  tr55: 'USDA-NRCS (1986). Urban Hydrology for Small Watersheds, Technical Release 55; distributions as implemented in HEC-HMS 4.13.',
  yen80: 'Yen, B.C., Chow, V.T. (1980). Design hyetographs for small drainage structures. Journal of the Hydraulics Division (ASCE) 106(HY6), 1055–1076.',
  mk: 'Mann, H.B. (1945). Nonparametric tests against trend. Econometrica 13, 245–259; Kendall, M.G. (1975). Rank Correlation Methods; Sen, P.K. (1968). JASA 63, 1379–1389.',
  kge: 'Gupta, H.V., Kling, H., Yilmaz, K.K., Martinez, G.F. (2009). Decomposition of the mean squared error and NSE performance criteria. Journal of Hydrology 377, 80–91.',
  cc: 'Martinkova, M., Kysely, J. (2020). Overview of observed Clausius-Clapeyron scaling of extreme precipitation in midlatitudes. Atmosphere 11, 786. https://doi.org/10.3390/atmos11080786',
  imd: 'IMD empirical reduction formula P_t = P_24 (t/24)^(1/3), as given e.g. in IJIRT 148410 (2019), eq. 3.1. Comparison for Bangladesh: Saiara, A. et al. (2026). Short-duration rainfall analysis for Bangladesh. Lecture Notes in Civil Engineering 822, 68–79. https://doi.org/10.1007/978-3-032-18708-6_6. Accuracy concerns: Galoie, M. (2021). Water Resources Management 35, doi:10.1007/s11269-021-02930-3.',
  menabde99: 'Menabde, M., Seed, A., Pegram, G. (1999). A simple scaling model for extreme rainfall. Water Resources Research 35(1), 335–339.',
  bell69: 'Bell, F.C. (1969). Generalized rainfall-duration-frequency relationships. Journal of the Hydraulics Division (ASCE) 95(HY1). [coefficients not verified — EXPERIMENTAL]',
  leclerc72: 'Leclerc, G., Schaake, J.C. (1972). Derivation of hydrologic frequency curves. MIT Report 142 [ARF formula as commonly reproduced; not verified — EXPERIMENTAL].',
  ms00: 'Martins, E.S., Stedinger, J.R. (2000). Generalized maximum-likelihood GEV quantile estimators for hydrologic data. Water Resources Research 36(3), 737–744. [prior parameters not verified — EXPERIMENTAL]',
  storn97: 'Storn, R., Price, K. (1997). Differential evolution. Journal of Global Optimization 11, 341–359.',
  ulrich20: 'Ulrich, J., Jurado, O.E., Peter, M., Scheibel, M., Rust, H.W. (2020). Estimating IDF curves consistently over durations with spatial covariates. Water 12, 3119.',
  efron: 'Efron, B., Tibshirani, R.J. (1993). An Introduction to the Bootstrap. Chapman & Hall.',
  b17b: 'Interagency Advisory Committee on Water Data (1982). Guidelines for Determining Flood Flow Frequency, Bulletin 17B. U.S. Geological Survey (Grubbs–Beck test, Appendix 4).',
  madsen97: 'Madsen, H., Rasmussen, P.F., Rosbjerg, D. (1997). Comparison of annual maximum series and partial duration series methods for modeling extreme hydrologic events. Water Resources Research 33(4), 747–757.',
  stedinger93: 'Stedinger, J.R., Vogel, R.M., Foufoula-Georgiou, E. (1993). Frequency analysis of extreme events. In: Maidment, D.R. (ed.), Handbook of Hydrology, ch. 18. McGraw-Hill.',
};

const PLOT_LABEL = { gringorten: 'Gringorten', weibull: 'Weibull', cunnane: 'Cunnane', hazen: 'Hazen', blom: 'Blom' };
const CRIT_LABEL = { aicc: 'AICc', bic: 'BIC', ad: 'Anderson–Darling A²', ppcc: 'probability-plot correlation', ks: 'Kolmogorov–Smirnov D' };
/** Method label including a fixed shape. */
export const methodLabel = (m, k) => (m === 'lmomk' ? `L-moments with the shape fixed at k = ${k}` : METHOD_LABELS[m]);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : '—');
const dl = (d) => (d < 60 ? `${d} min` : d % 1440 === 0 ? `${d / 1440} d` : `${d / 60} h`);

/**
 * @param {{station, res, settings, ci, storm, images:{name:string, url:string, caption:string}[], projectName}} o
 */
export function buildReport(o) {
  const { station, res, settings: S, ci } = o;
  const cited = new Set(['hosking90', 'kout98', 'mk']);
  const cite = (k) => { cited.add(k); return `[${[...cited].indexOf(k) + 1}]`; };
  const out = [];
  const Ts = res.design.returnPeriods;
  out.push(`<h1>IDF analysis — ${esc(station.name)}</h1>`);
  out.push(`<p class="meta">Brishti IDF ${TOOL_VERSION} · generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · project “${esc(o.projectName || 'untitled')}” · random seed ${S.uncertainty.seed}</p>`);

  // ---- data
  let sec = 0; // sections are numbered as they are emitted (some are optional)
  out.push(`<h2>${++sec}. Data</h2>`);
  if (res.kind === 'ams') out.push(`<p>Annual-maximum depths were supplied directly for ${res.ams.durations.length} durations (${res.ams.durations.map(dl).join(', ')}) and ${res.ams.years.length} years (${res.ams.years[0]}–${res.ams.years.at(-1)}). No time-series quality checks were possible.</p>`);
  else {
    const q = res.qc;
    out.push(`<p>Source: ${esc(station.source?.fileName || 'entered data')}. Time step ${res.series.step} min; record from ${fmtTime(res.series.origin)} (${res.series.n.toLocaleString()} intervals; ${(100 * q.nMissing / q.nValues).toFixed(2)}% missing). Years are ${S.yearStartMonth === 1 ? 'calendar years' : `hydrological years starting in month ${S.yearStartMonth}`}; a year is used only if at least ${Math.round(S.minCoverage * 100)}% of its intervals are present${S.includeIncomplete ? ' (overridden: incomplete years kept)' : ''}.</p>`);
    out.push('<p>Quality checks:</p><ul>' + (q.issues.length ? q.issues.map((i) => `<li>${esc(i.text)}</li>`).join('') : '<li>No issues detected.</li>') + '</ul>');
    if (q.changed.length) out.push(`<p>${q.changed.length} value(s) were set to missing by the quality checks (listed in the exported workbook).</p>`);
    if (res.ams.excluded.length) out.push(`<p>Excluded years (coverage below threshold): ${res.ams.excluded.map((e) => `${e.year} (${(100 * e.coverage).toFixed(0)}%)`).join(', ')}.</p>`);
  }

  // ---- AMS
  out.push(`<h2>${++sec}. Annual maximum series</h2>`);
  if (res.kind !== 'ams') out.push(`<p>Annual maxima were extracted with ${S.amsMode === 'sliding' ? 'sliding (rolling) windows at the data resolution' : 'fixed non-overlapping windows'} for durations ${res.ams.durations.map(dl).join(', ')}; windows containing missing data were ${S.maxMissingFraction > 0 ? `accepted up to ${S.maxMissingFraction * 100}% missing (scaled up)` : 'rejected'}.</p>`);
  const fac = Object.entries(res.factors).filter(([, v]) => v !== 1);
  if (fac.length) out.push(`<p>Fixed-interval (Hershfield-type) factors applied to annual maxima of windows spanning n observation intervals: ${fac.map(([d, v]) => `${dl(+d)} × ${v.toFixed(3)}`).join(', ')} (${S.fixedFactor.method === 'weiss' ? `Weiss n/(n−1/8) ${cite('papalexiou16')}` : `table values 1.13 (n=1) and 1.04 (n=2) as used by ${cite('kout98')}`}). The factor is an average correction; its actual value varies by station and year ${cite('papalexiou16')}.</p>`);
  if (res.hershfield) out.push(`<p>Empirical 24-h fixed-to-sliding ratio from this record: ${res.hershfield.ratioOfMeans.toFixed(3)} (ratio of mean annual maxima, ${res.hershfield.n} years).</p>`);
  const sig = res.trends.filter((t) => t.p < 0.05);
  out.push(`<p>Mann–Kendall trend test ${cite('mk')} (two-sided, 5% level, no correction for serial correlation): ${sig.length ? `significant trends at ${sig.map((t) => `${dl(t.d)} (Sen slope ${f(t.sen, 3)} mm/yr, p=${f(t.p, 3)})`).join(', ')} — stationarity is questionable; consider shorter recent periods or non-stationary methods` : 'no significant trend at any duration'}.</p>`);
  if (res.outliers) {
    const fl = res.outliers.filter((q) => q.lowFlags.length || q.highFlags.length);
    out.push(`<p>Grubbs–Beck outlier screening ${cite('b17b')} (log values, 10% significance; flags only, nothing removed): ${fl.length ? fl.map((q) => `${dl(q.d)}: ${[...q.lowFlags.map((x) => `low ${x.year} (${f(x.value, 1)} mm)`), ...q.highFlags.map((x) => `high ${x.year} (${f(x.value, 1)} mm)`)].join(', ')}`).join('; ') : 'no value flagged at any duration'}.</p>`);
  }

  // ---- frequency
  out.push(`<h2>${++sec}. Frequency analysis</h2>`);
  const per = Object.keys(S.perDuration || {}).length;
  const crit = S.criterion || 'aicc';
  out.push(`<p>Distribution: <b>${esc(DISTRIBUTIONS[S.dist].label)}</b> fitted by <b>${esc(methodLabel(S.method, S.fixedShape))}</b>${per ? ` (overridden for ${per} duration(s): ${Object.entries(S.perDuration).map(([d, c]) => `${dl(+d)} ${DISTRIBUTIONS[c.dist].label}/${methodLabel(c.method, c.k)}`).join('; ')})` : ''} ${S.method === 'lmom' || S.method === 'lmomk' ? cite('hosking90') : ''}${S.dist === 'gev' && S.method === 'lmom' ? cite('hww85') : ''}${S.dist === 'ln3' || S.method === 'lmomk' ? cite('hw97') : ''}${S.method === 'gmle' ? cite('ms00') : ''}. Candidate models were compared by AICc, BIC, Anderson–Darling A², probability-plot correlation and Kolmogorov–Smirnov D (statistics against the fitted model; no p-values without parametric bootstrap) and ranked by ${CRIT_LABEL[crit]}. Plotting positions: ${PLOT_LABEL[S.plotting] ?? S.plotting}${S.plotting === 'gringorten' ? ` ${cite('kout98')}` : ''}.</p>`);
  const best = res.comparison.map((c) => { const b = c.rows.find((r) => r.ok); return `${dl(c.d)}: ${b ? `${DISTRIBUTIONS[b.dist].label}/${methodLabel(b.method, b.k)}` : '—'}`; });
  out.push(`<p>Best candidate per duration by ${CRIT_LABEL[crit]} (for information; the chosen model above is used): ${best.join('; ')}.</p>`);
  if (res.pot) {
    const P = S.pot;
    out.push(`<p>Peaks over threshold ${cite('madsen97')}: independent peaks of the rolling depth, about ${P.eventsPerYear} per year, at least ${P.separationHours} h apart; excesses over the smallest selected peak fitted with ${P.shape === 'exp' ? 'an exponential distribution' : 'a generalised Pareto distribution'} (${P.method === 'mle' ? 'maximum likelihood' : 'L-moments'}, known threshold); annual return periods from Poisson arrivals, F* = 1 + ln(1 − 1/T)/λ ${cite('stedinger93')}. ${P.use ? '<b>These quantiles were used for the design table</b> (the Koutsoyiannis models, which are fitted to annual maxima, were not used).' : 'Shown for comparison; the design table uses the annual-maximum fit.'} Rate based on ${f(res.pot.years, 1)} observed years.</p>`);
  }
  out.push(tableHTML(['Duration', 'n', ...Ts.map((T) => `T=${T} yr (mm)`)], res.design.rows.map((r) => [dl(r.d) + (r.source.startsWith('disaggregated') ? '*' : ''), res.observed.rows.find((q) => q.d === r.d)?.n ?? '—', ...r.depth.map((v, k) => {
    const c = ci?.table.find((q) => q.d === r.d);
    return c ? `${f(v, 1)} <span class="ci">(${f(c.lower[k], 1)}–${f(c.upper[k], 1)})</span>` : f(v, 1);
  })]), 'Design depths (mm). * = estimated by disaggregation from daily data.' + (res.pot && S.pot.use ? ' Depths from peaks over threshold where the source is “observed (POT)”; the bracketed intervals refer to the annual-maximum fit.' : '') + (ci ? ` Brackets: ${Math.round(ci.level * 100)}% ${ci.method} ${cite('efron')}, ${ci.nBoot} replicates. In tests with n = 40 the 90% percentile intervals covered the true value about 80% of the time; treat them as optimistic.` : '')));
  out.push(tableHTML(['Duration', ...Ts.map((T) => `T=${T} yr`)], res.design.rows.map((r) => [dl(r.d), ...r.intensity.map((v) => f(v, 2))]), 'Design intensities (mm/h).'));

  // ---- disaggregation
  if (res.disaggregation) {
    const dg = res.disaggregation;
    const m = DISAGG_METHODS[dg.selected];
    out.push(`<h2>${++sec}. Sub-daily estimates from daily data</h2>`);
    const STATUS = { 'verified-formula': 'formula checked; accuracy not validated', verified: 'implementation tested; accuracy depends on local data', experimental: 'EXPERIMENTAL', user: 'user input' };
    const sel = dg.methods[dg.selected];
    const how = dg.belowResolution
      ? `Durations below the ${res.series?.step ?? ''}-min record resolution were EXTRAPOLATED (experimental, opted in) from this station's own quantiles with <b>${esc(m.label)}</b>`
      : `Durations below the data resolution were estimated from the 24-h design depths with <b>${esc(m.label)}</b> (status: ${esc(STATUS[m.status] ?? m.status)})`;
    const cites = dg.selected === 'imd' ? cite('imd') : dg.selected === 'scaling' ? cite('menabde99') : dg.selected === 'bell' ? cite('bell69') : dg.selected === 'ratioTransfer' ? cite('imd') : '';
    const par = sel.n != null ? `, exponent n = ${f(sel.n, 3)}` : sel.H != null ? `, H = ${f(sel.H, 3)}` : sel.ratios ? `, ratios P_t/P_24 = ${Object.entries(sel.ratios).map(([d, r]) => `${dl(+d)}: ${f(r, 3)}`).join(', ')}` : '';
    out.push(`<p>${how} ${cites}${par}${dg.calibratedFrom ? `, calibrated on ${dg.belowResolution ? '' : 'station '}“${esc(dg.calibratedFrom)}”` : ''}. Methods available for comparison: ${Object.keys(dg.methods).join(', ')}.</p>`);
    out.push('<p class="warn">Caution: in the hold-out tests shipped with this tool (docs/HOLDOUT.md), the IMD formula underestimated 1-h quantiles at a real convective station (Denver) by about 40%; on a synthetic monsoon-like series it overestimated 5-min and underestimated 30-min to 1-h quantiles, and no single power law reproduced the 5-min to 24-h quantiles. Transferring depth ratios from a station with sub-daily data gave the lowest errors, but those tests transfer within one station (in time), not between stations. No method has been validated against Bangladeshi sub-daily records.</p>');
  }

  // ---- IDF model
  out.push(`<h2>${++sec}. IDF relationship</h2>`);
  const sel = res.models.find((m) => m.model.key === o.selectedKey) || res.models[0];
  if (sel) {
    out.push(`<p>Selected model: <b>${esc(modelLabel(sel.model))}</b> ${sel.model.type === 'kmodel' ? cite('kout98') : ''}${sel.model.method === 'mle' ? cite('ulrich20') : ''}. Fitting used multi-start Nelder–Mead${sel.model.type === 'kmodel' && sel.model.method !== 'robust' ? ` and differential evolution ${cite('storn97')}` : ''} with bounds θ ≥ 0, 0 &lt; η.</p>`);
    out.push(`<pre class="eq">${esc(equationText(sel.model).join('\n'))}</pre>`);
    if (res.selectionReason) out.push(`<p>Why this model: ${esc(res.selectionReason)}</p>`);
    if (sel.model.method === 'mle') out.push('<p>The duration-dependent likelihood treats maxima of different durations as independent; they are not, so likelihood-based standard errors would be too small. Bootstrap intervals (resampling whole years) are reported instead.</p>');
    out.push(tableHTML(['Model', 'k', 'R²', 'RMSE mm/h', 'NSE', `KGE ${cite('kge')}`, 'PBIAS %', 'MAPE %', 'AICc', 'Notes'],
      res.models.map((m) => [modelLabel(m.model) + (m.model.key === sel.model.key ? ' (selected)' : ''), m.metrics.k, f(m.metrics.r2, 4), f(m.metrics.rmse, 3), f(m.metrics.nse, 4), f(m.metrics.kge, 4), f(m.metrics.pbias, 2), f(m.metrics.mape, 2), f(m.metrics.aicc, 1), esc([m.caution, ...m.issues].filter(Boolean).join(' '))]),
      'Fit of each model to the design table. AICc uses log-space residuals and the total number of fitted parameters; models with more parameters that barely improve RMSE are flagged as likely over-fitting.'));
    if (sel.model.type === 'kmodel' && sel.model.method === 'robust' && sel.model.fixTheta === 0) out.push('<p>θ was fixed at 0 because the shortest duration is at least 1 h (θ is not estimable without sub-hourly data) ' + cite('kout98') + '.</p>');
  }

  // ---- adjustments
  const adj = S.climate.mode !== 'none' || S.arf.mode !== 'none';
  if (adj) {
    out.push(`<h2>${++sec}. Adjustments</h2>`);
    if (S.climate.mode === 'percent') out.push(`<p>Climate-change uplift: +${S.climate.percent}% on all durations (user-specified).</p>`);
    if (S.climate.mode === 'perDegree') out.push(`<p>Climate-change uplift: ${S.climate.rate}%/°C × ${S.climate.warming} °C (${S.climate.linear ? 'linear' : 'compounded'})${S.climate.shortRate != null ? `, ${S.climate.shortRate}%/°C at ≤ ${dl(S.climate.shortDuration)} interpolated to 24 h` : ''}. The ≈7%/°C Clausius–Clapeyron rate is a thermodynamic expectation; observed sub-daily scaling varies by region ${cite('cc')}. Factors: ${[60, 360, 1440].map((d) => `${dl(d)} × ${upliftFactor(d, S.climate).toFixed(3)}`).join(', ')}.</p>`);
    if (S.arf.mode !== 'none') out.push(`<p>Areal reduction: ${S.arf.mode === 'constant' ? `constant factor ${S.arf.value}` : S.arf.mode === 'leclerc' ? `Leclerc–Schaake fit to US TP-29 curves for ${S.arf.areaKm2} km² (EXPERIMENTAL, derived for the USA) ${cite('leclerc72')}; factors ${[60, 360, 1440].map((d) => `${dl(d)} × ${arfFactor(d, S.arf).toFixed(3)}`).join(', ')}` : 'user table'}.</p>`);
    out.push('<p>Baseline values in the tables above are unadjusted; adjusted curves are shown dashed in the figures.</p>');
  }

  // ---- design storm
  if (o.storm) {
    const st = o.storm;
    const refK = { alternatingBlock: 'chow88', chicago: 'keifer57', scs: 'tr55', huff: 'huff90', triangular: 'yen80' }[st.method];
    out.push(`<h2>${++sec}. Design storm</h2>`);
    out.push(`<p>${esc(st.label)} ${refK ? cite(refK) : ''}: T = ${st.T} yr, duration ${dl(st.duration)}, time step ${st.dt} min, total depth ${f(st.total, 2)} mm, peak intensity ${f(st.peak, 2)} mm/h${st.adjusted ? ' (adjusted IDF)' : ''}.</p>`);
  }

  // ---- figures
  if (o.images?.length) {
    out.push('<h2>Figures</h2>');
    o.images.forEach((im, i) => out.push(`<figure><img src="${im.url}" alt="${esc(im.caption)}"><figcaption>Figure ${i + 1}. ${esc(im.caption)}</figcaption></figure>`));
  }

  // ---- warnings and limitations
  out.push('<h2>Warnings and limitations</h2><ul>');
  for (const w of [...res.warnings, ...res.log]) out.push(`<li>${esc(w)}</li>`);
  out.push('<li>Frequency analysis assumes the annual maxima are independent and identically distributed (stationary). See the trend test above.</li>');
  out.push('<li>Point estimates for return periods much longer than the record are extrapolations; read them with their confidence intervals.</li>');
  out.push('</ul>');

  // ---- references
  out.push('<h2>References</h2><ol>');
  for (const k of cited) out.push(`<li>${esc(REFS[k])}</li>`);
  out.push('</ol>');
  out.push(`<h2>Appendix: settings</h2><pre class="settings">${esc(JSON.stringify(S, null, 1))}</pre>`);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IDF report — ${esc(station.name)}</title><style>
body{font-family:'Public Sans',system-ui,sans-serif;color:#1b2a33;background:#fff;max-width:56rem;margin:2rem auto;padding:0 1rem;line-height:1.55;font-size:15px;font-variant-numeric:tabular-nums}
h1{font-size:1.7rem;margin:0 0 .2rem}h2{font-size:1.15rem;margin:1.8rem 0 .5rem;border-top:1px solid #c8d3d2;padding-top:.8rem}
p,li{max-width:75ch}.meta{color:#4a5b64;font-size:.85rem}table{border-collapse:collapse;font-size:.8rem;margin:.4rem 0 1rem;width:100%}
th,td{border-bottom:1px solid #e1e8e7;padding:.25rem .5rem;text-align:right}th:first-child,td:first-child{text-align:left}th{border-bottom:1px solid #c8d3d2;color:#4a5b64}
caption{text-align:left;font-size:.8rem;color:#4a5b64;caption-side:bottom;padding-top:.3rem}.ci{color:#4a5b64;font-size:.9em}
pre{background:#f2f5f4;padding:.6rem .8rem;overflow-x:auto;font-size:.8rem}.warn{border-left:3px solid #8c7a55;padding-left:.7rem}
figure{margin:1rem 0}figure img{max-width:100%;border:1px solid #e1e8e7}figcaption{font-size:.8rem;color:#4a5b64}
@media print{body{margin:0;max-width:none}h2{break-after:avoid}figure,table{break-inside:avoid}}
</style></head><body>${out.join('\n')}</body></html>`;
}

function tableHTML(head, rows, caption) {
  return `<table><caption>${caption}</caption><thead><tr>${head.map((x) => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

/**
 * A short methods paragraph in plain text, ready to paste into a report. States only what was actually done.
 * @param {{station, res, settings, selectedKey, ci}} o
 */
export function methodsParagraph(o) {
  const { station, res, settings: S, ci } = o;
  const parts = [];
  const yrs = res.ams.years.length;
  const span = `${res.ams.years[0]}–${res.ams.years.at(-1)}`;
  if (res.kind === 'ams') parts.push(`Annual maximum rainfall depths for ${res.ams.durations.length} durations (${res.ams.durations.map(dl).join(', ')}) at ${station.name} (${yrs} years, ${span}) were analysed with Brishti IDF ${TOOL_VERSION}.`);
  else {
    const used = yrs - res.ams.excluded.length;
    parts.push(`Rainfall at ${station.name} (${res.series.step}-min record, ${span}) was analysed with Brishti IDF ${TOOL_VERSION}. Years with less than ${Math.round(S.minCoverage * 100)}% of data present were excluded${res.ams.excluded.length ? ` (${res.ams.excluded.length} year${res.ams.excluded.length > 1 ? 's' : ''})` : ''}, and annual maxima were extracted with ${S.amsMode === 'sliding' ? 'sliding' : 'fixed'} windows for durations of ${res.ams.durations.map(dl).join(', ')}${used > 0 ? ` (${used} years)` : ''}.`);
  }
  const fac = Object.entries(res.factors).filter(([, v]) => v !== 1);
  if (fac.length) parts.push(`Maxima spanning one or two observation intervals were multiplied by a fixed-interval factor (${fac.map(([d, v]) => `${dl(+d)} ×${v.toFixed(2)}`).join(', ')}).`);
  const sig = res.trends.filter((t) => t.p < 0.05);
  parts.push(`The Mann–Kendall test found ${sig.length ? `a significant trend (5% level) at ${sig.map((t) => dl(t.d)).join(', ')}` : 'no significant trend at any duration (5% level)'}.`);
  const per = Object.keys(S.perDuration || {}).length;
  parts.push(`A ${DISTRIBUTIONS[S.dist].label} distribution was fitted to each duration by ${methodLabel(S.method, S.fixedShape)}${per ? ` (with a different choice for ${per} duration${per > 1 ? 's' : ''})` : ''}, after comparing ${new Set(res.comparison[0]?.rows.map((r) => r.dist)).size} candidate distributions by ${CRIT_LABEL[S.criterion || 'aicc']}, Anderson–Darling and probability-plot correlation (${PLOT_LABEL[S.plotting] ?? S.plotting} plotting positions).`);
  if (res.pot && S.pot.use) parts.push(`Design quantiles were taken from a peaks-over-threshold analysis instead (about ${S.pot.eventsPerYear} independent events per year, ${S.pot.shape === 'exp' ? 'exponential' : 'generalised Pareto'} excesses, Poisson arrivals).`);
  if (res.disaggregation) {
    const dg = res.disaggregation;
    parts.push(`Depths for ${dg.durations.map(dl).join(', ')} were ${dg.belowResolution ? 'extrapolated' : 'estimated from the 24-h depths'} with the ${DISAGG_METHODS[dg.selected].label.replace(/^./, (c) => c.toLowerCase())}${dg.calibratedFrom ? `, calibrated on ${dg.calibratedFrom}` : ''}.`);
  }
  const sel = res.models.find((m) => m.model.key === o.selectedKey);
  if (sel) parts.push(`An IDF relationship of the form ${equationText(sel.model)[0]} (${modelLabel(sel.model)}) was fitted to the design table (largest error ${f(sel.metrics.maxAbsPct, 1)}%, R² = ${f(sel.metrics.r2, 3)}).`);
  if (ci) parts.push(`Uncertainty was estimated by a non-parametric bootstrap of whole years (${ci.nBoot} replicates, ${Math.round(ci.level * 100)}% percentile intervals).`);
  if (S.climate.mode !== 'none' || S.arf.mode !== 'none') parts.push(`${S.climate.mode !== 'none' ? `A climate-change uplift (${S.climate.mode === 'percent' ? `${S.climate.percent}%` : `${S.climate.rate}%/°C for ${S.climate.warming} °C`})` : ''}${S.climate.mode !== 'none' && S.arf.mode !== 'none' ? ' and ' : ''}${S.arf.mode !== 'none' ? 'an areal reduction factor' : ''} ${S.climate.mode !== 'none' && S.arf.mode !== 'none' ? 'were' : 'was'} applied to the adjusted curves.`);
  return parts.join(' ');
}
