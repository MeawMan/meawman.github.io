/**
 * steps.js — the ten workflow screens. Each renderer builds DOM into `main` and pushes plot-drawing
 * callbacks onto `after` (run once the elements are in the document).
 */
import { h, clear, block, note, help, tag, table, select, numberInput, textInput, checkbox, button, segmented, download, parseList, fmt, durLabel } from './dom.js';
import * as plots from '../plot/plots.js';
import { parseDelimited, guessMapping, applyMapping, parseDurationLabel } from '../io/parse.js';
import { buildRegularSeries, fmtTime, aggregate, annualMaxima, fixedIntervalFactor } from '../core/timeseries.js';
import { DISTRIBUTIONS, AMS_DISTRIBUTIONS, METHOD_LABELS, FIXED_SHAPE_DISTS, fitDistribution, quantileT } from '../core/distributions.js';
import { FORMS, KMODELS, predict, quantileTable } from '../core/idf.js';
import { DISAGG_METHODS, disaggregate, calibratePowerExponent, calibrateRatios, holdOutErrors, imdRatio, scalingAnalysis } from '../core/disaggregation.js';
import { designStorm, maxWindowDepth, stormToCSV, stormToSWMMDat, stormToSWMMTimeseries, stormToHecHms } from '../core/designstorm.js';
import { adjustmentFactor, upliftFactor, arfFactor } from '../core/adjustments.js';
import { siteLmoments, discordancy, regionalGrowthCurve, idwInterpolate } from '../core/regional.js';
import { deltaMethod } from '../core/uncertainty.js';
import { generateSynthetic } from '../core/synthetic.js';
import { equationText, modelLabel, tableToCSV, workbook, resultSheets, projectJSON, loadProject } from '../io/export.js';
import { buildReport, methodsParagraph, methodLabel } from '../report/report.js';
import { renderMethods } from './methods.js';

export const STEPS = [
  { id: 'data', label: 'Your data', title: 'Load rainfall records or annual-maximum tables' },
  { id: 'quality', label: 'Check quality', needs: 'result' },
  { id: 'ams', label: 'Annual maxima', needs: 'result' },
  { id: 'frequency', label: 'Frequency analysis', needs: 'result' },
  { id: 'daily', label: 'Short durations from daily data', needs: 'result' },
  { id: 'idf', label: 'Fit IDF equations', needs: 'result' },
  { id: 'curves', label: 'IDF curves and tables', needs: 'result' },
  { id: 'storm', label: 'Design storm', needs: 'result' },
  { id: 'stations', label: 'Compare stations', needs: 'station' },
  { id: 'report', label: 'Report and export', needs: 'result' },
  { id: 'methods', label: 'Methods and references' },
];

const RENDER = {};
export function renderStep(id, app, main, after) {
  (RENDER[id] || RENDER.data)(app, main, after);
  // Analysis warnings (failed fits, unresolvable durations, experimental steps) on every result screen.
  const res = app.result();
  if (id !== 'data' && id !== 'methods' && res?.warnings?.length) {
    const box = h('details.note.warn', { open: res.warnings.length <= 2 ? true : null },
      h('summary', `${res.warnings.length} analysis warning${res.warnings.length > 1 ? 's' : ''} for this station`),
      h('ul', { style: { margin: '0.4rem 0 0', paddingLeft: '1.2rem' } }, res.warnings.map((w) => h('li', w))));
    const header = main.querySelector('header');
    if (header) header.after(box); else main.prepend(box);
  }
}

function heading(main, title, lede) {
  main.append(h('header', { style: { marginBottom: '1rem' } }, h('h2', { style: { margin: '0 0 0.25rem', fontSize: '1.625rem', letterSpacing: '-0.015em' } }, title), lede ? h('p.muted', { style: { margin: 0, maxWidth: '72ch' } }, lede) : null));
}

