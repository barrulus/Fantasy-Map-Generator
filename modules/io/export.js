"use strict";
// Functions to export map to image or data files

async function exportToSvg() {
  TIME && console.time("exportToSvg");
  const url = await getMapURL("svg", {fullMap: true});
  const link = document.createElement("a");
  link.download = getFileName() + ".svg";
  link.href = url;
  link.click();

  const message = `${link.download} is saved. Open 'Downloads' screen (ctrl + J) to check`;
  tip(message, true, "success", 5000);
  TIME && console.timeEnd("exportToSvg");
}

async function exportToPng() {
  TIME && console.time("exportToPng");
  const url = await getMapURL("png");

  const link = document.createElement("a");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = svgWidth * pngResolutionInput.value;
  canvas.height = svgHeight * pngResolutionInput.value;
  const img = new Image();
  img.src = url;

  img.onload = function () {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    link.download = getFileName() + ".png";
    canvas.toBlob(function (blob) {
      link.href = window.URL.createObjectURL(blob);
      link.click();
      window.setTimeout(function () {
        canvas.remove();
        window.URL.revokeObjectURL(link.href);

        const message = `${link.download} is saved. Open 'Downloads' screen (ctrl + J) to check. You can set image scale in options`;
        tip(message, true, "success", 5000);
      }, 1000);
    });
  };

  TIME && console.timeEnd("exportToPng");
}

// Export the full map extent (ignoring current viewport) as PNG
async function exportFullMapPng() {
  TIME && console.time("exportFullMapPng");
  const url = await getMapURL("png", {fullMap: true});

  const link = document.createElement("a");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const scale = +pngResolutionInput.value || 1;
  canvas.width = graphWidth * scale;
  canvas.height = graphHeight * scale;
  const img = new Image();
  img.src = url;

  img.onload = function () {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    link.download = getFileName() + "_full.png";
    canvas.toBlob(function (blob) {
      link.href = window.URL.createObjectURL(blob);
      link.click();
      window.setTimeout(function () {
        canvas.remove();
        window.URL.revokeObjectURL(link.href);
        const message = `${link.download} is saved (full extent).`;
        tip(message, true, "success", 5000);
      }, 1000);
    });
  };

  TIME && console.timeEnd("exportFullMapPng");
}

async function exportToJpeg() {
  TIME && console.time("exportToJpeg");
  const url = await getMapURL("png");

  const canvas = document.createElement("canvas");
  canvas.width = svgWidth * pngResolutionInput.value;
  canvas.height = svgHeight * pngResolutionInput.value;
  const img = new Image();
  img.src = url;

  img.onload = async function () {
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const quality = Math.min(rn(1 - pngResolutionInput.value / 20, 2), 0.92);
    const URL = await canvas.toDataURL("image/jpeg", quality);
    const link = document.createElement("a");
    link.download = getFileName() + ".jpeg";
    link.href = URL;
    link.click();
    tip(`${link.download} is saved. Open "Downloads" screen (CTRL + J) to check`, true, "success", 7000);
    window.setTimeout(() => window.URL.revokeObjectURL(URL), 5000);
  };

  TIME && console.timeEnd("exportToJpeg");
}

async function exportToPngTiles() {
  const status = byId("tileStatus");
  status.innerHTML = "Preparing files...";

  const urlSchema = await getMapURL("tiles", {debug: true, fullMap: true});
  await import("../../libs/jszip.min.js");
  const zip = new window.JSZip();

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = graphWidth;
  canvas.height = graphHeight;

  const imgSchema = new Image();
  imgSchema.src = urlSchema;
  await loadImage(imgSchema);

  status.innerHTML = "Rendering schema...";
  ctx.drawImage(imgSchema, 0, 0, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, "image/png");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  zip.file("schema.png", blob);

  // Add world file for schema (WGS84 degrees)
  const {dppX, dppY} = computeWgs84Transform();
  const A_schema = dppX; // deg per pixel X at schema scale (1:1)
  const E_schema = -dppY; // negative for north-up
  const [lonTL_schema, latTL_schema] = pixelsToLonLat(0.5, 0.5, 12); // center of top-left pixel
  const pgwSchema = [A_schema, 0, 0, E_schema, lonTL_schema, latTL_schema].join("\n");
  zip.file("schema.pgw", pgwSchema);

  // download tiles
  const url = await getMapURL("tiles", {fullMap: true});
  const tilesX = +byId("tileColsOutput").value || 2;
  const tilesY = +byId("tileRowsOutput").value || 2;
  const scale = +byId("tileScaleOutput").value || 1;
  const tolesTotal = tilesX * tilesY;

  const tileW = (graphWidth / tilesX) | 0;
  const tileH = (graphHeight / tilesY) | 0;

  const width = graphWidth * scale;
  const height = width * (tileH / tileW);
  canvas.width = width;
  canvas.height = height;

  const img = new Image();
  img.src = url;
  await loadImage(img);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function getRowLabel(row) {
    const first = row >= alphabet.length ? alphabet[Math.floor(row / alphabet.length) - 1] : "";
    const last = alphabet[row % alphabet.length];
    return first + last;
  }

  // Precompute constant degrees-per-output-pixel using world transform
  // Each tile covers tileW x tileH map pixels; output image size is width x height
  const A_tile = (dppX * tileW) / width; // deg/pixel X in output tile images
  const E_tile = -((dppY * tileH) / height); // deg/pixel Y (negative)

  for (let y = 0, row = 0, id = 1; y + tileH <= graphHeight; y += tileH, row++) {
    const rowName = getRowLabel(row);

    for (let x = 0, cell = 1; x + tileW <= graphWidth; x += tileW, cell++, id++) {
      status.innerHTML = `Rendering tile ${rowName}${cell} (${id} of ${tolesTotal})...`;
      ctx.drawImage(img, x, y, tileW, tileH, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, "image/png");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const baseName = `${rowName}${cell}`;
      zip.file(`${baseName}.png`, blob);

      // Add world file for this tile (WGS84 degrees)
      const [lonTL, latTL] = pixelsToLonLat(x + 0.5, y + 0.5, 12); // center of top-left tile pixel
      const pgw = [A_tile, 0, 0, E_tile, lonTL, latTL].join("\n");
      zip.file(`${baseName}.pgw`, pgw);
    }
  }

  status.innerHTML = "Zipping files...";
  zip.generateAsync({type: "blob"}).then(blob => {
    status.innerHTML = "Downloading the archive...";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = getFileName() + ".zip";
    link.click();
    link.remove();

    status.innerHTML = 'Done. Check .zip file in "Downloads" (crtl + J)';
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  });

  // promisified img.onload
  function loadImage(img) {
    return new Promise((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = err => reject(err);
    });
  }

  // promisified canvas.toBlob
  function canvasToBlob(canvas, mimeType, qualityArgument = 1) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        blob => {
          if (blob) resolve(blob);
          else reject(new Error("Canvas toBlob() error"));
        },
        mimeType,
        qualityArgument
      );
    });
  }
}

