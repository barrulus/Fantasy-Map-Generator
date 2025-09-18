# PROMPT FOR CODEX — Add GeoTIFF 16×16 Tile-Pyramid Export to Azgaar FMG

You are modifying the **Azgaar’s Fantasy Map Generator** codebase to add a new **“GeoTIFF Tile Pyramid (16×16)”** export option that replaces the current **SVG tile export** path when selected. The goal is to produce a **set of 256 GeoTIFF tiles** (16×16 at full resolution) with correct **georeferencing** so they can be used as a **basemap in QGIS and Leaflet**. Include an **optional GDAL post-step** to convert tiles to **COG** and build **internal overviews** and a **VRT** mosaic.

## Requirements

### UX / UI

- Add a new menu item alongside existing exports:

  - **Export → GeoTIFF Tile Pyramid (16×16)**.

- A small modal with options:
  - **CRS**: default `EPSG:4326`;
  - **Bounds**: default to full map extent.
  - **Output resolution** (pixels wide × high of the _full_ map before tiling).
  - **Compression**: `NONE | LZW | DEFLATE | ZSTD` (default `DEFLATE`).
  - **Block size**: `256 | 512` (default `512`).
  - **Nodata**: numeric (default `0` or leave unset).
  - **Make COG + Overviews (GDAL)**: checkbox (off by default).
  - **Download as zip** (browser path) OR **Generate job file (.fmgpack)** (for a Node/GDAL post-processor).

### Architecture

Implement two cooperating pieces:

1. **Client-side exporter** (browser, no native deps):

   - File: `modules/export/geotiffPyramid.js` (or similar next to svg export).
   - Renders the current FMG **map canvas** into a **full-resolution raster** (the same visual composition used for SVG tiles), then **cuts it into 16×16 equal tiles**.
   - For each tile, **writes a GeoTIFF** with correct **GeoTransform** and **CRS** using **geotiff.js** (or a small GeoTIFF encoder lib).
   - Packs all tiles into a **ZIP** (streamed) so the user downloads `geotiff_pyramid_16x16.zip`.
   - Also writes a **mosaic VRT** (`mosaic.vrt`) and a **TileJSON** (`tilejson.json`) into the ZIP.
   - If **“Make COG + Overviews (GDAL)”** is checked, instead of a ZIP of final GeoTIFFs, export a **job bundle** (`.fmgpack` JSON + raw tile TIFFs optional) that a Node CLI converts to COG + overviews.

2. **Optional Node+GDAL post-processor** (for perfect COGs & overviews):

   - Files:

     - `tools/export-fmg-pyramid-cli.js` (CLI)
     - `tools/lib/gdalPyramid.js` (helpers)

   - **Input**: the `.fmgpack` job file (contains: bounds, CRS, grid=16, tile file names, desired compression/blocksize/overviews, nodata).
   - **Output**: a folder with:

     - `tiles/r{row}_c{col}.tif` (COG with internal overviews),
     - `mosaic.vrt` built with `gdalbuildvrt`,
     - `tilejson.json` with metadata,
     - (optional) a final ZIP.

> Keep the **existing SVG export** intact; this adds a **parallel** GeoTIFF option that uses the same visual styling stack FMG uses to render the final “map appearance.”

## Georeferencing & math (EPSG:4326 only)

- **CRS**: hard-code **WGS84 / EPSG:4326** for all exports. No other CRS, no reprojection.

- **Inputs** (from FMG/export UI):

  - `canvasWidthPx`, `canvasHeightPx` — the rendered map’s pixel size.
  - **Scale option A**: `pixelSizeKm` (kilometres per pixel).
    _or_
  - **Scale option B**: `mapWidthKm`, `mapHeightKm` (total map size in km) → derive `pixelSizeKm`.
  - `centerLonDeg`, `centerLatDeg` (defaults `0, 0`; allow user override).
  - `nodata` (optional), `compression`, `blockSize`, etc. as before.

- **Convert km ↔ degrees** (WGS84 approximations):

  ```text
  kmPerDegLat(φ) ≈ 110.574
  kmPerDegLon(φ) ≈ 111.320 · cos(φ)
  ```

  where φ = `centerLatDeg` in radians.

- **Derive degrees per pixel**:

  ```text
  degPerPxLat = pixelSizeKm / kmPerDegLat(centerLatDeg)
  degPerPxLon = pixelSizeKm / kmPerDegLon(centerLatDeg)
  ```

  If using total map size:

  ```text
  pixelSizeKmX = mapWidthKm  / canvasWidthPx
  pixelSizeKmY = mapHeightKm / canvasHeightPx
  # usually pixelSizeKmX == pixelSizeKmY; if not, compute deg per px separately:
  degPerPxLon = pixelSizeKmX / kmPerDegLon(centerLatDeg)
  degPerPxLat = pixelSizeKmY / kmPerDegLat(centerLatDeg)
  ```

