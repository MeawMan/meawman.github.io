// Study-site map: Bangladesh outline and major rivers (Natural Earth, see
// data/geo/bangladesh.json) with the study sites from content.json.
// The base geometry is emitted once as an SVG <symbol>-style group and reused
// by the hero figure and the larger map in the study-sites section.
import { esc } from './util.mjs';

const K = 60; // SVG units per degree of latitude
const COS = Math.cos((23.6 * Math.PI) / 180); // equirectangular, true scale at mid-latitude

export function projector(geo) {
  const { w, e, s, n } = geo.bbox;
  const pt = (lon, lat) => [(lon - w) * COS * K, (n - lat) * K];
  return { pt, width: Math.round((e - w) * COS * K), height: Math.round((n - s) * K) };
}

const f = (v) => (Math.round(v * 10) / 10).toString();

function pathOf(line, pt, close) {
  return line.map((p, i) => { const [x, y] = pt(p[0], p[1]); return (i ? 'L' : 'M') + f(x) + ' ' + f(y); }).join('') + (close ? 'Z' : '');
}

/** Hidden sprite holding the shared base map; place once near the top of <body>. */
export function mapSprite(geo) {
  if (!geo) return '';
  const { pt } = projector(geo);
  const land = geo.outline.map((r) => pathOf(r, pt, true)).join('');
  const major = geo.rivers.filter((r) => r.scalerank < 4).map((r) => r.lines.map((l) => pathOf(l, pt)).join('')).join('');
  const minor = geo.rivers.filter((r) => r.scalerank >= 4).map((r) => r.lines.map((l) => pathOf(l, pt)).join('')).join('');
  const label = (lon, lat, text, cls) => { const [x, y] = pt(lon, lat); return '<text class="map-lbl' + (cls || '') + '" x="' + f(x) + '" y="' + f(y) + '">' + text + '</text>'; };
  return '<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs><g id="bd-base">' +
    '<path class="map-land" d="' + land + '"/>' +
    '<path class="map-river minor" d="' + minor + '"/>' +
    '<path class="map-river" d="' + major + '"/>' +
    label(89.95, 24.75, 'Jamuna') + label(88.72, 23.8, 'Padma') + label(90.95, 23.35, 'Meghna') + label(90.15, 21.05, 'Bay of Bengal', ' sea') +
    '</g></defs></svg>';
}

/** Small locator map for the hero: one image, not interactive. */
export function heroMap(data, geo) {
  if (!geo) return '';
  const { pt, width, height } = projector(geo);
  const sites = data.studyAreas || [];
  const dots = sites.map((s) => { const [x, y] = pt(s.lon, s.lat); return '<circle class="map-dot' + (s.current ? ' now' : '') + '" cx="' + f(x) + '" cy="' + f(y) + '" r="' + (s.current ? 5 : 3.6) + '"/>'; }).join('');
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" role="img" aria-label="Map of Bangladesh showing the Padma, Jamuna and Meghna rivers and ' + sites.length + ' study sites">' +
    '<use href="#bd-base"/>' + dots + '</svg>';
}

/** Larger numbered map. Decorative for assistive technology: the numbered list beside it carries the same information. */
export function sitesMap(data, geo) {
  if (!geo) return '';
  const { pt, width, height } = projector(geo);
  const sites = data.studyAreas || [];
  const pins = sites.map((s, i) => {
    const [x, y] = pt(s.lon, s.lat);
    return '<a class="map-pin' + (s.current ? ' now' : '') + '" href="#site-' + (i + 1) + '" tabindex="-1" data-site="' + (i + 1) + '">' +
      '<circle class="hit" cx="' + f(x) + '" cy="' + f(y) + '" r="11"/><circle class="ring" cx="' + f(x) + '" cy="' + f(y) + '" r="9"/>' +
      '<text x="' + f(x) + '" y="' + f(y + 4.2) + '">' + (i + 1) + '</text><title>' + esc(s.name) + '</title></a>';
  }).join('');
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" aria-hidden="true" focusable="false"><use href="#bd-base"/>' + pins + '</svg>';
}
