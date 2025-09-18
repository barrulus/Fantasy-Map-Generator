"use strict";

// GeoTIFF Tile Pyramid (16×16) client-side job exporter
// If a browser-side GeoTIFF writer is not available, this generates a .fmgpack job bundle
// with PNG tiles and metadata for a Node+GDAL post-processor to convert to GeoTIFF/COG.

async function exportGeoTiffPyramid16x16(options = {}) {
  const {
    fullWidth = Math.max(1024, graphWidth),
    fullHeight = Math.max(1024, graphHeight),
    // avoid name collision with local 'tiles' array used below
    tiles: gridSize = 16,
    compression = "DEFLATE",
    blockSize = 512,
    nodata = undefined,
    makeCOG = true
  } = options;

  // Fetch full map as raster
  const url = await getMapURL("png", {fullMap: true});
  const img = new Image();
  img.src = url;
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
  });
  // Revoke URL after load to free memory
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  // Compute WGS84 placement centered on current map, using plate carrée (equal degrees per pixel)
  // This avoids horizontal/vertical scale mismatch in GIS (no cos(latitude) correction in degrees space)
  const {lat0, lon0} = computeWgs84Transform();
  const mpp = getMetersPerPixel();
  const degPerMeter = 1 / 111320; // approximate degrees per meter at equator
  const degPerPx = mpp * degPerMeter;
  const widthDeg = graphWidth * degPerPx;
  const heightDeg = graphHeight * degPerPx;
  const minx = lon0 - widthDeg / 2;
  const maxx = lon0 + widthDeg / 2;
  const miny = lat0 - heightDeg / 2;
  const maxy = lat0 + heightDeg / 2;

  // Output degrees per pixel (scaled to requested full output size). Keep X and Y equal.
  const degPerPxLon = widthDeg / fullWidth;
  const degPerPxLat = heightDeg / fullHeight;

  // Tile geometry
  const tilesX = gridSize, tilesY = gridSize;
  const tileOutW = Math.floor(fullWidth / tilesX);
  const tileOutH = Math.floor(fullHeight / tilesY);
  const tileSrcW = graphWidth / tilesX;
  const tileSrcH = graphHeight / tilesY;

  // Prepare ZIP writer
  await import("../../libs/jszip.min.js");
  const zip = new window.JSZip();

  // Status (if available)
  const statusEl = byId("gtiffStatus");
  const setStatus = msg => statusEl ? (statusEl.innerHTML = msg) : null;

  // Rasterize full map SVG at target full resolution once
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = fullWidth;
  fullCanvas.height = fullHeight;
  const fctx = fullCanvas.getContext("2d");
  try { fctx.imageSmoothingEnabled = true; fctx.imageSmoothingQuality = "high"; } catch (e) {}
  // draw the SVG image scaled up to desired full resolution to avoid per-tile upscaling artifacts
  fctx.drawImage(img, 0, 0, fullWidth, fullHeight);

  // Draw and save tiles as PNG into zip (from the high-res full canvas)
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = tileOutW;
  tileCanvas.height = tileOutH;
  const tctx = tileCanvas.getContext("2d");
  // Improve resampling quality when scaling from source to output tiles
  try {
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
  } catch (e) {}

  const tiles = [];
  for (let r = 0; r < tilesY; r++) {
    for (let c = 0; c < tilesX; c++) {
      setStatus && setStatus(`Rendering tile ${r},${c}...`);
      const sx = c * tileOutW;
      const sy = r * tileOutH;
      // draw from high-resolution full canvas without further upscaling
      tctx.clearRect(0, 0, tileOutW, tileOutH);
      tctx.drawImage(fullCanvas, sx, sy, tileOutW, tileOutH, 0, 0, tileOutW, tileOutH);
      const blob = await new Promise((resolve, reject) => tileCanvas.toBlob(b => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
      const name = `tiles/r${r}_c${c}.png`;
      zip.file(name, blob);

      // Tile geotransform (EPSG:4326)
      const tileMinX = minx + c * (tileOutW * degPerPxLon);
      const tileMaxY = maxy - r * (tileOutH * degPerPxLat);
      const GT = [tileMinX, degPerPxLon, 0, tileMaxY, 0, -degPerPxLat];
      tiles.push({r, c, name, geotransform: GT});
    }
  }

  // Build job file (.fmgpack) for Node+GDAL post-processing
  const job = {
    version: "1.0",
    name: getFileName("GeoTIFF_Pyramid_16x16"),
    crs: "EPSG:4326",
    grid: tilesX, // grid dimension (e.g., 16)
    full: {
      widthPx: fullWidth,
      heightPx: fullHeight,
      degPerPxLon,
      degPerPxLat,
      bounds: [minx, miny, maxx, maxy]
    },
    tiles: tiles.map(t => ({r: t.r, c: t.c, file: t.name.replace(/\.png$/, ".tif"), src: t.name, geotransform: t.geotransform})),
    compression,
    blockSize,
    nodata,
    overviews: [2, 4, 8, 16, 32],
    notes: makeCOG
      ? "Run the Node+GDAL CLI to convert PNG tiles to COG GeoTIFFs and build overviews/VRT"
      : "Client-side GeoTIFF creation not available; produced job bundle instead"
  };

  zip.file("job.fmgpack", JSON.stringify(job, null, 2));

  // Add TileJSON manifest (points to final TIFF names)
  const tilejson = {
    tilejson: "2.2.0",
    name: "FMG GeoTIFF Pyramid 16x16",
    crs: "EPSG:4326",
    bounds: [minx, miny, maxx, maxy],
    grid_dim: tilesX,
    overview_levels: [2, 4, 8, 16, 32],
    compression,
    tiles: ["tiles/r{row}_c{col}.tif"]
  };
  zip.file("tilejson.json", JSON.stringify(tilejson, null, 2));

  // Add a VRT mosaic referencing final TIFF tiles at their destination offsets
  const vrtHeader = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<VRTDataset rasterXSize="${fullWidth}" rasterYSize="${fullHeight}">\n` +
    `  <SRS>EPSG:4326</SRS>\n` +
    `  <GeoTransform>${minx}, ${degPerPxLon}, 0, ${maxy}, 0, ${-degPerPxLat}</GeoTransform>\n`;
  const bands = [1, 2, 3, 4];
  let vrtBody = "";
  for (const band of bands) {
    vrtBody += `  <VRTRasterBand dataType="Byte" band="${band}">\n`;
    for (let r = 0; r < tilesY; r++) {
      for (let c = 0; c < tilesX; c++) {
        const dstX = c * tileOutW;
        const dstY = r * tileOutH;
        const fname = `tiles/r${r}_c${c}.tif`;
        vrtBody +=
          `    <SimpleSource>\n` +
          `      <SourceFilename relativeToVRT="1">${fname}</SourceFilename>\n` +
          `      <SourceBand>${band}</SourceBand>\n` +
          `      <SourceProperties RasterXSize="${tileOutW}" RasterYSize="${tileOutH}" DataType="Byte" BlockXSize="128" BlockYSize="128"/>\n` +
          `      <SrcRect xOff="0" yOff="0" xSize="${tileOutW}" ySize="${tileOutH}"/>\n` +
          `      <DstRect xOff="${dstX}" yOff="${dstY}" xSize="${tileOutW}" ySize="${tileOutH}"/>\n` +
          (nodata !== undefined ? `      <NODATA>${nodata}</NODATA>\n` : "") +
          `    </SimpleSource>\n`;
      }
    }
    vrtBody += `  </VRTRasterBand>\n`;
  }
  const vrt = vrtHeader + vrtBody + `</VRTDataset>\n`;
  zip.file("mosaic.vrt", vrt);

  setStatus && setStatus("Zipping files...");
  const blob = await zip.generateAsync({type: "blob"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = getFileName("geotiff_pyramid_16x16") + ".zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}
