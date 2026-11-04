// io.js - reading user files into layers (vectors as GeoJSON in lon/lat, rasters as streamed GeoTIFF handles).
import shp from 'shpjs';
import proj4 from 'proj4';
import { openRaster } from '../engine/raster.js';
import { ensureCrs, registerWkt, isKnown, fixPrj } from '../engine/crs.js';
import { unzipSync, strFromU8 } from 'fflate';
import { gdalToGeoJSON, gdalToGeoTiff } from './gp.js';

const ext = (n) => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
const base = (n) => n.replace(/\.[^.]+$/, '');

/** Group a FileList into load jobs: shapefile part sets, single files. */
export function groupFiles(files) {
  const jobs = [], shpParts = new Map();
  for (const f of files) {
    const e = ext(f.name);
    if (['shp', 'dbf', 'prj', 'cpg', 'shx', 'sbn', 'sbx', 'xml'].includes(e)) {
      const k = base(f.name).replace(/\.shp$/i, '').toLowerCase();
      if (!shpParts.has(k)) shpParts.set(k, { name: base(f.name).replace(/\.shp$/i, ''), parts: {} });
      shpParts.get(k).parts[e] = f;
    } else jobs.push({ kind: 'file', file: f });
  }
  for (const s of shpParts.values()) if (s.parts.shp) jobs.push({ kind: 'shp', ...s });
  return jobs;
}

/** Load one job. Returns an array of layer specs: {type:'vector', name, fc, srcCrs} or {type:'raster', name, raster, file}. */
export async function loadJob(job, onStatus = () => {}) {
  if (job.kind === 'shp') {
    const p = job.parts;
    return [await readShapefile(job.name, { shp: await p.shp.arrayBuffer(), dbf: p.dbf ? await p.dbf.arrayBuffer() : undefined,
      prj: p.prj ? await p.prj.text() : null, cpg: p.cpg ? await p.cpg.text() : undefined })];
  }
  const f = job.file, e = ext(f.name);
  if (e === 'zip') {
    // unzipped here (not inside shpjs) so that every .prj can be repaired before it is used
    const files = unzipSync(new Uint8Array(await f.arrayBuffer()));
    const sets = new Map();
    for (const [path, data] of Object.entries(files)) {
      const x = ext(path); if (!['shp', 'dbf', 'prj', 'cpg'].includes(x) || /__MACOSX/.test(path)) continue;
      const k = path.replace(/\.[^.]+$/, '').toLowerCase();
      if (!sets.has(k)) sets.set(k, { name: base(path.split('/').pop()) });
      sets.get(k)[x] = data;
    }
    const out = [];
    for (const v of sets.values()) if (v.shp) out.push(await readShapefile(v.name, { shp: v.shp.buffer.slice(v.shp.byteOffset, v.shp.byteOffset + v.shp.byteLength),
      dbf: v.dbf ? v.dbf.buffer.slice(v.dbf.byteOffset, v.dbf.byteOffset + v.dbf.byteLength) : undefined, prj: v.prj ? strFromU8(v.prj) : null, cpg: v.cpg ? strFromU8(v.cpg) : undefined }));
    if (!out.length) throw new Error(`${f.name}: no shapefile (.shp) inside the zip`);
    return out;
  }
  if (e === 'geojson' || e === 'json') {
    const fc = JSON.parse(await f.text());
    const name = (fc.crs && fc.crs.properties && fc.crs.properties.name) || '';
    const m = /EPSG::?(\d+)/.exec(name);
    let srcCrs = 'EPSG:4326';
    if (m && m[1] !== '4326' && m[1] !== '84') { srcCrs = await ensureCrs(`EPSG:${m[1]}`); reprojectFC(fc, srcCrs, 'EPSG:4326'); }
    return [{ type: 'vector', name: base(f.name), fc: tidy(fc.type === 'Feature' ? { type: 'FeatureCollection', features: [fc] } : fc), srcCrs }];
  }
  if (e === 'tif' || e === 'tiff' || e === 'gtiff') {
    const raster = await openRaster(f, base(f.name));
    if (raster.meta.crs && !isKnown(raster.meta.crs)) { onStatus(`Looking up ${raster.meta.crs}…`); await ensureCrs(raster.meta.crs); }
    return [{ type: 'raster', name: base(f.name), raster, file: f }];
  }
  if (['kml', 'kmz', 'gpkg', 'gml', 'gpx', 'csv', 'tab', 'mif'].includes(e)) {
    onStatus('Loading GDAL (first time only, ~40 MB)…');
    const layers = await gdalToGeoJSON(f);
    return layers.map((l) => ({ type: 'vector', name: l.name, fc: tidy(l.fc), srcCrs: l.srcCrs }));
  }
  if (['img', 'asc', 'bil', 'dem', 'nc', 'hdf', 'jp2', 'vrt', 'sdat', 'rst', 'flt', 'hgt'].includes(e)) {
    onStatus('Loading GDAL (first time only, ~40 MB)…');
    const blob = await gdalToGeoTiff(f);
    const file = new File([blob], base(f.name) + '.tif', { type: 'image/tiff' });
    const raster = await openRaster(file, base(f.name));
    if (raster.meta.crs && !isKnown(raster.meta.crs)) await ensureCrs(raster.meta.crs);
    return [{ type: 'raster', name: base(f.name), raster, file, converted: true }];
  }
  throw new Error(`${f.name}: unsupported file type`);
}

