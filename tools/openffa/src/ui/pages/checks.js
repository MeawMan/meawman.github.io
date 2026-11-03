// pages/checks.js - step 2: data diagnostics before fitting.
import { h, field, helpButton, toast, fmt, fmtP, table } from '../dom.js';
import { plotBlock } from '../../plot/render.js';
import { seriesPlot } from '../../plot/plots.js';

const SYM = { ok: '✓', warn: '!', bad: '✕' };

export function render(host, ctx) {
  const { state } = ctx;
  host.append(h('h2', { id: 'h-checks' }, 'Is the record fit for frequency analysis?'),
    h('p', { class: 'muted' }, 'Stationary flood frequency analysis assumes the annual maxima are independent and come from one unchanging distribution. These checks look for evidence against that.'));
  if (!state.data?.series) { host.append(h('p', {}, 'Enter a record in step 1 first.')); return; }
  const diag = state.results?.diagnostics;
  if (!diag) {
    const box = h('div', {});
    host.append(box);
    ctx.runDiagnostics(box).then(() => ctx.render()).catch((e) => { if (e.message !== 'Cancelled') toast(e.message, 6000); });
    return;
  }
  const s = state.data.series;
  host.append(h('div', { class: 'verdict' }, diag.recommendation));
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Findings'),
    diag.findings.map((f) => h('div', { class: `finding ${f.level}` }, h('span', { class: 'sym', 'aria-label': f.level }, SYM[f.level]), h('div', {}, f.text)))));
  host.append(h('div', { class: 'sheet' }, plotBlock(() => seriesPlot(s.values, s.years, diag, state.data.units), { name: 'series_trend' })));

  // test details
  const t = diag.tests, rows = [];
  if (t.mannKendall) rows.push(['Mann-Kendall (Hamed-Rao where autocorrelated)', fmt(t.mannKendall.Z, 3), fmtP(t.mannKendall.p), `Kendall τ = ${fmt(t.mannKendall.tau, 3)}, Sen slope = ${fmt(t.mannKendall.slope, 3)}`]);
  if (t.pettitt) rows.push(['Pettitt change point', `K = ${t.pettitt.K}`, fmtP(t.pettitt.p), t.pettitt.year != null ? `most likely after ${t.pettitt.year}` : '']);
  if (t.lag1) rows.push(['Lag-1 autocorrelation', fmt(t.lag1.r1, 3), '–', `95 % limits ${fmt(t.lag1.lo, 3)} to ${fmt(t.lag1.hi, 3)}`]);
  if (t.waldWolfowitz) rows.push(['Wald-Wolfowitz independence', fmt(t.waldWolfowitz.Z, 3), fmtP(t.waldWolfowitz.p), '']);
  if (t.mannWhitney) rows.push(['Mann-Whitney (first vs second half)', fmt(t.mannWhitney.Z, 3), fmtP(t.mannWhitney.p), '']);
  if (t.grubbsBeck) rows.push(['Grubbs-Beck (Bulletin 17B, 10 %)', `K = ${fmt(t.grubbsBeck.K, 3)}`, '–', `low < ${fmt(t.grubbsBeck.lowThreshold)}, high > ${fmt(t.grubbsBeck.highThreshold)}`]);
  if (t.mgbt) rows.push(['Multiple Grubbs-Beck (Bulletin 17C)', `${t.mgbt.klow} PILF(s)`, '–', t.mgbt.klow ? `threshold ${fmt(t.mgbt.threshold)}` : 'none']);
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Test results', helpButton('mk')),
    table(['Test', 'Statistic', 'p-value', 'Detail'], rows, { classes: ['l', '', '', 'l'] }),
    h('p', { class: 'note' }, 'A p-value below 0.05 is evidence against the assumption; above 0.05 is absence of evidence, not proof. With short records these tests have little power.')));

  // low outliers
  const st = state.settings;
  const mg = t.mgbt;
  const thr = h('input', { type: 'number', min: '0', value: st.pilfThreshold ?? '', placeholder: mg?.klow ? String(mg.threshold) : 'none' });
  const cens = h('input', { type: 'checkbox', checked: !!st.censorPILFs });
  cens.addEventListener('change', () => { st.censorPILFs = cens.checked; keepDiag(ctx); toast(cens.checked ? 'Low outliers will be censored in ML and EMA fits.' : 'Low outliers will not be censored.'); });
  thr.addEventListener('change', () => { st.pilfThreshold = Number(thr.value) > 0 ? Number(thr.value) : null; keepDiag(ctx); });
  const pv = mg?.pvalues?.length ? h('details', { class: 'expert' }, h('summary', {}, 'MGBT p-values for the smallest values'),
    h('div', { class: 'scroll-y' }, table(['k', 'value', 'ω', 'p-value'], mg.pvalues.map((p, i) => [String(i + 1), fmt(mg.x[i]), fmt(mg.omegas[i], 4), p < 1e-4 ? p.toExponential(2) : p.toFixed(4)])))) : null;
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'Low outliers', helpButton('pilf')),
    h('p', { class: 'small' }, mg ? (mg.klow ? `The Multiple Grubbs-Beck test identifies ${mg.klow} potentially influential low flood(s) below ${fmt(mg.threshold)} ${state.data.units}.` : 'The Multiple Grubbs-Beck test finds no potentially influential low floods.') : 'Not enough positive values for the low-outlier test.'),
    h('div', { class: 'row' }, h('label', { class: 'check' }, cens, 'Censor low outliers in ML and EMA fits (Bulletin 17C)'),
      h('div', { class: 'expert' }, field('Manual PILF threshold (overrides the test)', thr, 'Leave empty to use the test'))),
    pv,
    h('div', { class: 'btn-group', style: { marginTop: '1rem' } }, h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('fit') }, 'Fit distributions'))));
}
function keepDiag(ctx) { const r = ctx.state.results; if (r) ctx.state.results = { diagnostics: r.diagnostics, lmoments: r.lmoments, lmomentsLog: r.lmomentsLog, diagOnly: true }; }
