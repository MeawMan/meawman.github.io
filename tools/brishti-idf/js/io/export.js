/**
 * export.js — tables to CSV/XLSX, fitted equations as text, JSON project save/load.
 */
import { FORMS, KMODELS, predict } from '../core/idf.js';
import { TOOL_VERSION } from '../pipeline.js';
import { DISTRIBUTIONS } from '../core/distributions.js';

const n = (v, d = 4) => (Number.isFinite(v) ? Number(v.toPrecision(d + 2)) : v);

/** Human-readable equation(s) of a fitted model, with units. */
export function equationText(model) {
  const u = model.unit === 'h' ? 'h' : 'min';
  const unitLine = `i in mm/h, t in ${u}, T in years`;
  if (model.type === 'kmodel') {
    const p = model.params;
    if (model.model === 'kgumbel') {
      const lambda = p[1]; const psi = p[0] / p[1];
      return [`i = ${n(lambda)} * [${n(psi)} - ln(-ln(1 - 1/T))] / (t + ${n(p[2])})^${n(p[3])}`, unitLine,
        `Koutsoyiannis et al. (1998) general IDF, Gumbel; estimation: ${model.method}`];
    }
    return [`i = {${n(p[0])} + ${n(p[1])} * [1 - (-ln(1 - 1/T))^(${n(p[2])})] / (${n(p[2])})} / (t + ${n(p[3])})^${n(p[4])}`, unitLine,
      `Koutsoyiannis et al. (1998) general IDF, GEV (Hosking shape k = ${n(p[2])}); estimation: ${model.method}`];
  }
  const f = FORMS[model.form];
  const sub = (params) => {
    let e = f.expr;
    f.params.forEach((name, j) => { e = e.replace(new RegExp(`\\b${name}\\b`, 'g'), String(n(params[j]))); });
    return e;
  };
  if (f.kind === 'unified') return [sub(model.unified.params), unitLine, `${f.label}; least squares in ${model.space} space`];
  const lines = [`${f.expr}   (${f.label}; one parameter set per return period; least squares in ${model.space} space)`, unitLine];
  for (const [T, v] of Object.entries(model.perT)) lines.push(`T = ${T} yr: ` + f.params.map((nm, j) => `${nm} = ${n(v.params[j])}`).join(', '));
  return lines;
}

export function modelLabel(model) {
  if (model.type === 'kmodel') return `${KMODELS[model.model].label} (${model.method})`;
  return FORMS[model.form].label;
}

