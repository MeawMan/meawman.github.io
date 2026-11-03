/**
 * plots.js — all charts, built on the vendored Plotly (window.Plotly).
 * Colours are read from CSS custom properties so charts follow the light/dark theme.
 * Return periods use a sequential ramp: rarer storms are drawn in deeper colours.
 */
import { predict } from '../core/idf.js';
import { durLabel } from '../ui/dom.js';
import { lmomentRatioCurves } from '../core/distributions.js';

const P = () => window.Plotly;
// Charts read colours from CSS variables. For report figures the caller points this at an off-screen element
// carrying data-theme="light", so the exported PNGs are light whatever theme the screen uses.
let renderRoot = null;
export function setRenderRoot(el) { renderRoot = el; }
const css = (name) => getComputedStyle(renderRoot || document.documentElement).getPropertyValue(name).trim();

/** Sequential teal -> indigo ramp, validated for monotone lightness (light and dark grounds). */
const RAMP_LIGHT = ['#7cc4c0', '#3fa3a6', '#1b8090', '#1f5f86', '#2c3f7a', '#2a1f5c', '#1a0f3d'];
const RAMP_DARK = ['#3c6f74', '#3f8d93', '#46abb2', '#63c4d6', '#8fb7ef', '#b8a9f2', '#e2d4ff'];
export function tColors(n) {
  const dark = isDark();
  const ramp = dark ? RAMP_DARK : RAMP_LIGHT;
  if (n <= 1) return [ramp[3]];
  return Array.from({ length: n }, (_, i) => ramp[Math.round((i * (ramp.length - 1)) / (n - 1))]);
}
/** Categorical palette (stations, methods). */
/** Categorical palette (stations, methods), matching the portfolio's accents. */
export function catColors() { return isDark() ? ['#5be7ff', '#ffc857', '#ff6b8b', '#9dff6b', '#b79cff', '#ff8f6b', '#6db7ff'] : ['#0786ad', '#b86200', '#c0264d', '#2c8a22', '#6d4fd6', '#d4572f', '#2563c9']; }
const fontFamily = () => getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
export function isDark() {
  const t = (renderRoot || document.documentElement).getAttribute('data-theme');
  if (t) return t === 'dark';
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function baseLayout(extra = {}) {
  const ink = css('--ink'); const rule = css('--rule'); const surface = css('--surface');
  return {
    paper_bgcolor: surface, plot_bgcolor: surface,
    font: { family: fontFamily(), size: 12, color: ink },
    margin: { l: 64, r: 20, t: 36, b: 56 },
    legend: { orientation: 'v', x: 1, xanchor: 'right', y: 1, bgcolor: 'rgba(0,0,0,0)' },
    xaxis: { gridcolor: css('--rule-soft'), linecolor: rule, zeroline: false, ticks: 'outside', tickcolor: rule },
    yaxis: { gridcolor: css('--rule-soft'), linecolor: rule, zeroline: false, ticks: 'outside', tickcolor: rule },
    hoverlabel: { font: { family: fontFamily() } },
    ...extra,
  };
}

/** 1-2-5 tick values covering [lo, hi] for a log axis (avoids Plotly's cluttered minor-digit labels). */
export function logTicks(values) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (!v.length) return {};
  const lo = Math.min(...v); const hi = Math.max(...v);
  const vals = [];
  for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++) {
    for (const m of [1, 2, 5]) { const t = m * 10 ** e; if (t >= lo / 1.5 && t <= hi * 1.5) vals.push(t); }
  }
  const txt = (t) => (t >= 1 ? String(Math.round(t)) : String(+t.toPrecision(1)));
  return { tickvals: vals, ticktext: vals.map(txt) };
}

/** Named duration ticks (min) for a log duration axis. */
export function durTicks(values) {
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  const lo = Math.min(...v); const hi = Math.max(...v);
  const vals = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 4320, 10080].filter((d) => d >= lo * 0.99 && d <= hi * 1.01);
  return { tickvals: vals, ticktext: vals.map(durLabel) };
}

const CONFIG = { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['select2d', 'lasso2d', 'autoScale2d'] };

