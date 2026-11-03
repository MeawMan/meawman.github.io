// render.js - draws Plotly figures and provides publication export (PNG/SVG at a chosen size and DPI).
import { h } from '../ui/dom.js';

const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ['select2d', 'lasso2d', 'toImage'] };

export function draw(div, fig) {
  if (!globalThis.Plotly) { div.textContent = 'Plotting library not loaded yet.'; return; }
  globalThis.Plotly.react(div, fig.data, fig.layout, CONFIG);
}

/** A plot container with an export toolbar. build() must return a fresh {data, layout}. */
export function plotBlock(build, { name = 'figure', small = false } = {}) {
  const div = h('div', { class: `plot${small ? ' small' : ''}`, role: 'img', 'aria-label': name.replace(/_/g, ' ') });
  const w = h('input', { type: 'number', value: '16', min: '4', max: '60', step: '0.5', 'aria-label': 'Width in cm', style: { width: '5rem', minWidth: '0' } });
  const hh = h('input', { type: 'number', value: '10', min: '3', max: '60', step: '0.5', 'aria-label': 'Height in cm', style: { width: '5rem', minWidth: '0' } });
  const dpi = h('select', { 'aria-label': 'Resolution' }, ['150', '300', '600'].map((d) => h('option', { value: d, selected: d === '300' }, `${d} dpi`)));
  const exp = async (format) => {
    const fig = build();
    const pxW = Math.round(Number(w.value) / 2.54 * 96), pxH = Math.round(Number(hh.value) / 2.54 * 96);
    // exports always use a white background and dark ink so figures print well
    fig.layout = { ...fig.layout, paper_bgcolor: '#FFFFFF', plot_bgcolor: '#FFFFFF', font: { ...fig.layout.font, color: '#13293D' } };
    const tmp = h('div', { style: { position: 'fixed', left: '-10000px', width: `${pxW}px`, height: `${pxH}px` } });
    document.body.append(tmp);
    await globalThis.Plotly.newPlot(tmp, fig.data, { ...fig.layout, width: pxW, height: pxH }, { staticPlot: true });
    await globalThis.Plotly.downloadImage(tmp, { format, width: pxW, height: pxH, scale: format === 'png' ? Number(dpi.value) / 96 : 1, filename: name });
    globalThis.Plotly.purge(tmp); tmp.remove();
  };
  const tools = h('div', { class: 'plot-tools' },
    h('label', { class: 'field' }, 'Width (cm)', w), h('label', { class: 'field' }, 'Height (cm)', hh), h('label', { class: 'field' }, 'PNG resolution', dpi),
    h('div', { class: 'btn-group' }, h('button', { class: 'btn quiet', type: 'button', onclick: () => exp('png') }, 'Download PNG'), h('button', { class: 'btn quiet', type: 'button', onclick: () => exp('svg') }, 'Download SVG')));
  const wrap = h('div', {}, div, tools);
  const redraw = () => draw(div, build());
  const tryDraw = () => (globalThis.Plotly ? requestAnimationFrame(redraw) : setTimeout(tryDraw, 100));
  tryDraw();
  wrap.redraw = redraw;
  return wrap;
}

/** PNG data URL of a figure (for the report). */
export async function figureDataURL(fig, width = 900, height = 520) {
  const tmp = h('div', { style: { position: 'fixed', left: '-10000px', width: `${width}px`, height: `${height}px` } });
  document.body.append(tmp);
  const layout = { ...fig.layout, width, height, paper_bgcolor: '#FFFFFF', plot_bgcolor: '#FFFFFF', font: { ...fig.layout.font, color: '#13293D' } };
  await globalThis.Plotly.newPlot(tmp, fig.data, layout, { staticPlot: true });
  const url = await globalThis.Plotly.toImage(tmp, { format: 'png', width, height, scale: 2 });
  globalThis.Plotly.purge(tmp); tmp.remove();
  return url;
}
