// pages/fit.js - step 3: choose distributions and estimation methods, fit, compare.
import { h, field, helpButton, toast, fmt, fmtP } from '../dom.js';
import { DISTRIBUTIONS, DIST_ORDER } from '../../core/distributions.js';
import { AVAILABLE_METHODS, METHOD_LABELS } from '../../core/fit.js';
import { RANK_CRITERIA, rankFits } from '../../core/analysis.js';
import { PLOTTING_POSITIONS } from '../../core/plotpos.js';
import { plotBlock } from '../../plot/render.js';
import { frequencyPlot, lmrdPlot, SERIES } from '../../plot/plots.js';

const METHODS = ['lmom', 'mle', 'mom', 'pwm', 'ema', 'gumbel58'];
const MLABEL = { ...METHOD_LABELS, ema: 'EMA (Bulletin 17C)' };
const avail = (d, m) => (m === 'ema' ? d === 'LP3' : AVAILABLE_METHODS[d].includes(m));

export const PRESETS = {
  recommended: { label: 'Recommended comparison', fits: () => [['GEV', 'lmom'], ['GLO', 'lmom'], ['PE3', 'lmom'], ['LP3', 'ema'], ['GUM', 'lmom'], ['LN3', 'lmom'], ['LN2', 'mle'], ['GEV', 'mle']] },
  b17c: { label: 'Bulletin 17C (LP3 by EMA)', fits: () => [['LP3', 'ema']] },
  lmomAll: { label: 'All distributions by L-moments', fits: () => DIST_ORDER.filter((d) => avail(d, 'lmom') && d !== 'GPA').map((d) => [d, 'lmom']) },
  mleAll: { label: 'All distributions by maximum likelihood', fits: () => DIST_ORDER.filter((d) => d !== 'GPA').map((d) => [d, 'mle']) },
};

export function render(host, ctx) {
  const { state } = ctx, st = state.settings;
  host.append(h('h2', { id: 'h-fit' }, 'Fit and compare distributions'));
  if (!state.data?.series) { host.append(h('p', {}, 'Enter a record in step 1 first.')); return; }

  // ---------------- selection
  const chosen = new Set(st.fits.map((f) => `${f.distId}|${f.method}`));
  const sel = h('div', { class: 'sheet' }, h('h3', {}, 'Distributions and methods', helpButton('dist'), helpButton('methods')));
  const presetBtns = h('div', { class: 'btn-group' }, Object.entries(PRESETS).map(([k, p]) => h('button', { class: 'btn quiet', type: 'button', onclick: () => {
    st.fits = p.fits().map(([distId, method]) => ({ distId, method })); ctx.render(); } }, p.label)));
  sel.append(h('p', { class: 'small muted' }, 'Start from a preset, then add or remove combinations. Every combination is fitted to the same data.'), presetBtns);
  const head = h('tr', {}, h('th', { class: 'l' }, 'Distribution'), METHODS.map((m) => h('th', {}, m === 'gumbel58' ? "Gumbel's method" : MLABEL[m].replace(' (plotting-position)', ''))));
  const body = DIST_ORDER.map((d) => h('tr', {}, h('td', { class: 'l' }, DISTRIBUTIONS[d].name),
    METHODS.map((m) => h('td', {}, avail(d, m) ? h('input', { type: 'checkbox', checked: chosen.has(`${d}|${m}`), 'aria-label': `${DISTRIBUTIONS[d].name}, ${MLABEL[m]}`,
      onchange: (e) => { const key = `${d}|${m}`; if (e.target.checked) st.fits.push({ distId: d, method: m }); else st.fits = st.fits.filter((f) => `${f.distId}|${f.method}` !== key); } }) : ''))));
  sel.append(h('div', { class: 'table-wrap', style: { marginTop: '.75rem' } }, h('table', { class: 'matrix' }, h('thead', {}, head), h('tbody', {}, body))));
  sel.append(h('p', { class: 'small muted' }, 'GPA (generalised Pareto) is meant for peaks over threshold; use the Peaks over threshold page. EMA and maximum likelihood use historic and censored information; the other methods use the systematic record only.'));

  // ---------------- options
  const ppSel = h('select', { onchange: (e) => { st.plottingPosition = e.target.value; } }, Object.entries(PLOTTING_POSITIONS).map(([k, v]) => h('option', { value: k, selected: st.plottingPosition === k }, `${v.label} (a = ${v.a})`)));
  const gofN = h('input', { type: 'number', min: '0', max: '5000', step: '50', value: String(st.gofBoot), onchange: (e) => { st.gofBoot = Number(e.target.value); } });
  const seed = h('input', { type: 'number', step: '1', value: String(st.seed), onchange: (e) => { st.seed = Number(e.target.value); } });
  const rs = st.regionalSkew ?? {};
  const rsv = h('input', { type: 'number', step: '0.01', value: rs.value ?? '', placeholder: 'none' });
  const rsm = h('input', { type: 'number', step: '0.001', min: '0', value: rs.mse ?? '', placeholder: 'MSE' });
  const saveRs = () => { st.regionalSkew = rsv.value !== '' && Number(rsm.value) > 0 ? { value: Number(rsv.value), mse: Number(rsm.value) } : null; };
  rsv.addEventListener('change', saveRs); rsm.addEventListener('change', saveRs);
  host.append(sel, h('div', { class: 'sheet expert' }, h('h3', {}, 'Options'),
    h('div', { class: 'row' }, field('Plotting position', ppSel, null, 'pp'), field('GOF bootstrap replicates', gofN, '0 = statistics only', 'gof'), field('Random seed', seed, 'Same seed, same result'),
      field('Regional skew (LP3)', rsv, null, 'regskew'), field('Regional skew MSE', rsm))));

  const runBox = h('div', {});
  host.append(runBox, h('div', { class: 'btn-group' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
    if (!st.fits.length) return toast('Choose at least one distribution.');
    try { await ctx.runFullAnalysis(runBox); toast(`Fitted ${state.results.fits.filter((f) => f.ok).length} of ${state.results.fits.length} combinations.`); ctx.render(); }
    catch (e) { if (e.message !== 'Cancelled') toast(`Fitting failed: ${e.message}`, 6000); }
  } }, state.results?.fits ? 'Fit again' : 'Fit selected distributions')));

  const res = state.results;
  if (!res?.fits) return;
  host.append(resultsTable(ctx, res));
  host.append(h('div', { class: 'cols-2' },
    h('div', { class: 'sheet' }, plotBlock(() => frequencyPlot(res, { paper: state.plot.paper, logY: state.plot.logY, ciFor: null, units: state.data.units, title: 'All fitted curves' }), { name: 'frequency_all_fits' })),
    h('div', { class: 'sheet' }, plotBlock(() => lmrdPlot(res), { name: 'lmoment_ratio_diagram' }),
      h('p', { class: 'small muted' }, 'A sample point close to a curve supports that distribution family. Sampling scatter is large for short records (Hosking & Wallis 1997, ch. 5).'))));
}

