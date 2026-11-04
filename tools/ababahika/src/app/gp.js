// gp.js - geoprocessing with GDAL 3 compiled to WebAssembly (gdal3.js), loaded the first time a tool needs it.
// Every operation runs inside GDAL's own worker; inputs are copied into its in-memory file system, so
// the inputs and outputs of these tools must fit in browser memory (unlike zonal statistics, which stream).
import { zipSync } from 'fflate';
import { srsArg } from '../engine/crs.js';

let gdalPromise = null;
const BASE = new URL('../vendor/gdal/', import.meta.url).href;

export function loadGdal(onStatus = () => {}) {
  if (gdalPromise) return gdalPromise;
  gdalPromise = new Promise((resolve, reject) => {
    onStatus('Loading GDAL (≈40 MB, cached after the first time)…');
    const s = document.createElement('script');
    s.src = BASE + 'gdal3.js';
    s.onload = () => window.initGdalJs({ paths: { wasm: 'gdal3WebAssembly.wasm', data: 'gdal3WebAssembly.data', js: 'gdal3.js' }, path: BASE, useWorker: true })
      .then((g) => { onStatus(''); resolve(g); }, reject);
    s.onerror = () => reject(new Error('Could not load GDAL'));
    document.head.appendChild(s);
  }).catch((e) => { gdalPromise = null; throw e; });
  return gdalPromise;
}

let seq = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;
const safe = (n) => (n || 'layer').replace(/[^\w.-]+/g, '_').slice(0, 60);

async function openFile(G, file) {
  const r = await G.open(file);
  if (!r.datasets || !r.datasets.length) throw new Error(`GDAL could not open ${file.name}${r.errors && r.errors.length ? ': ' + r.errors.map((e) => e.message).join(' ') : ''}`);
  return r.datasets;
}
const geojsonFile = (fc, name) => new File([JSON.stringify(fc)], `${safe(name)}_${uid('v')}.geojson`, { type: 'application/geo+json' });
async function bytes(G, out) { return G.getFileBytes(out.local || out.real || out); }

