// pages/report.js - step 5: exports and the methods-and-results report.
import { h, toast, download } from '../dom.js';
import { toCSV, quantileRows, fitRows, dataRows, workbook, reportHTML, methodsText } from '../../io/export.js';
import { figureDataURL } from '../../plot/render.js';
import { frequencyPlot, lmrdPlot, seriesPlot, qqPlot } from '../../plot/plots.js';
import { projectJSON } from '../app.js';

export function render(host, ctx) {
  const { state } = ctx, res = state.results;
  host.append(h('h2', { id: 'h-report' }, 'Report and exports'));
  if (!res?.fits) { host.append(h('p', {}, 'Fit distributions first.')); return; }
  const base = (state.data.site || state.data.name || 'openffa').replace(/[^\w.-]+/g, '_');
  const makeReport = async () => {
    try {
      const u = state.data.units, s = state.data.series;
      const figs = {
        freq: await figureDataURL(frequencyPlot(res, { paper: state.plot.paper, logY: state.plot.logY, fits: [...new Set([state.selected, ...(state.plot.compare ?? [])])].filter((i) => res.fits[i]?.ok), ciFor: state.selected, units: u })),
        lmrd: await figureDataURL(lmrdPlot(res), 700, 520),
        series: await figureDataURL(seriesPlot(s.values, s.years, res.diagnostics, u), 900, 380),
        qq: await figureDataURL(qqPlot(res, state.selected, u), 600, 480),
      };
      const html = reportHTML(state, figs);
      state.reportMade = true;
      return html;
    } catch (e) { toast(`Report failed: ${e.message}`, 6000); throw e; }
  };
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Methods and results report'),
    h('p', { class: 'small' }, 'A self-contained HTML page with the methods paragraph, data checks, fit comparison, design floods, figures, references and every setting. Open it and print to PDF from the browser.'),
    h('div', { class: 'btn-group' },
      h('button', { class: 'btn', type: 'button', onclick: async () => { const html = await makeReport(); const w = window.open('', '_blank'); if (w) { w.document.write(html); w.document.close(); } else download(`${base}_report.html`, html, 'text/html'); ctx.render(); } }, 'Open report'),
      h('button', { class: 'btn secondary', type: 'button', onclick: async () => { download(`${base}_report.html`, await makeReport(), 'text/html'); ctx.render(); } }, 'Download report (HTML)'))));
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Tables and project'),
    h('div', { class: 'btn-group' },
      h('button', { class: 'btn quiet', type: 'button', onclick: () => download(`${base}_quantiles.csv`, toCSV(quantileRows(res)), 'text/csv') }, 'Design floods (CSV)'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => download(`${base}_fits.csv`, toCSV(fitRows(res)), 'text/csv') }, 'Fit comparison (CSV)'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => download(`${base}_data.csv`, toCSV(dataRows(state)), 'text/csv') }, 'Annual maxima (CSV)'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => { if (!globalThis.XLSX) return toast('Spreadsheet library not loaded.'); download(`${base}.xlsx`, new Blob([workbook(state)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); } }, 'Everything (Excel workbook)'),
      h('button', { class: 'btn quiet', type: 'button', onclick: () => download(`${base}.openffa.json`, JSON.stringify(projectJSON(), null, 1), 'application/json') }, 'Project file (JSON)'))));
  const m = methodsText(state);
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Methods paragraph (preview)'), h('div', { html: m.html })));
}