function draw(el, data, layout) {
  const lay = baseLayout(layout);
  // Narrow screens: legend below the plot so it never covers the curves.
  if ((el.clientWidth || 900) < 560) {
    lay.legend = { ...lay.legend, orientation: 'h', x: 0, xanchor: 'left', y: -0.28, yanchor: 'top', title: null };
    lay.margin = { ...lay.margin, l: 52, r: 12, b: 120 };
  }
  P().react(el, data, lay, CONFIG);
}

/**
 * Export a plot at a physical size (cm) and resolution (dpi), as journals specify figures.
 * The chart is laid out at 96 px per inch (so fonts keep their point size) and rasterised at dpi/96 scale;
 * the PNG gets a pHYs chunk so word processors and LaTeX place it at the intended physical size.
 */
export async function exportPlot(el, { format = 'png', widthCm = 16, heightCm = 10, dpi = 300, filename = 'figure' } = {}) {
  const width = Math.round((widthCm / 2.54) * 96);
  const height = Math.round((heightCm / 2.54) * 96);
  if (format === 'svg') {
    const url = await P().toImage(el, { format: 'svg', width, height });
    const svg = decodeURIComponent(url.split(',')[1]);
    return saveBlob(new Blob([svg], { type: 'image/svg+xml' }), `${filename}.svg`);
  }
  const url = await P().toImage(el, { format: 'png', width, height, scale: dpi / 96 });
  const bytes = Uint8Array.from(atob(url.split(',')[1]), (c) => c.charCodeAt(0));
  return saveBlob(new Blob([withPngDpi(bytes, dpi)], { type: 'image/png' }), `${filename}.png`);
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Insert (or replace) a pHYs chunk carrying `dpi` into a PNG byte array. */
export function withPngDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, 9); chunk.set([0x70, 0x48, 0x59, 0x73], 4); // 'pHYs'
  dv.setUint32(8, ppm); dv.setUint32(12, ppm); chunk[16] = 1; // unit: metre
  dv.setUint32(17, crc32(chunk.subarray(4, 17)));
  // walk chunks: drop an existing pHYs, insert ours after IHDR
  const out = [png.subarray(0, 8)];
  let p = 8;
  while (p < png.length) {
    const len = new DataView(png.buffer, png.byteOffset + p).getUint32(0);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    const end = p + 12 + len;
    if (type !== 'pHYs') out.push(png.subarray(p, end));
    if (type === 'IHDR') out.push(chunk);
    p = end;
  }
  const total = out.reduce((a, b) => a + b.length, 0);
  const res = new Uint8Array(total);
  let o = 0; for (const b of out) { res.set(b, o); o += b.length; }
  return res;
}

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** PNG data URL (for the report). */
export function plotToDataURL(el, width = 900, height = 520) {
  return P().toImage(el, { format: 'png', width, height, scale: 2 });
}

// ---------------------------------------------------------------------------

/** Year x day-of-year raster of daily totals; missing days in gauge red. */
export function recordStrip(el, strip, unit = 'mm') {
  const zMain = strip.z.map((r) => r.map((v) => (v == null || v < 0 ? null : v)));
  const zMiss = strip.z.map((r) => r.map((v) => (v === -1 ? 1 : null)));
  const vals = zMain.flat().filter((v) => v != null && v > 0).sort((a, b) => a - b);
  const vmax = vals.length ? vals[Math.floor(0.995 * (vals.length - 1))] : 1;
  const ground = css('--surface');
  draw(el, [
    { type: 'heatmap', z: zMain, x: Array.from({ length: 366 }, (_, i) => i + 1), y: strip.years, zmin: 0, zmax: vmax,
      colorscale: [[0, ground], [0.0001, isDark() ? '#1f3d44' : '#d9ecec'], [0.3, isDark() ? '#3f8d93' : '#5fb0b3'], [0.7, isDark() ? '#8fb7ef' : '#1f5f86'], [1, isDark() ? '#e2d4ff' : '#1a0f3d']],
      colorbar: { title: { text: `daily ${unit}` }, thickness: 10, len: 0.9 }, hovertemplate: 'year %{y}, day %{x}<br>%{z:.1f} ' + unit + '<extra></extra>', xgap: 0, ygap: 1 },
    { type: 'heatmap', z: zMiss, x: Array.from({ length: 366 }, (_, i) => i + 1), y: strip.years, colorscale: [[0, css('--red')], [1, css('--red')]], showscale: false, hovertemplate: 'year %{y}, day %{x}: missing<extra></extra>', ygap: 1 },
  ], {
    margin: { l: 52, r: 10, t: 10, b: 40 },
    xaxis: { title: { text: 'day of year' }, tickvals: [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], ticktext: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], gridcolor: 'rgba(0,0,0,0)' },
    yaxis: { autorange: 'reversed', dtick: strip.years.length > 30 ? 5 : 1, gridcolor: 'rgba(0,0,0,0)' },
    height: Math.max(220, 40 + 9 * strip.years.length),
  });
}