const recommend = (text) => h('p.recommend.beginner-only', text);
const selModel = (res) => res?.models.find((m) => m.model.key === res.selectedKey)?.model ?? null;
const uid = () => `st${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Plot element plus export tools (physical size in cm, DPI, PNG/SVG). */
function plotBox(after, draw, { cls = '', name = 'figure', label = 'Chart' } = {}) {
  const el = h(`div.plot${cls ? '.' + cls : ''}`, { role: 'img', 'aria-label': label });
  const opt = { widthCm: 16, heightCm: 10, dpi: 300, format: 'png' };
  const tools = h('div.plot-tools',
    numberInput('Width (cm)', opt.widthCm, (v) => { opt.widthCm = v; }, { step: 0.5 }),
    numberInput('Height (cm)', opt.heightCm, (v) => { opt.heightCm = v; }, { step: 0.5 }),
    numberInput('DPI', opt.dpi, (v) => { opt.dpi = v; }, { step: 50 }),
    select('Format', 'png', [['png', 'PNG'], ['svg', 'SVG']], (v) => { opt.format = v; }),
    button('Save figure', () => plots.exportPlot(el, { ...opt, filename: name }), { quiet: true }));
  after.push(() => draw(el));
  return h('div', el, tools);
}

// ===========================================================================
// 1. Data
// ===========================================================================
let pendingImport = null;

RENDER.data = (app, main, after) => {
  const S = app.state;
  heading(main, 'Your data', 'Load a rainfall record (1 min to daily), a tipping-bucket log, or a table of annual maxima. Files are read in this browser only.');

  const fileInput = h('input', { type: 'file', accept: '.csv,.txt,.tsv,.dat,.xlsx,.xls,.json', 'aria-label': 'Choose a data file', onchange: (e) => e.target.files[0] && readFile(e.target.files[0], app) });
  const drop = h('div.drop', h('p', { style: { margin: '0 0 0.5rem' } }, 'Drop a CSV, text or Excel file here, or ', h('label', { style: { color: 'var(--teal)', cursor: 'pointer', fontWeight: 600 } }, 'choose a file', h('span.sr-only', ''), fileInput)),
    h('p.small', { style: { margin: 0 } }, 'A saved project (.json) restores all settings and data.'));
  fileInput.style.display = 'none';
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0], app); });

  const paste = h('textarea', { placeholder: 'Or paste data here, for example:\ndatetime,rain_mm\n2019-07-01 00:00,0\n2019-07-01 01:00,2.4', 'aria-label': 'Paste data' });
  main.append(block('Load data', h('div.grid2', drop, h('div', paste, h('div.row', { style: { marginTop: '0.5rem' } }, button('Read pasted text', () => { if (paste.value.trim()) startImport(parseDelimited(paste.value), 'pasted text', app); }, { quiet: true })))),
    help('Which layouts can I use?',
      h('ul', h('li', 'One date-time column and one rainfall column (any interval from 1 minute to 1 day).'),
        h('li', 'Separate date and time columns, or year/month/day(/hour/minute) columns.'),
        h('li', 'BMD-style daily sheets: Year, Month, then columns 1 to 31.'),
        h('li', 'A table of annual maxima: Year plus one column per duration (headers such as 15min, 1h, 24 h).'),
        h('li', 'Tipping-bucket logs: one row per tip.'),
        h('li', 'Any of these with a Station column holds several stations in one file.')),
      h('p', 'Missing values may be blank, NA, -999 or ***. Trace rainfall (T) is read as 0.'))));

  main.append(block('Or try an example',
    h('div.row',
      button('Synthetic 5-min record (30 years)', () => addDemo(app, 'syn5')),
      button('Denver hourly, real (July only, 42 years)', () => addDemo(app, 'denver'), { quiet: true }),
      button('Synthetic daily record (40 years)', () => addDemo(app, 'synday'), { quiet: true })),
    h('p.small.muted', 'Synthetic records come from the built-in stochastic generator and are not real observations. The Denver record is real hourly data from the R package extRemes (GPL), units as distributed.'),
    h('p.small', 'Sample files showing each layout (all synthetic): ',
      [['sample_hourly_synthetic.csv', 'hourly series'], ['sample_daily_bmd_wide_synthetic.csv', 'BMD-style daily sheet, two stations'], ['sample_ams_table_synthetic.csv', 'annual-maximum table'], ['sample_multistation_daily_synthetic.csv', 'several stations in one file']]
        .flatMap(([f, l], i) => [i ? ' · ' : '', h('a', { href: `data/${f}`, download: f }, l)]))));

  if (pendingImport) main.append(mappingPanel(app));

  if (S.stations.length) {
    main.append(block('Stations in this project', table([
      { label: 'Name', get: (s) => h('input', { type: 'text', value: s.name, 'aria-label': 'Station name', onchange: (e) => { s.name = e.target.value; app.render(); } }) },
      { label: 'Type', get: (s) => kindLabel(s) },
      { label: 'Latitude', get: (s) => h('input', { type: 'number', step: 'any', value: s.lat ?? '', style: { width: '6rem' }, 'aria-label': 'Latitude', onchange: (e) => { s.lat = e.target.value === '' ? null : +e.target.value; } }) },
      { label: 'Longitude', get: (s) => h('input', { type: 'number', step: 'any', value: s.lon ?? '', style: { width: '6rem' }, 'aria-label': 'Longitude', onchange: (e) => { s.lon = e.target.value === '' ? null : +e.target.value; } }) },
      { label: 'Status', get: (s) => (app.state.results[s.id] && !app.state.dirty.has(s.id) ? 'analysed' : 'pending') },
      { label: '', get: (s) => button('Remove', () => app.removeStation(s.id), { danger: true }) },
    ], S.stations), h('div.row', button('Continue to quality checks', () => app.go('quality'), { disabled: !app.result() }))));
  }

  const inc = { v: true };
  main.append(block('Project',
    h('div.row',
      textInput('Project name', S.project.name, (v) => { S.project.name = v; }),
      checkbox('Include data in the project file', true, (v) => { inc.v = v; }),
      button('Save project (.json)', () => download(`${slug(S.project.name)}.idf.json`, projectJSON(S, { includeData: inc.v }), 'application/json'), { quiet: true })),
    h('p.small.muted', 'A project file stores every setting, the random seed and the tool version, so opening it reproduces the same results.')));
};

function kindLabel(s) {
  if (s.data.kind === 'ams') return `annual maxima, ${Object.keys(s.data.depth).length} durations`;
  const step = s.data.step;
  return `${step >= 1440 ? 'daily' : `${step}-min`} series, ${(s.data.values.length * step / 525960).toFixed(1)} yr`;
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

async function readFile(file, app) {
  try {
    if (/\.json$/i.test(file.name)) {
      const p = loadProject(await file.text());
      app.loadProjectState(p);
      if (p.versionNote) app.toast(p.versionNote, 'warn');
      return;
    }
    if (/\.xlsx?$/i.test(file.name)) {
      const X = window.XLSX;
      const wb = X.read(await file.arrayBuffer(), { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const rows = X.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, blankrows: false }).map((r) => Array.from(r, (c) => (c == null ? '' : c)));
      const alpha = (r) => r.filter((c) => typeof c === 'string' && /[a-z]/i.test(c)).length;
      const header = alpha(rows[0] || []) > alpha(rows[1] || []) ? rows.shift().map(String) : null;
      startImport({ delimiter: 'xlsx', header, rows, decimalComma: false, sheetNames: wb.SheetNames }, `${file.name} (sheet “${sheetName}”)`, app, file.name);
      return;
    }
    startImport(parseDelimited(await file.text()), file.name, app, file.name);
  } catch (e) {
    app.toast(`Could not read ${file.name}: ${e.message}`, 'error');
  }
}

function startImport(parsed, label, app, fileName) {
  const mapping = guessMapping(parsed.header, parsed.rows);
  pendingImport = { parsed, label, fileName: fileName || label, mapping, opt: { units: 'mm', convention: 'end', step: null, tipDepth: 0.2, dateOrder: null, amsUnit: 'depth', name: (fileName || 'Station').replace(/\.[^.]+$/, '') } };
  app.render();
}

function mappingPanel(app) {
  const P = pendingImport;
  const cols = Math.max(P.parsed.header?.length || 0, ...P.parsed.rows.slice(0, 20).map((r) => r.length));
  const colOpts = [[-1, '(none)'], ...Array.from({ length: cols }, (_, i) => [i, P.parsed.header?.[i] ? `${i + 1}: ${P.parsed.header[i]}` : `column ${i + 1}`])];
  const m = P.mapping;
  const colSel = (label, key) => select(label, m[key] ?? -1, colOpts, (v) => { m[key] = +v; app.render(); });
  const preview = table(Array.from({ length: cols }, (_, i) => ({ label: P.parsed.header?.[i] ?? `col ${i + 1}`, get: (r) => String(r[i] ?? '') })), P.parsed.rows.slice(0, 6));
  const fields = [];
  fields.push(select('Layout', m.layout, [['datetime', 'Date-time + value'], ['date+time', 'Date, time, value'], ['ymd', 'Year, month, day (+hour, minute)'], ['wide-daily', 'Year, month, days 1–31'], ['ams-table', 'Annual maxima table'], ['tips', 'Tipping-bucket tips']], (v) => { m.layout = v; app.render(); }));
  fields.push(colSel('Station column', 'station'));
  if (['datetime', 'date+time', 'tips'].includes(m.layout)) {
    fields.push(colSel(m.layout === 'date+time' ? 'Date column' : 'Date-time column', 'date'));
    if (m.layout === 'date+time') fields.push(colSel('Time column', 'time'));
    fields.push(select('Day/month order', P.opt.dateOrder || 'auto', [['auto', 'Detect'], ['dmy', 'DD/MM/YYYY'], ['mdy', 'MM/DD/YYYY'], ['ymd', 'YYYY-MM-DD']], (v) => { P.opt.dateOrder = v === 'auto' ? null : v; }));
  }
  if (m.layout === 'ymd') ['year', 'month', 'day', 'hour', 'minute'].forEach((k) => fields.push(colSel(k[0].toUpperCase() + k.slice(1), k)));
  if (['wide-daily', 'ams-table'].includes(m.layout)) fields.push(colSel('Year column', 'year'));
  if (m.layout === 'wide-daily') fields.push(colSel('Month column', 'month'));
  if (['datetime', 'date+time', 'ymd'].includes(m.layout)) fields.push(colSel('Rainfall column', 'value'));
  if (m.layout === 'tips') {
    fields.push(colSel('Depth per tip column (optional)', 'value'));
    fields.push(numberInput('Depth per tip (mm)', P.opt.tipDepth, (v) => { P.opt.tipDepth = v; }, { step: 0.01 }));
  }
  if (m.layout === 'ams-table') {
    fields.push(select('Values are', P.opt.amsUnit, [['depth', 'depths (mm)'], ['intensity', 'intensities (mm/h)']], (v) => { P.opt.amsUnit = v; }));
  }
  if (m.layout !== 'ams-table' && m.layout !== 'wide-daily') {
    fields.push(select('Time stamp marks', P.opt.convention, [['end', 'end of interval (most loggers)'], ['start', 'start of interval (daily totals dated by day)']], (v) => { P.opt.convention = v; }));
    fields.push(numberInput('Time step (min)', P.opt.step, (v) => { P.opt.step = v; }, { hint: m.layout === 'tips' ? 'aggregation step, e.g. 1 or 5' : 'blank = detect' }));
  }
  fields.push(select('Units', P.opt.units, [['mm', 'mm'], ['tenth', '0.1 mm'], ['cm', 'cm'], ['in', 'inches']], (v) => { P.opt.units = v; }));
  if (m.station < 0) fields.push(textInput('Station name', P.opt.name, (v) => { P.opt.name = v; }));

  let durInfo = null;
  if (m.layout === 'ams-table') {
    const durs = (m.durationCols || []).map(([i, d]) => `${P.parsed.header?.[i] ?? i} → ${durLabel(d)}`);
    durInfo = h('p.small', durs.length ? `Duration columns detected: ${durs.join(', ')}` : 'No duration columns detected: name them like 15min, 1h, 24h.');
  }
  return block(`Map the columns of ${P.label}`,
    preview, h('div.row', fields), durInfo,
    h('div.row', { style: { marginTop: '0.75rem' } }, button('Add to project', () => commitImport(app)), button('Discard', () => { pendingImport = null; app.render(); }, { quiet: true })));
}

function commitImport(app) {
  const P = pendingImport;
  const unitF = { mm: 1, tenth: 0.1, cm: 10, in: 25.4 }[P.opt.units];
  try {
    if (P.mapping.layout === 'ams-table' && !(P.mapping.durationCols || []).length) throw new Error('no duration columns found');
    const { stations, warnings } = applyMapping(P.parsed.rows, { ...P.mapping, amsUnit: P.opt.amsUnit }, { decimalComma: P.parsed.decimalComma, dateOrder: P.opt.dateOrder || undefined });
    const list = [];
    for (const [name, st] of stations) {
      const sname = P.mapping.station >= 0 ? name : P.opt.name;
      if (st.ams) {
        const depth = {};
        for (const [d, v] of Object.entries(st.ams.depth)) depth[d] = v.map((x) => x * unitF);
        list.push({ id: uid(), name: sname, data: { kind: 'ams', years: st.ams.years, depth }, source: { fileName: P.fileName, layout: P.mapping.layout } });
      } else {
        const recs = st.records.map((r) => ({ t: r.t, v: r.v * unitF }));
        const s = buildRegularSeries(recs, { step: P.opt.step || (P.mapping.layout === 'wide-daily' ? 1440 : undefined), convention: P.mapping.layout === 'wide-daily' ? 'start' : P.opt.convention, kind: P.mapping.layout === 'tips' ? 'tips' : 'depth', tipDepth: P.mapping.value >= 0 ? null : P.opt.tipDepth * unitF });
        warnings.push(...s.log);
        list.push({ id: uid(), name: sname, data: { kind: 'series', origin: s.origin, step: s.step, values: s.values }, source: { fileName: P.fileName, layout: P.mapping.layout, units: P.opt.units, convention: P.opt.convention } });
      }
    }
    pendingImport = null;
    for (const w of warnings) app.toast(w, /WARNING/.test(w) ? 'warn' : '');
    app.addStations(list);
  } catch (e) {
    app.toast(`Import failed: ${e.message}`, 'error');
  }
}

async function addDemo(app, which) {
  if (which === 'syn5') {
    const s = generateSynthetic({ years: 30, step: 5, seed: 2026 });
    app.addStations([{ id: uid(), name: 'Synthetic 5-min (NOT real)', data: { kind: 'series', origin: s.origin, step: 5, values: s.values }, source: { fileName: 'built-in generator, seed 2026' } }]);
  } else if (which === 'synday') {
    const s = aggregate(generateSynthetic({ years: 40, step: 60, seed: 77, startYear: 1981 }), 1440, 0);
    app.addStations([{ id: uid(), name: 'Synthetic daily (NOT real)', data: { kind: 'series', origin: s.origin, step: 1440, values: s.values }, source: { fileName: 'built-in generator, seed 77' } }]);
  } else {
    try {
      const text = await (await fetch('data/third-party/denver_july_hourly_1949-1990.csv')).text();
      const p = parseDelimited(text);
      const recs = applyMapping(p.rows, guessMapping(p.header, p.rows), { dateOrder: 'ymd' }).stations.get('Station 1').records;
      const s = buildRegularSeries(recs, { step: 60, convention: 'end' });
      app.state.settings.includeIncomplete = true;
      app.state.settings.qc.wetMonths = [7];
      app.addStations([{ id: uid(), name: 'Denver hourly, July only (real)', lat: 39.74, lon: -104.99, data: { kind: 'series', origin: s.origin, step: 60, values: s.values }, source: { fileName: 'extRemes::Denversp (GPL)' } }]);
      app.toast('Denver has July data only: “keep incomplete years” was switched on so each July counts as a year.', 'warn');
    } catch (e) { app.toast(`Could not load the example: ${e.message}`, 'error'); }
  }
}

// ===========================================================================
// 2. Quality
// ===========================================================================
RENDER.quality = (app, main, after) => {
  const res = app.result(); const S = app.state.settings;
  heading(main, 'Check quality', 'Gaps, implausible values and short records change the answer more than any choice of distribution. Review them before going on.');
  if (res.kind === 'ams') { main.append(note('This station was supplied as an annual-maximum table, so time-series checks are not possible. Check the table itself for transcription errors.', 'warn')); return; }
  const q = res.qc;
  main.append(block('Findings', q.issues.length ? q.issues.map((i) => note(i.text, i.level === 'error' ? 'error' : i.level === 'warning' ? 'warn' : '')) : note('No issues detected.')));
  main.append(block('Record strip', h('p.muted.small', 'Each row is a year and each column a day; darker cells are wetter days. Red cells are days with more than 20% of values missing.'),
    plotBox(after, (el) => plots.recordStrip(el, res.series.dailyStrip), { cls: 'strip', name: 'record-strip', label: 'Record strip of daily rainfall by year' })));
  main.append(block('Rules',
    h('div.row',
      numberInput('Minimum coverage per year (%)', Math.round(S.minCoverage * 100), (v) => app.set((s) => { s.minCoverage = (v ?? 80) / 100; }), { min: 0, max: 100, step: 5 }),
      select('Year starts in', S.yearStartMonth, ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => [i + 1, m]), (v) => app.set((s) => { s.yearStartMonth = +v; }), { hint: 'April gives the April–March hydrological year' }),
      textInput('Wet-season months', S.qc.wetMonths.join(', '), (v) => app.set((s) => { s.qc.wetMonths = parseList(v); }), { hint: 'for the blocked-gauge check' }),
      numberInput('Zero-rain run that looks suspicious (days)', S.qc.zeroRunDays, (v) => app.set((s) => { s.qc.zeroRunDays = v ?? 30; }))),
    h('div.row', { style: { marginTop: '0.5rem' } },
      checkbox('Set negative and implausible values to missing', S.qc.fix, (v) => app.set((s) => { s.qc.fix = v; })),
      checkbox('Keep years below the coverage threshold', S.includeIncomplete, (v) => app.set((s) => { s.includeIncomplete = v; }))),
    help('Why exclude incomplete years?', h('p', 'A year with long gaps may have missed its largest storm, which biases the annual maximum low. A common practice is to keep a year only if most of it is present (80% here), or if its maximum is clearly large despite the gap. Every exclusion is listed below and in the report.'))));
  const cov = q.coverage.map((c) => ({ ...c, used: !res.ams.excluded.some((e) => e.year === c.year) }));
  main.append(block('Coverage by year', table([
    { label: 'Year', key: 'year' }, { label: 'Coverage %', get: (r) => (100 * r.coverage).toFixed(1), cls: (v) => (+v < S.minCoverage * 100 ? 'num-warn' : null) },
    { label: 'Total (mm)', get: (r) => r.sum.toFixed(1) }, { label: 'Used', get: (r) => (r.used ? 'yes' : 'no') },
  ], cov)));
  if (q.gaps.length) main.append(block('Longest gaps', table([{ label: 'From', get: (g) => fmtTime(g.start) }, { label: 'To', get: (g) => fmtTime(g.end) }, { label: 'Intervals', key: 'n' }], [...q.gaps].sort((a, b) => b.n - a.n).slice(0, 15))));
  if (q.changed.length) main.append(block('Values set to missing', table([{ label: 'Time', get: (c) => fmtTime(c.t) }, { label: 'Value', get: (c) => fmt(c.from) }, { label: 'Reason', key: 'reason' }], q.changed.slice(0, 50))));
  if (q.flats.length) main.append(block('Repeated identical values', table([{ label: 'From', get: (g) => fmtTime(g.start) }, { label: 'To', get: (g) => fmtTime(g.end) }, { label: 'Value', get: (g) => fmt(g.value) }], q.flats.slice(0, 20))));
  if (res.log.length) main.append(block('Processing log', h('ul.small', res.log.map((l) => h('li', l)))));
};

// ===========================================================================
// 3. Annual maxima
// ===========================================================================
RENDER.ams = (app, main, after) => {
  const res = app.result(); const S = app.state.settings;
  heading(main, 'Annual maxima', 'For each duration, the largest rainfall depth in each year. These series feed the frequency analysis.');
  main.append(block('Durations and extraction',
    h('div.row',
      textInput('Durations (min)', S.durations.join(', '), (v) => app.set((s) => { s.durations = [...new Set(parseList(v).map(Math.round))].sort((a, b) => a - b); }), { hint: 'e.g. 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880' }),
      select('Windows', S.amsMode, [['sliding', 'Sliding (rolling) windows'], ['fixed', 'Fixed blocks (clock intervals)']], (v) => app.set((s) => { s.amsMode = v; }), { cls: 'expert-only' }),
      select('Fixed-interval correction', S.fixedFactor.method, [['table', '1.13 (one interval), 1.04 (two)'], ['weiss', 'Weiss n/(n − 1/8)'], ['none', 'None']], (v) => app.set((s) => { s.fixedFactor.method = v; })),
      res.kind === 'ams' ? checkbox('Apply correction to the supplied table', S.fixedFactor.applyToAmsTables, (v) => app.set((s) => { s.fixedFactor.applyToAmsTables = v; })) : null),
    help('What is the fixed-interval correction?',
      h('p', 'A gauge read once a day (or once an hour) splits a storm that crosses the reading time, so the largest fixed-interval total underestimates the true largest 24-h (or 1-h) total. The classical correction multiplies annual maxima that span one observation interval by about 1.13 and two intervals by 1.04 (values used by Koutsoyiannis et al. 1998, after Linsley et al. 1975). The correction is an average: Papalexiou et al. (2016) show it varies from year to year.'),
      res.hershfield ? h('p', `This record resolves 24 h finely, so the ratio can be measured directly: sliding ÷ fixed-day mean annual maximum = ${res.hershfield.ratioOfMeans.toFixed(3)} (${res.hershfield.n} years).`) : null)));

  const durs = res.ams.durations;
  main.append(block('Annual maximum depths', h('p.small.muted', 'Raw depths before the fixed-interval factor. Factors: ' + durs.map((d) => `${durLabel(d)} ×${res.factors[d].toFixed(3)}`).join(', ')),
    table([{ label: 'Year', key: 'y' }, ...durs.map((d) => ({ label: durLabel(d), get: (r) => fmt(r[d], 1) }))],
      res.ams.years.map((y, j) => Object.fromEntries([['y', y], ...durs.map((d) => [d, res.ams.depth[d][j]])])))));
  main.append(block('Annual maxima over time', plotBox(after, (el) => plots.amsSeries(el, res.ams, durs.filter((_, i) => durs.length <= 6 || i % 2 === 0), res.factors), { name: 'annual-maxima', label: 'Annual maxima by year' })));
  main.append(block('Trend test', h('p.small.muted', 'Mann–Kendall test (two-sided) with Sen’s slope. A significant trend means the series may not be stationary, which the frequency analysis assumes. The test does not correct for serial correlation.'),
    table([{ label: 'Duration', get: (t) => durLabel(t.d) }, { label: 'Years', key: 'n' }, { label: 'S', key: 'S' }, { label: 'Z', get: (t) => fmt(t.Z, 2) },
      { label: 'p', get: (t) => fmt(t.p, 3), cls: (v) => (+v < 0.05 ? 'num-warn' : null) }, { label: 'Sen slope (mm/yr)', get: (t) => fmt(t.sen, 3) }], res.trends)));
  if (res.outliers) {
    const flagged = res.outliers.filter((o) => o.lowFlags.length || o.highFlags.length);
    main.append(block('Outlier screening',
      h('p.small.muted', 'Grubbs–Beck test (Bulletin 17B, 10% significance) on the logarithms of each duration’s annual maxima, after the fixed-interval factor. Flagged values are not removed: check them against the original record.'),
      flagged.length ? note(`${flagged.length} duration${flagged.length > 1 ? 's have' : ' has'} flagged values. A real extreme storm is not an error; a value that is impossibly small (failed gauge) or a misplaced decimal is.`, 'warn') : note('No values flagged at any duration.'),
      table([{ label: 'Duration', get: (o) => durLabel(o.d) }, { label: 'n', key: 'n' }, { label: 'K_N', get: (o) => fmt(o.K, 3) },
        { label: 'Low limit (mm)', get: (o) => fmt(o.low, 1) }, { label: 'High limit (mm)', get: (o) => fmt(o.high, 1) },
        { label: 'Low flags', get: (o) => (o.applicable ? (o.lowFlags.map((f) => `${f.year}: ${fmt(f.value, 1)}`).join(', ') || 'none') : o.message) },
        { label: 'High flags', get: (o) => (o.applicable ? o.highFlags.map((f) => `${f.year}: ${fmt(f.value, 1)}`).join(', ') || 'none' : '—') }], res.outliers)));
  }
};

// ===========================================================================
// 4. Frequency analysis
// ===========================================================================
let freqDuration = null;
RENDER.frequency = (app, main, after) => {
  const res = app.result(); const S = app.state.settings; const st = app.station();
  heading(main, 'Frequency analysis', 'Fit a probability distribution to each duration’s annual maxima and read off depths for chosen return periods.');
  const dOpts = res.ams.durations;
  if (!dOpts.includes(freqDuration)) freqDuration = dOpts.includes(1440) ? 1440 : dOpts[0];
  const distOpts = AMS_DISTRIBUTIONS.map((d) => [d, DISTRIBUTIONS[d].label]);
  const methodsOf = (d) => [...DISTRIBUTIONS[d].methods, ...(FIXED_SHAPE_DISTS.includes(d) ? ['lmomk'] : [])];
  const mLabel = (m, k) => (m === 'lmomk' ? `L-moments, shape fixed${Number.isFinite(k) ? ` (k = ${k})` : ''}` : METHOD_LABELS[m]);
  const crit = S.criterion || 'aicc';
  const CRIT = { aicc: 'AICc', bic: 'BIC', ad: 'Anderson–Darling A²', ppcc: 'PPCC', ks: 'KS D' };
  main.append(block('Model choice',
    recommend('Recommended: GEV fitted by L-moments. L-moments are robust for short records and GEV is used by NOAA Atlas 14 and IDF_CC. Gumbel is common in Bangladeshi practice; compare the two below.'),
    h('div.row',
      select('Distribution (all durations)', S.dist, distOpts, (v) => app.set((s) => { s.dist = v; if (!methodsOf(v).includes(s.method)) s.method = DISTRIBUTIONS[v].methods[0]; })),
      select('Estimation method', S.method, methodsOf(S.dist).map((m) => [m, mLabel(m, S.fixedShape)]), (v) => app.set((s) => { s.method = v; })),
      FIXED_SHAPE_DISTS.includes(S.dist) ? numberInput('Fixed shape k', S.fixedShape, (v) => app.set((s) => { s.fixedShape = v; }), { step: 0.01, min: -0.5, max: 0.5, cls: S.method === 'lmomk' ? null : 'expert-only', hint: 'Hosking sign: k < 0 heavy tail' }) : null,
      textInput('Return periods (yr)', S.returnPeriods.join(', '), (v) => app.set((s) => { s.returnPeriods = [...new Set(parseList(v).filter((t) => t > 1))].sort((a, b) => a - b); }), { hint: 'add custom values, e.g. 2, 5, 10, 20, 25, 50, 100, 200' })),
    h('div.row.expert-only', { style: { marginTop: '0.5rem' } },
      select('Rank candidates by', crit, Object.entries(CRIT), (v) => app.set((s) => { s.criterion = v; })),
      select('Plotting position', S.plotting, [['gringorten', 'Gringorten (a = 0.44)'], ['weibull', 'Weibull (a = 0)'], ['cunnane', 'Cunnane (a = 0.40)'], ['hazen', 'Hazen (a = 0.5)'], ['blom', 'Blom (a = 0.375)']], (v) => app.set((s) => { s.plotting = v; }))),
    S.method === 'lmomk' && !Number.isFinite(S.fixedShape) ? note('Enter the fixed shape k to use this method.', 'warn') : null,
    S.method === 'gmle' ? note('Penalised (generalised) maximum likelihood is EXPERIMENTAL: the Martins–Stedinger prior parameters were not verified from the original paper.', 'warn') : null,
    help('How should I choose?',
      h('p', 'Prefer a consistent, defensible choice over the best score at each duration: with 20–40 years of data, goodness-of-fit statistics rarely separate the candidates. AICc penalises extra parameters; the Anderson–Darling statistic weights the tails; the probability-plot correlation (PPCC) measures straightness on the plot. Use the L-moment ratio diagram to see whether the samples sit near a distribution’s curve.'))));

  const cmp = res.comparison.find((c) => c.d === freqDuration);
  const per = S.perDuration[freqDuration];
  main.append(block(`Candidates for ${durLabel(freqDuration)}`,
    h('div.row', select('Duration', freqDuration, dOpts.map((d) => [d, durLabel(d)]), (v) => { freqDuration = +v; app.render(); }),
      h('div.expert-only', select('Override for this duration', per ? `${per.dist}|${per.method}` : '', [['', 'Use the global choice'], ...AMS_DISTRIBUTIONS.flatMap((d) => methodsOf(d).filter((m) => m !== 'lmomk' || Number.isFinite(S.fixedShape)).map((m) => [`${d}|${m}`, `${DISTRIBUTIONS[d].label} / ${mLabel(m, S.fixedShape)}`]))],
        (v) => app.set((s) => { if (!v) delete s.perDuration[freqDuration]; else { const [dist, method] = v.split('|'); s.perDuration[freqDuration] = method === 'lmomk' ? { dist, method, k: s.fixedShape } : { dist, method }; } })))),
    table([
      { label: 'Distribution', get: (r) => DISTRIBUTIONS[r.dist].label }, { label: 'Method', get: (r) => mLabel(r.method, r.k) },
      { label: 'AICc', get: (r) => fmt(r.gof?.aicc, 1) }, { label: 'BIC', get: (r) => fmt(r.gof?.bic, 1) }, { label: 'A²', get: (r) => fmt(r.gof?.ad, 3) }, { label: 'PPCC', get: (r) => fmt(r.gof?.ppcc, 4) }, { label: 'KS D', get: (r) => fmt(r.gof?.ks, 3) },
      { label: '100-yr (mm)', get: (r) => (r.ok ? fmt(DISTRIBUTIONS[r.dist].ppf(0.99, r.params), 1) : '—') },
      { label: 'Note', get: (r) => r.message || '' },
    ], cmp.rows, { rowClass: (r) => (!r.ok ? 'bad' : (per ? r.dist === per.dist && r.method === per.method : r.dist === S.dist && r.method === S.method) ? 'best' : null),
      caption: `n = ${cmp.n} years, depths include the ×${res.factors[freqDuration].toFixed(3)} factor. Highlighted row = model in use. Sorted by ${CRIT[crit]}.` })));

  const ci = app.state.ci[app.state.active];
  const emp = res.empirical.find((e) => e.d === freqDuration);
  const used = res.observed.rows.find((r) => r.d === freqDuration);
  const top = cmp.rows.filter((r) => r.ok && !(r.dist === used.fit.dist && r.method === used.fit.method)).slice(0, 2);
  const fits = [{ label: `${DISTRIBUTIONS[used.fit.dist].label} / ${mLabel(used.fit.method, used.fit.fixedK)} (in use)`, q: (T) => DISTRIBUTIONS[used.fit.dist].ppf(1 - 1 / T, used.fit.params) },
    ...top.map((r) => ({ label: `${DISTRIBUTIONS[r.dist].label} / ${mLabel(r.method, r.k)}`, q: (T) => DISTRIBUTIONS[r.dist].ppf(1 - 1 / T, r.params) }))];
  const ciRow = ci?.table.find((r) => r.d === freqDuration);
  main.append(block('Probability plot', plotBox(after, (el) => plots.probabilityPlot(el, emp, fits, ciRow ? { T: ci.returnPeriods, lower: ciRow.lower, upper: ciRow.upper, level: ci.level } : null), { name: `probability-plot-${freqDuration}min`, label: 'Probability plot' })));

  const L = res.ams.durations.map((d) => { const x = res.ams.depth[d].filter(Number.isFinite); const s = siteLmoments(durLabel(d), x); return { t3: s.t3, t4: s.t4, label: durLabel(d) }; });
  main.append(block('L-moment ratio diagram', plotBox(after, (el) => plots.lmomDiagram(el, L), { cls: 'tall', name: 'lmoment-ratio-diagram', label: 'L-moment ratio diagram' })));

  main.append(potBlock(app, res, S));

  const U = S.uncertainty;
  const ciBlock = block('Confidence intervals',
    h('p', 'Bootstrap: resample whole years with replacement (keeping each year’s maxima for all durations together), refit, and take percentiles of the quantiles.'),
    h('div.row',
      numberInput('Replicates', U.nBoot, (v) => app.set((s) => { s.uncertainty.nBoot = v ?? 500; }, { recompute: false }), { min: 50, step: 50 }),
      numberInput('Level (%)', Math.round(U.level * 100), (v) => app.set((s) => { s.uncertainty.level = (v ?? 90) / 100; }, { recompute: false }), { min: 50, max: 99 }),
      numberInput('Random seed', U.seed, (v) => app.set((s) => { s.uncertainty.seed = v ?? 1; }, { recompute: false }), { cls: 'expert-only' }),
      button(ci ? 'Recompute intervals' : 'Compute intervals', () => runBootstrap(app))),
    note('In this tool’s tests, nominal 90% percentile intervals covered the truth about 80% of the time for 40-year records. Treat them as a lower bound on the real uncertainty.', 'warn'),
    S.pot.use && res.pot ? note('The intervals are computed for the annual-maximum fit. The design table currently uses peaks-over-threshold quantiles, which these intervals do not describe.', 'warn') : null);
  if (ci) ciBlock.append(table([{ label: 'Duration', get: (r) => durLabel(r.d) }, ...ci.returnPeriods.map((T, k) => ({ label: `${T} yr (mm)`, get: (r) => `${fmt(r.lower[k], 1)} – ${fmt(r.upper[k], 1)}` }))], ci.table,
    { caption: `${Math.round(ci.level * 100)}% intervals, ${ci.nBoot} replicates, seed ${U.seed}.` }));
  main.append(ciBlock);

  const fitUsed = { dist: used.fit.dist, method: used.fit.method, params: used.fit.params, fixedK: used.fit.fixedK, nFree: used.fit.nFree };
  const x = res.ams.depth[freqDuration].filter(Number.isFinite).map((v) => v * res.factors[freqDuration]);
  const exp = block('Goodness-of-fit p-value (parametric bootstrap)', h('p.small.muted', 'Simulates samples from the fitted model, refits with the same method and compares the Anderson–Darling statistic.'),
    button('Compute p-value', async () => {
      try {
        app.setBusy({ text: 'Parametric bootstrap…' });
        const r = await app.runJob('gofp', { fit: fitUsed, x, opt: { nSim: 500, seed: U.seed } }, (i) => app.setBusy({ text: `Parametric bootstrap ${i.done}/${i.of}`, value: i.done / i.of }));
        app.setBusy(null);
        app.toast(`${durLabel(freqDuration)}: Anderson–Darling A² = ${r.observed.toFixed(3)}, p = ${r.p.toFixed(3)} (${r.nSim} simulations).`);
      } catch (e) { app.setBusy(null); if (e.message !== 'cancelled') app.toast(e.message, 'error'); }
    }, { quiet: true }));
  if (used.fit.method === 'mle') {
    const dm = deltaMethod(fitUsed, x, res.observed.returnPeriods, U.level);
    if (dm) exp.append(table([{ label: 'T (yr)', key: 'T' }, { label: 'Quantile (mm)', get: (r) => fmt(r.quantile, 1) }, { label: 'SE', get: (r) => fmt(r.se, 2) }, { label: 'Interval (normal approximation)', get: (r) => `${fmt(r.lower, 1)} – ${fmt(r.upper, 1)}` }], dm, { caption: 'Delta-method intervals for the ML fit (normal approximation; unreliable for small samples and the GEV shape — prefer the bootstrap).' }));
  }
  exp.classList.add('expert-only');
  main.append(exp);
};

function potBlock(app, res, S) {
  const P = S.pot;
  const set = (fn) => app.set((s) => { fn(s.pot); });
  const b = block('Peaks over threshold',
    h('p', 'An alternative to annual maxima: take every independent storm above a threshold (several per year), fit a generalised Pareto distribution to the excesses, and convert to annual return periods. It uses more of the record, which helps short records, but depends on the threshold.'),
    res.kind === 'ams' ? note('Not available: this station is an annual-maximum table, not a time series.') : [
      h('div.row',
        checkbox('Compute peaks over threshold', P.enabled || P.use, (v) => set((p) => { p.enabled = v; if (!v) p.use = false; })),
        checkbox('Use them for the design table', P.use, (v) => set((p) => { p.use = v; if (v) p.enabled = true; }))),
      (P.enabled || P.use) ? h('div.row', { style: { marginTop: '0.5rem' } },
        numberInput('Events per year', P.eventsPerYear, (v) => set((p) => { p.eventsPerYear = v ?? 3; }), { min: 1, max: 10, step: 0.5 }),
        numberInput('Minimum separation (h)', P.separationHours, (v) => set((p) => { p.separationHours = v ?? 24; }), { min: 1, step: 1 }),
        select('Excess distribution', P.shape, [['free', 'Generalised Pareto'], ['exp', 'Exponential (k = 0)']], (v) => set((p) => { p.shape = v; })),
        select('POT estimation', P.method, [['lmom', 'L-moments'], ['mle', 'Maximum likelihood']], (v) => set((p) => { p.method = v; }))) : null,
    ]);
  const pot = res.pot;
  if (!pot) return b;
  const Ts = pot.returnPeriods;
  const show = Ts.filter((T) => [2, 10, 50, 100].includes(T));
  const Tc = show.length ? show : Ts.slice(0, 3);
  b.append(table([
    { label: 'Duration', get: (r) => durLabel(r.d) }, { label: 'Threshold (mm)', get: (r) => fmt(r.threshold * r.factor, 1) }, { label: 'Peaks', get: (r) => r.nPeaks ?? '—' },
    { label: 'Rate (/yr)', get: (r) => fmt(r.rate, 2) }, { label: 'k', get: (r) => fmt(r.k, 3) },
    ...Tc.map((T) => ({ label: `${T}-yr POT / AMS (mm)`, get: (r) => { const j = Ts.indexOf(T); const a = res.comparison && res.observed.rows.find((q) => q.d === r.d); const amsQ = a ? DISTRIBUTIONS[a.fit.dist].ppf(1 - 1 / T, a.fit.params || [NaN]) : NaN; return `${fmt(r.depth[j], 1)} / ${fmt(amsQ, 1)}`; } })),
    { label: 'Note', get: (r) => r.message || '' },
  ], pot.rows, { caption: `Record used for the rate: ${pot.years.toFixed(1)} observed years. AMS = the annual-maximum fit chosen above. Depths include the fixed-interval factor.` }));
  if (pot.stability) {
    b.append(h('h4', `Threshold stability, ${durLabel(pot.stability.d)}`),
      h('p.small.muted', 'If the threshold is high enough, the shape k and the quantile should stay roughly constant as the number of events per year changes. Pick a rate inside a stable stretch.'),
      table([{ label: 'Events/yr', key: 'eventsPerYear' }, { label: 'Threshold (mm)', get: (r) => fmt(r.threshold, 1) }, { label: 'k', get: (r) => fmt(r.k, 3) }, { label: `${pot.stability.T}-yr depth (mm)`, get: (r) => fmt(r.q, 1) }, { label: 'Note', get: (r) => r.message || '' }], pot.stability.rows,
        { rowClass: (r) => (r.eventsPerYear === P.eventsPerYear ? 'best' : null) }));
  }
  return b;
}

async function runBootstrap(app, withIdf = false) {
  const res = app.result(); const S = app.state.settings; const id = app.state.active;
  const sel = selModel(res);
  const idf = withIdf && sel ? (sel.type === 'kmodel'
    ? { kind: 'kmodel', key: sel.model, opt: { method: sel.method, unit: sel.unit, fixTheta: sel.fixTheta } }
    : FORMS[sel.form].kind === 'unified' ? { kind: 'form', key: sel.form, opt: { unit: sel.unit, space: sel.space } } : null) : null;
  try {
    app.setBusy({ text: 'Bootstrap…', value: 0 });
    const r = await app.runJob('bootstrap', {
      ams: res.ams, factors: res.factors,
      freq: { dist: S.dist, method: S.method, fixedK: S.fixedShape, perDuration: S.perDuration, returnPeriods: res.observed.returnPeriods },
      opt: { nBoot: withIdf ? Math.min(S.uncertainty.nBoot, 300) : S.uncertainty.nBoot, seed: S.uncertainty.seed, level: S.uncertainty.level, idf },
    }, (i) => app.setBusy({ text: `Bootstrap ${i.done}/${i.of}`, value: i.done / i.of }));
    app.setBusy(null);
    app.state.ci[id] = { ...r, idfKey: idf ? sel.key : null };
    app.render();
  } catch (e) { app.setBusy(null); if (e.message !== 'cancelled') app.toast(`Bootstrap failed: ${e.message}`, 'error'); }
}

// ===========================================================================
// 5. Daily-only methods
// ===========================================================================
let dailyT = 10;
RENDER.daily = (app, main, after) => {
  const res = app.result(); const S = app.state.settings;
  heading(main, 'Short durations from daily data', 'Most Bangladeshi gauges report daily totals only. Sub-daily design rainfall must then be estimated, and the method matters a great deal.');
  main.append(note('No daily-to-sub-daily method has been validated against Bangladeshi sub-daily records in this tool. In the hold-out tests shipped with it (docs/HOLDOUT.md), the IMD formula underestimated 1-hour quantiles at a real convective station by about 40%, and on a synthetic monsoon-like record it overestimated 5-minute and underestimated 1-hour quantiles. Methods calibrated on sub-daily data did much better; transferring depth ratios kept the error lowest. Load a nearby station with sub-daily data and select it below.', 'warn'));
  const T = res.design.returnPeriods.includes(dailyT) ? dailyT : res.design.returnPeriods[Math.min(2, res.design.returnPeriods.length - 1)];
  dailyT = T;
  if (res.disaggregation && !res.disaggregation.belowResolution) {
    const dg = res.disaggregation;
    const subStations = app.state.stations.filter((s) => s.id !== app.state.active && s.data.kind === 'series' && s.data.step < 1440);
    const methodOpts = Object.entries(DISAGG_METHODS).map(([k, v]) => [k, v.label]);
    main.append(block('Method',
      h('div.row',
        select('Method used for design', S.disagg.method, methodOpts, (v) => app.set((s) => { s.disagg.method = v; })),
        select('Calibrate on station', S.disagg.calibStation || '', [['', '(none)'], ...subStations.map((s) => [s.id, s.name])], (v) => app.set((s) => { s.disagg.calibStation = v || null; }), { hint: 'a station with sub-daily data and a 24-h duration' }),
        numberInput('Exponent n (manual)', S.disagg.n, (v) => app.set((s) => { s.disagg.n = v; }), { hint: 'P_t = P_24 (t/24)^n' }),
        numberInput('Scaling exponent H (manual)', S.disagg.H, (v) => app.set((s) => { s.disagg.H = v; }), { cls: 'expert-only' }),
        numberInput('10-yr 1-h depth for Bell (mm)', S.disagg.p60_10, (v) => app.set((s) => { s.disagg.p60_10 = v; }), { cls: 'expert-only' })),
      h('div.row', { style: { marginTop: '0.5rem' } }, textInput('Ratio table P_t/P_24 (duration:ratio, …)', Object.entries(S.disagg.ratios).map(([d, r]) => `${d}:${r}`).join(', '),
        (v) => app.set((s) => { s.disagg.ratios = Object.fromEntries(String(v).split(/[,;]+/).map((p) => p.split(':').map((q) => q.trim())).filter(([d, r]) => Number.isFinite(parseDurationLabel(d)) && +r > 0).map(([d, r]) => [parseDurationLabel(d), +r])); }),
        { hint: 'e.g. 60:0.42, 180:0.6, 360:0.72' })),
      table([{ label: 'Method', get: ([k]) => DISAGG_METHODS[k].label }, { label: 'Status', get: ([k]) => tag(DISAGG_METHODS[k].status) },
        { label: 'Parameter', get: ([k, v]) => (v.n != null ? `n = ${v.n.toFixed(3)}` : v.H != null ? `H = ${v.H.toFixed(3)}` : k === 'imd' ? 'n = 1/3' : '') },
        ...dg.durations.slice(0, 8).map((d) => ({ label: `r(${durLabel(d)})`, get: ([, v]) => { const r = v.rows.find((q) => q.d === d); const p24 = res.observed.rows.find((q) => q.d === 1440).depth; return r ? fmt(r.depth[0] / p24[0], 3) : '—'; } }))],
      Object.entries(dg.methods), { rowClass: ([k]) => (k === dg.selected ? 'best' : null), caption: `Ratios to the 24-h depth (T = ${dg.returnPeriods[0]} yr). Highlighted = used for design.${dg.calibratedFrom ? ` Calibrated on “${dg.calibratedFrom}”.` : ''}` }),
      help('About the methods',
        h('p', h('b', 'IDM / IMD reduction formula. '), 'P_t = P_24 (t/24)^(1/3), t in hours. Widely used in South Asia, including Bangladesh. It is the simple-scaling law with a fixed exponent of 1/3.'),
        h('p', h('b', 'Calibrated power law. '), 'The same law with the exponent fitted to quantiles from a nearby station that has sub-daily data (choose it above), or entered manually.'),
        h('p', h('b', 'Simple scaling. '), 'The exponent comes from how mean annual maxima grow with duration at the calibration station (Menabde et al. 1999 framework).'),
        h('p', h('b', 'Ratio transfer. '), 'The depth ratios P_t/P_24 measured at the calibration station, applied to this station. It keeps the bend of the local depth–duration curve, which a single exponent cannot. Assumes the two stations share the same short-duration behaviour.'),
        h('p', h('b', 'Ratio table. '), 'Your own ratios, e.g. from a local study.'),
        h('p', h('b', 'Bell (1969). '), 'Generalised ratios scaled to the 10-yr 1-h depth, valid for 5–120 min. EXPERIMENTAL: the coefficients could not be verified from an opened source.'))));
    main.append(block('Compare methods',
      h('div.row', select('Return period', T, res.design.returnPeriods.map((t) => [t, `${t} yr`]), (v) => { dailyT = +v; app.render(); })),
      plotBox(after, (el) => plots.disaggPlot(el, dg, T, res.observed.rows), { name: 'disaggregation-comparison', label: 'Comparison of disaggregation methods' })));
  } else {
    const below = S.durations.filter((d) => d < 1440 && !res.ams.durations.includes(d));
    const dg = res.disaggregation;
    main.append(block('This station has sub-daily data',
      h('p', 'Sub-daily quantiles come directly from the record, so no disaggregation is needed. You can use this station to calibrate daily-only stations (choose it on their version of this screen), and you can test how well the daily-only methods would have worked here.'),
      below.length ? [
        note(`The record resolution is ${res.series.step} min, so ${below.map(durLabel).join(', ')} cannot be estimated from it. These durations are left out of the curves and equations by default.`, dg ? 'warn' : ''),
        checkbox(`Extrapolate ${below.map(durLabel).join(', ')} with a power law calibrated on this station's own quantiles (EXPERIMENTAL)`, S.disagg.fillBelowResolution, (v) => app.set((s) => { s.disagg.fillBelowResolution = v; }), { cls: 'expert-only' }),
        h('p.small.muted.expert-only', 'Extrapolation assumes the depth–duration power law continues below the shortest observed duration. Convective bursts often break that assumption; prefer finer data.'),
      ] : null));
    if (dg?.belowResolution) {
      main.append(block('Extrapolated durations',
        h('div.row', select('Return period', T, res.design.returnPeriods.map((t) => [t, `${t} yr`]), (v) => { dailyT = +v; app.render(); })),
        plotBox(after, (el) => plots.disaggPlot(el, dg, T, res.observed.rows), { name: 'extrapolation', label: 'Durations extrapolated below the record resolution' })));
    }
  }
  if (res.kind === 'subdaily' && res.ams.durations.includes(1440)) main.append(holdOutBlock(app, res, after));
};

