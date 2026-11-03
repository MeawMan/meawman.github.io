// pages/data.js - step 1: get a record in, map its columns, extract annual maxima from daily data.
import { h, $, field, helpButton, toast, fmt, table } from '../dom.js';
import { parseText, parseXlsx, detectColumns, toSeries } from '../../io/parse.js';
import { annualMaxima } from '../../core/series.js';
import { plotBlock } from '../../plot/render.js';
import { seriesPlot } from '../../plot/plots.js';

export const SAMPLES = [
  { file: 'usgs_01134500_moose_river_peaks.csv', title: 'Moose River at Victory, Vermont (USGS 01134500)', desc: '68 annual peaks, 1947–2014. Bulletin 17C Example 1; regional skew 0.44 (MSE 0.078).', units: 'ft³/s', regionalSkew: { value: 0.44, mse: 0.078 } },
  { file: 'usgs_11274500_orestimba_creek_peaks.csv', title: 'Orestimba Creek near Newman, California (USGS 11274500)', desc: '82 annual peaks with 12 zero years. Bulletin 17C Example 2 (low outliers).', units: 'ft³/s', censorPILFs: true },
  { file: 'usgs_09480000_santa_cruz_river_peaks.csv', title: 'Santa Cruz River near Lochiel, Arizona (USGS 09480000)', desc: '65 annual peaks plus a 22-year historic period with no flood above 12,000 ft³/s. Bulletin 17C Example 6.', units: 'ft³/s', censorPILFs: true, historic: { years: 22, threshold: 12000, peaks: [] } },
  { file: 'synthetic_monsoon_river_daily.csv', title: 'Synthetic monsoon river, daily flows (not real data)', desc: '40 years of daily discharge imitating a Bangladeshi river, with a monsoon gauge outage in 1994. Use the April–March water year.', units: 'm³/s', waterYearStart: 4 },
  { file: 'usgs_01134500_moose_river_daily.csv', title: 'Moose River at Victory, daily mean flows (USGS)', desc: 'Daily mean discharge 1947–2014 for testing AMS extraction and peaks over threshold. Use an October water year.', units: 'ft³/s', waterYearStart: 10 },
  { file: 'coles_port_pirie_sea_level.csv', title: 'Port Pirie annual maximum sea level (Coles 2001)', desc: '65 years. Textbook GEV example: μ = 3.87, σ = 0.198, ξ = −0.050.', units: 'm' },
  { file: 'coles_fremantle_sea_level.csv', title: 'Fremantle annual maximum sea level (Coles 2001)', desc: 'Has a linear trend: use it with the non-stationary GEV.', units: 'm' },
];
const UNITS = ['m³/s', 'ft³/s', 'm', 'mm', ''];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let tab = 'paste';