- **Full map extent in degrees (north-up, EPSG:4326)**:

  ```text
  widthDeg  = canvasWidthPx  · degPerPxLon
  heightDeg = canvasHeightPx · degPerPxLat

  minx = centerLonDeg - widthDeg  / 2
  maxx = centerLonDeg + widthDeg  / 2
  miny = centerLatDeg - heightDeg / 2
  maxy = centerLatDeg + heightDeg / 2
  ```

- **16×16 tiling (no gaps/overlaps)**:

  ```text
  tilesX = tilesY = 16
  tileWidthPx  = canvasWidthPx  / tilesX
  tileHeightPx = canvasHeightPx / tilesY

  tileWidthDeg  = tileWidthPx  · degPerPxLon
  tileHeightDeg = tileHeightPx · degPerPxLat
  ```

  For tile at (row r, col c) with r,c ∈ \[0..15]:

  ```text
  tileMinX = minx + c · tileWidthDeg
  tileMaxY = maxy - r · tileHeightDeg

  GeoTransform = [
    tileMinX,          # GT[0] top-left lon
    degPerPxLon,       # GT[1] pixel width  (deg/pixel, +east)
    0,                 # GT[2]
    tileMaxY,          # GT[3] top-left lat
    0,                 # GT[4]
    -degPerPxLat       # GT[5] pixel height (deg/pixel, -south)
  ]
  ```

  This guarantees 16×16 tiles exactly partition `[minx,maxx] × [miny,maxy]` with **no rounding gaps** (ensure all math in **double precision**; only round when writing tags if the library forces it).

- **Tile naming**: `tiles/r{r}_c{c}.tif` (r,c zero-based).

- **Tags & data layout**:

  - Always embed `EPSG:4326` in the GeoTIFF GeoKeys.
  - Set **NoData** if provided.
  - **Bit depth**: 8-bit RGBA for styled basemap tiles (DEM export, if added later, must be 32-bit float).
  - If producing COGs in a post-step, use internal tiling (`BLOCKSIZE=512`) and build overviews (`2 4 8 16 32`), resampling:

    - `average` for continuous rasters,
    - `nearest` for categorical (biomes, labels).

- **UI nits** (update export dialog):

  - Remove CRS/WKT fields (since EPSG:4326 is fixed).
  - Add either **Pixel size (km/px)** _or_ **Map size (km)** fields.
  - Add optional **Center latitude/longitude** (defaults 0/0). This affects the **longitude km/deg** conversion; documenting this avoids surprises.

- **Validation**:

  - After writing, `gdalinfo` on a few tiles must show:

    - `Coordinate System is: EPSG:4326`
    - Corner coords that match `tileMinX, tileMaxY` and increments of `degPerPxLon/Lat`.

  - Build a `mosaic.vrt` over all 256 tiles; in QGIS the mosaic must align perfectly with a WGS84 grid.

---

### Helper snippet for the exporter (JS/pseudocode)

```js
const toRad = (d) => (d * Math.PI) / 180;
const kmPerDegLat = 110.574;
const kmPerDegLon = (latDeg) => 111.32 * Math.cos(toRad(latDeg));

function georefFromCanvas({
  canvasWidthPx,
  canvasHeightPx,
  pixelSizeKm = null,
  mapWidthKm = null,
  mapHeightKm = null,
  centerLonDeg = 0,
  centerLatDeg = 0,
}) {
  const kx = mapWidthKm ?? pixelSizeKm * canvasWidthPx;
  const ky = mapHeightKm ?? pixelSizeKm * canvasHeightPx;

  const degPerPxLon = kx / canvasWidthPx / kmPerDegLon(centerLatDeg);
  const degPerPxLat = ky / canvasHeightPx / kmPerDegLat;

  const widthDeg = canvasWidthPx * degPerPxLon;
  const heightDeg = canvasHeightPx * degPerPxLat;

  const minx = centerLonDeg - widthDeg / 2;
  const maxy = centerLatDeg + heightDeg / 2;

  const tiles = [];
  const tilesX = 16,
    tilesY = 16;
  const tileWidthPx = canvasWidthPx / tilesX;
  const tileHeightPx = canvasHeightPx / tilesY;

  for (let r = 0; r < tilesY; r++)
    for (let c = 0; c < tilesX; c++) {
      const tileMinX = minx + c * tileWidthPx * degPerPxLon;
      const tileMaxY = maxy - r * tileHeightPx * degPerPxLat;
      const GT = [tileMinX, degPerPxLon, 0, tileMaxY, 0, -degPerPxLat];
      tiles.push({ r, c, geotransform: GT });
    }
  return { tiles, degPerPxLon, degPerPxLat };
}
```

### Client implementation details