function holdOutBlock(app, res, after) {
  const box = block('Test the methods on this station (hold-out)',
    h('p', 'Pretend only daily totals exist: aggregate this record to calendar days, estimate 24-h quantiles with the fixed-interval factor, disaggregate, and compare with the quantiles from the real sub-daily data. The exponent for the calibrated methods is fitted on the first half of the years and tested on the second half.'));
  const out = h('div');
  box.append(button('Run hold-out test', () => {
    const S = app.state.settings; const st = app.station();
    const series = { origin: st.data.origin, step: st.data.step, values: st.data.values };
    const durs = res.ams.durations.filter((d) => d < 1440);
    const Ts = res.observed.returnPeriods;
    const opt = { yearStartMonth: S.yearStartMonth, minCoverage: S.minCoverage, includeIncomplete: S.includeIncomplete };
    const amsAll = annualMaxima(series, [...durs, 1440], opt);
    const daily = annualMaxima(aggregate(series, 1440, 0), [1440], opt);
    const years = amsAll.years.filter((y, j) => Number.isFinite(amsAll.depth[1440][j]));
    const mid = years[Math.floor(years.length / 2)];
    const sub = (a, keep) => { const idx = a.years.map((y, j) => (keep(y) ? j : -1)).filter((j) => j >= 0); const depth = {}; for (const d of a.durations) depth[d] = idx.map((j) => a.depth[d][j]); return { ...a, years: idx.map((j) => a.years[j]), depth }; };
    const freq = { dist: S.dist, method: S.method, fixedK: S.fixedShape, returnPeriods: Ts };
    const test = sub(amsAll, (y) => y >= mid); const cal = sub(amsAll, (y) => y < mid);
    const truth = quantileTable(test, freq);
    const p24 = quantileTable(sub(daily, (y) => y >= mid), { ...freq, factor: () => fixedIntervalFactor(1, S.fixedFactor.method, S.fixedFactor.table) }).rows[0].depth;
    const n = calibratePowerExponent(quantileTable(cal, freq).rows, Ts).n;
    const H = scalingAnalysis(cal, [...durs, 1440]).H;
    const methods = { imd: disaggregate(p24, durs, Ts, { method: 'imd' }), 'power (calibrated)': disaggregate(p24, durs, Ts, { method: 'power', n }), 'scaling (calibrated)': disaggregate(p24, durs, Ts, { method: 'scaling', H, refDuration: 1440 }),
      'ratio transfer (calibrated)': disaggregate(p24, durs, Ts, { method: 'ratioTransfer', ratios: calibrateRatios(quantileTable(cal, freq).rows, Ts, durs).ratios }) };
    const rows = Object.entries(methods).map(([m, est]) => { const e = holdOutErrors(truth, est, Ts); return { m, ...e, byD: durs.map((d) => { const r = e.rows.filter((q) => q.d === d); return r.reduce((a, q) => a + q.pct, 0) / r.length; }) }; });
    clear(out).append(table([{ label: 'Method', key: 'm' }, { label: 'MAPE %', get: (r) => fmt(r.mape, 1) }, { label: 'Mean bias %', get: (r) => fmt(r.bias, 1) }, ...durs.map((d, i) => ({ label: durLabel(d), get: (r) => fmt(r.byD[i], 1) }))], rows,
      { caption: `Test years ${mid}–${years.at(-1)}; calibration exponent n = ${n.toFixed(3)}, H = ${H.toFixed(3)} from ${years[0]}–${mid - 1}. Per-duration columns: mean signed % error (negative = underestimate).` }));
  }, { quiet: true }), out);
  return box;
}