/** Annual maxima time series by duration. */
export function amsSeries(el, ams, durations, factors) {
  const cols = tColors(durations.length).reverse();
  draw(el, durations.map((d, i) => ({
    type: 'scatter', mode: 'lines+markers', name: durLabel(d), x: ams.years, y: ams.depth[d].map((v) => (Number.isFinite(v) ? v * (factors?.[d] ?? 1) : null)),
    line: { color: cols[i], width: 1.4 }, marker: { size: 4 },
  })), { yaxis: { title: { text: 'annual maximum depth (mm)' }, type: 'log', ...logTicks(durations.flatMap((d) => ams.depth[d].map((v) => v * (factors?.[d] ?? 1)))) }, xaxis: { title: { text: 'year' } } });
}

/** Probability plot on Gumbel reduced-variate axis: empirical points + fitted quantile curves for one duration. */
export function probabilityPlot(el, emp, fits, ci) {
  const gy = (T) => -Math.log(-Math.log(1 - 1 / T));
  const Tgrid = []; for (let t = 1.01; t <= 1000; t *= 1.08) Tgrid.push(t);
  const data = [{ type: 'scatter', mode: 'markers', name: `annual maxima (${(emp.plotting || 'gringorten').replace(/^./, (c) => c.toUpperCase())})`, x: emp.T.map(gy), y: emp.depth, marker: { color: css('--ink'), size: 6, symbol: 'circle-open' }, hovertemplate: 'T≈%{customdata:.1f} yr<br>%{y:.1f} mm<extra></extra>', customdata: emp.T }];
  const cc = catColors();
  fits.forEach((f, i) => data.push({ type: 'scatter', mode: 'lines', name: f.label, x: Tgrid.map(gy), y: Tgrid.map((T) => f.q(T)), line: { color: cc[i % cc.length], width: i === 0 ? 2.4 : 1.3, dash: i === 0 ? 'solid' : 'dot' } }));
  if (ci) {
    data.push({ type: 'scatter', mode: 'lines', name: `${Math.round(ci.level * 100)}% CI`, x: ci.T.map(gy), y: ci.upper, line: { color: cc[0], width: 0.8, dash: 'dash' } });
    data.push({ type: 'scatter', mode: 'lines', showlegend: false, x: ci.T.map(gy), y: ci.lower, line: { color: cc[0], width: 0.8, dash: 'dash' } });
  }
  const ticksT = [1.25, 2, 5, 10, 25, 50, 100, 200, 500];
  draw(el, data, {
    xaxis: { title: { text: 'return period (yr) — Gumbel probability scale' }, tickvals: ticksT.map(gy), ticktext: ticksT.map(String) },
    yaxis: { title: { text: 'depth (mm)' } },
    legend: { x: 0.01, xanchor: 'left', y: 0.99, yanchor: 'top', bgcolor: hexA(css('--surface').trim() || '#ffffff', 0.85) },
  });
}