function resultsTable(ctx, res) {
  const { state } = ctx;
  const rankSel = h('select', { onchange: (e) => { state.settings.rankBy = e.target.value; res.ranking = rankFits(res.fits, e.target.value); ctx.render(); } },
    Object.entries(RANK_CRITERIA).map(([k, c]) => h('option', { value: k, selected: res.ranking.by === k }, c.label)));
  const order = [...res.ranking.order, ...res.fits.map((_, i) => i).filter((i) => !res.ranking.order.includes(i))];
  const best = res.ranking.values[0];
  const rows = order.map((i, r) => {
    const f = res.fits[i];
    const selected = state.selected === i;
    const pick = () => { state.selected = i; ctx.render(); };
    if (!f.ok) return h('tr', { class: 'fail' }, h('td', {}, '–'), h('td', { class: 'l' }, f.distId), h('td', { class: 'l' }, f.methodLabel), h('td', { class: 'l wrap', colspan: '7' }, `Not fitted: ${f.reason}`));
    const g = f.gof ?? {};
    const ic = res.ranking.by.startsWith('aic') || res.ranking.by === 'bic' ? res.ranking.values[res.ranking.order.indexOf(i)] - best : null;
    const params = f.params.map((v, k) => `${f.paramNames[k]} = ${fmt(v, 4)}`).join(', ');
    return h('tr', { class: `clickable${selected ? ' sel' : ''}`, tabindex: '0', 'aria-selected': String(selected), onclick: pick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } } },
      h('td', { title: r < res.ranking.order.length ? '' : 'Not ranked: its likelihood uses censored/historic data, so it is not comparable' }, r < res.ranking.order.length ? String(r + 1) : '–'),
      h('td', { class: 'l' }, h('span', { style: { display: 'inline-block', width: '.7rem', height: '.7rem', background: SERIES[i % SERIES.length], marginRight: '.4rem', borderRadius: '2px' } }), f.distId, f.experimental ? h('span', { class: 'badge exp', style: { marginLeft: '.4rem' } }, 'experimental') : null),
      h('td', { class: 'l' }, f.methodLabel),
      h('td', { class: 'l small wrap' }, params, f.warnings?.length ? h('ul', { class: 'warnlist' }, f.warnings.map((w) => h('li', {}, w))) : null),
      h('td', {}, fmt(f.aicc, 5)), h('td', {}, ic !== null && Number.isFinite(ic) ? fmt(ic, 3) : '–'), h('td', {}, fmt(f.bic, 5)),
      h('td', {}, fmt(g.stats?.ad, 3)), h('td', {}, fmtP(g.p?.ad)), h('td', {}, fmt(g.stats?.ppcc, 4)));
  });
  return h('div', { class: 'sheet' }, h('h3', {}, 'Comparison', helpButton('ic'), helpButton('gof')),
    h('div', { class: 'row' }, field('Rank by', rankSel)),
    h('div', { class: 'table-wrap', style: { marginTop: '.75rem' } }, h('table', {},
      h('thead', {}, h('tr', {}, ['Rank', 'Distribution', 'Method', 'Parameters and warnings', 'AICc', 'Δ', 'BIC', 'AD A²', 'AD p (bootstrap)', 'PPCC'].map((c, k) => h('th', { class: k > 0 && k < 4 ? 'l' : '', scope: 'col' }, c)))),
      h('tbody', {}, rows))),
    h('p', { class: 'note' }, res.ranking.caveat),
    h('p', { class: 'small guided-only' }, guidance(res)),
    h('div', { class: 'btn-group' }, h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('design') }, 'Design floods for the selected fit')));
}

function guidance(res) {
  const o = res.ranking.order;
  if (!o.length) return '';
  const close = o.filter((i, k) => res.ranking.values[k] - res.ranking.values[0] < 2).map((i) => res.fits[i].distId);
  return `Click a row to select a fit. ${res.fits[o[0]].distId} ranks first by ${res.ranking.label.split(' (')[0]}; ${close.length > 1 ? `${close.join(', ')} are within 2 units and practically indistinguishable, so compare their design floods on the next page before choosing.` : 'check the plots before accepting it.'} If guidance or a regional study prescribes a distribution (e.g. LP3 under Bulletin 17C), prefer it for consistency.`;
}
