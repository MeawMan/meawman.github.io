# Ababahika validation — v0.1.0 (2026-11-03)

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