/** L-moment ratio diagram with sample points per duration. */
export function lmomDiagram(el, points) {
  const c = lmomentRatioCurves();
  const cc = catColors();
  const data = [
    { name: 'GEV', x: c.t3, y: c.gev }, { name: 'GLO', x: c.t3, y: c.glo }, { name: 'GPA', x: c.t3, y: c.gpa },
    { name: 'Log-normal (3p)', x: c.t3, y: c.ln3 }, { name: 'Pearson III', x: c.t3, y: c.pe3 },
  ].map((s, i) => ({ type: 'scatter', mode: 'lines', ...s, line: { color: cc[i], width: 1.4 } }));
  data.push({ type: 'scatter', mode: 'markers', name: 'Gumbel', x: [c.gumbel.t3], y: [c.gumbel.t4], marker: { symbol: 'x', size: 10, color: css('--ink') } });
  // Sample points carry their duration on hover; the printed labels are a separate legend item, off at first,
  // because neighbouring durations sit on top of each other and their labels overlap.
  data.push({ type: 'scatter', mode: 'markers', name: 'sample (per duration)', x: points.map((p) => p.t3), y: points.map((p) => p.t4), text: points.map((p) => p.label),
    hovertemplate: '%{text}<br>τ3 %{x:.3f}, τ4 %{y:.3f}<extra></extra>', marker: { size: 8, color: css('--red'), line: { width: 1, color: css('--surface') } } });
  data.push({ type: 'scatter', mode: 'text', name: 'duration labels', x: points.map((p) => p.t3), y: points.map((p) => p.t4), text: points.map((p) => p.label),
    textposition: 'top center', textfont: { size: 10, color: css('--ink-2') }, hoverinfo: 'skip', visible: 'legendonly' });
  draw(el, data, {
    xaxis: { title: { text: 'L-skewness τ3' }, range: [-0.2, 0.6] }, yaxis: { title: { text: 'L-kurtosis τ4' }, range: [-0.05, 0.45] },
    // legend under the plot so it never covers the curves; a click on a name hides or shows that line
    legend: { orientation: 'h', x: 0, xanchor: 'left', y: -0.2, yanchor: 'top', bgcolor: 'rgba(0,0,0,0)',
      title: { text: 'Click a name to hide or show it · double-click to show only that one<br>', font: { size: 11, color: css('--ink-2') }, side: 'top' } },
    margin: { l: 64, r: 20, t: 24, b: 130 },
  });
}

/**
 * IDF curves.
 * @param {object} o { model, design, Ts, adjust:(d)=>factor|null, ci:{T->{d->[lo,hi]}}|null, axes:'loglog'|'semilog', dmin, dmax, showPoints }
 */
export function idfPlot(el, o) {
  const ds = []; for (let d = o.dmin; d <= o.dmax * 1.0001; d *= 1.04) ds.push(d);
  const cols = tColors(o.Ts.length);
  const data = [];
  o.Ts.forEach((T, k) => {
    const color = cols[k];
    if (o.ci && o.ci[T]) {
      const pts = o.ci[T];
      data.push({ type: 'scatter', mode: 'lines', x: pts.d, y: pts.upper, line: { width: 0 }, showlegend: false, hoverinfo: 'skip' });
      data.push({ type: 'scatter', mode: 'lines', x: pts.d, y: pts.lower, fill: 'tonexty', fillcolor: hexA(color, 0.15), line: { width: 0 }, showlegend: false, hoverinfo: 'skip', name: `${T}-yr CI` });
    }
    if (o.model) {
      data.push({ type: 'scatter', mode: 'lines', name: `${T} yr`, x: ds, y: ds.map((d) => predict(o.model, d, T)), line: { color, width: 2 }, legendgroup: String(T),
        hovertemplate: `T=${T} yr<br>%{x:.0f} min<br>%{y:.2f} mm/h<extra></extra>` });
      if (o.adjust) data.push({ type: 'scatter', mode: 'lines', name: `${T} yr adjusted`, x: ds, y: ds.map((d) => predict(o.model, d, T) * o.adjust(d)), line: { color, width: 1.6, dash: 'dash' }, legendgroup: String(T), showlegend: k === 0, hovertemplate: `T=${T} yr adjusted<br>%{x:.0f} min<br>%{y:.2f} mm/h<extra></extra>` });
    }
    if (o.showPoints && o.design) {
      const kk = o.design.returnPeriods.indexOf(T);
      if (kk >= 0) data.push({ type: 'scatter', mode: 'markers', showlegend: false, legendgroup: String(T), x: o.design.rows.map((r) => r.d), y: o.design.rows.map((r) => r.intensity[kk]),
        marker: { color, size: 6, symbol: o.design.rows.map((r) => (r.source === 'observed' ? 'circle' : 'diamond-open')) }, hovertemplate: `T=${T} yr quantile<br>%{x} min<br>%{y:.2f} mm/h<extra></extra>` });
    }
  });
  const yv = data.flatMap((t) => (t.y || []));
  draw(el, data, {
    xaxis: { title: { text: 'duration' }, type: 'log', ...durTicks([o.dmin, o.dmax]) },
    yaxis: { title: { text: 'intensity (mm/h)' }, type: o.axes === 'semilog' ? 'linear' : 'log', ...(o.axes === 'semilog' ? {} : logTicks(yv)) },
    legend: { title: { text: 'return period' }, x: 1, xanchor: 'right', y: 1 },
  });
}

