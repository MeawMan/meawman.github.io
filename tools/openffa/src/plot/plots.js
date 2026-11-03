// plots.js - Plotly figure builders. Each function returns { data, layout } and never touches the DOM,
// so figures can be rebuilt for export at any size. Probability paper is drawn by plotting against a
// reduced variate of the non-exceedance probability F and labelling the axis in AEP / return period.

import { DISTRIBUTIONS } from '../core/distributions.js';
import { normPpf } from '../core/special.js';
import { LMRD } from '../core/lmrd_data.js';

// Colour-blind-safe categorical palette (Okabe & Ito 2008, extended with Tol "muted")
export const SERIES = ['#0072B2', '#D55E00', '#009E73', '#CC79A7', '#E69F00', '#56B4E9', '#882255', '#44AA99', '#999933', '#AA4499', '#332288'];

export const PAPERS = {
  gumbel: { label: 'Gumbel (EV1) paper', f: (F) => -Math.log(-Math.log(F)), axis: 'Gumbel reduced variate' },
  normal: { label: 'Normal probability paper', f: (F) => normPpf(F), axis: 'Standard normal variate' },
  logT: { label: 'Log return period', f: (F) => Math.log10(1 / (1 - F)), axis: 'log10 return period' },
  weibull: { label: 'Weibull paper', f: (F) => Math.log(-Math.log(1 - F)), axis: 'ln(-ln(AEP))' },
};

const TICK_T = [1.25, 2, 5, 10, 25, 50, 100, 200, 500, 1000, 10000];

function theme() {
  const cs = typeof getComputedStyle === 'function' ? getComputedStyle(document.documentElement) : null;
  const v = (n, d) => (cs ? cs.getPropertyValue(n).trim() || d : d);
  return { ink: v('--ink', '#13293D'), muted: v('--muted', '#5B6B78'), grid: v('--grid', '#D5DDDC'), bg: v('--plot-bg', '#FFFFFF'), accent: v('--river', '#1B6F8A'), font: v('--font-body', 'Public Sans, sans-serif') };
}

function baseLayout(t, title, extra = {}) {
  return {
    title: title ? { text: title, font: { size: 15, color: t.ink }, x: 0, xanchor: 'left' } : undefined,
    paper_bgcolor: t.bg, plot_bgcolor: t.bg,
    font: { family: t.font, color: t.ink, size: 12 },
    margin: { l: 70, r: 20, t: title ? 44 : 16, b: 60 },
    legend: { orientation: 'v', x: 0.01, xanchor: 'left', y: 0.99, yanchor: 'top', bgcolor: t.bg, bordercolor: t.grid, borderwidth: 1, font: { size: 11 } },
    hovermode: 'closest',
    ...extra,
  };
}
const axis = (t, title, extra = {}) => ({ title: { text: title, standoff: 8 }, gridcolor: t.grid, zerolinecolor: t.grid, linecolor: t.muted, ticks: 'outside', tickcolor: t.muted, mirror: true, ...extra });

const fGrid = () => {
  const out = [];
  for (let i = 0; i <= 500; i++) { const z = -1.6 + (i / 500) * 10.9; out.push(Math.exp(-Math.exp(-z))); } // Gumbel space, T ~ 1.01 to 10^4
  return out.filter((F) => F > 0.005 && F < 0.99995);
};

export function fitLabel(f) { return `${f.distId} · ${f.methodLabel}`; }

/** Quantile of a fit including the zero-flow adjustment p0. */
export function fitQuantile(fit, F) {
  const p0 = fit.p0 ?? 0;
  if (F <= p0) return 0;
  return DISTRIBUTIONS[fit.distId].quantile((F - p0) / (1 - p0), fit.params);
}

