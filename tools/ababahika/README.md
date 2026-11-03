# Ababahika (অববাহিকা) — catchment GIS in the browser

Slope, land-cover and soil-texture statistics for every catchment, with a map and basic geoprocessing.
Runs entirely in the browser; files are never uploaded. Part of the tools at <https://meawman.github.io/#tools>.

## What it does
- **Catchment stats** — for each polygon: slope mean / SD / min / P10 / median / P90 / max (degrees and percent), area in slope classes, elevation mean / min / max, relief, hypsometric integral; area and % of every land-cover class; area and % of every soil class (soil raster or soil polygons). Excel workbook, copyable tables, methods paragraph; results joined to the catchment layer and mapped.
- **Map** — layers panel (drag to reorder), raster symbology (stretch + hillshade, or unique classes with ESA WorldCover / Esri / Dynamic World / USDA texture names), vector symbology (colours, labels, colour-by-value), identify, attribute table, basemaps.
- **Tools** (GDAL 3 in WebAssembly) — project raster, clip raster (polygons or map view), merge/mosaic rasters, slope raster, clip vector, merge vectors, dissolve, export vector (shapefile, GeoPackage, GeoJSON, KML, CSV) in any coordinate system.

## Size limits
- Catchment statistics **stream** the GeoTIFF block by block; file size is not limited by memory (a 460 MB, 144-million-cell DEM: 6 s, ~230 MB RAM in tests).
- GDAL tools copy inputs into memory: inputs + outputs must fit in roughly 2 GB.
- Slope raster: up to 250 million cells (uncompressed output).

## Methods
- Cell-in-polygon: cell centre inside (GDAL rasterize scanline rule; same as rasterio/rasterstats `all_touched=False` and ArcGIS Zonal Statistics). Holes and multipart polygons handled.
- Polygons are reprojected to the raster CRS (proj4js); rasters are never resampled for statistics.
- Slope: Horn (1981), NoData neighbours replaced by the centre value (ArcGIS rule), edges replicated. Geographic DEMs: per-row metre spacing from WGS 84 radii of curvature.
- Areas: projected cells |Δx·Δy|; geographic cells exact ellipsoidal area; catchment areas geodesic (WGS 84, local Lambert equal-area); polygon-on-polygon (soil) areas in the catchment's UTM zone.

## Validation (`npm test`)
`tests/make_data.py` builds synthetic data (UTM and geographic DEMs with NoData, tiled and striped GeoTIFFs, 10 m LULC, soil raster and polygons, catchments with a hole, a multipart polygon and an overlap, stored in a different CRS) and reference results with rasterio, rasterstats-equivalent masks, NumPy, shapely and pyproj.
- `tests/zonal.test.mjs`: 183/183 checks — identical cell counts, slope statistics to 1e-9°, class areas to 1e-6 m², soil overlay areas to 0.02 %, geodesic areas to 0.01 %.
- `tests/slope.test.mjs`: slope rasters vs NumPy Horn, max difference 1e-6° (float32), identical NoData mask and georeferencing.

## Build
```
npm install
node build.mjs          # dist/app.js, dist/worker.js, dist/app.css
python3 tests/make_data.py && node tests/zonal.test.mjs && node tests/slope.test.mjs
```
`vendor/gdal/` holds gdal3.js 2.8.1 (LGPL-2.1, loaded only when a GDAL tool is used); `vendor/xlsx.core.min.js` is SheetJS CE (Apache-2.0).

## Licence
MIT © 2026 Mahfujur Rahman Joy. Third-party: OpenLayers (BSD-2), geotiff.js (MIT), proj4js (MIT), shpjs (MIT), Turf (MIT), fflate (MIT), gdal3.js (LGPL-2.1; GDAL MIT/X), SheetJS CE (Apache-2.0).
