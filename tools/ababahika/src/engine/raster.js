// raster.js - GeoTIFF access that never loads the whole file: geotiff.js reads only the tiles/strips a window needs.
import { fromBlob } from 'geotiff';
import { epsgFromGeoKeys, isGeographic } from './crs.js';

/** Open a GeoTIFF File/Blob. Returns a raster handle with metadata and a window reader. */
export async function openRaster(blob, name = blob.name || 'raster') {
  const tiff = await fromBlob(blob);
  const img = await tiff.getImage();
  const count = await tiff.getImageCount();
  const [rx, ry] = img.getResolution();
  const [ox, oy] = img.getOrigin();
  const W = img.getWidth(), H = img.getHeight();
  const fd = img.getFileDirectory();
  let mt = null; try { mt = fd.getValue ? fd.getValue('ModelTransformation') : fd.ModelTransformation; } catch (e) { /* absent */ }
  if (mt && Math.abs(mt[1]) + Math.abs(mt[4]) > 0) throw new Error(`${name}: rotated rasters are not supported`);
  const nd = img.getGDALNoData();
  const crs = epsgFromGeoKeys(img.getGeoKeys());
  const overviews = [];
  for (let i = 1; i < count; i++) { const o = await tiff.getImage(i); if (o.getWidth() < W) overviews.push(o); }
  const meta = {
    name, width: W, height: H, bands: img.getSamplesPerPixel(), left: ox, top: oy, rx: Math.abs(rx), ry: Math.abs(ry),
    right: ox + Math.abs(rx) * W, bottom: oy - Math.abs(ry) * H, nodata: nd, crs, geographic: crs ? isGeographic(crs) : null,
    dtype: `${['', 'uint', 'int', 'float'][img.getSampleFormat(0)] || 'uint'}${img.getBitsPerSample(0)}`,
    tileW: img.getTileWidth(), tileH: img.getTileHeight(), tiled: !!img.isTiled, bytes: blob.size, overviews: overviews.length,
  };
  if (ry > 0) meta.flipped = true; // south-up rasters are rare; refuse them clearly
  if (meta.flipped) throw new Error(`${name}: south-up rasters are not supported`);
  return {
    meta, tiff, img, overviewImages: overviews, blob,
    /** Band 1 of the window [x0, y0, x1, y1) in pixels (clamped). */
    async read(x0, y0, x1, y1, band = 0) {
      const w = [Math.max(0, x0), Math.max(0, y0), Math.min(W, x1), Math.min(H, y1)];
      const r = await img.readRasters({ window: w, samples: [band], interleave: false });
      return { data: r[0], x0: w[0], y0: w[1], w: w[2] - w[0], h: w[3] - w[1] };
    },
    /** Decimated copy for display (uses an overview when one is close to the requested size). */
    async preview(maxDim = 1600) {
      const s = Math.min(1, maxDim / Math.max(W, H)), pw = Math.max(1, Math.round(W * s)), ph = Math.max(1, Math.round(H * s));
      let src = img; for (const o of overviews) if (o.getWidth() >= pw) src = o;
      const r = await src.readRasters({ samples: [0], width: pw, height: ph, resampleMethod: 'nearest', interleave: false });
      return { data: r[0], w: pw, h: ph };
    },
  };
}

/** Pixel window [x0,y0,x1,y1) covering a bbox [minx,miny,maxx,maxy] in raster CRS, padded by pad pixels. */
export function bboxToWindow(m, b, pad = 0) {
  const x0 = Math.floor((b[0] - m.left) / m.rx) - pad, x1 = Math.ceil((b[2] - m.left) / m.rx) + pad;
  const y0 = Math.floor((m.top - b[3]) / m.ry) - pad, y1 = Math.ceil((m.top - b[1]) / m.ry) + pad;
  return [Math.max(0, x0), Math.max(0, y0), Math.min(m.width, x1), Math.min(m.height, y1)];
}
