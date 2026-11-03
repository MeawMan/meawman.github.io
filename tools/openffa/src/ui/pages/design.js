// pages/design.js - step 4: quantiles (design floods), confidence intervals and diagnostic plots.
import { h, field, helpButton, toast, fmt, table } from '../dom.js';
import { CI_METHODS } from '../../core/uncertainty.js';
import { CI_CORRECTIONS } from '../../core/bootci.js';
import { plotBlock } from '../../plot/render.js';
import { frequencyPlot, qqPlot, ppPlot, pdfPlot, cdfPlot, PAPERS, fitLabel } from '../../plot/plots.js';

export function render(host, ctx) {
  const { state } = ctx, st = state.settings, res = state.results;
  host.append(h('h2', { id: 'h-design' }, 'Design floods and their uncertainty'));
  if (!res?.fits) { host.append(h('p', {}, 'Fit distributions in step 3 first.'), h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('fit') }, 'Go to fitting')); return; }
  const ok = res.fits.map((f, i) => [f, i]).filter(([f]) => f.ok);
  if (state.selected === null || !res.fits[state.selected]?.ok) state.selected = res.ranking.order[0] ?? ok[0]?.[1] ?? null;
  const fit = res.fits[state.selected];
  const units = state.data.units;

  // ---------------- settings
  const rp = h('input', { type: 'text', value: st.returnPeriods.join(', '), style: { minWidth: '18rem' } });
  const ciM = h('select', {}, h('option', { value: 'none', selected: st.ciMethod === 'none' }, 'No interval'), Object.entries(CI_METHODS).map(([k, v]) => h('option', { value: k, selected: st.ciMethod === k }, v)));
  const lvl = h('select', {}, [0.8, 0.9, 0.95, 0.99].map((l) => h('option', { value: String(l), selected: st.ciLevel === l }, `${Math.round(l * 100)} %`)));
  const nb = h('input', { type: 'number', min: '100', max: '20000', step: '100', value: String(st.nBoot) });
  st.ciCorrection ??= 'percentile';
  const corr = h('select', {}, Object.entries(CI_CORRECTIONS).map(([k, v]) => h('option', { value: k, selected: st.ciCorrection === k }, v)));
  const runBox = h('div', {});
  const recompute = async () => {
    const T = rp.value.split(/[,;\s]+/).map(Number).filter((v) => v > 1);
    if (!T.length) return toast('Enter return periods greater than 1 year.');
    st.returnPeriods = [...new Set(T)].sort((a, b) => a - b); st.ciMethod = ciM.value; st.ciLevel = Number(lvl.value); st.nBoot = Number(nb.value); st.ciCorrection = corr.value;
    try { await ctx.runFullAnalysis(runBox); ctx.render(); } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 6000); }
  };
  const fitSel = h('select', { onchange: (e) => { state.selected = Number(e.target.value); ctx.render(); } }, ok.map(([f, i]) => h('option', { value: String(i), selected: i === state.selected }, fitLabel(f))));
  host.append(h('div', { class: 'sheet' },
    h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Selected fit', fitSel)), field('Return periods (years)', rp, 'Comma separated')),
    h('div', { class: 'row', style: { marginTop: '.75rem' } }, field('Confidence interval', ciM, null, 'ci'), field('Level', lvl), field('Bootstrap replicates', nb), h('span', { class: 'expert' }, field('Bootstrap limits', corr)),
      h('button', { class: 'btn secondary', type: 'button', onclick: recompute }, 'Recalculate')), runBox));

  // ---------------- quantile table for the selected fit
  const lvlTxt = `${Math.round((fit.ci?.level ?? st.ciLevel) * 100)} %`;
  const rows = fit.quantiles.map((q) => [fmt(q.T), `${fmt(100 / q.T, 3)} %`, fmt(q.q, 4), fmt(q.lo, 4), fmt(q.hi, 4), h('span', { class: 'expert' }, fmt(q.se, 3)), q.T > 2 * res.input.n ? 'extrapolation' : '']);
  host.append(h('div', { class: 'sheet' }, h('h3', {}, `${fitLabel(fit)}`),
    h('p', { class: 'small muted' }, `Parameters: ${fit.params.map((v, k) => `${fit.paramNames[k]} = ${fmt(v, 5)}`).join(', ')}${fit.distId === 'LP3' ? ' (log10 space)' : ''}${['GEV', 'GLO', 'GPA'].includes(fit.distId) ? '. Shape k uses the Hosking sign (k > 0: bounded upper tail); ξ in Coles/extRemes = −k.' : '.'}`),
    table(['Return period (yr)', 'AEP', `Design flood (${units})`, `Lower ${lvlTxt}`, `Upper ${lvlTxt}`, 'SE', ''], rows, { classes: ['', '', '', '', '', '', 'l'] }),
    fit.ci?.error ? h('p', { class: 'note' }, fit.ci.error) : null,
    fit.ci?.correction && fit.ci.correction !== 'percentile' ? h('p', { class: 'small muted' }, `Interval limits: ${fit.ci.correction === 'bca' ? 'bias-corrected and accelerated (BCa)' : 'bias-corrected (BC)'} bootstrap.`) : null,
    fit.ci?.note ? h('p', { class: 'note' }, fit.ci.note) : null,
    fit.ci?.failed ? h('p', { class: 'note' }, `${fit.ci.failed} of ${fit.ci.nBoot} bootstrap refits failed and were left out.`) : null,
    h('p', { class: 'note' }, `Return periods beyond about twice the record length (${2 * res.input.n} years) are extrapolations: the result depends mainly on the assumed distribution, which the data cannot confirm.`)));

  // ---------------- frequency plot
  state.plot.compare ??= res.ranking.order.slice(0, 3);
  const paperSel = h('select', { onchange: (e) => { state.plot.paper = e.target.value; ctx.render(); } }, Object.entries(PAPERS).map(([k, p]) => h('option', { value: k, selected: state.plot.paper === k }, p.label)));
  const logY = h('input', { type: 'checkbox', checked: state.plot.logY, onchange: (e) => { state.plot.logY = e.target.checked; ctx.render(); } });
  const cmp = h('div', { class: 'row' }, ok.map(([f, i]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: state.plot.compare.includes(i) || i === state.selected,
    onchange: (e) => { state.plot.compare = e.target.checked ? [...state.plot.compare, i] : state.plot.compare.filter((j) => j !== i); ctx.render(); } }), f.distId + (f.method !== 'lmom' ? ` (${f.method})` : ''))));
  const shown = [...new Set([state.selected, ...state.plot.compare])].filter((i) => res.fits[i]?.ok);
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Frequency curve', helpButton('paper')),
    h('div', { class: 'row' }, field('Probability paper', paperSel), h('label', { class: 'check' }, logY, 'Logarithmic discharge axis')),
    h('div', { style: { margin: '.5rem 0' } }, h('span', { class: 'small muted' }, 'Show also: '), cmp),
    plotBlock(() => frequencyPlot(res, { paper: state.plot.paper, logY: state.plot.logY, fits: shown, ciFor: state.selected, units }), { name: `frequency_${fit.distId}_${fit.method}` })));

  // ---------------- comparison of design floods across fits
  const T = st.returnPeriods;
  const cmpRows = T.map((t, k) => [fmt(t), ...shown.map((i) => fmt(res.fits[i].quantiles[k]?.q, 4))]);
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'The same design floods from the other fits shown'),
    table(['T (yr)', ...shown.map((i) => fitLabel(res.fits[i]))], cmpRows),
    h('p', { class: 'note' }, 'The spread between distributions at long return periods is model uncertainty, which the confidence interval does not include. Report it.')));

  // ---------------- diagnostics
  host.append(h('div', { class: 'cols-2' },
    h('div', { class: 'sheet' }, plotBlock(() => qqPlot(res, state.selected, units), { name: 'qq_plot', small: true })),
    h('div', { class: 'sheet' }, plotBlock(() => ppPlot(res, state.selected), { name: 'pp_plot', small: true })),
    h('div', { class: 'sheet' }, plotBlock(() => pdfPlot(res, shown, units), { name: 'pdf_histogram', small: true })),
    h('div', { class: 'sheet' }, plotBlock(() => cdfPlot(res, shown, units), { name: 'cdf', small: true }))));
  host.append(h('div', { class: 'btn-group' }, h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('report') }, 'Make the report')));
}