/** Frequency (return-level) plot on probability paper. */
export function frequencyPlot(res, { paper = 'gumbel', logY = false, fits = null, ciFor = null, units = '', title = '' } = {}) {
  const t = theme(), P = PAPERS[paper];
  const shown = (fits ?? res.fits.map((_, i) => i)).filter((i) => res.fits[i]?.ok);
  const data = [];
  const ciFit = ciFor !== null && res.fits[ciFor]?.ok ? res.fits[ciFor] : null;
  if (ciFit && ciFit.quantiles.some((q) => Number.isFinite(q.lo))) {
    const qs = ciFit.quantiles.filter((q) => Number.isFinite(q.lo) && Number.isFinite(q.hi) && q.q > 0);
    data.push({ x: qs.map((q) => P.f(q.F)), y: qs.map((q) => q.hi), mode: 'lines', line: { width: 0 }, hoverinfo: 'skip', showlegend: false, type: 'scatter' });
    data.push({ x: qs.map((q) => P.f(q.F)), y: qs.map((q) => q.lo), mode: 'lines', line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(27,111,138,0.16)', name: `${Math.round((ciFit.ci?.level ?? 0.9) * 100)}% CI (${ciFit.distId})`, type: 'scatter', hoverinfo: 'skip' });
  }
  const Fg = fGrid();
  shown.forEach((i) => {
    const f = res.fits[i];
    const ys = Fg.map((F) => fitQuantile(f, F));
    data.push({ x: Fg.map(P.f), y: ys, mode: 'lines', name: fitLabel(f), line: { width: 2, color: SERIES[i % SERIES.length] }, type: 'scatter',
      customdata: Fg.map((F) => [1 / (1 - F), (1 - F) * 100]), hovertemplate: `${f.distId}<br>T = %{customdata[0]:.1f} yr (AEP %{customdata[1]:.2f}%)<br>Q = %{y:.4g} ${units}<extra></extra>` });
  });
  const emp = res.empirical;
  data.push({ x: emp.map((e) => P.f(e.F)), y: emp.map((e) => e.x), mode: 'markers', name: `Observed (${res.settings.plottingPosition})`, type: 'scatter',
    marker: { size: 7, color: t.bg, line: { color: t.ink, width: 1.4 } }, customdata: emp.map((e) => e.T), hovertemplate: `Observed %{y:.4g} ${units}<br>plotting T = %{customdata:.2f} yr<extra></extra>` });
  if (res.pilf) {
    data.push({ x: [P.f(0.005), P.f(0.9995)], y: [res.pilf.threshold, res.pilf.threshold], mode: 'lines', name: `PILF threshold (${res.pilf.source})`, line: { dash: 'dot', color: '#B3261E', width: 1.2 }, type: 'scatter', hoverinfo: 'skip' });
  }
  const ticks = TICK_T.map((T) => ({ T, x: P.f(1 - 1 / T) })).filter((k) => Number.isFinite(k.x));
  const layout = baseLayout(t, title, {
    xaxis: axis(t, 'Return period (years)  /  annual exceedance probability', { tickvals: ticks.map((k) => k.x), ticktext: ticks.map((k) => `${k.T}<br>${fmtAep(1 / k.T)}`), range: [P.f(0.15), P.f(0.9995)], tickangle: 0 }),
    yaxis: axis(t, `Discharge${units ? ` (${units})` : ''}`, logY ? { type: 'log' } : {}),
  });
  return { data, layout };
}
const fmtAep = (p) => (p >= 0.1 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${(p * 100).toFixed(0)}%` : `${(p * 100).toPrecision(1)}%`);

export function qqPlot(res, i, units = '') {
  const t = theme(), f = res.fits[i];
  const emp = res.empirical;
  const q = emp.map((e) => fitQuantile(f, e.F));
  const lo = Math.min(...emp.map((e) => e.x), ...q), hi = Math.max(...emp.map((e) => e.x), ...q);
  return { data: [
    { x: [lo, hi], y: [lo, hi], mode: 'lines', line: { color: t.muted, dash: 'dash', width: 1 }, name: '1:1', type: 'scatter', hoverinfo: 'skip' },
    { x: q, y: emp.map((e) => e.x), mode: 'markers', marker: { color: SERIES[i % SERIES.length], size: 7 }, name: f.distId, type: 'scatter', hovertemplate: 'fitted %{x:.4g}<br>observed %{y:.4g}<extra></extra>' },
  ], layout: baseLayout(t, `Q-Q plot: ${fitLabel(f)}`, { xaxis: axis(t, `Fitted quantile ${units}`), yaxis: axis(t, `Observed ${units}`), showlegend: false }) };
}

export function ppPlot(res, i) {
  const t = theme(), f = res.fits[i], d = DISTRIBUTIONS[f.distId], p0 = f.p0 ?? 0;
  const emp = res.empirical;
  const Fm = emp.map((e) => p0 + (1 - p0) * d.cdf(e.x, f.params));
  return { data: [
    { x: [0, 1], y: [0, 1], mode: 'lines', line: { color: t.muted, dash: 'dash', width: 1 }, type: 'scatter', hoverinfo: 'skip' },
    { x: Fm, y: emp.map((e) => e.F), mode: 'markers', marker: { color: SERIES[i % SERIES.length], size: 7 }, type: 'scatter', hovertemplate: 'model %{x:.3f}<br>empirical %{y:.3f}<extra></extra>' },
  ], layout: baseLayout(t, `P-P plot: ${fitLabel(f)}`, { xaxis: axis(t, 'Fitted non-exceedance probability', { range: [0, 1] }), yaxis: axis(t, 'Empirical (plotting position)', { range: [0, 1] }), showlegend: false }) };
}

export function pdfPlot(res, fitIdx, units = '') {
  const t = theme(), x = res.empirical.map((e) => e.x), n = x.length;
  const k = Math.max(5, Math.ceil(Math.log2(n) + 1)); // Sturges
  const lo = Math.min(...x), hi = Math.max(...x), w = (hi - lo) / k || 1;
  const counts = new Array(k).fill(0);
  for (const v of x) counts[Math.min(k - 1, Math.floor((v - lo) / w))]++;
  const data = [{ type: 'bar', x: counts.map((_, i) => lo + (i + 0.5) * w), y: counts.map((c) => c / (n * w)), width: w * 0.98, marker: { color: t.grid, line: { color: t.muted, width: 0.5 } }, name: 'Observed (density)', hovertemplate: '%{y:.3g}<extra></extra>' }];
  const xs = Array.from({ length: 200 }, (_, i) => lo - 0.1 * (hi - lo) + (i / 199) * 1.4 * (hi - lo));
  fitIdx.forEach((i) => {
    const f = res.fits[i]; if (!f.ok) return;
    const d = DISTRIBUTIONS[f.distId], s = 1 - (f.p0 ?? 0);
    data.push({ type: 'scatter', mode: 'lines', x: xs, y: xs.map((v) => s * d.pdf(v, f.params)), name: f.distId, line: { color: SERIES[i % SERIES.length], width: 2 } });
  });
  return { data, layout: baseLayout(t, 'Histogram and fitted densities', { xaxis: axis(t, units), yaxis: axis(t, 'Probability density', { exponentformat: 'power' }), bargap: 0, legend: { x: 0.99, xanchor: 'right', y: 0.99, yanchor: 'top', bgcolor: t.bg } }) };
}

export function cdfPlot(res, fitIdx, units = '') {
  const t = theme(), emp = res.empirical;
  const lo = emp[0].x, hi = emp[emp.length - 1].x;
  const xs = Array.from({ length: 200 }, (_, i) => lo - 0.1 * (hi - lo) + (i / 199) * 1.3 * (hi - lo));
  const data = [{ type: 'scatter', mode: 'markers', x: emp.map((e) => e.x), y: emp.map((e) => e.F), name: 'Empirical', marker: { color: t.bg, size: 6, line: { color: t.ink, width: 1.2 } } }];
  fitIdx.forEach((i) => {
    const f = res.fits[i]; if (!f.ok) return;
    const d = DISTRIBUTIONS[f.distId], p0 = f.p0 ?? 0;
    data.push({ type: 'scatter', mode: 'lines', x: xs, y: xs.map((v) => p0 + (1 - p0) * d.cdf(v, f.params)), name: f.distId, line: { color: SERIES[i % SERIES.length], width: 2 } });
  });
  return { data, layout: baseLayout(t, 'Empirical and fitted CDF', { xaxis: axis(t, units), yaxis: axis(t, 'Non-exceedance probability', { range: [0, 1.02] }), legend: { x: 0.99, xanchor: 'right', y: 0.02, yanchor: 'bottom', bgcolor: t.bg } }) };
}

export function lmrdPlot(res) {
  const t = theme(), data = [];
  const names = { GEV: 'GEV', GLO: 'GLO', GPA: 'GPA', PE3: 'Pearson III', LN3: 'LN3 (GNO)' };
  Object.entries(LMRD.curves).forEach(([k, pts], i) => {
    data.push({ type: 'scatter', mode: 'lines', x: pts.map((p) => p[0]), y: pts.map((p) => p[1]), name: names[k], line: { color: SERIES[i % SERIES.length], width: 1.6 } });
  });
  Object.entries(LMRD.points).filter(([k]) => k !== 'Uniform').forEach(([k, p]) => data.push({ type: 'scatter', mode: 'markers+text', x: [p[0]], y: [p[1]], text: [k], textposition: 'top right', marker: { symbol: 'square', size: 7, color: t.muted }, showlegend: false, textfont: { size: 10, color: t.muted }, hoverinfo: 'text' }));
  if (res.lmoments) data.push({ type: 'scatter', mode: 'markers', x: [res.lmoments.t3], y: [res.lmoments.t4], name: 'Sample (flows)', marker: { size: 13, color: '#B3261E', symbol: 'x' } });
  if (res.lmomentsLog) data.push({ type: 'scatter', mode: 'markers', x: [res.lmomentsLog.t3], y: [res.lmomentsLog.t4], name: 'Sample (log10 flows; compare with PE3 for LP3)', marker: { size: 11, color: '#B3261E', symbol: 'circle-open', line: { width: 2 } } });
  return { data, layout: baseLayout(t, 'L-moment ratio diagram', { xaxis: axis(t, 'L-skewness τ3', { range: [-0.3, 0.7] }), yaxis: axis(t, 'L-kurtosis τ4', { range: [-0.1, 0.5] }),
    legend: { orientation: 'h', x: 0, y: -0.22, yanchor: 'top', bgcolor: t.bg }, margin: { l: 70, r: 20, t: 44, b: 120 } }) };
}

export function seriesPlot(values, years, diag, units = '') {
  const t = theme(), x = years ?? values.map((_, i) => i + 1);
  const data = [{ type: 'scatter', mode: 'lines+markers', x, y: values, name: 'Annual maximum', line: { color: t.accent, width: 1.2 }, marker: { size: 5, color: t.accent } }];
  const mk = diag?.tests?.mannKendall;
  if (mk && Number.isFinite(mk.slope)) {
    const ts = x.map((v, i) => (years ? v : i));
    const ys = [...values].sort((a, b) => a - b), med = ys[Math.floor(ys.length / 2)];
    const tm = [...ts].sort((a, b) => a - b)[Math.floor(ts.length / 2)];
    data.push({ type: 'scatter', mode: 'lines', x: [x[0], x[x.length - 1]], y: [med + mk.slope * (ts[0] - tm), med + mk.slope * (ts[ts.length - 1] - tm)], name: `Sen slope (${mk.slope.toPrecision(3)}/yr, MK p = ${mk.p.toFixed(3)})`, line: { color: mk.p < 0.05 ? '#B3261E' : t.muted, dash: 'dash', width: 1.5 } });
  }
  const pt = diag?.tests?.pettitt;
  const shapes = [];
  if (pt && pt.p < 0.05 && pt.year != null) shapes.push({ type: 'line', x0: pt.year + 0.5, x1: pt.year + 0.5, yref: 'paper', y0: 0, y1: 1, line: { color: '#B3261E', dash: 'dot' } });
  return { data, layout: baseLayout(t, 'Annual maximum series', { xaxis: axis(t, years ? 'Water year' : 'Index'), yaxis: axis(t, units), shapes, legend: { orientation: 'h', y: -0.25 } }) };
}

export function mrlPlot(mrl, units = '') {
  const t = theme(), ok = mrl.filter((m) => Number.isFinite(m.mean));
  return { data: [
    { type: 'scatter', mode: 'lines', x: ok.map((m) => m.u), y: ok.map((m) => m.hi), line: { width: 0 }, showlegend: false, hoverinfo: 'skip' },
    { type: 'scatter', mode: 'lines', x: ok.map((m) => m.u), y: ok.map((m) => m.lo), line: { width: 0 }, fill: 'tonexty', fillcolor: 'rgba(27,111,138,0.15)', name: '95% CI', hoverinfo: 'skip' },
    { type: 'scatter', mode: 'lines', x: ok.map((m) => m.u), y: ok.map((m) => m.mean), line: { color: t.accent, width: 2 }, name: 'Mean excess', customdata: ok.map((m) => m.n), hovertemplate: 'u = %{x:.4g}<br>mean excess %{y:.4g}<br>n = %{customdata}<extra></extra>' },
  ], layout: baseLayout(t, 'Mean residual life plot (choose u where the curve becomes linear)', { xaxis: axis(t, `Threshold u ${units}`), yaxis: axis(t, `Mean excess ${units}`) }) };
}

export function stabilityPlot(st, units = '') {
  const t = theme(), ok = st.filter((s) => Number.isFinite(s.k));
  return { data: [
    { type: 'scatter', mode: 'lines+markers', x: ok.map((s) => s.u), y: ok.map((s) => s.k), name: 'Shape k (Hosking sign)', line: { color: SERIES[0] }, yaxis: 'y' },
    { type: 'scatter', mode: 'lines+markers', x: ok.map((s) => s.u), y: ok.map((s) => s.modScale), name: 'Modified scale α + k·u', line: { color: SERIES[1] }, yaxis: 'y2' },
  ], layout: baseLayout(t, 'Parameter stability (both should be roughly constant above a valid threshold)', {
    xaxis: axis(t, `Threshold u ${units}`), yaxis: axis(t, 'Shape k'), yaxis2: axis(t, 'Modified scale', { overlaying: 'y', side: 'right', showgrid: false }), legend: { orientation: 'h', y: -0.25 } }) };
}

export function nonstationaryPlot(x, cov, ns, Ts, units = '') {
  const t = theme(), data = [{ type: 'scatter', mode: 'markers', x: cov, y: x, name: 'Observed', marker: { color: t.ink, size: 6 } }];
  const { coef, model, covariateMean: cm } = ns;
  const gev = DISTRIBUTIONS.GEV;
  Ts.forEach((T, i) => {
    const ys = cov.map((c) => {
      const cc = c - cm;
      const p = [coef[0] + coef[1] * cc, model === 'locscale' ? Math.exp(coef[2] + coef[3] * cc) : Math.exp(coef[2]), coef[coef.length - 1]];
      return gev.quantile(1 - 1 / T, p);
    });
    data.push({ type: 'scatter', mode: 'lines', x: cov, y: ys, name: `Effective ${T}-yr level`, line: { color: SERIES[i % SERIES.length], width: 2 } });
  });
  return { data, layout: baseLayout(t, 'Non-stationary GEV: effective return levels', { xaxis: axis(t, 'Covariate'), yaxis: axis(t, units), legend: { orientation: 'h', y: -0.25 } }) };
}