// ===========================================================================
// 6. IDF equations
// ===========================================================================
RENDER.idf = (app, main, after) => {
  const res = app.result(); const S = app.state.settings;
  heading(main, 'Fit IDF equations', 'Summarise the design table with an equation. Compare forms and prefer the simplest one that fits; extra parameters often fit noise.');
  const keys = [
    ['kgumbel:robust', 'Koutsoyiannis general IDF, Gumbel — robust estimation'], ['kgumbel:onestep', 'Koutsoyiannis general IDF, Gumbel — one-step least squares'], ['kgumbel:mle', 'Koutsoyiannis general IDF, Gumbel — maximum likelihood'],
    ['kgev:robust', 'Koutsoyiannis general IDF, GEV — robust estimation'], ['kgev:onestep', 'Koutsoyiannis general IDF, GEV — one-step least squares'], ['kgev:mle', 'Koutsoyiannis general IDF, GEV — maximum likelihood'],
    ...Object.entries(FORMS).map(([k, f]) => [k, `${f.label}: ${f.expr}`]),
  ];
  main.append(block('Models to fit',
    recommend('Recommended: the Koutsoyiannis general IDF (Gumbel or GEV, robust estimation). It is consistent with the frequency distribution at every return period, so it extrapolates sensibly; the popular i = K T^m/(t+b)^n form does not.'),
    h('div', { style: { columns: '2 22rem', columnGap: '2rem' } }, keys.map(([k, l]) => h('div', checkbox(l, S.models.includes(k), (v) => app.set((s) => { s.models = v ? [...new Set([...s.models, k])] : s.models.filter((q) => q !== k); }))))),
    h('div.row', { style: { marginTop: '0.5rem' } },
      select('Time unit in equations', S.unit, [['h', 'hours'], ['min', 'minutes']], (v) => app.set((s) => { s.unit = v; })),
      select('Least squares on', S.fitSpace, [['log', 'log intensities (balances durations)'], ['linear', 'intensities']], (v) => app.set((s) => { s.fitSpace = v; }), { cls: 'expert-only' }),
      select('θ for Koutsoyiannis models', String(S.fixTheta), [['auto', 'auto (0 if shortest duration ≥ 1 h)'], ['null', 'always estimate'], ['0', 'fix at 0']], (v) => app.set((s) => { s.fixTheta = v === 'auto' ? 'auto' : v === 'null' ? null : 0; }), { cls: 'expert-only' })),
    res.kind === 'daily' ? note('Daily-only station: the Koutsoyiannis models need annual maxima at several durations, so the formulas are fitted to the design table (which includes the disaggregated rows).', 'warn') : null));

  const sel = res.selectedKey;
  main.append(block('Comparison',
    table([
      { label: 'Use', get: (r) => h('input', { type: 'radio', name: 'selmodel', checked: r.model.key === sel, 'aria-label': `Use ${modelLabel(r.model)}`, onchange: () => app.set((s) => { s.selectedModel = r.model.key; }, { recompute: false }) }) },
      { label: 'Model', get: (r) => modelLabel(r.model) }, { label: 'k', get: (r) => r.metrics.k },
      { label: 'R²', get: (r) => fmt(r.metrics.r2, 4) }, { label: 'RMSE', get: (r) => fmt(r.metrics.rmse, 3) }, { label: 'NSE', get: (r) => fmt(r.metrics.nse, 4) }, { label: 'KGE', get: (r) => fmt(r.metrics.kge, 4) },
      { label: 'Bias %', get: (r) => fmt(r.metrics.pbias, 2) }, { label: 'Max |err| %', get: (r) => fmt(r.metrics.maxAbsPct, 1) }, { label: 'AICc', get: (r) => fmt(r.metrics.aicc, 1) },
      { label: 'Notes', get: (r) => [r.caution, ...r.issues, weakNote(r.model)].filter(Boolean).join(' ') || '' },
    ], res.models, { rowClass: (r) => (r.model.key === sel ? 'best' : null), caption: 'Sorted by AICc (log residuals, penalised for the number of parameters). RMSE in mm/h.' }),
    res.selectionReason ? note(res.selectionReason, /No Koutsoyiannis/.test(res.selectionReason) ? 'warn' : '') : null,
    help('What do these numbers mean?', h('p', 'R² and NSE near 1 and small RMSE, bias and maximum error mean the equation reproduces the design table. AICc trades fit against the number of parameters k; a difference of more than about 2 is meaningful. Per-return-period forms use one parameter set per return period, so k is large. “Curves cross” or “depth decreases” notes mean the equation is physically inconsistent in the fitted range.'))));

  const m = selModel(res);
  if (m) {
    const row = res.models.find((r) => r.model.key === sel);
    const ci = app.state.ci[app.state.active];
    const eqBlock = block(`Selected: ${modelLabel(m)}`, h('pre.eq', equationText(m).join('\n')),
      m.warning ? note(m.warning, 'warn') : null, m.note ? h('p.small.muted', m.note) : null, FORMS[m.form]?.note ? note(FORMS[m.form].note, 'warn') : null,
      plotBox(after, (el) => plots.residualPlot(el, row.metrics.resid, res.design.returnPeriods), { name: 'idf-residuals', label: 'Residuals of the selected equation' }));
    const canCI = m.type === 'kmodel' || FORMS[m.form]?.kind === 'unified';
    if (canCI) {
      eqBlock.append(h('div.row', { style: { marginTop: '0.5rem' } }, button(ci?.paramCI && ci.idfKey === m.key ? 'Recompute parameter intervals' : 'Bootstrap parameter intervals', () => runBootstrap(app, true), { quiet: true }), h('span.small.muted', 'Refits the equation to each bootstrap replicate (up to 300; may take a minute).')));
      if (ci?.paramCI && ci.idfKey === m.key) {
        const names = m.type === 'kmodel' ? KMODELS[m.model].params.map((p, i) => (m.model === 'kgumbel' ? ['xi_Y', 'alpha_Y = lambda', 'theta', 'eta'][i] : p)) : FORMS[m.form].params;
        const point = m.type === 'kmodel' ? m.params : m.unified.params;
        eqBlock.append(table([{ label: 'Parameter', key: 'n' }, { label: 'Estimate', get: (r) => fmt(r.p, 4) }, { label: `${Math.round(ci.level * 100)}% interval`, get: (r) => `${fmt(r.lo, 4)} – ${fmt(r.hi, 4)}` }, { label: 'SE', get: (r) => fmt(r.se, 4) }],
          ci.paramCI.map((c, i) => ({ n: names[i], p: point[i], lo: c.lower, hi: c.upper, se: c.se })), { caption: 'Bootstrap (whole years resampled). Strongly correlated parameters are common; see the correlation matrix in the exported workbook.' }));
        const corr = ci.paramCI.correlation;
        const strong = []; for (let i = 0; i < corr.length; i++) for (let j = i + 1; j < corr.length; j++) if (Math.abs(corr[i][j]) > 0.95) strong.push(`${names[i]}–${names[j]} (${corr[i][j].toFixed(2)})`);
        if (strong.length) eqBlock.append(note(`Weakly identifiable: bootstrap correlation above 0.95 for ${strong.join(', ')}. Individual parameter values are not meaningful on their own; the curve as a whole is.`, 'warn'));
      }
    } else eqBlock.append(h('p.small.muted', 'Per-return-period forms have separate parameters for each return period; their uncertainty is shown through the quantile intervals on the curves screen.'));
    main.append(eqBlock);
  }
};

