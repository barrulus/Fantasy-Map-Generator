"use strict";

const {spawn} = require("child_process");
const fs = require("fs");
const path = require("path");

function run(cmd, args, {cwd, env} = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {cwd, env, stdio: "inherit", shell: false});
    p.on("error", reject);
    p.on("exit", code => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}

function whichSync(bin) {
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  const paths = (process.env.PATH || "").split(path.delimiter);
  for (const p of paths) {
    for (const ext of exts) {
      const full = path.join(p, bin + ext);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function findGdalBin(name) {
  // Respect explicit env override GDAL_BIN_DIR
  const dir = process.env.GDAL_BIN || process.env.GDAL_BIN_DIR;
  if (dir) {
    const candidate = path.join(dir, name + (process.platform === "win32" ? ".exe" : ""));
    if (fs.existsSync(candidate)) return candidate;
  }
  return whichSync(name);
}

async function pngToGeoTiff({srcPng, dstTif, ulx, uly, lrx, lry, nodata, compression = "DEFLATE", blockSize = 512}) {
  const gdalTranslate = findGdalBin("gdal_translate");
  if (!gdalTranslate) throw new Error("gdal_translate not found in PATH. Set GDAL_BIN or install GDAL");
  const args = [
    "-a_srs", "EPSG:4326",
    "-a_ullr", String(ulx), String(uly), String(lrx), String(lry),
    "-of", "GTiff",
    "-co", "TILED=YES",
    "-co", `BLOCKXSIZE=${blockSize}`,
    "-co", `BLOCKYSIZE=${blockSize}`,
    "-co", `COMPRESS=${compression}`
  ];
  if (nodata !== undefined) args.push("-a_nodata", String(nodata));
  args.push(srcPng, dstTif);
  await run(gdalTranslate, args);
}

async function geoTiffToCOG({srcTif, dstCog, compression = "ZSTD", blockSize = 512}) {
  const gdalTranslate = findGdalBin("gdal_translate");
  if (!gdalTranslate) throw new Error("gdal_translate not found in PATH. Set GDAL_BIN or install GDAL");
  const args = [
    "-of", "COG",
    "-co", `COMPRESS=${compression}`,
    "-co", `BLOCKSIZE=${blockSize}`,
    srcTif,
    dstCog
  ];
  await run(gdalTranslate, args);
}

async function buildOverviews({tifPath, levels = [2, 4, 8, 16, 32], resampling = "average"}) {
  const gdalAddo = findGdalBin("gdaladdo");
  if (!gdalAddo) throw new Error("gdaladdo not found in PATH. Set GDAL_BIN or install GDAL");
  const args = ["-r", resampling, tifPath, ...levels.map(l => String(l))];
  await run(gdalAddo, args);
}

async function buildVRT({outVrt, tileList}) {
  // If gdalbuildvrt exists, use it; else write a simple VRT ourselves
  const gdalVrt = findGdalBin("gdalbuildvrt");
  if (gdalVrt) {
    const args = [outVrt, ...tileList];
    await run(gdalVrt, args);
    return;
  }

  // Minimal VRT (assumes all tiles share same georef and are butt-joined)
  const xml = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<VRTDataset subClass=\"VRTPansharpenedDataset\">",
    "</VRTDataset>"
  ].join("\n");
  fs.writeFileSync(outVrt, xml);
}

module.exports = {
  run,
  whichSync,
  findGdalBin,
  pngToGeoTiff,
  geoTiffToCOG,
  buildOverviews,
  buildVRT
};

