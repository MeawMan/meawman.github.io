// tiffout.js - write a single-band GeoTIFF (uncompressed) for a grid in an EPSG coordinate system.
import { writeArrayBuffer } from 'geotiff';
import { isGeographic } from './crs.js';

/** data: Float32Array | Uint8Array | Int32Array | Uint32Array; grid: {W,H,left,top,rx,ry,crs}. */
export function writeTiff(data, g, { nodata = null } = {}) {
  const code = /^EPSG:(\d+)$/.exec(g.crs || '');
  if (!code) throw new Error('GeoTIFF export needs an EPSG coordinate system (project the DEM first).');
  const geo = isGeographic(g.crs);
  const [bits, fmt] = data instanceof Float32Array ? [32, 3] : data instanceof Uint8Array ? [8, 1] : data instanceof Int32Array ? [32, 2] : data instanceof Uint32Array ? [32, 1] : data instanceof Int16Array ? [16, 2] : [32, 3];
  const meta = {
    width: g.W, height: g.H, BitsPerSample: [bits], SampleFormat: [fmt], SamplesPerPixel: 1, PhotometricInterpretation: 1,
    ModelPixelScale: [g.rx, g.ry, 0], ModelTiepoint: [0, 0, 0, g.left, g.top, 0], GTModelTypeGeoKey: geo ? 2 : 1, GTRasterTypeGeoKey: 1,
    ...(geo ? { GeographicTypeGeoKey: +code[1] } : { ProjectedCSTypeGeoKey: +code[1] }),
    ...(nodata != null ? { GDAL_NODATA: String(nodata) } : {}),
  };
  return writeArrayBuffer(data, meta);
}