function weakNote(model) {
  if (model.type !== 'form') return '';
  const fits = model.unified ? [model.unified] : Object.values(model.perT);
  if (fits.some((f) => f.weak)) return 'Weakly identifiable (several parameter sets fit almost equally well).';
  if (fits.some((f) => f.atBound?.some(Boolean))) return 'A parameter hit its bound.';
  return '';
}

// ===========================================================================
// 7. Curves, tables, adjustments
// ===========================================================================
let curveAxes = 'loglog';
let curveSource = 'model';
RENDER.curves = (app, main, after) => {
  const res = app.result(); const S = app.state.settings; const st = app.station();
  heading(main, 'IDF curves and tables', 'The design intensities and depths, with optional climate-change uplift and areal reduction shown beside the baseline.');
  const m = selModel(res);
  const ci = app.state.ci[app.state.active];
  const Ts = res.design.returnPeriods.filter((T) => !(m && m.type === 'form' && FORMS[m.form].kind === 'perT') || m.perT[T]);
  const adjOn = S.climate.mode !== 'none' || S.arf.mode !== 'none';
  const adjust = adjOn ? (d) => adjustmentFactor(d, S.climate, S.arf) : null;
  const dmin = Math.min(...res.design.rows.map((r) => r.d)); const dmax = Math.max(...res.design.rows.map((r) => r.d));
  let ciBands = null;
  if (ci) {
    ciBands = {};
    res.design.returnPeriods.forEach((T, k) => {
      const rows = ci.table.filter((r) => Number.isFinite(r.lower[k]));
      ciBands[T] = { d: rows.map((r) => r.d), lower: rows.map((r) => r.lower[k] / (r.d / 60)), upper: rows.map((r) => r.upper[k] / (r.d / 60)) };
    });
  }
  main.append(block('Curves',
    h('div.row', segmented('Axes', curveAxes, [['loglog', 'Log–log'], ['semilog', 'Semi-log']], (v) => { curveAxes = v; app.render(); }),
      ci ? h('span.small.muted', `Shaded: ${Math.round(ci.level * 100)}% bootstrap interval of the quantiles.`) : h('span.small.muted', 'Compute confidence intervals on the frequency screen to show bands.')),
    m ? null : note('No IDF equation is available; showing quantile points only.', 'warn'),
    plotBox(after, (el) => plots.idfPlot(el, { model: m, design: res.design, Ts, adjust, ci: ciBands, axes: curveAxes, dmin, dmax, showPoints: true }), { cls: 'tall', name: `idf-curves-${slug(st.name)}`, label: 'IDF curves' }),
    h('p.small.muted', 'Lines: fitted equation. Filled circles: quantiles from observed annual maxima. Open diamonds: quantiles estimated by disaggregation. Dashed: adjusted.')));

  // adjustments
  const C = S.climate; const A = S.arf;
  main.append(block('Adjustments',
    h('div.grid2',
      h('div', h('h4', { style: { margin: '0 0 0.4rem' } }, 'Climate-change uplift'),
        h('div.row', select('Uplift', C.mode, [['none', 'None'], ['percent', 'Fixed percentage'], ['perDegree', 'Per degree of warming']], (v) => app.set((s) => { s.climate.mode = v; }, { recompute: false })),
          C.mode === 'percent' ? numberInput('Uplift (%)', C.percent, (v) => app.set((s) => { s.climate.percent = v ?? 0; }, { recompute: false })) : null,
          C.mode === 'perDegree' ? [numberInput('Rate (%/°C)', C.rate, (v) => app.set((s) => { s.climate.rate = v ?? 7; }, { recompute: false })), numberInput('Warming (°C)', C.warming, (v) => app.set((s) => { s.climate.warming = v ?? 0; }, { recompute: false })),
            h('div.expert-only', numberInput('Short-duration rate (%/°C)', C.shortRate, (v) => app.set((s) => { s.climate.shortRate = v; }, { recompute: false }), { hint: 'blank = same rate' })),
            checkbox('Linear instead of compounded', C.linear, (v) => app.set((s) => { s.climate.linear = v; }, { recompute: false }))] : null),
        help('Which rate?', h('p', 'Air can hold about 7% more water vapour per °C of warming (Clausius–Clapeyron). Observed sub-daily extremes sometimes increase faster (“super-CC”), but not everywhere (Martinkova & Kysely 2020). Use the factor required by the governing design guideline where one exists.'))),
      h('div', h('h4', { style: { margin: '0 0 0.4rem' } }, 'Areal reduction'),
        h('div.row', select('Areal reduction', A.mode, [['none', 'None (point rainfall)'], ['constant', 'Constant factor'], ['leclerc', 'US TP-29 fit (experimental)']], (v) => app.set((s) => { s.arf.mode = v; }, { recompute: false })),
          A.mode === 'constant' ? numberInput('Factor', A.value, (v) => app.set((s) => { s.arf.value = v ?? 1; }, { recompute: false }), { step: 0.01 }) : null,
          A.mode === 'leclerc' ? [numberInput('Catchment area (km²)', A.areaKm2, (v) => app.set((s) => { s.arf.areaKm2 = v ?? 0; }, { recompute: false })), tag('experimental')] : null),
        A.mode === 'leclerc' ? note('This formula was fitted to US Weather Bureau curves and its coefficients were not verified from an opened source. It is not validated for Bangladesh.', 'warn') : null)),
    adjOn ? table([{ label: 'Duration', get: (d) => durLabel(d) }, { label: 'Climate factor', get: (d) => upliftFactor(d, C).toFixed(3) }, { label: 'Areal factor', get: (d) => arfFactor(d, A).toFixed(3) }, { label: 'Combined', get: (d) => adjustmentFactor(d, C, A).toFixed(3) }], res.design.rows.map((r) => r.d)) : null));

  // tables
  const rowsFor = (kind) => res.design.rows.map((r) => {
    const vals = res.design.returnPeriods.map((T, k) => {
      const base = curveSource === 'model' && m && Ts.includes(T) ? predict(m, r.d, T) : r.intensity[k];
      return kind === 'intensity' ? base : base * r.d / 60;
    });
    return { d: r.d, source: r.source, vals };
  });
  const tbl = (kind, adjusted) => table([{ label: 'Duration', get: (r) => durLabel(r.d) + (r.source.startsWith('disaggregated') ? ' *' : '') },
    ...res.design.returnPeriods.map((T, k) => ({ label: `${T} yr`, get: (r) => fmt(r.vals[k] * (adjusted ? adjust(r.d) : 1), kind === 'intensity' ? 2 : 1) }))],
  rowsFor(kind), { caption: `${kind === 'intensity' ? 'Intensity (mm/h)' : 'Depth (mm)'}${adjusted ? ', adjusted' : ''}. ${curveSource === 'model' ? 'From the fitted equation.' : 'Frequency-analysis quantiles.'} * = disaggregated from daily data.` });
  main.append(block('Tables',
    h('div.row', segmented('Values from', curveSource, [['model', 'Fitted equation'], ['quantile', 'Quantiles']], (v) => { curveSource = v; app.render(); })),
    h('div.grid2', tbl('intensity', false), tbl('depth', false)),
    adjOn ? h('div.grid2', tbl('intensity', true), tbl('depth', true)) : null,
    h('div.row', button('Download table (.csv)', () => download(`${slug(st.name)}-idf-table.csv`, tableToCSV(res.design, { ci, adjust, model: m, meta: { station: st.name, tool: `Brishti IDF ${app.version}`, distribution: `${S.dist}/${S.method}` } }), 'text/csv'), { quiet: true }),
      button('Download workbook (.xlsx)', () => download(`${slug(st.name)}-idf.xlsx`, workbook(resultSheets(st, res, { ci }))), { quiet: true }))));
};