- **Rendering**: render the exact visible FMG map (layers, styles, labels as desired) into an **OffscreenCanvas** or a hidden canvas at the **target full resolution** (e.g., 16384×16384).
- **Cutting**: draw sub-rects into a **tile canvas** of size `fullWidth/16 × fullHeight/16` and encode that tile to a **GeoTIFF**.
- **GeoTIFF writing**:

  - Use **geotiff.js** (or equivalent) to create a baseline GeoTIFF with tags:

    - `ModelPixelScaleTag`, `ModelTiepointTag` (or full `GeoTransform`), `GeoKeyDirectoryTag` (CRS), `TIFFTAG_IMAGEDESCRIPTION` with FMG metadata.

  - Creation options to mimic tiling: internal strip/tiling is not strictly required client-side; do what geotiff.js supports.
  - Compression: if library supports `LZW`/`Deflate`, apply per user; else fallback to none and let GDAL post-step recompress to COG.

- **Packaging**: stream tiles + `mosaic.vrt` + `tilejson.json` into a ZIP for download **OR** create `.fmgpack` if GDAL step is requested.

### Node+GDAL post-processor

- **CLI usage**:

  ```bash
  node tools/export-fmg-pyramid-cli.js \
    --job /path/to/job.fmgpack \
    --out /path/to/outdir \
    --make-cog \
    --overviews 2,4,8,16,32 \
    --compression ZSTD \
    --blocksize 512 \
    --nodata 0
  ```

- **Process**:

  1. For each input tile (if raw PNGs/PNMs were produced by browser), run `gdal_translate` to GeoTIFF with:

     - `-co TILED=YES -co BLOCKXSIZE=512 -co BLOCKYSIZE=512 -co COMPRESS=ZSTD -co BIGTIFF=YES`
     - `-a_srs` set from job CRS; `-a_ullr` set to tile geographic bounds.

  2. If `--make-cog`, convert to COG:

     - `gdal_translate -of COG -co COMPRESS=ZSTD -co BLOCKSIZE=512 in.tif out.tif`

  3. Build **overviews**:

     - `gdaladdo -r average out.tif 2 4 8 16 32` (or `nearest` for categorical).

  4. Build **VRT** mosaic over all final TIFFs:

     - `gdalbuildvrt mosaic.vrt tiles/*.tif`

  5. Write **TileJSON** (`tilejson.json`) with:

     ```json
     {
       "tilejson":"2.2.0",
       "name":"FMG GeoTIFF Pyramid 16x16",
       "crs":"EPSG:4326",
       "bounds":[minx,miny,maxx,maxy],
       "grid_dim":16,
       "overview_levels":[2,4,8,16,32],
       "compression":"ZSTD",
       "tiles":["tiles/r{row}_c{col}.tif"]
     }
     ```

### Wiring into FMG codebase

- New module: `modules/export/geotiffPyramid.js`

  - Export function:

    ```js
    export async function exportGeoTiffPyramid16x16(options) {
      // options: { crs, wktOrProj, bounds, fullWidth, fullHeight, compression, blockSize, nodata, makeCOG }
      // 1) render full canvas
      // 2) slice to 16×16 tiles
      // 3) write GeoTIFFs (geotiff.js)
      // 4) generate mosaic.vrt + tilejson.json
      // 5) zip or .fmgpack
    }
    ```

- Hook: in the existing export UI code (where SVG tiles are offered), add:

  - “GeoTIFF Tile Pyramid (16×16)” → calls the new function.

- Shared helpers:

  - `modules/export/geoTags.js` for CRS/WKT handling and GeoKeys.
  - `modules/export/vrtWriter.js` to emit a simple VRT mosaic referencing tile geotransforms.
  - `modules/export/tilejsonWriter.js`.

### Acceptance criteria

- Exporting a **16×16 GeoTIFF pyramid** on a standard FMG map produces:

  - **256 GeoTIFF** files with **correct georeferencing** (CRS + bounds).
  - A **mosaic.vrt** that opens in QGIS and visually matches the FMG map.
  - A **TileJSON** manifest with accurate metadata.

- Optional **Node+GDAL** step:

  - Produces **COG tiles with internal overviews** at specified levels.
  - `gdalinfo` shows `Coordinate System is ...`, correct `Corner Coordinates`, and `Overviews:` lines.

- No regressions in existing SVG/PNG exports.
- The operation is stable for large canvases (e.g., 16k×16k full map) by streaming/tiling, not holding the entire ZIP in memory at once.

### Notes & tips

- If browser-side GeoTIFF compression is limited, prefer the **.fmgpack** path for **COG + overviews**; that gives production-grade tiles for QGIS/Leaflet.
- Keep **label layers** optional; many users will want a **basemap without labels** and a separate vector/label layer in QGIS.

---

**Implement this feature now.**