export function render(host, ctx) {
  const { state } = ctx;
  host.append(h('h2', { id: 'h-data' }, 'Your flood record'),
    h('p', { class: 'muted' }, 'Paste or upload annual maximum floods (one per year), or daily flows from which the annual maxima will be extracted. Everything stays in this browser.', helpButton('ams')));

  // ---------------- input tabs
  const tabs = h('div', { role: 'tablist', 'aria-label': 'How to enter data' });
  const panel = h('div', { role: 'tabpanel' });
  const mk = (id, label) => h('button', { role: 'tab', type: 'button', 'aria-selected': String(tab === id), onclick: () => { tab = id; ctx.render(); } }, label);
  tabs.append(mk('paste', 'Paste'), mk('file', 'Upload a file'), mk('sample', 'Sample data'));
  if (tab === 'paste') {
    const ta = h('textarea', { 'aria-label': 'Data', placeholder: 'Year, peak\n1981, 6120\n1982, 4380\n…\n\nOr a single column of values, or date + daily flow.' });
    panel.append(ta, h('div', { class: 'btn-group', style: { marginTop: '.5rem' } },
      h('button', { class: 'btn', type: 'button', onclick: () => { if (!ta.value.trim()) return toast('Paste some data first.'); load(ctx, parseText(ta.value), 'pasted data'); } }, 'Read pasted data')));
  } else if (tab === 'file') {
    const inp = h('input', { type: 'file', accept: '.csv,.txt,.tsv,.dat,.xlsx,.xls', 'aria-label': 'Choose a file' });
    inp.addEventListener('change', async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const t = /\.xlsx?$/i.test(f.name) ? parseXlsx(await f.arrayBuffer()) : parseText(await f.text());
        load(ctx, t, f.name);
      } catch (e) { toast(`Could not read ${f.name}: ${e.message}`, 6000); }
    });
    panel.append(field('CSV, text or Excel file', inp, 'Header rows, delimiters (comma, tab, semicolon, space) and date formats are detected automatically. Lines starting with # are treated as comments.'));
  } else {
    panel.append(h('div', { class: 'cols-2' }, SAMPLES.map((s) => h('div', { class: 'sheet', style: { margin: 0 } },
      h('h3', { style: { fontSize: '1rem' } }, s.title), h('p', { class: 'small muted' }, s.desc),
      h('button', { class: 'btn secondary', type: 'button', onclick: () => loadSample(ctx, s) }, 'Use this record')))));
  }
  host.append(h('div', { class: 'sheet' }, tabs, panel));

  if (!state.data) return;
  const d = state.data;

  // ---------------- column mapping
  const map = d.map;
  const colOpts = (sel, allowNone) => [allowNone ? h('option', { value: '' }, '(none)') : null,
    ...Array.from({ length: d.ncol }, (_, j) => h('option', { value: String(j), selected: sel === j }, d.table.header?.[j] ? `${j + 1}: ${d.table.header[j]}` : `Column ${j + 1}`))];
  const kind = h('select', { onchange: (e) => { map.kind = e.target.value; apply(ctx); } },
    h('option', { value: 'annual', selected: map.kind === 'annual' }, 'Annual maxima (one value per year)'), h('option', { value: 'daily', selected: map.kind === 'daily' }, 'Daily or sub-daily series (dates + values)'));
  const valueSel = h('select', { onchange: (e) => { map.value = Number(e.target.value); apply(ctx); } }, colOpts(map.value));
  const yearSel = h('select', { onchange: (e) => { map.year = e.target.value === '' ? null : Number(e.target.value); apply(ctx); } }, colOpts(map.year, true));
  const dateSel = h('select', { onchange: (e) => { map.date = Number(e.target.value); apply(ctx); } }, colOpts(map.date));
  const order = h('select', { onchange: (e) => { map.dateOrder = e.target.value; apply(ctx); } },
    h('option', { value: 'dmy', selected: map.dateOrder === 'dmy' }, 'day/month/year'), h('option', { value: 'mdy', selected: map.dateOrder === 'mdy' }, 'month/day/year'));
  const units = h('select', { onchange: (e) => { d.units = e.target.value; ctx.render(); } }, UNITS.map((u) => h('option', { value: u, selected: d.units === u }, u || '(none)')));
  const site = h('input', { type: 'text', value: d.site ?? '', placeholder: 'e.g. Bahadurabad, Jamuna', onchange: (e) => { d.site = e.target.value; ctx.render(); } });
  host.append(h('div', { class: 'sheet' }, h('h3', {}, 'What the columns mean'),
    d.comments?.length ? h('p', { class: 'small muted' }, d.comments.join(' ')) : null,
    h('div', { class: 'row' }, field('Type of record', kind), map.kind === 'annual' ? field('Year column', yearSel) : field('Date column', dateSel),
      map.kind === 'daily' ? field('Date order (for 07/09/1998-style dates)', order) : null,
      field('Value column', valueSel), field('Units', units, null, 'units'), h('div', { class: 'grow' }, field('Site name (for the report)', site))),
    previewTable(d)));

  // ---------------- daily -> annual maxima
  if (map.kind === 'daily' && d.daily) host.append(dailyBlock(ctx));

  // ---------------- extra information
  host.append(extraInfo(ctx));

  // ---------------- summary + plot
  const s = d.series;
  if (s?.values?.length) {
    const v = s.values, n = v.length;
    host.append(h('div', { class: 'sheet' }, h('h3', {}, `Annual maximum series: ${n} values`),
      d.problems?.length ? h('ul', { class: 'warnlist' }, d.problems.map((p) => h('li', {}, p)), d.nProblems > d.problems.length ? h('li', {}, `…and ${d.nProblems - d.problems.length} more`) : null) : null,
      h('p', { class: 'small' }, `Smallest ${fmt(Math.min(...v))}, largest ${fmt(Math.max(...v))}, mean ${fmt(v.reduce((a, b) => a + b, 0) / n)} ${d.units}.`,
        s.years ? ` Years ${Math.min(...s.years)}–${Math.max(...s.years)}.` : ' No years given (the trend tests will use the order of the values).'),
      plotBlock(() => seriesPlot(v, s.years, null, d.units), { name: 'annual_maximum_series', small: true }),
      h('div', { class: 'btn-group' }, h('button', { class: 'btn', type: 'button', onclick: () => ctx.go('checks') }, 'Check the data'))));
  }
}

