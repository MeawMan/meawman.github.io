// pages/pot.js - peaks over threshold with a generalised Pareto distribution.
import { h, field, helpButton, toast, fmt, table } from '../dom.js';
import { plotBlock } from '../../plot/render.js';
import { mrlPlot, stabilityPlot } from '../../plot/plots.js';
import { potReturnLevel, langbeinAnnualT } from '../../core/series.js';
import { quantileSorted } from '../../core/stats.js';

export function render(host, ctx) {
  const { state } = ctx;
  host.append(h('h2', { id: 'h-pot' }, 'Peaks over threshold', helpButton('pot')));
  const recs = state.data?.daily?.records;
  if (!recs?.length) { host.append(h('p', {}, 'Peaks over threshold needs a daily (or sub-daily) record. Load one in step 1 and choose "Daily or sub-daily series".')); return; }
  const P = (state.pot.settings ??= {});
  const vals = recs.map((r) => r.value).filter(Number.isFinite).sort((a, b) => a - b);
  P.threshold ??= Number(quantileSorted(Float64Array.from(vals), 0.99).toPrecision(3));
  P.minSep ??= 7; P.drop ??= 0.667; P.method ??= 'mle'; P.T ??= [2, 5, 10, 25, 50, 100];
  const units = state.data.units;
  const u = h('input', { type: 'number', value: String(P.threshold), step: 'any' });
  const sep = h('input', { type: 'number', value: String(P.minSep), min: '1', step: '1' });
  const drop = h('input', { type: 'number', value: String(P.drop), min: '0.1', max: '1', step: '0.05' });
  const meth = h('select', {}, h('option', { value: 'mle', selected: P.method === 'mle' }, 'Maximum likelihood'), h('option', { value: 'lmom', selected: P.method === 'lmom' }, 'L-moments'));
  const box = h('div', {});
  const serial = () => recs.map((r) => [r.date.getTime(), r.value]);
  const read = () => { P.threshold = Number(u.value); P.minSep = Number(sep.value); P.drop = Number(drop.value); P.method = meth.value; };
  const diag = async () => {
    read();
    const lo = quantileSorted(Float64Array.from(vals), 0.9), hi = quantileSorted(Float64Array.from(vals), 0.999);
    const th = Array.from({ length: 30 }, (_, i) => lo + (hi - lo) * i / 29);
    try {
      // diagnostics use declustered peaks above the lowest threshold
      const base = await ctx.callWorker('potFit', [serial(), lo, { minSeparationDays: P.minSep, minDropFraction: P.drop }, P.method], box);
      state.pot.diag = await ctx.callWorker('potDiagnostics', [base.pot.values, th, P.method], box);
      ctx.render();
    } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 6000); }
  };
  const fit = async () => {
    read();
    try {
      const r = await ctx.callWorker('potFit', [serial(), P.threshold, { minSeparationDays: P.minSep, minDropFraction: P.drop }, P.method], box);
      state.pot.result = r;
      if (r.fit.ok) {
        const Fs = P.T.map((T) => 1 - 1 / (r.pot.lambda * T)).filter((F) => F > 0);
        state.pot.ci = await ctx.callWorker('potBootstrap', [r.pot.values, { ...r.fit, distId: 'GPA', method: P.method }, Fs, { nBoot: 500, seed: state.settings.seed, level: state.settings.ciLevel, fitOpts: { loc: P.threshold } }], box);
      }
      ctx.render();
    } catch (e) { if (e.message !== 'Cancelled') toast(e.message, 6000); }
  };
  host.append(h('div', { class: 'sheet' },
    h('div', { class: 'row' }, field(`Threshold (${units})`, u, 'Default: 99th percentile of daily values'), field('Minimum days between peaks', sep), field('Inter-event drop (fraction of smaller peak)', drop), field('Method', meth)),
    h('div', { class: 'btn-group', style: { marginTop: '.75rem' } }, h('button', { class: 'btn secondary', type: 'button', onclick: diag }, 'Threshold diagnostics'), h('button', { class: 'btn', type: 'button', onclick: fit }, 'Fit GPA')), box));
  if (state.pot.diag) host.append(h('div', { class: 'cols-2' },
    h('div', { class: 'sheet' }, plotBlock(() => mrlPlot(state.pot.diag.mrl, units), { name: 'mean_residual_life', small: true })),
    h('div', { class: 'sheet' }, plotBlock(() => stabilityPlot(state.pot.diag.stability, units), { name: 'parameter_stability', small: true }))));
  const r = state.pot.result;
  if (r) {
    const { pot, fit: f } = r;
    const info = `${pot.values.length} independent peaks above ${fmt(pot.threshold)} ${units} in ${fmt(pot.nYears, 3)} years: λ = ${fmt(pot.lambda, 3)} events per year.`;
    if (!f.ok) { host.append(h('div', { class: 'sheet' }, h('p', {}, info), h('p', { class: 'note' }, `GPA not fitted: ${f.reason}`))); return; }
    let j = 0;
    const rows = P.T.map((T) => {
      const q = potReturnLevel(f.params, pot.lambda, T);
      const ci = state.pot.ci && pot.lambda * T > 1 ? state.pot.ci.intervals[j++] : null;
      return [fmt(T), fmt(langbeinAnnualT(T), 4), fmt(q, 4), ci ? fmt(ci.lo, 4) : '–', ci ? fmt(ci.hi, 4) : '–'];
    });
    host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Generalised Pareto fit'), h('p', { class: 'small' }, info),
      h('p', { class: 'small muted' }, `Scale α = ${fmt(f.params[1], 5)}, shape k = ${fmt(f.params[2], 4)} (Hosking sign; ξ = −k), location fixed at the threshold.`),
      f.warnings?.length ? h('ul', { class: 'warnlist' }, f.warnings.map((w) => h('li', {}, w))) : null,
      table(['Return period (yr, partial-duration)', 'Equivalent annual-maximum T (Langbein)', `Return level (${units})`, `Lower ${Math.round(state.settings.ciLevel * 100)} %`, 'Upper'], rows),
      h('p', { class: 'note' }, 'Return periods here are average intervals between exceedances. For T ≥ 10 years they are practically equal to annual-maximum return periods (Langbein 1949). The bootstrap resamples the exceedances with λ held fixed.')));
  }
}