// ===========================================================================
// 8. Design storm
// ===========================================================================
let lastStorm = null;
RENDER.storm = (app, main, after) => {
  const res = app.result(); const S = app.state.settings; const st = app.station();
  heading(main, 'Design storm', 'Turn the IDF relationship into a rainfall time series for a runoff model.');
  const m = selModel(res);
  const D = S.storm;
  const perT = m && m.type === 'form' && FORMS[m.form].kind === 'perT';
  const Topts = perT ? Object.keys(m.perT).map(Number) : [...new Set([...res.design.returnPeriods, D.T])].sort((a, b) => a - b);
  if (!m) { main.append(note('Fit an IDF equation first (previous screens).', 'error')); return; }
  const set = (fn) => app.set((s) => fn(s.storm), { recompute: false });
  const methods = [['alternatingBlock', 'Alternating block (Chow et al. 1988)'], ['chicago', 'Chicago (Keifer & Chu 1957)'], ['scs', 'SCS/NRCS 24-h type'], ['huff', 'Huff quartile (Illinois point curves)'], ['triangular', 'Triangular (Yen & Chow 1980)'], ['uniform', 'Uniform']];
  main.append(block('Storm',
    h('div.row',
      select('Method', D.method, methods, (v) => set((s) => { s.method = v; if (v === 'scs') s.duration = 1440; })),
      perT ? select('Return period', D.T, Topts.map((t) => [t, `${t} yr`]), (v) => set((s) => { s.T = +v; })) : numberInput('Return period (yr)', D.T, (v) => set((s) => { s.T = v ?? 10; }), { min: 1.01 }),
      numberInput('Duration (min)', D.duration, (v) => set((s) => { s.duration = v ?? 180; })),
      numberInput('Time step (min)', D.dt, (v) => set((s) => { s.dt = v ?? 5; })),
      ['alternatingBlock', 'chicago', 'triangular'].includes(D.method) ? numberInput('Peak position (0–1)', D.peak, (v) => set((s) => { s.peak = v ?? 0.5; }), { step: 0.05, min: 0.05, max: 0.95 }) : null,
      D.method === 'scs' ? select('SCS type', D.scsType, [['I', 'Type I'], ['IA', 'Type IA'], ['II', 'Type II'], ['III', 'Type III']], (v) => set((s) => { s.scsType = v; })) : null,
      D.method === 'huff' ? select('Quartile', D.quartile, [[1, 'First'], [2, 'Second'], [3, 'Third'], [4, 'Fourth']], (v) => set((s) => { s.quartile = +v; })) : null,
      checkbox('Use adjusted IDF', D.adjusted, (v) => set((s) => { s.adjusted = v; }))),
    help('Which pattern?', h('p', 'Alternating block and Chicago storms contain the IDF depth for every shorter duration nested inside them, which suits small urban catchments but is deliberately severe. SCS and Huff patterns come from the USA (Huff: Illinois point storms) and have not been derived for Bangladesh; use them for comparison or where a guideline requires them.'))));
  try {
    if (perT && !m.perT[D.T]) throw new Error(`the selected equation was fitted only for T = ${Topts.join(', ')} yr`);
    const adj = D.adjusted ? (d) => adjustmentFactor(d, S.climate, S.arf) : () => 1;
    const depthFn = (d) => (d <= 0 ? 0 : predict(m, d, D.T) * (d / 60) * adj(d));
    const blocks = designStorm(depthFn, D.duration, D.dt, { method: D.method, peak: D.peak, scsType: D.scsType, quartile: D.quartile });
    const total = blocks.at(-1).cumulative;
    const peak = Math.max(...blocks.map((b) => b.intensity));
    const label = methods.find(([k]) => k === D.method)[1];
    lastStorm = { blocks, label, T: D.T, duration: D.duration, dt: D.dt, total, peak, method: D.method, adjusted: D.adjusted };
    app.state.storm[app.state.active] = { label, T: D.T, duration: D.duration, dt: D.dt, total, peak, method: D.method, adjusted: D.adjusted };
    const ks = [1, 2, 3, 6, 12].filter((k) => k * D.dt <= D.duration);
    main.append(block('Hyetograph', plotBox(after, (el) => plots.hyetograph(el, blocks, D.dt, `${label}, T = ${D.T} yr, ${durLabel(D.duration)}`), { name: `design-storm-${D.method}-T${D.T}`, label: 'Design hyetograph' }),
      h('p', `Total depth ${total.toFixed(2)} mm (IDF depth for ${durLabel(D.duration)}: ${depthFn(D.duration).toFixed(2)} mm); peak intensity ${peak.toFixed(2)} mm/h.`),
      table([{ label: 'Window', get: (k) => durLabel(k * D.dt) }, { label: 'Largest depth in storm (mm)', get: (k) => maxWindowDepth(blocks, k).toFixed(2) }, { label: 'IDF depth (mm)', get: (k) => depthFn(k * D.dt).toFixed(2) }], ks, { caption: 'Nested-window check: how much of the IDF depth each shorter window of the storm contains.' })));
    const meta = { station: st.name, method: label, 'return period (yr)': D.T, 'duration (min)': D.duration, 'time step (min)': D.dt, adjusted: D.adjusted, tool: `Brishti IDF ${app.version}` };
    const base = `${slug(st.name)}-${D.method}-T${D.T}-${D.duration}min`;
    main.append(block('Export',
      h('div.row',
        button('CSV', () => download(`${base}.csv`, stormToCSV(blocks, meta), 'text/csv'), { quiet: true }),
        button('SWMM rain file (.dat)', () => download(`${base}.dat`, stormToSWMMDat(blocks, D.dt, { station: 'IDF1' })), { quiet: true }),
        button('SWMM [TIMESERIES]', () => download(`${base}-swmm-timeseries.txt`, stormToSWMMTimeseries(blocks, D.dt)), { quiet: true }),
        button('HEC-HMS table', () => download(`${base}-hechms.csv`, stormToHecHms(blocks, D.dt), 'text/csv'), { quiet: true })),
      help('Using the files', h('ul',
        h('li', 'SWMM .dat: create a Rain Gage with Data Source = FILE, station ID “IDF1”, Rain Format = INTENSITY, Rain Units = MM, Recording Interval = the time step. The storm starts on 1 January 2000.'),
        h('li', 'SWMM [TIMESERIES]: paste into the [TIMESERIES] section and use it in a Rain Gage with Rain Format = INTENSITY.'),
        h('li', 'HEC-HMS: incremental depths (mm) at the time step; enter them in a Precipitation Gage (Manual Entry) or the Specified Hyetograph method. Browsers cannot write HEC-DSS files directly.')))));
  } catch (e) {
    main.append(note(`Cannot build this storm: ${e.message}`, 'error'));
  }
};

