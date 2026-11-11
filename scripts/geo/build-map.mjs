// Builds data/geo/bangladesh.json: a simplified outline of Bangladesh and the
// major rivers crossing it, from Natural Earth 1:10m (public domain).
//
//   node scripts/geo/build-map.mjs
//
// The two source files (about 20 MB) are downloaded to .tmp/geo/ and are not
// committed. The output is small, committed, and read by the site build, so
// this script only needs re-running if the map extent or detail changes.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = join(ROOT, '.tmp', 'geo');
const OUT = join(ROOT, 'data', 'geo', 'bangladesh.json');
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/';
const FILES = { rivers: 'ne_10m_rivers_lake_centerlines.geojson', countries: 'ne_10m_admin_0_countries.geojson' };

// Map window (degrees). Rivers are clipped to it; the outline is drawn whole.
const BBOX = { w: 87.75, e: 92.85, s: 20.45, n: 26.75 };
const TOL_OUTLINE = 0.012; // about 1.3 km
const TOL_RIVER = 0.008;
const MIN_ISLAND_AREA = 0.004; // square degrees; drops specks that would only add noise

async function fetchCached(name) {
  const file = join(TMP, name);
  try { await access(file); } catch {
    process.stdout.write('downloading ' + name + ' … ');
    const res = await fetch(BASE + name);
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + name);
    await writeFile(file, Buffer.from(await res.arrayBuffer()));
    console.log('done');
  }
  return JSON.parse(await readFile(file, 'utf8'));
}

// Douglas–Peucker
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let max = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      // closed ring (start = end): measure from the start point instead of from a zero-length chord
      const d = len < 1e-9 ? Math.hypot(pts[i][0] - ax, pts[i][1] - ay)
        : Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const ringArea = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const round = (p) => [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000];
const inside = (p) => p[0] >= BBOX.w && p[0] <= BBOX.e && p[1] >= BBOX.s && p[1] <= BBOX.n;

// Split a line into the runs that fall inside the window, cutting at the window edge
function clipLine(line) {
  const out = []; let cur = [];
  const cut = (a, b) => { // point where a→b crosses the window edge (a inside, b outside or the reverse)
    let lo = 0, hi = 1;
    const at = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const aIn = inside(a);
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (inside(at(m)) === aIn) lo = m; else hi = m; }
    return at((lo + hi) / 2);
  };
  for (let i = 0; i < line.length; i++) {
    const p = line[i], prev = line[i - 1];
    if (inside(p)) {
      if (!cur.length && prev) cur.push(cut(p, prev));
      cur.push(p);
    } else if (cur.length) { cur.push(cut(prev, p)); out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

await mkdir(TMP, { recursive: true });
await mkdir(dirname(OUT), { recursive: true });
const [rivers, countries] = await Promise.all([fetchCached(FILES.rivers), fetchCached(FILES.countries)]);

const bd = countries.features.find((f) => f.properties.ADMIN === 'Bangladesh');
if (!bd) throw new Error('Bangladesh not found in the countries file');
const polys = bd.geometry.type === 'Polygon' ? [bd.geometry.coordinates] : bd.geometry.coordinates;
const outline = polys.map((poly) => poly[0]).filter((ring) => ringArea(ring) >= MIN_ISLAND_AREA)
  .map((ring) => simplify(ring, TOL_OUTLINE).map(round)).sort((a, b) => b.length - a.length);

const byName = new Map();
for (const f of rivers.features) {
  const p = f.properties;
  if (p.featurecla && !/river/i.test(p.featurecla)) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const line of lines) for (const run of clipLine(line)) {
    const name = p.name_en || p.name || '';
    const key = name || 'unnamed';
    if (!byName.has(key)) byName.set(key, { name, scalerank: p.scalerank ?? 9, lines: [] });
    const r = byName.get(key);
    r.scalerank = Math.min(r.scalerank, p.scalerank ?? 9);
    r.lines.push(simplify(run, TOL_RIVER).map(round));
  }
}
const riverList = [...byName.values()].filter((r) => r.lines.some((l) => l.length > 1))
  .sort((a, b) => a.scalerank - b.scalerank || a.name.localeCompare(b.name));

const out = {
  source: 'Natural Earth 1:10m (rivers and lake centerlines; admin 0 countries), v5.1.2 — public domain, naturalearthdata.com',
  note: 'Generated by scripts/geo/build-map.mjs. Simplified for display; not for measurement.',
  bbox: BBOX,
  outline,
  rivers: riverList,
};
await writeFile(OUT, JSON.stringify(out) + '\n');
const pts = (a) => a.reduce((s, l) => s + l.length, 0);
console.log('outline: ' + outline.length + ' rings, ' + pts(outline) + ' points');
for (const r of riverList) console.log('river: ' + (r.name || '(unnamed)') + ' · rank ' + r.scalerank + ' · ' + r.lines.length + ' lines, ' + pts(r.lines) + ' points');
console.log('wrote ' + OUT + ' (' + Buffer.byteLength(JSON.stringify(out)) + ' bytes)');