// Export georeferenced SVG tiles with WGS84 bbox in metadata
async function exportToSvgTiles() {
  const status = byId("tileStatus");
  status.innerHTML = "Preparing SVG...";

  // Get a fully inlined, full-extent SVG
  const url = await getMapURL("svg", {fullMap: true});
  const resp = await fetch(url);
  const baseSvg = await resp.text();
  setTimeout(() => URL.revokeObjectURL(url), 5000);

  await import("../../libs/jszip.min.js");
  const zip = new window.JSZip();

  const tilesX = +byId("tileColsOutput").value || 2;
  const tilesY = +byId("tileRowsOutput").value || 2;
  const scale = +byId("tileScaleOutput").value || 1;

  const tileW = (graphWidth / tilesX) | 0;
  const tileH = (graphHeight / tilesY) | 0;

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function getRowLabel(row) {
    const first = row >= alphabet.length ? alphabet[Math.floor(row / alphabet.length) - 1] : "";
    const last = alphabet[row % alphabet.length];
    return first + last;
  }

  function buildTileSvgString(x, y, w, h) {
    // Parse original SVG
    const parser = new DOMParser();
    const doc = parser.parseFromString(baseSvg, "image/svg+xml");
    const svg = doc.documentElement;
    // Apply tile viewBox and pixel size
    svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    svg.setAttribute("width", String(w * scale));
    svg.setAttribute("height", String(h * scale));
    svg.setAttribute("preserveAspectRatio", "none");
    // Add GML metadata with WGS84 envelope
    const [lonW, latN] = pixelsToLonLat(x, y, 6);
    const [lonE, latS] = pixelsToLonLat(x + w, y + h, 6);
    const minLat = Math.max(-90, Math.min(latN, latS));
    const maxLat = Math.min(90, Math.max(latN, latS));
    const minLon = Math.max(-180, Math.min(lonW, lonE));
    const maxLon = Math.min(180, Math.max(lonW, lonE));

    // Ensure GML namespace present
    svg.setAttribute("xmlns:gml", "http://www.opengis.net/gml/3.2");
    // Create or reuse metadata node
    let meta = svg.querySelector("metadata");
    if (!meta) {
      meta = doc.createElementNS("http://www.w3.org/2000/svg", "metadata");
      svg.insertBefore(meta, svg.firstChild);
    }
    // Build boundedBy element
    const gmlNS = "http://www.opengis.net/gml/3.2";
    const boundedBy = doc.createElementNS(gmlNS, "gml:boundedBy");
    const env = doc.createElementNS(gmlNS, "gml:Envelope");
    env.setAttribute("srsName", "urn:ogc:def:crs:EPSG::4326");
    env.setAttribute("srsDimension", "2");
    env.setAttribute("axisLabels", "Lat Long");
    env.setAttribute("uomLabels", "deg deg");
    const lower = doc.createElementNS(gmlNS, "gml:lowerCorner");
    lower.textContent = `${minLat} ${minLon}`; // Lat Lon order
    const upper = doc.createElementNS(gmlNS, "gml:upperCorner");
    upper.textContent = `${maxLat} ${maxLon}`; // Lat Lon order
    env.appendChild(lower);
    env.appendChild(upper);
    boundedBy.appendChild(env);

    // Replace existing boundedBy if present
    const existing = meta.querySelector("gml\\:boundedBy, boundedBy");
    if (existing) existing.remove();
    meta.appendChild(boundedBy);

    // Serialize back to string
    return new XMLSerializer().serializeToString(doc);
  }

  let id = 1;
  for (let y = 0, row = 0; y + tileH <= graphHeight; y += tileH, row++) {
    const rowName = getRowLabel(row);
    for (let x = 0, col = 1; x + tileW <= graphWidth; x += tileW, col++, id++) {
      status.innerHTML = `Rendering SVG tile ${rowName}${col} (${id})...`;
      const svgStr = buildTileSvgString(x, y, tileW, tileH);
      zip.file(`${rowName}${col}.svg`, svgStr);
    }
  }

  status.innerHTML = "Zipping files...";
  const blob = await zip.generateAsync({type: "blob"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = getFileName() + "-svg-tiles.zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

// parse map svg to object url
async function getMapURL(type, options) {
  const {
    debug = false,
    noLabels = false,
    noWater = false,
    noScaleBar = false,
    noIce = false,
    noVignette = false,
    fullMap = false
  } = options || {};

  const cloneEl = byId("map").cloneNode(true); // clone svg
  cloneEl.id = "fantasyMap";
  document.body.appendChild(cloneEl);
  const clone = d3.select(cloneEl);
  if (!debug) clone.select("#debug")?.remove();

  const cloneDefs = cloneEl.getElementsByTagName("defs")[0];
  const svgDefs = byId("defElements");

  const isFirefox = navigator.userAgent.toLowerCase().indexOf("firefox") > -1;
  if (isFirefox && type === "mesh") clone.select("#oceanPattern")?.remove();
  if (noLabels) {
    clone.select("#labels #states")?.remove();
    clone.select("#labels #burgLabels")?.remove();
    clone.select("#icons #burgIcons")?.remove();
  }
  if (noWater) {
    clone.select("#oceanBase").attr("opacity", 0);
    clone.select("#oceanPattern").attr("opacity", 0);
  }
  if (noIce) clone.select("#ice")?.remove();
  if (noVignette) clone.select("#vignette")?.remove();
  if (fullMap) {
    // reset transform to show the whole map
    clone.attr("width", graphWidth).attr("height", graphHeight);
    clone.select("#viewbox").attr("transform", null);

    if (!noScaleBar) {
      drawScaleBar(clone.select("#scaleBar"), 1);
      fitScaleBar(clone.select("#scaleBar"), graphWidth, graphHeight);
    }
  }
  if (noScaleBar) clone.select("#scaleBar")?.remove();

  if (type === "svg") removeUnusedElements(clone);
  if (customization && type === "mesh") updateMeshCells(clone);
  inlineStyle(clone);

  // remove unused filters
  const filters = cloneEl.querySelectorAll("filter");
  for (let i = 0; i < filters.length; i++) {
    const id = filters[i].id;
    if (cloneEl.querySelector("[filter='url(#" + id + ")']")) continue;
    if (cloneEl.getAttribute("filter") === "url(#" + id + ")") continue;
    filters[i].remove();
  }

  // remove unused patterns
  const patterns = cloneEl.querySelectorAll("pattern");
  for (let i = 0; i < patterns.length; i++) {
    const id = patterns[i].id;
    if (cloneEl.querySelector("[fill='url(#" + id + ")']")) continue;
    patterns[i].remove();
  }

  // remove unused symbols
  const symbols = cloneEl.querySelectorAll("symbol");
  for (let i = 0; i < symbols.length; i++) {
    const id = symbols[i].id;
    if (cloneEl.querySelector("use[*|href='#" + id + "']")) continue;
    symbols[i].remove();
  }

  // add displayed emblems
  if (layerIsOn("toggleEmblems") && emblems.selectAll("use").size()) {
    cloneEl
      .getElementById("emblems")
      ?.querySelectorAll("use")
      .forEach(el => {
        const href = el.getAttribute("href") || el.getAttribute("xlink:href");
        if (!href) return;
        const emblem = byId(href.slice(1));
        if (emblem) cloneDefs.append(emblem.cloneNode(true));
      });
  } else {
    cloneDefs.querySelector("#defs-emblems")?.remove();
  }

  {
    // replace ocean pattern href to base64
    const image = cloneEl.getElementById("oceanicPattern");
    const href = image?.getAttribute("href");
    if (href) {
      await new Promise(resolve => {
        getBase64(href, base64 => {
          image.setAttribute("href", base64);
          resolve();
        });
      });
    }
  }

  {
    // replace texture href to base64
    const image = cloneEl.querySelector("#texture > image");
    const href = image?.getAttribute("href");
    if (href) {
      await new Promise(resolve => {
        getBase64(href, base64 => {
          image.setAttribute("href", base64);
          resolve();
        });
      });
    }
  }

  // add relief icons
  if (cloneEl.getElementById("terrain")) {
    const uniqueElements = new Set();
    const terrainNodes = cloneEl.getElementById("terrain").childNodes;
    for (let i = 0; i < terrainNodes.length; i++) {
      const href = terrainNodes[i].getAttribute("href") || terrainNodes[i].getAttribute("xlink:href");
      uniqueElements.add(href);
    }

    const defsRelief = svgDefs.getElementById("defs-relief");
    for (const terrain of [...uniqueElements]) {
      const element = defsRelief.querySelector(terrain);
      if (element) cloneDefs.appendChild(element.cloneNode(true));
    }
  }

  // add wind rose
  if (cloneEl.getElementById("compass")) {
    const rose = svgDefs.getElementById("defs-compass-rose");
    if (rose) cloneDefs.appendChild(rose.cloneNode(true));
  }

  // add port icon
  if (cloneEl.getElementById("anchors")) {
    const anchor = svgDefs.getElementById("icon-anchor");
    if (anchor) cloneDefs.appendChild(anchor.cloneNode(true));
  }

  // add grid pattern
  if (cloneEl.getElementById("gridOverlay")?.hasChildNodes()) {
    const type = cloneEl.getElementById("gridOverlay").getAttribute("type");
    const pattern = svgDefs.getElementById("pattern_" + type);
    if (pattern) cloneDefs.appendChild(pattern.cloneNode(true));
  }

  {
    // replace external marker icons
    const externalMarkerImages = cloneEl.querySelectorAll('#markers image[href]:not([href=""])');
    const imageHrefs = Array.from(externalMarkerImages).map(img => img.getAttribute("href"));

    for (const url of imageHrefs) {
      await new Promise(resolve => {
        getBase64(url, base64 => {
          externalMarkerImages.forEach(img => {
            if (img.getAttribute("href") === url) img.setAttribute("href", base64);
          });
          resolve();
        });
      });
    }
  }

  {
    // replace external regiment icons
    const externalRegimentImages = cloneEl.querySelectorAll('#armies image[href]:not([href=""])');
    const imageHrefs = Array.from(externalRegimentImages).map(img => img.getAttribute("href"));

    for (const url of imageHrefs) {
      await new Promise(resolve => {
        getBase64(url, base64 => {
          externalRegimentImages.forEach(img => {
            if (img.getAttribute("href") === url) img.setAttribute("href", base64);
          });
          resolve();
        });
      });
    }
  }

  if (!cloneEl.getElementById("fogging-cont")) cloneEl.getElementById("fog")?.remove(); // remove unused fog
  if (!cloneEl.getElementById("regions")) cloneEl.getElementById("statePaths")?.remove(); // removed unused statePaths
  if (!cloneEl.getElementById("labels")) cloneEl.getElementById("textPaths")?.remove(); // removed unused textPaths

  // add armies style
  if (cloneEl.getElementById("armies")) {
    cloneEl.insertAdjacentHTML(
      "afterbegin",
      "<style>#armies text {stroke: none; fill: #fff; text-shadow: 0 0 4px #000; dominant-baseline: central; text-anchor: middle; font-family: Helvetica; fill-opacity: 1;}#armies text.regimentIcon {font-size: .8em;}</style>"
    );
  }

  // add xlink: for href to support svg 1.1
  if (type === "svg") {
    cloneEl.querySelectorAll("[href]").forEach(el => {
      const href = el.getAttribute("href");
      el.removeAttribute("href");
      el.setAttribute("xlink:href", href);
    });
  }

  // add hatchings
  const hatchingUsers = cloneEl.querySelectorAll(`[fill^='url(#hatch']`);
  const hatchingFills = unique(Array.from(hatchingUsers).map(el => el.getAttribute("fill")));
  const hatchingIds = hatchingFills.map(fill => fill.slice(5, -1));
  for (const hatchingId of hatchingIds) {
    const hatching = svgDefs.getElementById(hatchingId);
    if (hatching) cloneDefs.appendChild(hatching.cloneNode(true));
  }

  // load fonts
  const usedFonts = getUsedFonts(cloneEl);
  const fontsToLoad = usedFonts.filter(font => font.src);
  if (fontsToLoad.length) {
    const dataURLfonts = await loadFontsAsDataURI(fontsToLoad);

    const fontFaces = dataURLfonts
      .map(({family, src, unicodeRange = "", variant = "normal"}) => {
        return `@font-face {font-family: "${family}"; src: ${src}; unicode-range: ${unicodeRange}; font-variant: ${variant};}`;
      })
      .join("\n");

    const style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.innerHTML = fontFaces;
    cloneEl.querySelector("defs").appendChild(style);
  }

  clone.remove();

  const serialized =
    `<?xml version="1.0" encoding="UTF-8" standalone="no"?>` + new XMLSerializer().serializeToString(cloneEl);
  const blob = new Blob([serialized], {type: "image/svg+xml;charset=utf-8"});
  const url = window.URL.createObjectURL(blob);
  window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
  return url;
}

// remove hidden g elements and g elements without children to make downloaded svg smaller in size
function removeUnusedElements(clone) {
  if (!terrain.selectAll("use").size()) clone.select("#defs-relief")?.remove();

  for (let empty = 1; empty; ) {
    empty = 0;
    clone.selectAll("g").each(function () {
      if (!this.hasChildNodes() || this.style.display === "none" || this.classList.contains("hidden")) {
        empty++;
        this.remove();
      }
      if (this.hasAttribute("display") && this.style.display === "inline") this.removeAttribute("display");
    });
  }
}

function updateMeshCells(clone) {
  const data = renderOcean.checked ? grid.cells.i : grid.cells.i.filter(i => grid.cells.h[i] >= 20);
  const scheme = getColorScheme(terrs.select("#landHeights").attr("scheme"));
  clone.select("#heights").attr("filter", "url(#blur1)");
  clone
    .select("#heights")
    .selectAll("polygon")
    .data(data)
    .join("polygon")
    .attr("points", d => getGridPolygon(d))
    .attr("id", d => "cell" + d)
    .attr("stroke", d => getColor(grid.cells.h[d], scheme));
}

// for each g element get inline style
function inlineStyle(clone) {
  const emptyG = clone.append("g").node();
  const defaultStyles = window.getComputedStyle(emptyG);

  clone.selectAll("g, #ruler *, #scaleBar > text").each(function () {
    const compStyle = window.getComputedStyle(this);
    let style = "";

    for (let i = 0; i < compStyle.length; i++) {
      const key = compStyle[i];
      const value = compStyle.getPropertyValue(key);

      if (key === "cursor") continue; // cursor should be default
      if (this.hasAttribute(key)) continue; // don't add style if there is the same attribute
      if (value === defaultStyles.getPropertyValue(key)) continue;
      style += key + ":" + value + ";";
    }

    for (const key in compStyle) {
      const value = compStyle.getPropertyValue(key);

      if (key === "cursor") continue; // cursor should be default
      if (this.hasAttribute(key)) continue; // don't add style if there is the same attribute
      if (value === defaultStyles.getPropertyValue(key)) continue;
      style += key + ":" + value + ";";
    }

    if (style != "") this.setAttribute("style", style);
  });

  emptyG.remove();
}

// Helper function to get meters per pixel based on distance unit
function getMetersPerPixel() {
  const unit = distanceUnitInput.value.toLowerCase();

  switch(unit) {
    case 'km':
      return distanceScale * 1000;
    case 'm':
    case 'meter':
    case 'meters':
      return distanceScale;
    case 'mi':
    case 'mile':
    case 'miles':
      return distanceScale * 1609.344;
    case 'yd':
    case 'yard':
    case 'yards':
      return distanceScale * 0.9144;
    case 'ft':
    case 'foot':
    case 'feet':
      return distanceScale * 0.3048;
    case 'league':
    case 'leagues':
      return distanceScale * 4828.032;
    default:
      console.warn(`Unknown distance unit: ${unit}, defaulting to km`);
      return distanceScale * 1000;
  }
}

// Convert from map pixel coordinates to WGS84 lon/lat degrees (EPSG:4326)
// Uses an equirectangular mapping centered on map center with uniform scale
function computeWgs84Transform() {
  const mpp = getMetersPerPixel();
  const lat0 = +latitudeOutput.value || 0;
  const lon0 = +longitudeOutput.value || 0;
  // Use more accurate mean meters-per-degree for latitude
  // 1 degree latitude ≈ 110,574 meters
  const degPerMeterLat = 1 / 110574;
  const degPerMeterLon = 1 / (111320 * Math.cos((lat0 * Math.PI) / 180));
  return {
    lat0,
    lon0,
    dppX: mpp * degPerMeterLon, // degrees per pixel (longitude)
    dppY: mpp * degPerMeterLat // degrees per pixel (latitude), positive upwards
  };
}

function computeWgs84Bbox() {
  const {lat0, lon0, dppX, dppY} = computeWgs84Transform();
  const lonSpan = (graphWidth / 2) * dppX;
  const latSpan = (graphHeight / 2) * dppY;
  const minLat = Math.max(-90, lat0 - latSpan);
  const maxLat = Math.min(90, lat0 + latSpan);
  // Clamp longitudes to [-180, 180] without wrapping to avoid inverted bbox across the antimeridian
  const clampLon = v => Math.max(-180, Math.min(180, v));
  const minLon = clampLon(lon0 - lonSpan);
  const maxLon = clampLon(lon0 + lonSpan);
  return [minLon, minLat, maxLon, maxLat];
}

function computeFantasyBbox() {
  const metersPerPixel = getMetersPerPixel();
  const maxX = graphWidth * metersPerPixel;
  const minY = -graphHeight * metersPerPixel;
  return [0, minY, maxX, 0]; // [minX, minY, maxX, maxY]
}

function pixelsToLonLat(x, y, decimals = 6) {
  const {lat0, lon0, dppX, dppY} = computeWgs84Transform();
  // top-left is (-graphWidth/2, -graphHeight/2) in pixel delta from center
  const lon = lon0 + (x - graphWidth / 2) * dppX;
  const lat = lat0 - (y - graphHeight / 2) * dppY;
  const wrapLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const clampLat = Math.max(-90, Math.min(90, lat));
  const factor = Math.pow(10, decimals);
  return [
    Math.round(wrapLon * factor) / factor,
    Math.round(clampLat * factor) / factor
  ];
}

function buildGeoJsonCells() {
  const {cells, vertices} = pack;

  // Calculate meters per pixel based on unit
  const metersPerPixel = getMetersPerPixel();

  // Use the same global variables as prepareMapData
  const json = {
    type: "FeatureCollection",
    features: [],
    bbox: computeFantasyBbox(),
    // Include metadata using the same sources as prepareMapData
    metadata: {
      generator: "Azgaar's Fantasy Map Generator",
      version: VERSION,
      mapName: mapName.value,
      mapId: mapId,
      seed: seed,
      dimensions: {
        width_px: graphWidth,
        height_px: graphHeight
      },
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      },
      units: {
        distance: distanceUnitInput.value,
        area: areaUnit.value,
        height: heightUnit.value,
        temperature: temperatureScale.value
      },
      bounds_meters: {
        minX: 0,
        maxX: graphWidth * metersPerPixel,
        minY: -(graphHeight * metersPerPixel),
        maxY: 0
      },
      settings: {
        populationRate: populationRate,
        urbanization: urbanization,
        urbanDensity: urbanDensity,
        growthRate: growthRate.value,
        mapSize: mapSizeOutput.value,
        latitude: latitudeOutput.value,
        longitude: longitudeOutput.value,
        precipitation: precOutput.value
      },
      exportedAt: new Date().toISOString()
    }
  };

  const getPopulation = i => {
    const [r, u] = getCellPopulation(i);
    return rn(r + u);
  };

  const getHeight = i => parseInt(getFriendlyHeight([...cells.p[i]]));

  function getCellCoordinates(cellVertices) {
    const coordinates = cellVertices.map(vertex => {
      const [x, y] = vertices.p[vertex];
      return pixelsToLonLat(x, y, 6);
    });
    return [[...coordinates, coordinates[0]]];
  }

  function getCellCoordinatesFantasy(cellVertices) {
    const coordinates = cellVertices.map(vertex => {
      const [x, y] = vertices.p[vertex];
      return getFantasyCoordinates(x, y, 2);
    });
    return [[...coordinates, coordinates[0]]];
  }

  cells.i.forEach(i => {
    const coordinates = getCellCoordinatesFantasy(cells.v[i]);
    const height = getHeight(i);
    const biome = cells.biome[i];
    const type = pack.features[cells.f[i]].type;
    const population = getPopulation(i);
    const state = cells.state[i];
    const province = cells.province[i];
    const culture = cells.culture[i];
    const religion = cells.religion[i];
    const neighbors = cells.c[i];

    const properties = {id: i, height, biome, type, population, state, province, culture, religion, neighbors};
    const feature = {type: "Feature", geometry: {type: "Polygon", coordinates}, properties};
    json.features.push(feature);
  });

  return json;
}

function saveGeoJsonCells() {
  const json = buildGeoJsonCells();
  const fileName = getFileName("Cells") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

// Export categorical terrain as MultiPolygons (one feature per terrain class)
function buildGeoJsonTerrain() {
  const metersPerPixel = getMetersPerPixel();
  const {cells} = pack;
  if (!cells.terrain) return {type: "FeatureCollection", features: []};

  const nameByCode = {
    1: "ocean",
    2: "lake",
    3: "glacier_ice",
    4: "mountains",
    5: "highlands",
    6: "hills",
    7: "plains",
    8: "wetland",
    9: "dunes",
    10: "cultivated"
  };

  // Group cells by terrain code
  const byCode = new Map();
  for (const i of cells.i) {
    const code = cells.terrain[i];
    if (!code) continue;
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(i);
  }

  // For each code, build MultiPolygon from constituent cell polygons
  const features = [];
  for (const [code, cellIds] of byCode.entries()) {
    const polygons = buildMultiPolygonFromCells(cellIds); // already lon/lat via pixelsToLonLat
    const area = sumAreaByCells(cellIds);
    const properties = {code, name: nameByCode[code] || String(code), cells: cellIds.length, area};
    features.push({type: "Feature", geometry: {type: "MultiPolygon", coordinates: polygons}, properties});
  }

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {mapName: mapName.value, scale: {distance: distanceScale, unit: distanceUnitInput.value, meters_per_pixel: metersPerPixel}}
  };
  return json;
}

function saveGeoJsonTerrain() {
  const json = buildGeoJsonTerrain();
  const fileName = getFileName("Terrain") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonRoutes() {
  const metersPerPixel = getMetersPerPixel();
  const unitLabel = distanceUnitInput.value;
  const features = pack.routes
    .map(route => {
      if (!route?.points || route.points.length < 2) return null;
      const {i, points, group, type, feature} = route;
      // Ensure a stable route name even if the Routes Overview panel hasn't been opened
      const routeName = route.name || Routes.generateName({group, points});
      const coordinates = points.map(([x, y]) => getFantasyCoordinates(x, y, 2));

      // Compute lengths: pixels, map-units (distanceScale), and meters
      const lengthPx = route.length || Routes.getLength(i);
      const lengthUnits = rn(lengthPx * distanceScale, 2);
      const lengthMeters = rn(lengthPx * metersPerPixel, 2);

      return {
        type: "Feature",
        geometry: {type: "LineString", coordinates},
        properties: {
          id: i,
          group,
          name: routeName,
          type,
          feature,
          length_px: lengthPx,
          length_units: lengthUnits,
          unit: unitLabel,
          length_meters: lengthMeters
        }
      };
    })
    .filter(Boolean);

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonRoutes() {
  const json = buildGeoJsonRoutes();
  const fileName = getFileName("Routes") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonRivers() {
  const metersPerPixel = getMetersPerPixel();
  const features = pack.rivers.map(
    ({i, cells, points, source, mouth, parent, basin, widthFactor, sourceWidth, discharge, length, width, name, type}) => {
      if (!cells || cells.length < 2) return;
      const meanderedPoints = Rivers.addMeandering(cells, points);
      const coordinates = meanderedPoints.map(([x, y]) => getFantasyCoordinates(x, y, 2));
      return {
        type: "Feature",
        geometry: {type: "LineString", coordinates},
        properties: {id: i, source, mouth, parent, basin, widthFactor, sourceWidth, discharge, length, width, name, type}
      };
    }
  ).filter(f => f); // Remove undefined entries

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonRivers() {
  const json = buildGeoJsonRivers();
  const fileName = getFileName("Rivers") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonMarkers() {
  const metersPerPixel = getMetersPerPixel();
  const features = pack.markers.map(marker => {
    const {i, type, icon, x, y, size, fill, stroke} = marker;
    const coordinates = getFantasyCoordinates(x, y, 2);
    // Find the associated note if it exists
    const note = notes.find(note => note.id === `marker${i}`);
    const name = note ? note.name : "Unknown";
    const properties = {
      id: i,
      type,
      name,
      icon,
      x_px: x,
      y_px: y,
      size,
      fill,
      stroke,
      ...(note && {note: note.legend}) // Add note text if it exists
    };
    return {type: "Feature", geometry: {type: "Point", coordinates}, properties};
  });

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonMarkers() {
  const json = buildGeoJsonMarkers();
  const fileName = getFileName("Markers") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonBurgs() {
  const metersPerPixel = getMetersPerPixel();
  const valid = pack.burgs.filter(b => b.i && !b.removed);

  const features = valid.map(b => {
    const coordinates = getFantasyCoordinates(b.x, b.y, 2);
    const province = pack.cells.province[b.cell];
    const temperature = grid.cells.temp[pack.cells.g[b.cell]];

    // Calculate world coordinates same as CSV export
    const xWorld = b.x * metersPerPixel;
    const yWorld = -b.y * metersPerPixel;

    return {
      type: "Feature",
      geometry: {type: "Point", coordinates},
      properties: {
        id: b.i,
        name: b.name,
        province: province ? pack.provinces[province].name : null,
        provinceFull: province ? pack.provinces[province].fullName : null,
        state: pack.states[b.state].name,
        stateFull: pack.states[b.state].fullName,
        culture: pack.cultures[b.culture].name,
        religion: pack.religions[pack.cells.religion[b.cell]].name,
        population: rn(b.population * populationRate * urbanization),
        populationRaw: b.population,
        xWorld: rn(xWorld, 2),
        yWorld: rn(yWorld, 2),
        xPixel: b.x,
        yPixel: b.y,
        elevation: parseInt(getHeight(pack.cells.h[b.cell])),
        skyAltitude: b.flying ? (b.altitude ?? 1000) : null,
        temperature: convertTemperature(temperature),
        temperatureLikeness: getTemperatureLikeness(temperature),
        capital: !!b.capital,
        port: !!b.port,
        flying: !!b.flying,
        skyPort: !!b.skyPort,
        citadel: !!b.citadel,
        walls: !!b.walls,
        plaza: !!b.plaza,
        temple: !!b.temple,
        shanty: !!b.shanty,
        emblem: b.coa || null,
        cell: b.cell
      }
    };
  });

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonBurgs() {
  const json = buildGeoJsonBurgs();
  const fileName = getFileName("Burgs") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonRegiments() {
  const metersPerPixel = getMetersPerPixel();
  const allRegiments = [];

  // Collect all regiments from all states
  for (const s of pack.states) {
    if (!s.i || s.removed || !s.military.length) continue;
    for (const r of s.military) {
      allRegiments.push({regiment: r, state: s});
    }
  }

  const features = allRegiments.map(({regiment: r, state: s}) => {
    const coordinates = getFantasyCoordinates(r.x, r.y, 2);
    const baseCoordinates = getFantasyCoordinates(r.bx, r.by, 2);

    // Calculate world coordinates same as CSV export
    const xWorld = r.x * metersPerPixel;
    const yWorld = -r.y * metersPerPixel;
    const bxWorld = r.bx * metersPerPixel;
    const byWorld = -r.by * metersPerPixel;

    // Collect military unit data
    const units = {};
    options.military.forEach(u => {
      units[u.name] = r.u[u.name] || 0;
    });

    return {
      type: "Feature",
      geometry: {type: "Point", coordinates},
      properties: {
        id: r.i,
        name: r.name,
        icon: r.icon,
        state: s.name,
        stateFull: s.fullName,
        stateId: s.i,
        units: units,
        totalUnits: r.a,
        xWorld: rn(xWorld, 2),
        yWorld: rn(yWorld, 2),
        xPixel: r.x,
        yPixel: r.y,
        baseXWorld: rn(bxWorld, 2),
        baseYWorld: rn(byWorld, 2),
        baseXPixel: r.bx,
        baseYPixel: r.by,
        baseCoordinates: baseCoordinates
      }
    };
  });

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      },
      military: {
        unitTypes: options.military.map(u => u.name)
      }
    }
  };
  return json;
}

function saveGeoJsonRegiments() {
  const json = buildGeoJsonRegiments();
  const fileName = getFileName("Regiments") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

// Export heightmap as ESRI ASCII Grid (.asc) for QGIS (Fantasy Map Cartesian)
function saveAsciiGridHeightmap() {
  if (!grid?.cells?.h || !grid.cellsX || !grid.cellsY) {
    tip("Height grid is not available", false, "error");
    return;
  }

  const ncols = grid.cellsX;
  const nrows = grid.cellsY;

  // Use Fantasy Map Cartesian meters per pixel; derive per-cell size from pixels per grid cell
  const metersPerPixel = getMetersPerPixel();
  const pxPerCellX = graphWidth / ncols;
  const pxPerCellY = graphHeight / nrows;
  const stepX = metersPerPixel * pxPerCellX; // meters per cell in X direction
  const stepY = metersPerPixel * pxPerCellY; // meters per cell in Y direction
  const cellsize = stepX; // ASCII Grid requires square cellsize; use X spacing

  // Lower-left corner (of the lower-left cell) in Fantasy Map Cartesian meters
  // Compute from lower-left cell center (in pixels) minus half cell size
  const [xLLc, yLLc] = getFantasyCoordinates(pxPerCellX / 2, graphHeight - pxPerCellY / 2, 6);
  // Use half-steps per axis to derive true lower-left corner
  const xllcorner = rn(xLLc - stepX / 2, 6);
  const yllcorner = rn(yLLc - stepY / 2, 6);

  const NODATA = -9999;

  // Convert FMG height (0..100, 20 sea level) to meters (signed)
  const exp = +heightExponentInput.value;
  function elevationInMeters(h) {
    if (h >= 20) return Math.pow(h - 18, exp); // above sea level
    if (h > 0) return ((h - 20) / h) * 50; // below sea level (negative)
    return 0; // treat 0 as 0
  }

  let lines = [];
  lines.push(`ncols ${ncols}`);
  lines.push(`nrows ${nrows}`);
  lines.push(`xllcorner ${xllcorner}`);
  lines.push(`yllcorner ${yllcorner}`);
  lines.push(`cellsize ${cellsize}`);
  lines.push(`NODATA_value ${NODATA}`);

  // ESRI ASCII expects rows from top (north) to bottom (south)
  for (let row = 0; row < nrows; row++) {
    const vals = new Array(ncols);
    for (let col = 0; col < ncols; col++) {
      const i = col + row * ncols;
      const h = grid.cells.h[i];
      const z = elevationInMeters(h);
      vals[col] = Number.isFinite(z) ? rn(z, 2) : NODATA;
    }
    lines.push(vals.join(" "));
  }

  const content = lines.join("\n");
  const fileBase = getFileName("Heightmap");
  const fileName = fileBase + ".asc";
  downloadFile(content, fileName, "text/plain");

  // Also emit a .prj file with Fantasy Map Cartesian CRS so GIS can auto-assign the CRS
  const prj = getFantasyMapCartesianWkt();
  downloadFile(prj, fileBase + ".prj", "text/plain");
}

// Helpers to build MultiPolygons from cell sets
function getCellPolygonCoordinates(cellVertices) {
  const {vertices} = pack;
  const coordinates = cellVertices.map(vertex => {
    const [x, y] = vertices.p[vertex];
    return getFantasyCoordinates(x, y, 2);
  });
  // Close the ring
  return [[...coordinates, coordinates[0]]];
}

function buildMultiPolygonFromCells(cellIds) {
  const {cells} = pack;
  const polygons = cellIds.map(i => getCellPolygonCoordinates(cells.v[i]));
  // polygons is an array of [ [ ring ] ] — wrap for MultiPolygon
  return polygons;
}

function aggregatePopulationByCells(cellIds) {
  // Follow editor logic: population lives in burgs; rural is accounted for via small burgs only
  // Return values in absolute people, matching CSV exports
  let ruralK = 0; // thousands-equivalent for rural (as tracked in states)
  let urbanK = 0; // thousands for urban from burgs
  for (const i of cellIds) {
    const burgId = pack.cells.burg[i];
    if (!burgId) continue;
    const k = pack.burgs[burgId].population; // in thousands
    // Mirror states stats split: <= 0.1k as rural, otherwise urban
    if (k > 0.1) urbanK += k; else ruralK += k;
  }
  const rural = Math.round(ruralK * populationRate);
  const urban = Math.round(urbanK * 1000 * urbanization);
  return {rural, urban, total: rural + urban};
}

function sumAreaByCells(cellIds) {
  const sum = cellIds.reduce((acc, i) => acc + (pack.cells.area[i] || 0), 0);
  return getArea(sum);
}

function getCellsFor(type, id) {
  const {cells} = pack;
  switch (type) {
    case "state":
      return cells.i.filter(i => cells.h[i] >= 20 && cells.state[i] === id);
    case "province":
      return cells.i.filter(i => cells.h[i] >= 20 && cells.province[i] === id);
    case "culture":
      return cells.i.filter(i => cells.h[i] >= 20 && cells.culture[i] === id);
    case "religion":
      return cells.i.filter(i => cells.h[i] >= 20 && cells.religion[i] === id);
    default:
      return [];
  }
}

function buildGeoJsonCultures() {
  const metersPerPixel = getMetersPerPixel();
  const features = pack.cultures
    .filter(c => c.i && !c.removed)
    .map(c => {
      const cellIds = getCellsFor("culture", c.i);
      if (!cellIds.length) return null;
      const geometry = {type: "MultiPolygon", coordinates: buildMultiPolygonFromCells(cellIds)};
      const {total} = aggregatePopulationByCells(cellIds);
      const area = sumAreaByCells(cellIds);
      const namesbase = nameBases[c.base]?.name;
      const origins = (c.origins || []).filter(o => o).map(o => pack.cultures[o]?.name).filter(Boolean);
      const properties = {
        id: c.i,
        name: c.name,
        color: c.color,
        cells: cellIds.length,
        expansionism: c.expansionism,
        type: c.type,
        area,
        population: rn(total),
        namesbase: namesbase || "",
        emblemsShape: c.emblemsShape || "",
        origins
      };
      return {type: "Feature", geometry, properties};
    })
    .filter(Boolean);

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonCultures() {
  const json = buildGeoJsonCultures();
  const fileName = getFileName("Cultures") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonReligions() {
  const metersPerPixel = getMetersPerPixel();
  const features = pack.religions
    .filter(r => r.i && !r.removed)
    .map(r => {
      const cellIds = getCellsFor("religion", r.i);
      if (!cellIds.length) return null;
      const geometry = {type: "MultiPolygon", coordinates: buildMultiPolygonFromCells(cellIds)};
      const {total} = aggregatePopulationByCells(cellIds);
      const area = sumAreaByCells(cellIds);
      const origins = (r.origins || []).filter(o => o).map(o => pack.religions[o]?.name).filter(Boolean);
      const properties = {
        id: r.i,
        name: r.name,
        color: r.color,
        type: r.type,
        form: r.form,
        deity: r.deity || "",
        area,
        believers: rn(total),
        origins,
        potential: r.expansion,
        expansionism: r.expansionism
      };
      return {type: "Feature", geometry, properties};
    })
    .filter(Boolean);

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonReligions() {
  const json = buildGeoJsonReligions();
  const fileName = getFileName("Religions") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonStates() {
  const metersPerPixel = getMetersPerPixel();
  const features = pack.states
    .filter(s => s.i && !s.removed)
    .map(s => {
      const cellIds = getCellsFor("state", s.i);
      if (!cellIds.length) return null;
      const geometry = {type: "MultiPolygon", coordinates: buildMultiPolygonFromCells(cellIds)};
      const {rural, urban, total} = aggregatePopulationByCells(cellIds);
      const area = sumAreaByCells(cellIds);
      const properties = {
        id: s.i,
        name: s.name,
        fullName: s.fullName || "",
        form: s.form || "",
        color: s.color,
        capital: s.capital || 0,
        culture: s.culture,
        type: s.type,
        expansionism: s.expansionism,
        cells: cellIds.length,
        burgs: s.burgs || 0,
        area,
        totalPopulation: total,
        ruralPopulation: rural,
        urbanPopulation: urban
      };
      return {type: "Feature", geometry, properties};
    })
    .filter(Boolean);

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonStates() {
  const json = buildGeoJsonStates();
  const fileName = getFileName("States") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonProvinces() {
  const metersPerPixel = getMetersPerPixel();
  const features = pack.provinces
    .filter(p => p.i && !p.removed)
    .map(p => {
      const cellIds = getCellsFor("province", p.i);
      if (!cellIds.length) return null;
      const geometry = {type: "MultiPolygon", coordinates: buildMultiPolygonFromCells(cellIds)};
      const {rural, urban, total} = aggregatePopulationByCells(cellIds);
      const area = sumAreaByCells(cellIds);
      const properties = {
        id: p.i,
        name: p.name,
        fullName: p.fullName || "",
        form: p.form || "",
        state: p.state,
        color: p.color,
        capital: p.burg || 0,
        area,
        totalPopulation: total,
        ruralPopulation: rural,
        urbanPopulation: urban,
        burgs: (p.burgs && p.burgs.length) || 0
      };
      return {type: "Feature", geometry, properties};
    })
    .filter(Boolean);

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonProvinces() {
  const json = buildGeoJsonProvinces();
  const fileName = getFileName("Provinces") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

function buildGeoJsonZones() {
  const metersPerPixel = getMetersPerPixel();
  const features = (pack.zones || [])
    .map(z => {
      if (!z || z.hidden) return null;
      const cellIds = (z.cells || []).filter(i => pack.cells.h[i] >= 20);
      if (!cellIds.length) return null;
      const geometry = {type: "MultiPolygon", coordinates: buildMultiPolygonFromCells(cellIds)};
      const {total} = aggregatePopulationByCells(cellIds);
      const area = sumAreaByCells(cellIds);
      const properties = {
        id: z.i,
        color: z.color,
        description: z.name,
        type: z.type,
        cells: cellIds.length,
        area,
        population: rn(total)
      };
      return {type: "Feature", geometry, properties};
    })
    .filter(Boolean);

  const json = {
    type: "FeatureCollection",
    features,
    bbox: computeFantasyBbox(),
    metadata: {
      mapName: mapName.value,
      scale: {
        distance: distanceScale,
        unit: distanceUnitInput.value,
        meters_per_pixel: metersPerPixel
      }
    }
  };
  return json;
}

function saveGeoJsonZones() {
  const json = buildGeoJsonZones();
  const fileName = getFileName("Zones") + ".geojson";
  downloadFile(JSON.stringify(json), fileName, "application/json");
}

// Convenience: export all GeoJSONs into a single ZIP
async function saveAllGeoJson() {
  await import("../../libs/jszip.min.js");
  const zip = new window.JSZip();

  const files = [
    {name: getFileName("Cells") + ".geojson", json: buildGeoJsonCells()},
    {name: getFileName("Terrain") + ".geojson", json: buildGeoJsonTerrain()},
    {name: getFileName("Routes") + ".geojson", json: buildGeoJsonRoutes()},
    {name: getFileName("Rivers") + ".geojson", json: buildGeoJsonRivers()},
    {name: getFileName("Markers") + ".geojson", json: buildGeoJsonMarkers()},
    {name: getFileName("Burgs") + ".geojson", json: buildGeoJsonBurgs()},
    {name: getFileName("Regiments") + ".geojson", json: buildGeoJsonRegiments()},
    {name: getFileName("States") + ".geojson", json: buildGeoJsonStates()},
    {name: getFileName("Provinces") + ".geojson", json: buildGeoJsonProvinces()},
    {name: getFileName("Cultures") + ".geojson", json: buildGeoJsonCultures()},
    {name: getFileName("Religions") + ".geojson", json: buildGeoJsonReligions()},
    {name: getFileName("Zones") + ".geojson", json: buildGeoJsonZones()}
  ];

  for (const f of files) {
    try {
      zip.file(f.name, JSON.stringify(f.json));
    } catch (e) {
      console.error("Failed to add", f.name, e);
    }
  }

  // Also include height raster (.asc) and its CRS (.prj) in the archive
  try {
    const {ascContent, prjContent, fileBase} = buildAsciiGridHeightmapData();
    zip.file(fileBase + ".asc", ascContent);
    zip.file(fileBase + ".prj", prjContent);
  } catch (e) {
    console.error("Failed to add height raster to GeoJSON zip", e);
  }

  const blob = await zip.generateAsync({type: "blob"});
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = getFileName("GeoJSON") + ".zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

// Build ASCII Grid (.asc) and corresponding .prj (Fantasy Map Cartesian) content without downloading
function buildAsciiGridHeightmapData() {
  if (!grid?.cells?.h || !grid.cellsX || !grid.cellsY) throw new Error("Height grid is not available");

  const ncols = grid.cellsX;
  const nrows = grid.cellsY;
  const metersPerPixel = getMetersPerPixel();
  const pxPerCellX = graphWidth / ncols;
  const pxPerCellY = graphHeight / nrows;
  const stepX = metersPerPixel * pxPerCellX;
  const stepY = metersPerPixel * pxPerCellY;
  const cellsize = stepX;

  const [xLLc, yLLc] = getFantasyCoordinates(pxPerCellX / 2, graphHeight - pxPerCellY / 2, 6);
  const xllcorner = rn(xLLc - stepX / 2, 6);
  const yllcorner = rn(yLLc - stepY / 2, 6);
  const NODATA = -9999;

  const exp = +heightExponentInput.value;
  function elevationInMeters(h) {
    if (h >= 20) return Math.pow(h - 18, exp);
    if (h > 0) return ((h - 20) / h) * 50;
    return 0;
  }

  const lines = [];
  lines.push(`ncols ${ncols}`);
  lines.push(`nrows ${nrows}`);
  lines.push(`xllcorner ${xllcorner}`);
  lines.push(`yllcorner ${yllcorner}`);
  lines.push(`cellsize ${cellsize}`);
  lines.push(`NODATA_value ${NODATA}`);
  for (let row = 0; row < nrows; row++) {
    const vals = new Array(ncols);
    for (let col = 0; col < ncols; col++) {
      const i = col + row * ncols;
      const h = grid.cells.h[i];
      const z = elevationInMeters(h);
      vals[col] = Number.isFinite(z) ? rn(z, 2) : NODATA;
    }
    lines.push(vals.join(" "));
  }

  const ascContent = lines.join("\n");
  const prjContent = getFantasyMapCartesianWkt();
  const fileBase = getFileName("Heightmap");
  return {ascContent, prjContent, fileBase};
}

// Classic WKT for EPSG:4326 (WGS 84)
function getEpsg4326Wkt() {
  return (
    'GEOGCS["WGS 84",' +
    'DATUM["WGS_1984",' +
    'SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],' +
    'AUTHORITY["EPSG","6326"]],' +
    'PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],' +
    'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],' +
    'AUTHORITY["EPSG","4326"]]'
  );
}

// Custom WKT for Fantasy Map Cartesian coordinate system
function getFantasyMapCartesianWkt() {
  return (
    'ENGCRS["Fantasy Map Cartesian (meters)",' +
    'EDATUM["Fantasy Map Datum"],' +
    'CS[Cartesian,2],' +
    'AXIS["easting (X)",east,' +
    'ORDER[1],' +
    'LENGTHUNIT["metre",1]],' +
    'AXIS["northing (Y)",north,' +
    'ORDER[2],' +
    'LENGTHUNIT["metre",1]]]'
  );
}

// Convert from map pixel coordinates to fantasy world coordinates (meters)
function getFantasyCoordinates(x, y, decimals = 2) {
  const metersPerPixel = getMetersPerPixel();
  const worldX = x * metersPerPixel;
  const worldY = -y * metersPerPixel; // Negative because Y increases downward in pixels
  
  const factor = Math.pow(10, decimals);
  return [
    Math.round(worldX * factor) / factor,
    Math.round(worldY * factor) / factor
  ];
}