// ===========================================================================
// 9. Stations
// ===========================================================================
let cmpT = 10; let regD = 1440; let regResult = null; let idwPoint = { lat: null, lon: null };
RENDER.stations = (app, main, after) => {
  const S = app.state.settings; const sts = app.state.stations;
  heading(main, 'Compare stations', 'Put several stations side by side, test whether they can be pooled, and estimate at a point between them.');
  const analysed = sts.filter((s) => app.state.results[s.id] && !app.state.dirty.has(s.id));
  main.append(block('Stations', h('p', `${analysed.length} of ${sts.length} station(s) analysed with the current settings.`),
    button('Analyse all stations', async () => { for (const s of sts) await app.ensureResult(s.id); app.render(); }, { disabled: analysed.length === sts.length })));
  if (analysed.length < 1) return;
  const items = analysed.map((s) => { const r = app.state.results[s.id]; const m = selModel(r); return { name: s.name, f: (d, T) => (m ? predict(m, d, T) : NaN), r, s }; });
  main.append(block('IDF curves by station',
    h('div.row', numberInput('Return period (yr)', cmpT, (v) => { cmpT = v ?? 10; app.render(); })),
    plotBox(after, (el) => plots.stationsPlot(el, items, cmpT, 5, 2880), { name: `stations-T${cmpT}`, label: 'IDF curves of all stations' }),
    table([{ label: 'Station', key: 'name' }, ...[15, 60, 180, 360, 1440].map((d) => ({ label: `${durLabel(d)} (mm/h)`, get: (it) => fmt(it.f(d, cmpT), 2) })), { label: 'Model', get: (it) => { const m = selModel(it.r); return m ? modelLabel(m) : '—'; } }], items,
      { caption: `Intensities at T = ${cmpT} yr from each station’s selected equation (extrapolated outside each station’s fitted durations).` })));

  // regional
  const commonD = [...new Set(analysed.flatMap((s) => app.state.results[s.id].ams.durations))].sort((a, b) => a - b);
  if (!commonD.includes(regD)) regD = commonD.includes(1440) ? 1440 : commonD[0];
  const sites = analysed.map((s) => { const r = app.state.results[s.id]; const x = (r.ams.depth[regD] || []).filter(Number.isFinite).map((v) => v * (r.factors[regD] ?? 1)); return x.length >= 5 ? siteLmoments(s.name, x) : null; }).filter(Boolean);
  const reg = block('Regional (index-storm) analysis', tag('experimental'),
    h('p.small.muted', 'Hosking & Wallis (1997) L-moment procedure: discordancy D for each site, heterogeneity H for the group, and a regional growth curve scaled by each site’s mean annual maximum. Not yet cross-checked against the R package lmomRFA.'),
    h('div.row', select('Duration', regD, commonD.map((d) => [d, durLabel(d)]), (v) => { regD = +v; regResult = null; app.render(); })));
  if (sites.length < 5) reg.append(note(`Regional analysis needs at least 5 sites with this duration (have ${sites.length}).`, 'warn'));
  else {
    const D = discordancy(sites);
    reg.append(table([{ label: 'Site', key: 'name' }, { label: 'Years', key: 'n' }, { label: 'Mean (mm)', get: (s) => fmt(s.mean, 1) }, { label: 'L-CV', get: (s) => fmt(s.t, 3) }, { label: 'L-skew', get: (s) => fmt(s.t3, 3) }, { label: 'L-kurt', get: (s) => fmt(s.t4, 3) },
      { label: 'D', get: (s, i) => fmt(D[i].D, 2), cls: (v, s) => (D[sites.indexOf(s)].discordant ? 'num-warn' : null) }], sites, { caption: `Discordancy critical value for ${sites.length} sites: ${fmt(D[0].critical, 3)}.` }));
    reg.append(h('div.row', button('Compute heterogeneity H', async () => {
      try {
        app.setBusy({ text: 'Simulating homogeneous regions…', value: 0 });
        regResult = await app.runJob('heterogeneity', { sites, opt: { nSim: 500, seed: S.uncertainty.seed } }, (i) => app.setBusy({ text: `Heterogeneity ${i.done}/${i.of}`, value: i.done / i.of }));
        app.setBusy(null); app.render();
      } catch (e) { app.setBusy(null); if (e.message !== 'cancelled') app.toast(e.message, 'error'); }
    }, { quiet: true })));
    if (regResult) reg.append(note(`H = ${regResult.H.toFixed(2)} — ${regResult.verdict} (${regResult.nSim} simulated regions, ${regResult.parent} parent).`, regResult.H >= 2 ? 'warn' : ''));
    try {
      const g = regionalGrowthCurve(sites, 'gev');
      const Ts = S.returnPeriods;
      reg.append(table([{ label: 'Site', key: 'name' }, ...Ts.map((T) => ({ label: `${T} yr regional / at-site (mm)`, get: (s) => { const r = analysed.find((a) => a.name === s.name); const row = app.state.results[r.id].observed.rows.find((q) => q.d === regD); const k = app.state.results[r.id].observed.returnPeriods.indexOf(T); return `${fmt(s.mean * g.growth(T), 1)} / ${row && k >= 0 ? fmt(row.depth[k], 1) : '—'}`; } }))], sites,
        { caption: `Regional GEV growth curve (L-moments): ${Ts.map((T) => `q(${T}) = ${g.growth(T).toFixed(3)}`).join(', ')}.` }));
    } catch (e) { reg.append(note(e.message, 'warn')); }
  }
  main.append(reg);

  // IDW
  const located = items.filter((it) => Number.isFinite(it.s.lat) && Number.isFinite(it.s.lon));
  const idw = block('Estimate at an ungauged point', tag('experimental'),
    h('p.small.muted', 'Inverse-distance weighting of log intensities from the stations’ design tables. It ignores topography and rainfall climatology and has no statistical basis; use only for screening.'),
    h('div.row', numberInput('Latitude', idwPoint.lat, (v) => { idwPoint.lat = v; app.render(); }), numberInput('Longitude', idwPoint.lon, (v) => { idwPoint.lon = v; app.render(); })));
  if (located.length < 2) idw.append(note('Enter coordinates for at least two stations on the data screen.', 'warn'));
  else if (Number.isFinite(idwPoint.lat) && Number.isFinite(idwPoint.lon)) {
    const ds = [15, 30, 60, 180, 360, 1440]; const Ts = S.returnPeriods;
    const pts = located.map((it) => ({ x: it.s.lon, y: it.s.lat, params: ds.flatMap((d) => Ts.map((T) => Math.log(it.f(d, T)))) }));
    const v = idwInterpolate(pts, idwPoint.lon, idwPoint.lat);
    idw.append(table([{ label: 'Duration', get: (d) => durLabel(d) }, ...Ts.map((T, k) => ({ label: `${T} yr (mm/h)`, get: (d) => fmt(Math.exp(v[ds.indexOf(d) * Ts.length + k]), 2) }))], ds, { caption: `IDW (power 2, great-circle distance) from ${located.length} stations.` }));
  }
  main.append(idw);
};

