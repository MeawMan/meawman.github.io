# Ababahika (অববাহিকা) — catchment GIS in the browser

Slope, land-cover and soil-texture statistics for every catchment, with a map and basic geoprocessing.
Runs entirely in the browser; files are never uploaded. Part of the tools at <https://meawman.github.io/#tools>.

## What it does
- **Catchment stats** — for each polygon: slope mean / SD / min / P10 / median / P90 / max (degrees and percent), area in slope classes, elevation mean / min / max, relief, hypsometric integral; area and % of every land-cover class; area and % of every soil class (soil raster or soil polygons). Excel workbook, copyable tables, methods paragraph; results joined to the catchment layer and mapped.
- **Map** — layers panel (drag to reorder), raster symbology (stretch + hillshade, or unique classes with ESA WorldCover / Esri / Dynamic World / USDA texture names), vector symbology (colours, labels, colour-by-value), identify, attribute table, basemaps.
- **Hydrology (D8)** — DEM at its own or a coarser cell size; embankments burned in as walls (4-connected), sluices/regulators as openings and outlets, khals burned in as channels (shapefile or drawn on the map); Priority-Flood filling (Barnes et al. 2014, +ε for flats); D8 flow direction (ESRI codes 1–128); flow accumulation; stream network with Strahler order; drainage units per sluice, or per clicked/loaded pour point snapped to the largest flow; separate (non-overlapping) or full upstream areas; Flat % and Filled % per unit; GeoTIFF downloads (flow direction, accumulation, upstream km², filled DEM, unit raster); units go straight into Catchment stats.
- **Tools** (GDAL 3 in WebAssembly) — project raster, clip raster (polygons or map view), merge/mosaic rasters, slope raster, clip vector, merge vectors, dissolve, export vector (shapefile, GeoPackage, GeoJSON, KML, CSV) in any coordinate system.

## Size limits
- Catchment statistics **stream** the GeoTIFF block by block; file size is not limited by memory (a 460 MB, 144-million-cell DEM: 6 s, ~230 MB RAM in tests).
- GDAL tools copy inputs into memory: inputs + outputs must fit in roughly 2 GB.
- Slope raster: up to 250 million cells (uncompressed output).
- Hydrology holds the whole grid in memory: up to 40 million cells (e.g. 6 300 × 6 300; 190 km square at 30 m). 36 M cells: 13 s read + 22 s flow model, ~1.3 GB. Use a coarser cell size or clip the DEM for larger areas.

## Flat and embanked land
D8 on a DEM alone is unreliable in floodplains and polders. Burn in embankments, sluices and khals, prefer a bare-earth DEM (survey/LiDAR, FABDEM), and read each unit's Flat % (cells with no lower neighbour) and Filled % (cells raised by depression filling): where they are high, the boundary was set by the filling algorithm, not the terrain.

## Methods
- Cell-in-polygon: cell centre inside (GDAL rasterize scanline rule; same as rasterio/rasterstats `all_touched=False` and ArcGIS Zonal Statistics). Holes and multipart polygons handled.
- Polygons are reprojected to the raster CRS (proj4js); rasters are never resampled for statistics.
- Slope: Horn (1981), NoData neighbours replaced by the centre value (ArcGIS rule), edges replicated. Geographic DEMs: per-row metre spacing from WGS 84 radii of curvature.
- Areas: projected cells |Δx·Δy|; geographic cells exact ellipsoidal area; catchment areas geodesic (WGS 84, local Lambert equal-area); polygon-on-polygon (soil) areas in the catchment's UTM zone.

## Validation (`npm test`)
`tests/make_data.py` builds synthetic data (UTM and geographic DEMs with NoData, tiled and striped GeoTIFFs, 10 m LULC, soil raster and polygons, catchments with a hole, a multipart polygon and an overlap, stored in a different CRS) and reference results with rasterio, rasterstats-equivalent masks, NumPy, shapely and pyproj.
- `tests/zonal.test.mjs`: 183/183 checks — identical cell counts, slope statistics to 1e-9°, class areas to 1e-6 m², soil overlay areas to 0.02 %, geodesic areas to 0.01 %.
- `tests/hydro.test.mjs` (`tests/make_hydro.py`): 22/22 — exact fill identical to pysheds `fill_depressions` (3 926 raised cells); D8 identical to an independent NumPy D8 on every interior cell (pysheds 0.5 `flowdir` is unreliable under NumPy 2); flow accumulation identical to pysheds `accumulation` from the same directions; catchments identical to pysheds `catchment`; separate units tile the union of full catchments; polygon areas = cells × cell area; synthetic polder: with the embankment and one sluice the unit stays inside the ring, without it the sluice drains a sliver; 30→90 m resampling = block mean.
- `tests/slope.test.mjs`: slope rasters vs NumPy Horn, max difference 1e-6° (float32), identical NoData mask and georeferencing.

## Build
```
npm install
node build.mjs          # dist/app.js, dist/worker.js, dist/app.css
python3 tests/make_data.py && python3 tests/make_hydro.py
node tests/zonal.test.mjs && node tests/slope.test.mjs && node tests/hydro.test.mjs
```
`vendor/gdal/` holds gdal3.js 2.8.1 (LGPL-2.1, loaded only when a GDAL tool is used); `vendor/xlsx.core.min.js` is SheetJS CE (Apache-2.0).

## Licence
MIT © 2026 Mahfujur Rahman Joy. Third-party: OpenLayers (BSD-2), geotiff.js (MIT), proj4js (MIT), shpjs (MIT), Turf (MIT), fflate (MIT), gdal3.js (LGPL-2.1; GDAL MIT/X), SheetJS CE (Apache-2.0).
