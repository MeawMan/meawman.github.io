// crs.js - coordinate reference systems. proj4 definitions for the systems met in Bangladesh work,
// all UTM zones, and a lookup on epsg.io (only the EPSG code is sent) for anything else.
import proj4 from 'proj4';

const DEFS = {
  'EPSG:4326': '+proj=longlat +datum=WGS84 +no_defs',
  'EPSG:3857': '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  // Gulshan 303 / Bangladesh Transverse Mercator as registered by EPSG (false northing 0), Everest 1830 (1937 adj.);
  // datum shift = EPSG transformation 1919 (Gulshan 303 to WGS 84), as published on epsg.io
  'EPSG:3106': '+proj=tmerc +lat_0=0 +lon_0=90 +k=0.9996 +x_0=500000 +y_0=0 +a=6377276.345 +rf=300.8017 +towgs84=283.729,735.942,261.143,0,0,0,0 +units=m +no_defs',
  'EPSG:4682': '+proj=longlat +a=6377276.345 +rf=300.8017 +towgs84=283.729,735.942,261.143,0,0,0,0 +no_defs', // Gulshan 303 geographic
  // BTM as used in Bangladesh practice (BWDB, SoB; ArcGIS "UTM_Bangladesh_(BTM)"): same as EPSG:3106 but false northing -2 000 000 m
  'BTM:BD': '+proj=tmerc +lat_0=0 +lon_0=90 +k=0.9996 +x_0=500000 +y_0=-2000000 +a=6377276.345 +rf=300.8017 +towgs84=283.729,735.942,261.143,0,0,0,0 +units=m +no_defs',
};
for (let z = 1; z <= 60; z++) {
  DEFS[`EPSG:${32600 + z}`] = `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`;
  DEFS[`EPSG:${32700 + z}`] = `+proj=utm +zone=${z} +south +datum=WGS84 +units=m +no_defs`;
}
export const NAMES = {
  'EPSG:4326': 'WGS 84 (geographic)', 'EPSG:3857': 'WGS 84 / Web Mercator', 'EPSG:3106': 'Gulshan 303 / Bangladesh TM, EPSG version (false northing 0)', 'BTM:BD': 'BTM, Bangladesh practice (Gulshan 303, false northing −2 000 000)',
  'EPSG:4682': 'Gulshan 303 (geographic)',
  'EPSG:32645': 'WGS 84 / UTM zone 45N', 'EPSG:32646': 'WGS 84 / UTM zone 46N',
};
export const COMMON = ['EPSG:4326', 'EPSG:32646', 'EPSG:32645', 'BTM:BD', 'EPSG:3106', 'EPSG:3857', 'EPSG:4682'];
Object.entries(DEFS).forEach(([k, v]) => proj4.defs(k, v));
/** Definitions registered at run time (epsg.io lookups, .prj WKT, custom proj4), so workers can be told about them. */
export const EXTRA = {};
const remember = (k, v) => { EXTRA[k] = v; proj4.defs(k, v); };
export function loadExtra(defs) { for (const [k, v] of Object.entries(defs || {})) if (!proj4.defs(k)) proj4.defs(k, v); }

export function crsName(code) {
  if (NAMES[code]) return NAMES[code];
  const m = /^EPSG:32([67])(\d\d)$/.exec(code || '');
  if (m) return `WGS 84 / UTM zone ${+m[2]}${m[1] === '6' ? 'N' : 'S'}`;
  return code || 'unknown';
}
export const isKnown = (code) => !!code && !!proj4.defs(code);
export const isGeographic = (code) => { const d = proj4.defs(code); return !!d && d.projName === 'longlat'; };

/** Register a CRS from an EPSG code by asking epsg.io for its proj4 string. */
export async function ensureCrs(code) {
  if (!code) throw new Error('No coordinate system');
  if (isKnown(code)) return code;
  const m = /^EPSG:(\d+)$/.exec(code);
  if (!m) throw new Error(`Unknown coordinate system ${code}`);
  const r = await fetch(`https://epsg.io/${m[1]}.proj4`);
  const txt = (await r.text()).trim();
  if (!r.ok || !txt.startsWith('+')) throw new Error(`EPSG:${m[1]} not found`);
  remember(code, txt); NAMES[code] = NAMES[code] || `EPSG:${m[1]}`;
  return code;
}
/**
 * Repair a .prj before use. ArcGIS writes the Gulshan 303 datum without a TOWGS84 shift, so proj4 would treat it as
 * WGS 84 and every coordinate would be off by a few hundred metres. Add the EPSG 1919 shift when it is missing.
 * Returns { wkt, fixed } where fixed names what was changed (or is null).
 */
