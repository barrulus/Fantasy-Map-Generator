#!/usr/bin/env node
"use strict";

// FMG GeoTIFF Pyramid Post-Processor (Node + GDAL)
// Converts PNG tiles + job.fmgpack into COG GeoTIFF tiles with overviews and builds a VRT mosaic.

const fs = require("fs");
const path = require("path");
const {
  pngToGeoTiff,
  geoTiffToCOG,
  buildOverviews,
  buildVRT
} = require("./lib/gdalPyramid");

function parseArgs(argv) {
  const out = {makeCOG: false, overviews: [2, 4, 8, 16, 32], compression: undefined, blocksize: undefined, nodata: undefined, resampling: "average"};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--job") out.job = next, i++;
    else if (a === "--out") out.out = next, i++;
    else if (a === "--make-cog") out.makeCOG = true;
    else if (a === "--overviews") out.overviews = next.split(",").map(n => +n), i++;
    else if (a === "--compression") out.compression = next, i++;
    else if (a === "--blocksize") out.blocksize = +next, i++;
    else if (a === "--nodata") out.nodata = +next, i++;
    else if (a === "--resampling") out.resampling = next, i++;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(`\nFMG GeoTIFF Pyramid CLI\n\nUsage:\n  node tools/export-fmg-pyramid-cli.js \\\n    --job /path/to/job.fmgpack \\\n    --out /path/to/outdir \\\n    [--make-cog] \\\n    [--overviews 2,4,8,16,32] \\\n    [--compression ZSTD] \\\n    [--blocksize 512] \\\n    [--nodata 0] \\\n    [--resampling average|nearest]\n\nNotes:\n- Requires GDAL tools in PATH or set GDAL_BIN/GDAL_BIN_DIR\n- job.fmgpack is a JSON produced by the browser exporter (contains tile georeferencing)\n`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.job || !args.out) { printHelp(); process.exit(args.help ? 0 : 1); }

  const jobPath = path.resolve(args.job);
  if (!fs.existsSync(jobPath)) throw new Error(`Job file not found: ${jobPath}`);
  const jobDir = path.dirname(jobPath);
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8"));

  const outDir = path.resolve(args.out);
  const outTiles = path.join(outDir, "tiles");
  fs.mkdirSync(outDir, {recursive: true});
  fs.mkdirSync(outTiles, {recursive: true});

  const compression = args.compression || job.compression || "ZSTD";
  const blockSize = args.blocksize || job.blockSize || 512;
  const nodata = ("nodata" in args) ? args.nodata : job.nodata;
  const overviews = args.overviews || [2, 4, 8, 16, 32];
  const resampling = args.resampling || "average";

  // Quick sanity: check pixel aspect in degrees from first tile
  if (job.tiles && job.tiles.length) {
    const gt = job.tiles[0].geotransform || job.tiles[0].GT;
    if (gt && gt.length >= 6) {
      const dppX = +gt[1];
      const dppY = Math.abs(+gt[5]);
      const ratio = dppX && dppY ? dppX / dppY : NaN;
      if (isFinite(ratio)) {
        console.log(`Pixel size (deg): dppX=${dppX}, dppY=${dppY}, ratio=${ratio.toFixed(6)}`);
        if (Math.abs(1 - ratio) > 0.02) {
          console.warn("Warning: pixel size X/Y differ by >2%. Result may look horizontally stretched/squashed in GIS.");
        }
      }
    }
  }

  // Convert each PNG tile to GeoTIFF with proper georeferencing
  console.log(`Converting ${job.tiles.length} tiles to GeoTIFF...`);
  for (const t of job.tiles) {
    const srcPng = path.resolve(jobDir, t.src || t.file.replace(/\.tif$/i, ".png"));
    if (!fs.existsSync(srcPng)) throw new Error(`Missing source tile: ${srcPng}`);
    const dstTif = path.join(outDir, t.file); // includes tiles/rX_cY.tif
    fs.mkdirSync(path.dirname(dstTif), {recursive: true});

    const [ulx, pxW, , uly, , pxHneg] = t.geotransform;
    const pxH = Math.abs(pxHneg);
    // Compute lower-right from UL and output pixel dimensions (in pixels)
    const {widthPx, heightPx} = inferTileSize(job, t);
    const lrx = ulx + pxW * widthPx;
    const lry = uly - pxH * heightPx;

    await pngToGeoTiff({
      srcPng,
      dstTif,
      ulx,
      uly,
      lrx,
      lry,
      nodata,
      compression,
      blockSize
    });

    if (args.makeCOG || job.notes?.includes("Node+GDAL") || (job.notes && job.notes.toLowerCase().includes("cog"))) {
      const tmp = dstTif.replace(/\.tif$/i, ".gtiff.tmp.tif");
      fs.renameSync(dstTif, tmp);
      await geoTiffToCOG({srcTif: tmp, dstCog: dstTif, compression, blockSize});
      fs.unlinkSync(tmp);
      await buildOverviews({tifPath: dstTif, levels: overviews, resampling});
    }
  }

  // Build mosaic VRT
  console.log("Building VRT...");
  const vrtPath = path.join(outDir, "mosaic.vrt");
  const tileFiles = job.tiles.map(t => path.join(outDir, t.file));
  await buildVRT({outVrt: vrtPath, tileList: tileFiles});

  // Write TileJSON
  console.log("Writing TileJSON...");
  const tj = {
    tilejson: "2.2.0",
    name: job.name || "FMG GeoTIFF Pyramid 16x16",
    crs: job.crs || "EPSG:4326",
    bounds: job.full?.bounds,
    grid_dim: job.grid || 16,
    overview_levels: overviews,
    compression,
    tiles: ["tiles/r{row}_c{col}.tif"]
  };
  fs.writeFileSync(path.join(outDir, "tilejson.json"), JSON.stringify(tj, null, 2));

  console.log("Done.");
}

function inferTileSize(job, tile) {
  // Based on full output size and 16×16 grid
  const grid = job.grid || 16;
  const w = Math.floor(job.full?.widthPx / grid);
  const h = Math.floor(job.full?.heightPx / grid);
  return {widthPx: w, heightPx: h};
}

main().catch(err => {
  console.error("ERROR:", err.message || err);
  process.exit(1);
});