/** CSV of a design/quantile table (depth and intensity), optionally with CI and adjustment. */
export function tableToCSV(design, { ci, adjust, model, meta = {} } = {}) {
  const Ts = design.returnPeriods;
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${v}`);
  const head = ['duration_min', 'source'];
  for (const T of Ts) head.push(`depth_T${T}_mm`, `intensity_T${T}_mm_per_h`);
  if (model) for (const T of Ts) head.push(`model_intensity_T${T}`);
  if (adjust) for (const T of Ts) head.push(`adjusted_intensity_T${T}`);
  if (ci) for (const T of Ts) head.push(`depth_T${T}_lower`, `depth_T${T}_upper`);
  lines.push(head.join(','));
  for (const r of design.rows) {
    const row = [r.d, r.source ?? ''];
    Ts.forEach((T, k) => row.push(r.depth[k]?.toFixed(3), r.intensity[k]?.toFixed(3)));
    if (model) Ts.forEach((T) => row.push(predict(model, r.d, T).toFixed(3)));
    if (adjust) Ts.forEach((T, k) => row.push((r.intensity[k] * adjust(r.d)).toFixed(3)));
    if (ci) { const c = ci.table.find((q) => q.d === r.d); Ts.forEach((T, k) => row.push(c ? c.lower[k]?.toFixed(3) : '', c ? c.upper[k]?.toFixed(3) : '')); }
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

/** XLSX workbook with several sheets (uses vendored SheetJS, window.XLSX). */
export function workbook(sheets) {
  const X = window.XLSX;
  const wb = X.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), name.slice(0, 31));
  const out = X.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/** Build the standard result sheets for one station. */
export function resultSheets(station, res, extra = {}) {
  const Ts = res.design.returnPeriods;
  const sheets = {};
  sheets.Intensity = [['duration (min)', 'source', ...Ts.map((T) => `T=${T} yr (mm/h)`)], ...res.design.rows.map((r) => [r.d, r.source, ...r.intensity.map((v) => n(v))])];
  sheets.Depth = [['duration (min)', 'source', ...Ts.map((T) => `T=${T} yr (mm)`)], ...res.design.rows.map((r) => [r.d, r.source, ...r.depth.map((v) => n(v))])];
  sheets['Annual maxima'] = [['year', ...res.ams.durations.map((d) => `${d} min (mm, raw)`)], ...res.ams.years.map((y, j) => [y, ...res.ams.durations.map((d) => (Number.isFinite(res.ams.depth[d][j]) ? res.ams.depth[d][j] : ''))])];
  sheets['Fixed-interval factors'] = [['duration (min)', 'factor'], ...Object.entries(res.factors).map(([d, f]) => [Number(d), f])];
  sheets.Distributions = [['duration (min)', 'distribution', 'method', 'parameters', 'AICc', 'AD', 'PPCC', 'KS', 'note'],
    ...res.comparison.flatMap((c) => c.rows.map((r) => [c.d, DISTRIBUTIONS[r.dist].label, r.method, r.params ? r.params.map((v) => n(v)).join('; ') : '', r.gof ? n(r.gof.aicc) : '', r.gof ? n(r.gof.ad) : '', r.gof ? n(r.gof.ppcc) : '', r.gof ? n(r.gof.ks) : '', r.message]))];
  sheets['IDF models'] = [['model', 'parameters (k)', 'R2', 'RMSE (mm/h)', 'NSE', 'KGE', 'PBIAS %', 'MAPE %', 'AICc', 'caution', 'equation'],
    ...res.models.map((m) => [modelLabel(m.model), m.metrics.k, n(m.metrics.r2), n(m.metrics.rmse), n(m.metrics.nse), n(m.metrics.kge), n(m.metrics.pbias), n(m.metrics.mape), n(m.metrics.aicc), [m.caution, ...m.issues].filter(Boolean).join(' '), equationText(m.model).join(' | ')])];
  sheets.Trends = [['duration (min)', 'n', 'Mann-Kendall S', 'Z', 'p (two-sided)', 'Sen slope (mm/yr)'], ...res.trends.map((t) => [t.d, t.n, t.S, n(t.Z), n(t.p), n(t.sen)])];
  if (extra.ci) sheets['Confidence intervals'] = [['duration (min)', ...Ts.flatMap((T) => [`T=${T} lower (mm)`, `T=${T} upper (mm)`])], ...extra.ci.table.map((r) => [r.d, ...Ts.flatMap((T, k) => [n(r.lower[k]), n(r.upper[k])])])];
  sheets.About = [['Tool', `Brishti IDF ${TOOL_VERSION}`], ['Station', station.name], ['Generated', new Date().toISOString()], ['Note', 'Depths include fixed-interval factors where applied; see "Fixed-interval factors".']];
  return sheets;
}

/**
 * JSON project: settings + station data (optional) + metadata. Results are recomputed on load
 * (deterministic: all stochastic steps are seeded), so saved projects reproduce exactly.
 */
export function projectJSON(state, { includeData = true } = {}) {
  return JSON.stringify({
    format: 'brishti-idf-project', toolVersion: TOOL_VERSION, saved: new Date().toISOString(),
    name: state.project.name, settings: state.settings, mode: state.mode,
    stations: state.stations.map((s) => ({ id: s.id, name: s.name, lat: s.lat ?? null, lon: s.lon ?? null, source: s.source ?? null,
      data: includeData ? serialiseData(s.data) : null })),
  });
}

function serialiseData(d) {
  if (d.kind === 'series') return { ...d, values: Array.from(d.values, (v) => (Number.isNaN(v) ? null : v)) };
  if (d.kind === 'records') return { ...d, records: d.records.map((r) => [r.t, Number.isFinite(r.v) ? r.v : null]) };
  return d;
}

export function loadProject(text) {
  const p = JSON.parse(text);
  if (p.format !== 'brishti-idf-project') throw new Error('not a Brishti IDF project file');
  const stations = p.stations.map((s) => {
    let data = s.data;
    if (data?.kind === 'series') data = { ...data, values: data.values.map((v) => (v == null ? NaN : v)) };
    if (data?.kind === 'records') data = { ...data, records: data.records.map(([t, v]) => ({ t, v: v == null ? NaN : v })) };
    return { ...s, data };
  });
  return { ...p, stations, versionNote: p.toolVersion !== TOOL_VERSION ? `Project saved with version ${p.toolVersion}; this is ${TOOL_VERSION}. Results may differ if methods changed (see CHANGELOG).` : null };
}