function hexA(hex, a) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Residuals (% error) of a model vs the design table, by duration and T. */
export function residualPlot(el, resid, Ts) {
  const cols = tColors(Ts.length);
  draw(el, Ts.map((T, k) => {
    const r = resid.filter((q) => q.T === T);
    return { type: 'scatter', mode: 'lines+markers', name: `${T} yr`, x: r.map((q) => q.d), y: r.map((q) => q.pct), line: { color: cols[k], width: 1 }, marker: { size: 5 } };
  }), { xaxis: { type: 'log', title: { text: 'duration' }, ...durTicks(resid.map((q) => q.d)) }, yaxis: { title: { text: 'model − quantile (%)' }, zeroline: true, zerolinecolor: css('--rule') } });
}

/** Side-by-side disaggregation methods for one return period. */
export function disaggPlot(el, dg, T, observedRows) {
  const k = dg.returnPeriods.indexOf(T);
  const cc = catColors();
  const data = Object.entries(dg.methods).map(([m, r], i) => ({ type: 'scatter', mode: 'lines+markers', name: m, x: r.rows.map((q) => q.d), y: r.rows.map((q) => q.intensity[k]), line: { color: cc[i % cc.length], width: 1.6 } }));
  if (observedRows) data.push({ type: 'scatter', mode: 'markers', name: 'from daily data', x: observedRows.map((r) => r.d), y: observedRows.map((r) => r.intensity[k]), marker: { color: css('--ink'), size: 7 } });
  const xs = data.flatMap((t) => t.x); const ys = data.flatMap((t) => t.y);
  draw(el, data, { xaxis: { type: 'log', title: { text: 'duration' }, ...durTicks(xs) }, yaxis: { type: 'log', title: { text: `intensity, T = ${T} yr (mm/h)` }, ...logTicks(ys) } });
}

/** Hyetograph bars + cumulative line. */
export function hyetograph(el, blocks, dt, title) {
  draw(el, [
    { type: 'bar', name: 'intensity (mm/h)', x: blocks.map((b) => b.t - dt / 2), y: blocks.map((b) => b.intensity), width: dt * 0.92, marker: { color: css('--teal') } },
    { type: 'scatter', mode: 'lines', name: 'cumulative (mm)', x: [0, ...blocks.map((b) => b.t)], y: [0, ...blocks.map((b) => b.cumulative)], yaxis: 'y2', line: { color: css('--silt'), width: 2 } },
  ], {
    title: { text: title, font: { size: 13 } }, bargap: 0,
    xaxis: { title: { text: 'time from storm start (min)' } }, yaxis: { title: { text: 'intensity (mm/h)' } },
    yaxis2: { title: { text: 'cumulative depth (mm)' }, overlaying: 'y', side: 'right', showgrid: false },
    margin: { l: 64, r: 64, t: 40, b: 56 }, legend: { x: 0, xanchor: 'left', y: 1 },
  });
}

/** Several stations' IDF curves for one T. */
export function stationsPlot(el, items, T, dmin, dmax) {
  const ds = []; for (let d = dmin; d <= dmax * 1.0001; d *= 1.05) ds.push(d);
  const cc = catColors();
  draw(el, items.map((it, i) => ({ type: 'scatter', mode: 'lines', name: it.name, x: ds, y: ds.map((d) => it.f(d, T)), line: { color: cc[i % cc.length], width: 2, dash: it.dash || 'solid' } })), {
    xaxis: { type: 'log', title: { text: 'duration' }, ...durTicks([dmin, dmax]) }, yaxis: { type: 'log', title: { text: `intensity, T = ${T} yr (mm/h)` }, ...logTicks(items.flatMap((it) => ds.map((d) => it.f(d, T)))) },
  });
}

export function purge(el) { try { P().purge(el); } catch { /* ignore */ } }
