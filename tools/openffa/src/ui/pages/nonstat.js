// pages/nonstat.js - GEV with a linear trend in location (and optionally log-scale).
import { h, field, helpButton, toast, fmt, fmtP, table } from '../dom.js';
import { plotBlock } from '../../plot/render.js';
import { nonstationaryPlot } from '../../plot/plots.js';
import { parseNumber } from '../../io/parse.js';

export function render(host, ctx) {
  const { state } = ctx;
  host.append(h('h2', { id: 'h-nonstat' }, 'Non-stationary GEV', helpButton('nonstat')));
  const s = state.data?.series;
  if (!s?.values?.length) { host.append(h('p', {}, 'Enter an annual maximum series in step 1 first.')); return; }
  const N = (state.nonstat.settings ??= { model: 'loc', covariate: 'year' });
  // covariate choices: year, or another numeric column of an annual table
  const d = state.data, choices = [['year', 'Year']];
  if (d.map.kind === 'annual') for (let j = 0; j < d.ncol; j++) if (j !== d.map.value && j !== d.map.year) choices.push([`col${j}`, d.table.header?.[j] ?? `Column ${j + 1}`]);
  const cov = h('select', {}, choices.map(([k, l]) => h('option', { value: k, selected: N.covariate === k }, l)));
  const model = h('select', {}, h('option', { value: 'loc', selected: N.model === 'loc' }, 'Location changes linearly'), h('option', { value: 'locscale', selected: N.model === 'locscale' }, 'Location and log-scale change linearly'));
  const box = h('div', {});
  const covValues = () => {
    if (N.covariate === 'year') return s.years ?? s.values.map((_, i) => i + 1);
    const j = Number(N.covariate.slice(3));
    return d.table.rows.filter((r) => Number.isFinite(parseNumber(r[d.map.value]))).map((r) => parseNumber(r[j]));
  };
  const run = async () => {
    N.covariate = cov.value; N.model = model.value;
    const c = covValues();
    if (c.length !== s.values.length || c.some((v) => !Number.isFinite(v))) return toast('The covariate has missing values for some years.');
    try { state.nonstat.result = await ctx.callWorker('nonstationary', [s.values, c, { model: N.model }], box); state.nonstat.cov = c; ctx.render(); }
    catch (e) { if (e.message !== 'Cancelled') toast(e.message, 6000); }
  };
  host.append(h('div', { class: 'sheet' }, h('div', { class: 'row' }, field('Covariate', cov), field('Model', model), h('button', { class: 'btn', type: 'button', onclick: run }, 'Fit')), box));
  const r = state.nonstat.result;
  if (!r) return;
  if (!r.ok) { host.append(h('p', { class: 'note' }, r.reason)); return; }
  const units = d.units;
  const coefRows = r.names.map((nm, i) => [nm, fmt(r.coef[i], 5), r.se ? fmt(r.se[i], 3) : '–']);
  const sig = r.lrTest.p < 0.05;
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Result'),
    h('div', { class: `finding ${sig ? 'warn' : 'ok'}` }, h('span', { class: 'sym' }, sig ? '!' : '✓'),
      h('div', {}, `Likelihood-ratio test against the stationary GEV: D = ${fmt(r.lrTest.D, 4)}, df = ${r.lrTest.df}, p = ${fmtP(r.lrTest.p)}. ${sig ? 'The trend is supported by the data; stationary design floods may be biased.' : 'No evidence that the non-stationary model is better.'} AIC: ${fmt(r.aic, 5)} (non-stationary) vs ${fmt(r.stationary.aic, 5)} (stationary).`)),
    table(['Coefficient', 'Estimate', 'Standard error'], coefRows, { classes: ['l', '', ''] }),
    h('p', { class: 'small muted' }, `The covariate is centred at its mean (${fmt(r.covariateMean, 6)}). Shape k uses the Hosking sign (ξ = −k).`)));
  host.append(h('div', { class: 'sheet' }, plotBlock(() => nonstationaryPlot(s.values, state.nonstat.cov, r, [10, 50, 100], units), { name: 'nonstationary_gev' }),
    h('p', { class: 'note' }, 'An "effective" return level is the level with the stated annual exceedance probability in a year with that covariate value. Extrapolating a trend beyond the observed covariate range is a modelling assumption, not a finding.')));
}