// ===========================================================================
// 10. Report and export
// ===========================================================================
RENDER.report = (app, main, after) => {
  const res = app.result(); const st = app.station(); const S = app.state.settings;
  heading(main, 'Report and export', 'A methods-and-results report that states every choice, cites the methods used and can be printed to PDF.');
  const status = h('p.small.muted');
  main.append(block('Report',
    h('div.row', button('Open report', () => makeReport(app, status, 'open')), button('Download report (.html)', () => makeReport(app, status, 'download'), { quiet: true })),
    status, h('p.small.muted', 'To make a PDF, open the report and use your browser’s Print → Save as PDF.')));
  main.append(block('Data and project',
    h('div.row',
      button('Workbook (.xlsx)', () => download(`${slug(st.name)}-idf.xlsx`, workbook(resultSheets(st, res, { ci: app.state.ci[app.state.active] }))), { quiet: true }),
      button('Design table (.csv)', () => download(`${slug(st.name)}-idf-table.csv`, tableToCSV(res.design, { ci: app.state.ci[app.state.active], model: selModel(res), meta: { station: st.name } }), 'text/csv'), { quiet: true }),
      button('Analysis results (.json)', () => download(`${slug(st.name)}-results.json`, JSON.stringify(res, null, 1), 'application/json'), { quiet: true }),
      button('Project (.json)', () => download(`${slug(app.state.project.name)}.idf.json`, projectJSON(app.state), 'application/json'), { quiet: true }))));
  const para = methodsParagraph({ station: st, res, settings: S, selectedKey: res.selectedKey, ci: app.state.ci[app.state.active] });
  const paraEl = h('p.methods-para', para);
  main.append(block('Methods paragraph',
    h('p.small.muted', 'A summary of what was done with this station, in plain text for your report. It updates as you change settings. The full report adds the tables, figures and references.'),
    paraEl,
    h('div.row', button('Copy paragraph', async () => { try { await navigator.clipboard.writeText(para); app.toast('Methods paragraph copied.'); } catch { const r = document.createRange(); r.selectNodeContents(paraEl); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); app.toast('Select-all done; press Ctrl+C to copy.'); } }, { quiet: true }))));
  main.append(block('How to cite',
    h('p.eq', `Joy, M. R. (${new Date().getFullYear()}). Brishti IDF: browser-based rainfall intensity–duration–frequency analysis (version ${app.version}) [software]. https://meawman.github.io/tools/brishti-idf/`),
    h('p.small.muted', 'Cite the methods listed in the report as well (for example Koutsoyiannis et al. 1998; Hosking 1990).')));
};

RENDER.methods = (app, main) => {
  heading(main, 'Methods and references', 'What every option computes, with equations, the evidence behind the daily-to-sub-daily methods, the known limitations and the sources.');
  renderMethods(main);
};

async function makeReport(app, status, how) {
  const res = app.result(); const st = app.station(); const S = app.state.settings;
  status.textContent = 'Drawing figures…';
  const host = h('div.report-figures', { 'data-theme': 'light', style: { position: 'fixed', left: '-10000px', top: 0, width: '900px' } });
  document.body.append(host);
  plots.setRenderRoot(host); // light figures for the report, whatever theme the screen uses
  const images = [];
  const draw = async (fn, caption) => { const el = h('div', { style: { width: '900px', height: '520px' } }); host.append(el); fn(el); images.push({ url: await plots.plotToDataURL(el), caption }); plots.purge(el); };
  try {
    const m = selModel(res);
    const adjOn = S.climate.mode !== 'none' || S.arf.mode !== 'none';
    const Ts = res.design.returnPeriods.filter((T) => !(m && m.type === 'form' && FORMS[m.form].kind === 'perT') || m.perT[T]);
    await draw((el) => plots.idfPlot(el, { model: m, design: res.design, Ts, adjust: adjOn ? (d) => adjustmentFactor(d, S.climate, S.arf) : null, ci: null, axes: 'loglog', dmin: Math.min(...res.design.rows.map((r) => r.d)), dmax: Math.max(...res.design.rows.map((r) => r.d)), showPoints: true }),
      `IDF curves (${m ? modelLabel(m) : 'quantiles'}); points are frequency-analysis quantiles${adjOn ? '; dashed lines adjusted' : ''}.`);
    if (res.series) await draw((el) => plots.recordStrip(el, res.series.dailyStrip), 'Record strip: daily rainfall by year and day of year; red = missing.');
    const d0 = res.ams.durations.includes(1440) ? 1440 : res.ams.durations.at(-1);
    const row = res.observed.rows.find((r) => r.d === d0);
    if (row?.fit.ok) await draw((el) => plots.probabilityPlot(el, res.empirical.find((e) => e.d === d0), [{ label: `${DISTRIBUTIONS[row.fit.dist].label} / ${methodLabel(row.fit.method, row.fit.fixedK)}`, q: (T) => DISTRIBUTIONS[row.fit.dist].ppf(1 - 1 / T, row.fit.params) }], null), `Probability plot, ${durLabel(d0)} annual maxima.`);
    const html = buildReport({ station: st, res, settings: S, ci: app.state.ci[app.state.active], storm: app.state.storm[app.state.active], images, projectName: app.state.project.name, selectedKey: res.selectedKey });
    if (how === 'open') { const w = window.open(URL.createObjectURL(new Blob([html], { type: 'text/html' })), '_blank'); if (!w) download(`${slug(st.name)}-idf-report.html`, html, 'text/html'); }
    else download(`${slug(st.name)}-idf-report.html`, html, 'text/html');
    status.textContent = 'Report ready.';
  } catch (e) {
    status.textContent = `Report failed: ${e.message}`;
  } finally { plots.setRenderRoot(null); host.remove(); }
}