/** Any OGR vector (KML, GPKG, GML, GPX…) -> GeoJSON layers in lon/lat. */
export async function gdalToGeoJSON(file) {
  const G = await loadGdal();
  const dss = await openFile(G, file), out = [];
  for (const ds of dss) {
    const info = await G.getInfo(ds);
    const names = (info.layers || []).map((l) => l.name);
    for (const ln of names.length ? names : [null]) {
      const o = await G.ogr2ogr(ds, ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-lco', 'RFC7946=YES', ...(ln ? [ln] : [])], uid('gj'));
      const fc = JSON.parse(new TextDecoder().decode(await bytes(G, o)));
      out.push({ name: ln || file.name.replace(/\.[^.]+$/, ''), fc, srcCrs: null });
    }
    await G.close(ds);
  }
  return out;
}
/** Any GDAL raster -> tiled, compressed GeoTIFF Blob. */
export async function gdalToGeoTiff(file) {
  const G = await loadGdal();
  const [ds] = await openFile(G, file);
  const o = await G.gdal_translate(ds, ['-of', 'GTiff', '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE'], uid('r'));
  const b = new Blob([await bytes(G, o)], { type: 'image/tiff' });
  await G.close(ds);
  return b;
}

const TIFF_OUT = ['-of', 'GTiff', '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'BIGTIFF=IF_SAFER'];

/** Reproject a raster. opts: crs (EPSG:xxxx or proj4), resampling, res (target cell size, optional). */
export async function projectRaster(file, { crs, resampling = 'near', res = null }, onStatus) {
  const G = await loadGdal(onStatus);
  const [ds] = await openFile(G, file);
  const args = [...TIFF_OUT, '-t_srs', srsArg(crs), '-r', resampling, ...(res ? ['-tr', String(res), String(res)] : [])];
  const o = await G.gdalwarp(ds, args, uid('proj'));
  const b = new Blob([await bytes(G, o)], { type: 'image/tiff' }); await G.close(ds); return b;
}

/** Clip a raster by polygons (dissolved first, so overlaps and slivers do not break the cutline) or by an extent. */
export async function clipRaster(file, { polygons = null, extent = null, extentCrs = null, nodata = null, crop = true }, onStatus) {
  const G = await loadGdal(onStatus);
  const [ds] = await openFile(G, file);
  let args = [...TIFF_OUT];
  const opened = [ds];
  if (polygons) {
    const [cds] = await openFile(G, geojsonFile(polygons, 'cut')); opened.push(cds);
    const lname = (await G.getInfo(cds)).layers[0].name;
    const u = await G.ogr2ogr(cds, ['-f', 'GeoJSON', '-dialect', 'sqlite', '-sql', `SELECT ST_Union(MakeValid(geometry)) AS geometry FROM "${lname}"`, '-nln', 'cut'], uid('cut'));
    args.push('-cutline', u.local, ...(crop ? ['-crop_to_cutline'] : []));
  } else if (extent) {
    args.push('-te', ...extent.map(String), ...(extentCrs ? ['-te_srs', extentCrs] : []));
  }
  if (nodata != null) args.push('-dstnodata', String(nodata));
  const o = await G.gdalwarp(ds, args, uid('clip'));
  const b = new Blob([await bytes(G, o)], { type: 'image/tiff' });
  for (const d of opened) await G.close(d);
  return b;
}

/** Mosaic several rasters into one (first raster's CRS unless crs is given). Later inputs win in overlaps. */
export async function mergeRasters(files, { crs = null, resampling = 'near', nodata = null }, onStatus) {
  const G = await loadGdal(onStatus);
  const dss = [];
  for (const f of files) dss.push((await openFile(G, f))[0]);
  const args = [...TIFF_OUT, '-r', resampling, ...(crs ? ['-t_srs', srsArg(crs)] : []), ...(nodata != null ? ['-srcnodata', String(nodata), '-dstnodata', String(nodata)] : [])];
  const o = await G.gdalwarp(dss, args, uid('mosaic'));
  const b = new Blob([await bytes(G, o)], { type: 'image/tiff' });
  for (const d of dss) await G.close(d);
  return b;
}

/** Clip a vector layer (any geometry) by polygons with OGR -clipsrc. */
export async function clipVector(fc, polygons, onStatus) {
  const G = await loadGdal(onStatus);
  const [ds] = await openFile(G, geojsonFile(fc, 'in'));
  const [cds] = await openFile(G, geojsonFile(polygons, 'clip'));
  const lname = (await G.getInfo(cds)).layers[0].name;
  const u = await G.ogr2ogr(cds, ['-f', 'GeoJSON', '-dialect', 'sqlite', '-sql', `SELECT ST_Union(MakeValid(geometry)) AS geometry FROM "${lname}"`], uid('cutu'));
  const o = await G.ogr2ogr(ds, ['-f', 'GeoJSON', '-clipsrc', u.local, '-makevalid', '-lco', 'RFC7946=YES'], uid('vclip'));
  const out = JSON.parse(new TextDecoder().decode(await bytes(G, o)));
  await G.close(ds); await G.close(cds);
  return out;
}

/** Dissolve polygons, optionally by a field. Geometry union by GEOS through the SQLite dialect. */
export async function dissolve(fc, field, onStatus) {
  const G = await loadGdal(onStatus);
  const [ds] = await openFile(G, geojsonFile(fc, 'in'));
  const lname = (await G.getInfo(ds)).layers[0].name;
  const sql = field ? `SELECT "${field}", ST_Union(MakeValid(geometry)) AS geometry FROM "${lname}" GROUP BY "${field}"` : `SELECT ST_Union(MakeValid(geometry)) AS geometry FROM "${lname}"`;
  const o = await G.ogr2ogr(ds, ['-f', 'GeoJSON', '-dialect', 'sqlite', '-sql', sql, '-lco', 'RFC7946=YES'], uid('diss'));
  const out = JSON.parse(new TextDecoder().decode(await bytes(G, o)));
  await G.close(ds); return out;
}

export const VECTOR_FORMATS = {
  shp: { label: 'Shapefile (.zip)', driver: 'ESRI Shapefile', ext: 'shp' },
  gpkg: { label: 'GeoPackage (.gpkg)', driver: 'GPKG', ext: 'gpkg' },
  geojson: { label: 'GeoJSON (.geojson)', driver: 'GeoJSON', ext: 'geojson' },
  kml: { label: 'KML (.kml, Google Earth)', driver: 'KML', ext: 'kml' },
  csv: { label: 'CSV with WKT geometry', driver: 'CSV', ext: 'csv' },
};
/** Export a layer (lon/lat GeoJSON) to a format and CRS. Returns {blob, filename}. */
export async function exportVector(fc, name, { format = 'shp', crs = 'EPSG:4326' }, onStatus) {
  const G = await loadGdal(onStatus), F = VECTOR_FORMATS[format], nm = safe(name);
  const [ds] = await openFile(G, geojsonFile(fc, nm));
  const args = ['-f', F.driver, ...(format === 'kml' ? [] : ['-t_srs', srsArg(crs)]), '-nln', nm, ...(format === 'shp' ? ['-lco', 'ENCODING=UTF-8'] : []), ...(format === 'csv' ? ['-lco', 'GEOMETRY=AS_WKT'] : [])];
  const o = await G.ogr2ogr(ds, args, nm);
  let blob, filename;
  if (format === 'shp') {
    const files = {};
    for (const f of o.all) files[`${nm}${f.local.slice(f.local.lastIndexOf('.'))}`] = await bytes(G, f);
    blob = new Blob([zipSync(files)], { type: 'application/zip' }); filename = `${nm}.zip`;
  } else { blob = new Blob([await bytes(G, o)]); filename = `${nm}.${F.ext}`; }
  await G.close(ds);
  return { blob, filename };
}