function previewTable(d) {
  const rows = d.table.rows.slice(0, 6).map((r) => Array.from({ length: d.ncol }, (_, j) => String(r[j] ?? '')));
  const head = Array.from({ length: d.ncol }, (_, j) => d.table.header?.[j] ?? `Column ${j + 1}`);
  return h('div', {}, h('p', { class: 'small muted', style: { marginTop: '.75rem' } }, `First rows of ${d.table.rows.length} read from ${d.name}:`), table(head, rows, { classes: head.map(() => 'l') }));
}

function load(ctx, t, name, preset = {}) {
  if (!t.rows.length) return toast('No data rows were found.');
  const map = detectColumns(t);
  if (map.value === null) return toast('No numeric column was found. Check the delimiter or the file.');
  const ncol = Math.max(...t.rows.slice(0, 100).map((r) => r.length));
  ctx.state.data = { name, table: t, ncol, map, units: preset.units ?? 'm³/s', site: '', comments: t.comments, waterYearStart: preset.waterYearStart ?? 4, minCompleteness: 0.8, include: {} };
  const st = ctx.state.settings;
  st.historic = preset.historic ?? null; st.regionalSkew = preset.regionalSkew ?? null; st.censorPILFs = !!preset.censorPILFs; st.pilfThreshold = null;
  ctx.state.results = null; ctx.state.selected = null;
  apply(ctx);
  toast(`Read ${t.rows.length} rows from ${name}.`);
}
async function loadSample(ctx, s) {
  try {
    const r = await fetch(`data/${s.file}`);
    if (!r.ok) throw new Error(r.statusText);
    load(ctx, parseText(await r.text()), s.file, s);
    ctx.state.data.site = s.title.replace(/\s*\(.*$/, '');
    ctx.render();
  } catch (e) { toast(`Could not load the sample (${e.message}). Open the tool through a web server or GitHub Pages, not as a local file.`, 7000); }
}

/** Rebuild the series from the table and mapping. */
export function apply(ctx) {
  const d = ctx.state.data;
  const s = toSeries(d.table, d.map);
  d.problems = s.problems; d.nProblems = s.nProblems;
  if (d.map.kind === 'daily') {
    d.daily = { records: s.records ?? [] };
    extractAms(d);
  } else {
    d.daily = null; d.ams = null;
    d.series = s.values ? { values: s.values, years: s.years } : null;
  }
  ctx.state.results = null; ctx.state.selected = null;
  ctx.render();
}
function extractAms(d) {
  if (!d.daily?.records?.length) { d.series = null; return; }
  const a = annualMaxima(d.daily.records, { waterYearStartMonth: d.waterYearStart, minCompleteness: d.minCompleteness });
  d.ams = a;
  const use = a.years.filter((y) => Number.isFinite(y.max) && (d.include[y.year] ?? y.included));
  d.series = { values: use.map((y) => y.max), years: use.map((y) => y.year) };
}

function dailyBlock(ctx) {
  const d = ctx.state.data;
  const wy = h('select', { onchange: (e) => { d.waterYearStart = Number(e.target.value); d.include = {}; extractAms(d); ctx.render(); } },
    MONTHS.map((m, i) => h('option', { value: String(i + 1), selected: d.waterYearStart === i + 1 }, m)));
  const comp = h('input', { type: 'number', min: '0', max: '1', step: '0.05', value: String(d.minCompleteness), onchange: (e) => { d.minCompleteness = Number(e.target.value); d.include = {}; extractAms(d); ctx.render(); } });
  const a = d.ams;
  const rows = (a?.years ?? []).map((y) => {
    const inc = d.include[y.year] ?? y.included;
    const cb = h('input', { type: 'checkbox', checked: inc, 'aria-label': `Include ${y.year}`, onchange: (e) => { d.include[y.year] = e.target.checked; extractAms(d); ctx.state.results = null; ctx.render(); } });
    return [cb, String(y.year), y.date ? new Date(y.date).toISOString().slice(0, 10) : '–', fmt(y.max), `${Math.round(100 * y.completeness)}%`, y.flag || ''];
  });
  return h('div', { class: 'sheet' }, h('h3', {}, 'Annual maxima from the daily record'),
    h('div', { class: 'row' }, field('Water year starts in', wy, 'Labelled by the calendar year in which it starts', 'waterYear'), field('Minimum completeness', comp, 'Fraction of days with data', 'completeness')),
    h('p', { class: 'small muted' }, `${d.daily.records.length} daily records, ${d.daily.records.filter((r) => !Number.isFinite(r.value)).length} missing values. Daily-mean maxima are smaller than instantaneous peaks; say which you used in the report.`),
    h('div', { class: 'scroll-y' }, table(['Use', 'Water year', 'Date of maximum', 'Maximum', 'Days with data', 'Note'], rows, { classes: ['l', '', '', '', '', 'l'] })));
}

function extraInfo(ctx) {
  const st = ctx.state.settings;
  const hist = st.historic ?? { years: 0, threshold: 0, peaks: [] };
  const hy = h('input', { type: 'number', min: '0', step: '1', value: String(hist.years || ''), placeholder: '0' });
  const ht = h('input', { type: 'number', min: '0', value: String(hist.threshold || ''), placeholder: 'flow' });
  const hp = h('input', { type: 'text', value: (hist.peaks || []).join(', '), placeholder: 'e.g. 102500, 98000' });
  const save = () => {
    const years = Number(hy.value) || 0, threshold = Number(ht.value) || 0;
    const peaks = hp.value.split(/[,;\s]+/).map(Number).filter((v) => v > 0);
    st.historic = years > 0 && threshold > 0 ? { years, threshold, peaks } : null;
    ctx.state.results = null;
    toast(st.historic ? `Historic period of ${years} years recorded (threshold ${threshold}).` : 'No historic information will be used.');
  };
  [hy, ht, hp].forEach((e) => e.addEventListener('change', save));
  const zero = h('select', { onchange: (e) => { st.zeroHandling = e.target.value; ctx.state.results = null; } },
    h('option', { value: 'conditional', selected: st.zeroHandling === 'conditional' }, 'Conditional probability adjustment (recommended)'),
    h('option', { value: 'none', selected: st.zeroHandling === 'none' }, 'Keep zeros in the sample'));
  return h('details', { class: 'sheet', open: !!st.historic },
    h('summary', {}, h('strong', {}, 'Historic floods and zero flows (optional)')),
    h('div', { class: 'row', style: { marginTop: '.75rem' } },
      field('Length of historic period (years before the gauged record)', hy, null, 'historic'),
      field('Perception threshold', ht, 'A flood above this would have been recorded'),
      h('div', { class: 'grow' }, field('Historic floods above the threshold', hp, 'Values separated by commas'))),
    h('div', { class: 'row', style: { marginTop: '.75rem' } }, field('Zero or negative annual peaks', zero)));
}
