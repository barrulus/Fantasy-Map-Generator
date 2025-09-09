# Georeferenced Raster (PNG + World File / GeoTIFF) and GeoJSON Exports

This note documents what the project supports today for GIS exports, the difference between GeoJSON and rasters, and a concrete plan to add a georeferenced raster export of the rendered map (PNG + world file). It also outlines an optional GeoTIFF route.

## TL;DR

- GeoJSON exports are now WGS84 (EPSG:4326) with bbox extents; use them directly in QGIS/Leaflet.
- The project also exports a height raster as ESRI ASCII Grid (.asc) for QGIS; units are meters in a local engineering CRS.
- A future georeferenced image export (PNG + world file) can use either degrees (WGS84) or meters (local); see notes below.

---

## What Exists Now

Vector GeoJSON exports (buttons in UI):

- Cells, Routes, Rivers, Markers, Burgs, Regiments, States, Provinces, Cultures, Religions, Zones
  - Code: `modules/io/export.js:654`, `687`, `724`, `769`, `841`, `919`, `1179`, `1229`, `1076`, `1126`, `1274`
  - UI: `index.html:6088` (“Export map data” → layer buttons, plus “all (zip)”).

Height raster export (for QGIS):

- ESRI ASCII Grid (.asc) of the heightmap
  - Code: `modules/io/export.js:920` (`saveAsciiGridHeightmap`)
  - UI: `index.html:6098` (“Export height raster (QGIS)” → “height (.asc)”).

CRS used by exports:

- GeoJSON: WGS84 (EPSG:4326)
- Height raster (.asc): local engineering CRS (meters). Assign a suitable projected CRS in QGIS for measurements, or reproject after import.

---

## GeoJSON vs Raster

- GeoJSON: vector features (Point/LineString/Polygon/Multi*). No raster imagery.
- Raster imagery: PNG/JPEG/GeoTIFF/etc., potentially georeferenced (world file or internal tags).

Current usage pattern:

- Use GeoJSON layers in QGIS for analysis/symbolization (already supported).
- Use `.asc` height raster in QGIS for terrain analysis (contours, hillshade).
- For a georeferenced image of the rendered map, add a PNG + world file export.

---

## Proposed: Georeferenced PNG (+ world file)

Add an export that renders the full map to PNG and writes a world file. Two compatible options:

1) WGS84 degrees: world file in degrees-per-pixel; easy overlay with GeoJSON.
   - Pixel size: `A = dppX` (deg/pixel in lon), `E = -dppY` (deg/pixel in lat)
   - Origin: center of top-left pixel in lon/lat
   - CRS: EPSG:4326

2) Local meters: world file in meters-per-pixel; matches the height raster.
   - Pixel size: `A = getMetersPerPixel() / pngResolution`
   - Origin: center of top-left pixel in local meters
   - CRS: treat as engineering CRS in QGIS; assign a projected CRS for analysis.

Implementation sketch (new helper; uses existing utilities):

```js
// modules/io/export.js (new)
async function exportGeorefPng() {
  // Render the full map at current PNG resolution
  const url = await getMapURL("png", {fullMap: true});

  const canvas = document.createElement("canvas");
  canvas.width = graphWidth * pngResolutionInput.value;
  canvas.height = graphHeight * pngResolutionInput.value;
  const ctx = canvas.getContext("2d");

  const img = new Image();
  img.src = url;
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  // Save PNG
  const pngBlob = await new Promise(r => canvas.toBlob(r, "image/png"));
  const pngUrl = window.URL.createObjectURL(pngBlob);
  const pngName = getFileName() + ".png";
  const link = document.createElement("a");
  link.download = pngName;
  link.href = pngUrl;
  link.click();

  // Build world file (.pgw)
  const A = getMetersPerPixel() / pngResolutionInput.value; // meters per pixel in X
  const E = -A; // meters per pixel in Y (north-up)
  const D = 0; // rotation
  const B = 0; // rotation
  const C = A / 2; // top-left pixel center X
  const F = E / 2; // top-left pixel center Y

  const pgw = [A, D, B, E, C, F].map(v => String(v)).join("\n");
  const worldName = pngName.replace(/\.png$/i, ".pgw");
  downloadFile(pgw, worldName, "text/plain");

  // If exporting in WGS84, no .prj is needed for GeoTIFF/PNG+PGW; for local meters, you may create a .prj matching your project CRS.

  setTimeout(() => window.URL.revokeObjectURL(pngUrl), 5000);
}
```

UI addition:

- In `index.html:6088`, add a button near existing PNG export (or under “Export height raster”) for the new georeferenced PNG export:

```html
<button onclick="exportGeorefPng()" data-tip="Export styled map as georeferenced PNG (+.pgw/.prj)">georef PNG</button>
```

QGIS usage:

1. Drag the exported `.png` into QGIS; ensure its world file sits next to it with the same base name.
2. If exported in WGS84, QGIS will georeference automatically. If exported in local meters, assign/define an appropriate projected CRS.
3. Use as backdrop under your GeoJSON layers (WGS84) or reproject layers to match.

Notes:

- Ensure `getMapURL` is called with `{fullMap: true}` so the PNG covers the entire extent with a fixed transform.
- The world file approach works identically for JPEG (`.jgw`) if needed.

---

## Optional: GeoTIFF (Single File)

Two paths:

1) Client-side GeoTIFF writer (in-browser):

- Add a small library (e.g., `geotiff.js`) and write the GeoTIFF with `ModelPixelScaleTag`, `ModelTiepointTag`, and appropriate CRS tags.
- Not currently bundled in `libs/`; PNG + PGW is simpler and already compatible with QGIS.

2) Convert in QGIS:

- Load the PNG + PGW; then:
  - Raster → Conversion → Translate (Convert format), or
  - Right‑click the raster layer → Export → Save As… → format: GeoTIFF.

---

## Height Raster (Already Available)

- Use the “height (.asc)” export for an analysis-grade elevation raster.
- In QGIS: Raster → Extraction → Contour for contours; Raster → Analysis → Hillshade for shaded relief.
- UI: `index.html:6098`
- Code: `modules/io/export.js:920`

---

## CRS notes

- GeoJSON is WGS84 (EPSG:4326) by default; no CRS tag is embedded (GeoJSON ‘crs’ is deprecated).
- Height raster is exported in a local engineering CRS (meters). In QGIS, set the Project CRS or reproject for metric analysis.

---

## Acceptance Checklist

- Exported PNG looks identical to the standard PNG export (full map extent).
- World file present with 6 lines; values match chosen units (degrees or meters) and sign conventions.
- QGIS loads the raster at the correct location; vectors from GeoJSON (WGS84) overlay when both are in WGS84 or after reprojection.

---

## References in Code

- GeoJSON builders and helpers: `modules/io/export.js`
- Download helper: `modules/ui/editors.js:960`
- UI export panel: `index.html:6088`
- QGIS styles and notes: `qgis/README.md`
