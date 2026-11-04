# Ababahika validation — v0.2.0 (2026-11-04)

Reference implementations: rasterio 1.4 (`geometry_mask`, all_touched=False), NumPy Horn slope, shapely 2 intersections, pyproj Geod areas.
Synthetic data from `tests/make_data.py` (seeded).

| Check | Data | Result |
|---|---|---|
| Slope stats, polygons in raster CRS | 30 m UTM DEM, tiled, NoData hole | cell counts identical; mean/min/max to 1e-9°, SD to 1e-6°, median to the 0.01° histogram bin, class areas exact |
| Slope via WGS 84 shapefile (reprojected by the tool) | same | mean within 0.2 %, cell counts within 0.2 % (boundary cells only) |
| Slope on geographic DEM | 1″ WGS 84 DEM, striped LZW | cell counts identical; mean and area-weighted mean to 1e-9°; areas to 1e-6 relative (exact ellipsoidal cell areas) |
| LULC class areas | 10 m, 8 classes, NoData strip, polygon with hole, multipart, overlap | every class area exact (GDAL scanline rule reproduced) |
| Soil raster class areas | 30 m | exact |
| Soil polygons overlay | 4 texture polygons | areas within 0.02 % of shapely |
| Catchment areas | geodesic | within 0.01 % of pyproj Geod |
| Slope raster (tool) | both DEMs | max difference 1e-6° (float32), NoData mask and georeferencing identical |
| GDAL clip by polygons | DEM, overlapping catchments | cutline dissolved first; pixel count consistent with union area |

Performance: 12 000 × 12 000 float32 DEM (460 MB, deflate, tiled), 4 catchments, 17.4 M cells: 6.3 s, 226 MB resident (Node 22).

Not yet validated: real Bangladeshi DEMs (SRTM/ALOS/FABDEM) against ArcGIS Pro outputs — recommended before first use in a report.

## Hydrology (v0.2)
| Check | Result |
|---|---|
| Priority-Flood exact fill vs pysheds 0.5 `fill_depressions` | max difference < 1e-4 m; same 3 926 raised cells |
| D8 on the raw DEM vs independent NumPy D8 | identical on all interior cells with a downslope neighbour (pysheds 0.5 `flowdir` marks cells with lower neighbours as sinks under NumPy 2, so it was not used) |
| Every cell routed after Priority-Flood+ε; no loops | yes (topological order covers all cells) |
| Flow accumulation vs pysheds `accumulation` (same directions) | identical (interior cells) |
| Catchments vs pysheds `catchment` (4 points) | identical cell counts (pysheds omits grid-border cells) |
| Separate units vs union of full catchments | identical |
| Raster → polygon | area = cells × cell area, holes kept |
| Synthetic polder (ring embankment + one sluice) | unit stays inside the ring; without the wall the sluice drains a sliver |
| Demo polder (2 sluices) | units 21.78 + 21.64 km² vs polder polygon 43.38 km² |
| Exported flow direction GeoTIFF | ESRI codes 1–128, NoData 0, CRS and transform kept |