/**
 * One shapefile from its parts. The .prj is repaired first (fixPrj: e.g. the Gulshan 303 datum shift ArcGIS leaves out).
 * Without a usable .prj, projected coordinates are not guessed: the layer comes back with needsCrs and the map asks
 * which coordinate system it uses (see addFiles in main.js), then reprojects it.
 */
async function readShapefile(name, parts) {
  const fx = parts.prj ? fixPrj(parts.prj) : { wkt: null, fixed: null };
  const fc = await shp({ shp: parts.shp, dbf: parts.dbf, prj: fx.wkt || undefined, cpg: parts.cpg });
  if (projectedCoords(fc)) {
    return { type: 'vector', name, fc: tidy(fc), srcCrs: null, needsCrs: true,
      why: fx.wkt ? 'its .prj file could not be read' : 'it has no .prj file' };
  }
  return { type: 'vector', name, fc: tidy(fc), srcCrs: fx.wkt ? registerWkt(fx.wkt) : null,
    info: fx.fixed ? `${name}: ${fx.fixed}.` : null,
    warn: fx.wkt ? null : 'No .prj file: coordinates assumed to be longitude/latitude (WGS 84).' };
}
/** True when the first coordinates are outside longitude/latitude range, i.e. still projected (metres). */
function projectedCoords(fc) {
  for (const ft of (fc.features || []).slice(0, 50)) {
    if (!ft.geometry) continue;
    let c = ft.geometry.coordinates; while (Array.isArray(c[0])) c = c[0];
    return Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90;
  }
  return false;
}

/** shpjs silently keeps projected coordinates when it cannot read a .prj: refuse rather than misplace the layer. */
function checkLonLat(fc, name) {
  for (const ft of (fc.features || []).slice(0, 50)) {
    if (!ft.geometry) continue;
    let c = ft.geometry.coordinates; while (Array.isArray(c[0])) c = c[0];
    if (Math.abs(c[0]) > 180 || Math.abs(c[1]) > 90) throw new Error(`${name}: its .prj could not be read, so the coordinates cannot be placed. Re-save the layer with a standard .prj (e.g. Project tool in ArcGIS to WGS 84 or UTM) or load it as GeoPackage.`);
    return;
  }
}

/** Drop features without geometry, give every feature an id. */
function tidy(fc) {
  fc.features = (fc.features || []).filter((f) => f && f.geometry);
  fc.features.forEach((f, i) => { f.properties = f.properties || {}; f.id = i; });
  return fc;
}

export function reprojectFC(fc, from, to) {
  const fw = proj4(from, to).forward;
  const walk = (c) => (typeof c[0] === 'number' ? fw([c[0], c[1]]) : c.map(walk));
  for (const f of fc.features || []) if (f.geometry) {
    if (f.geometry.type === 'GeometryCollection') f.geometry.geometries.forEach((g) => { g.coordinates = walk(g.coordinates); });
    else f.geometry.coordinates = walk(f.geometry.coordinates);
  }
  return fc;
}

/** Field names and types of a FeatureCollection. */
export function fieldsOf(fc) {
  const m = new Map();
  for (const f of fc.features.slice(0, 500)) for (const [k, v] of Object.entries(f.properties || {})) {
    if (v == null || v === '') continue;
    const t = typeof v === 'number' ? 'number' : 'text';
    if (!m.has(k)) m.set(k, t); else if (m.get(k) !== t) m.set(k, 'text');
  }
  return [...m].map(([name, type]) => ({ name, type }));
}
export function geomKind(fc) {
  const t = fc.features[0] && fc.features[0].geometry.type;
  return /Polygon/.test(t) ? 'polygon' : /Line/.test(t) ? 'line' : /Point/.test(t) ? 'point' : 'mixed';
}