export function fixPrj(wkt) {
  if (!wkt || /TOWGS84/i.test(wkt) || !/DATUM\["[^"]*gulshan/i.test(wkt)) return { wkt, fixed: null };
  const out = wkt.replace(/(DATUM\["[^"]*gulshan[^"]*",\s*SPHEROID\[[^\]]*\])/i, '$1,TOWGS84[283.729,735.942,261.143,0,0,0,0]');
  return out === wkt ? { wkt, fixed: null } : { wkt: out, fixed: 'Gulshan 303 datum shift to WGS 84 added (EPSG transformation 1919)' };
}
/** The -t_srs / -s_srs argument for GDAL: EPSG codes as they are, anything else as its proj4 definition. */
export function srsArg(code) {
  if (!code || /^EPSG:\d+$/.test(code)) return code;
  const d = DEFS[code] || EXTRA[code];
  return typeof d === 'string' ? d : code; // proj4 string or WKT: GDAL reads both
}
/** Short label for a layer's coordinate system, used when several layers are compared. */
export const crsLabel = (code) => crsName(code) + (code && /^EPSG:\d+$/.test(code) ? ` (${code})` : '');

/** Register a CRS from WKT (.prj) text; returns a code-like key. */
export function registerWkt(wkt) {
  wkt = fixPrj(wkt).wkt;
  const em = /AUTHORITY\["EPSG","(\d+)"\]\]\s*$/.exec(wkt.trim()) || /ID\["EPSG",(\d+)\]\]\s*$/.exec(wkt.trim());
  if (em && isKnown(`EPSG:${em[1]}`)) return `EPSG:${em[1]}`;
  const key = 'WKT:' + hash(wkt);
  if (!proj4.defs(key)) remember(key, wkt);
  const nm = /^\s*(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\["([^"]+)"/.exec(wkt); NAMES[key] = nm ? nm[1] : 'custom (.prj)';
  return key;
}
export function registerProj4(str, name) { const key = 'P4:' + hash(str); remember(key, str); NAMES[key] = name || 'custom'; return key; }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(36); }

export const transformer = (from, to) => (from === to ? (p) => p : proj4(from, to).forward);

/** UTM zone EPSG code for a lon/lat. */
export const utmFor = (lon, lat) => `EPSG:${lat >= 0 ? 326 : 327}${String(Math.min(60, Math.floor((lon + 180) / 6) + 1)).padStart(2, '0')}`;

/** EPSG code from GeoTIFF geokeys (ProjectedCSTypeGeoKey / GeographicTypeGeoKey). */
export function epsgFromGeoKeys(k) {
  if (!k) return null;
  if (k.ProjectedCSTypeGeoKey && k.ProjectedCSTypeGeoKey !== 32767) return `EPSG:${k.ProjectedCSTypeGeoKey}`;
  if (k.GTModelTypeGeoKey === 2 && k.GeographicTypeGeoKey && k.GeographicTypeGeoKey !== 32767) return `EPSG:${k.GeographicTypeGeoKey}`;
  if (k.GeographicTypeGeoKey && !k.ProjectedCSTypeGeoKey && k.GeographicTypeGeoKey !== 32767) return `EPSG:${k.GeographicTypeGeoKey}`;
  return null;
}

// ---- WGS84 ellipsoid helpers (exact cell areas and metre cell sizes for geographic rasters) ----
const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), E = Math.sqrt(E2);
const q = (phi) => { const s = Math.sin(phi); return s / (1 - E2 * s * s) + Math.log((1 + E * s) / (1 - E * s)) / (2 * E); };
/** Area (m²) of a lon/lat cell between latitudes lat1, lat2 (degrees), dlon degrees wide. Exact on the ellipsoid. */
export function cellAreaGeo(lat1, lat2, dlon) {
  return Math.abs(A * A * (1 - E2) / 2 * (dlon * Math.PI / 180) * (q(lat2 * Math.PI / 180) - q(lat1 * Math.PI / 180)));
}
/** Metres per degree of longitude (dx) and latitude (dy) at a latitude (prime vertical / meridional radii). */
export function metresPerDegree(latDeg) {
  const p = latDeg * Math.PI / 180, s = Math.sin(p), w = 1 - E2 * s * s;
  const N = A / Math.sqrt(w), M = A * (1 - E2) / Math.pow(w, 1.5);
  return { dx: N * Math.cos(p) * Math.PI / 180, dy: M * Math.PI / 180 };
}
/** Geodesic area (m²) of a ring in lon/lat degrees, ellipsoidal (authalic-latitude trapezoid sum). */
export function ringAreaGeo(ring) {
  let s = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [l1, p1] = ring[i], [l2, p2] = ring[(i + 1) % n];
    let dl = l2 - l1; if (dl > 180) dl -= 360; if (dl < -180) dl += 360;
    s += dl * Math.PI / 180 * (q(p1 * Math.PI / 180) + q(p2 * Math.PI / 180)) / 2;
  }
  return Math.abs(A * A * (1 - E2) / 2 * s);
}
export function ringAreaPlanar(ring) {
  let s = 0; for (let i = 0, n = ring.length; i < n; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n]; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
}
