(function () {
  "use strict";

  if (!window.pack) {
    alert("Open this on Fantasy Map Generator with a map loaded");
    return;
  }

  var JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  var mapNameValue = window.mapName ? window.mapName.value : "map";
  var w = window.graphWidth;
  var h = window.graphHeight;

  var LAYERS = [
    { id: "landmass", label: "landmass" },
    { id: "coastline", label: "coastline" },
    { id: "lakes", label: "lakes" },
    { id: "ocean", label: "ocean" },
    { id: "ice", label: "ice" },
    { id: "rivers", label: "rivers" },
    { id: "terrain", label: "terrain" }
  ];

  // --- Style Inlining (replicates export.js inlineStyle logic) ---

  function inlineStyles(clone) {
    var emptyG = document.createElementNS("http://www.w3.org/2000/svg", "g");
    clone.appendChild(emptyG);
    var defaultStyles = window.getComputedStyle(emptyG);

    var elements = clone.querySelectorAll("g, path, rect, circle, polygon, polyline, line, use, text, image, mask");
    for (var idx = 0; idx < elements.length; idx++) {
      var el = elements[idx];
      var compStyle = window.getComputedStyle(el);
      var style = "";

      for (var i = 0; i < compStyle.length; i++) {
        var key = compStyle[i];
        var value = compStyle.getPropertyValue(key);
        if (key === "cursor") continue;
        if (el.hasAttribute(key)) continue;
        if (value === defaultStyles.getPropertyValue(key)) continue;
        style += key + ":" + value + ";";
      }

      if (style !== "") el.setAttribute("style", style);
    }

    emptyG.remove();
  }

  // --- Base64 conversion for ocean pattern image ---

  function convertImageToBase64(imageEl, callback) {
    var href = imageEl ? imageEl.getAttribute("href") || imageEl.getAttribute("xlink:href") : null;
    if (!href || href.indexOf("data:") === 0) {
      callback();
      return;
    }

    if (typeof window.getBase64 === "function") {
      window.getBase64(href, function (base64) {
        imageEl.setAttribute("href", base64);
        callback();
      });
    } else {
      var xhr = new XMLHttpRequest();
      xhr.onload = function () {
        var reader = new FileReader();
        reader.onloadend = function () {
          imageEl.setAttribute("href", reader.result);
          callback();
        };
        reader.readAsDataURL(xhr.response);
      };
      xhr.onerror = function () { callback(); };
      xhr.open("GET", href);
      xhr.responseType = "blob";
      xhr.send();
    }
  }

  // --- Convert href -> xlink:href for SVG 1.1 compat ---

  function convertToXlinkHref(svgEl) {
    var els = svgEl.querySelectorAll("[href]");
    for (var i = 0; i < els.length; i++) {
      var hrefVal = els[i].getAttribute("href");
      els[i].removeAttribute("href");
      els[i].setAttribute("xlink:href", hrefVal);
    }
  }

  // --- Defs Collection Helpers ---

  function collectUsedHrefs(el) {
    var hrefs = [];
    var uses = el.querySelectorAll("use");
    for (var i = 0; i < uses.length; i++) {
      var href = uses[i].getAttribute("href") || uses[i].getAttribute("xlink:href");
      if (href) hrefs.push(href.replace(/^#/, ""));
    }
    return hrefs;
  }

  function collectFeaturePaths(el, cloneDefs) {
    var results = [];
    var seen = {};
    var hrefs = collectUsedHrefs(el);
    var featurePaths = cloneDefs.querySelector("#featurePaths");
    if (!featurePaths) return results;

    for (var i = 0; i < hrefs.length; i++) {
      if (seen[hrefs[i]]) continue;
      seen[hrefs[i]] = true;
      var pathEl = featurePaths.querySelector("#" + CSS.escape(hrefs[i]));
      if (pathEl) results.push(pathEl.cloneNode(true).outerHTML);
    }
    return results;
  }

  function collectLandMask(cloneDefs) {
    var results = [];
    var seen = {};
    var mask = cloneDefs.querySelector("mask#land");
    if (!mask) return results;

    // Collect all feature paths referenced by the mask
    var maskHrefs = collectUsedHrefs(mask);
    var featurePaths = cloneDefs.querySelector("#featurePaths");
    if (featurePaths) {
      for (var i = 0; i < maskHrefs.length; i++) {
        if (seen[maskHrefs[i]]) continue;
        seen[maskHrefs[i]] = true;
        var pathEl = featurePaths.querySelector("#" + CSS.escape(maskHrefs[i]));
        if (pathEl) results.push(pathEl.cloneNode(true).outerHTML);
      }
    }

    results.push(mask.cloneNode(true).outerHTML);
    return results;
  }

  function collectFilters(el, cloneSvg) {
    var results = [];
    var seen = {};

    // Check the element itself and all descendants for filter attributes
    var allEls = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*")));
    for (var i = 0; i < allEls.length; i++) {
      var filterAttr = allEls[i].getAttribute("filter");
      if (!filterAttr) continue;
      var match = filterAttr.match(/url\(#([^)]+)\)/);
      if (!match || seen[match[1]]) continue;
      seen[match[1]] = true;
      var filterEl = cloneSvg.querySelector("filter#" + CSS.escape(match[1]));
      if (filterEl) results.push(filterEl.cloneNode(true).outerHTML);
    }
    return results;
  }

  function collectPatterns(el, cloneSvg) {
    var results = [];
    var seen = {};

    var allEls = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*")));
    for (var i = 0; i < allEls.length; i++) {
      var fillAttr = allEls[i].getAttribute("fill");
      if (!fillAttr) continue;
      var match = fillAttr.match(/url\(#([^)]+)\)/);
      if (!match || seen[match[1]]) continue;
      seen[match[1]] = true;
      var patternEl = cloneSvg.querySelector("pattern#" + CSS.escape(match[1]));
      if (patternEl) results.push(patternEl.cloneNode(true).outerHTML);
    }

    // Also check for mask references in CSS style
    for (var j = 0; j < allEls.length; j++) {
      var styleAttr = allEls[j].getAttribute("style");
      if (!styleAttr) continue;
      var maskMatch = styleAttr.match(/mask:\s*url\(#([^)]+)\)/);
      if (maskMatch && !seen[maskMatch[1]]) {
        seen[maskMatch[1]] = true;
        var maskEl = cloneSvg.querySelector("mask#" + CSS.escape(maskMatch[1]));
        if (maskEl) {
          // Also collect feature paths used by this mask
          var maskFeaturePaths = collectFeaturePathsForMask(maskEl, cloneSvg);
          results = results.concat(maskFeaturePaths);
          results.push(maskEl.cloneNode(true).outerHTML);
        }
      }
    }

    return results;
  }

  function collectFeaturePathsForMask(maskEl, cloneSvg) {
    var results = [];
    var seen = {};
    var hrefs = collectUsedHrefs(maskEl);
    var defs = cloneSvg.querySelector("defs");
    var featurePaths = defs ? defs.querySelector("#featurePaths") : null;
    if (!featurePaths) return results;

    for (var i = 0; i < hrefs.length; i++) {
      if (seen[hrefs[i]]) continue;
      seen[hrefs[i]] = true;
      var pathEl = featurePaths.querySelector("#" + CSS.escape(hrefs[i]));
      if (pathEl) results.push(pathEl.cloneNode(true).outerHTML);
    }
    return results;
  }

  function collectReliefSymbols(el) {
    var results = [];
    var seen = {};
    var defsRelief = document.getElementById("defElements");
    if (!defsRelief) return results;
    var relief = defsRelief.querySelector("#defs-relief");
    if (!relief) return results;

    var uses = el.querySelectorAll("use");
    for (var i = 0; i < uses.length; i++) {
      var href = uses[i].getAttribute("href") || uses[i].getAttribute("xlink:href");
      if (!href) continue;
      if (seen[href]) continue;
      seen[href] = true;
      var symbol = relief.querySelector(href);
      if (symbol) results.push(symbol.cloneNode(true).outerHTML);
    }
    return results;
  }

  // --- Additional defs collectors for non-geographic layers ---

  function collectBurgIconDefs(el) {
    var results = [];
    var seen = {};
    var svgDefs = document.getElementById("defElements");
    if (!svgDefs) return results;

    var groups = el.querySelectorAll("g[data-icon]");
    for (var i = 0; i < groups.length; i++) {
      var iconSel = groups[i].dataset.icon;
      if (!iconSel || seen[iconSel]) continue;
      seen[iconSel] = true;
      var icon = svgDefs.querySelector(iconSel);
      if (icon) results.push(icon.cloneNode(true).outerHTML);
    }
    return results;
  }

  function collectAnchorDef() {
    var svgDefs = document.getElementById("defElements");
    if (!svgDefs) return [];
    var anchor = svgDefs.querySelector("#icon-anchor");
    return anchor ? [anchor.cloneNode(true).outerHTML] : [];
  }

  function collectCompassDef() {
    var svgDefs = document.getElementById("defElements");
    if (!svgDefs) return [];
    var rose = svgDefs.querySelector("#defs-compass-rose");
    return rose ? [rose.cloneNode(true).outerHTML] : [];
  }

  function collectGridPattern(el) {
    var svgDefs = document.getElementById("defElements");
    if (!svgDefs || !el.hasChildNodes()) return [];
    var type = el.getAttribute("type");
    if (!type) return [];
    var pattern = svgDefs.querySelector("#pattern_" + CSS.escape(type));
    return pattern ? [pattern.cloneNode(true).outerHTML] : [];
  }

  function collectHatchings(el, cloneSvg) {
    var results = [];
    var seen = {};
    var svgDefs = document.getElementById("defElements");
    if (!svgDefs) return results;

    var allEls = el.querySelectorAll("[fill^='url(#hatch']");
    for (var i = 0; i < allEls.length; i++) {
      var fill = allEls[i].getAttribute("fill");
      var match = fill ? fill.match(/url\(#([^)]+)\)/) : null;
      if (!match || seen[match[1]]) continue;
      seen[match[1]] = true;
      var hatching = svgDefs.querySelector("#" + CSS.escape(match[1]));
      if (hatching) results.push(hatching.cloneNode(true).outerHTML);
    }
    return results;
  }

  function collectEmblemDefs(el) {
    var results = [];
    var seen = {};
    var uses = el.querySelectorAll("use");
    for (var i = 0; i < uses.length; i++) {
      var href = uses[i].getAttribute("href") || uses[i].getAttribute("xlink:href");
      if (!href) continue;
      var id = href.replace(/^#/, "");
      if (seen[id]) continue;
      seen[id] = true;
      var emblem = document.getElementById(id);
      if (emblem) results.push(emblem.cloneNode(true).outerHTML);
    }
    return results;
  }

  function collectTextPaths(el, cloneDefs) {
    var results = [];
    var seen = {};
    var textPaths = cloneDefs.querySelector("#textPaths");
    if (!textPaths) return results;

    var tps = el.querySelectorAll("textPath");
    for (var i = 0; i < tps.length; i++) {
      var href = tps[i].getAttribute("href") || tps[i].getAttribute("xlink:href");
      if (!href) continue;
      var id = href.replace(/^#/, "");
      if (seen[id]) continue;
      seen[id] = true;
      var pathEl = textPaths.querySelector("#" + CSS.escape(id));
      if (pathEl) results.push(pathEl.cloneNode(true).outerHTML);
    }

    // Also check statePaths
    var statePaths = cloneDefs.querySelector("#statePaths");
    if (statePaths) {
      var sps = el.querySelectorAll("textPath");
      for (var j = 0; j < sps.length; j++) {
        var href2 = sps[j].getAttribute("href") || sps[j].getAttribute("xlink:href");
        if (!href2) continue;
        var id2 = href2.replace(/^#/, "");
        if (seen[id2]) continue;
        seen[id2] = true;
        var pathEl2 = statePaths.querySelector("#" + CSS.escape(id2));
        if (pathEl2) results.push(pathEl2.cloneNode(true).outerHTML);
      }
    }

    return results;
  }

  // --- Collect mask references from inline style (e.g. rivers use CSS mask:url(#land)) ---

  function collectMaskRefs(el, cloneSvg) {
    var results = [];
    var seen = {};

    var allEls = [el].concat(Array.prototype.slice.call(el.querySelectorAll("*")));
    for (var i = 0; i < allEls.length; i++) {
      var styleAttr = allEls[i].getAttribute("style") || "";
      var maskAttr = allEls[i].getAttribute("mask") || "";
      var combined = styleAttr + " " + maskAttr;

      var matches = combined.match(/url\(#([^)]+)\)/g);
      if (!matches) continue;

      for (var j = 0; j < matches.length; j++) {
        var id = matches[j].match(/url\(#([^)]+)\)/)[1];
        if (seen[id]) continue;
        seen[id] = true;

        var maskEl = cloneSvg.querySelector("mask#" + CSS.escape(id));
        if (maskEl) {
          // Collect feature paths used by this mask
          var maskPaths = collectFeaturePathsForMask(maskEl, cloneSvg);
          results = results.concat(maskPaths);
          results.push(maskEl.cloneNode(true).outerHTML);
        }
      }
    }
    return results;
  }

  // --- Deduplicate defs by id ---

  function deduplicateDefs(defsArray) {
    var seen = {};
    var result = [];
    for (var i = 0; i < defsArray.length; i++) {
      var html = defsArray[i];
      var idMatch = html.match(/\bid="([^"]+)"/);
      var key = idMatch ? idMatch[1] : html;
      if (seen[key]) continue;
      seen[key] = true;
      result.push(html);
    }
    return result;
  }

  // --- Per-layer defs collection ---

  function collectLayerDefs(layerId, layerEl, cloneSvg) {
    var defs = [];
    var cloneDefs = cloneSvg.querySelector("defs");

    switch (layerId) {
      case "landmass":
        defs = defs.concat(collectLandMask(cloneDefs));
        defs = defs.concat(collectFilters(layerEl, cloneSvg));
        break;

      case "coastline":
        defs = defs.concat(collectFeaturePaths(layerEl, cloneDefs));
        defs = defs.concat(collectFilters(layerEl, cloneSvg));
        break;

      case "lakes":
        defs = defs.concat(collectFeaturePaths(layerEl, cloneDefs));
        defs = defs.concat(collectFilters(layerEl, cloneSvg));
        defs = defs.concat(collectPatterns(layerEl, cloneSvg));
        break;

      case "ocean":
        defs = defs.concat(collectPatterns(layerEl, cloneSvg));
        defs = defs.concat(collectFilters(layerEl, cloneSvg));
        break;

      case "ice":
        defs = defs.concat(collectFilters(layerEl, cloneSvg));
        break;

      case "rivers":
        defs = defs.concat(collectMaskRefs(layerEl, cloneSvg));
        defs = defs.concat(collectFilters(layerEl, cloneSvg));
        break;

      case "terrain":
        defs = defs.concat(collectReliefSymbols(layerEl));
        defs = defs.concat(collectFilters(layerEl, cloneSvg));
        break;
    }

    return deduplicateDefs(defs);
  }

  // --- Generic defs collection for any viewbox child element ---

  function collectGenericDefs(elId, el, cloneSvg) {
    var defs = [];
    var cloneDefs = cloneSvg.querySelector("defs");

    // Common: filters, patterns/fills, mask refs, feature paths (for <use> refs)
    defs = defs.concat(collectFilters(el, cloneSvg));
    defs = defs.concat(collectPatterns(el, cloneSvg));
    defs = defs.concat(collectMaskRefs(el, cloneSvg));
    defs = defs.concat(collectFeaturePaths(el, cloneDefs));
    defs = defs.concat(collectHatchings(el, cloneSvg));

    // Layer-specific extras
    switch (elId) {
      case "terrain":
        defs = defs.concat(collectReliefSymbols(el));
        break;
      case "landmass":
        defs = defs.concat(collectLandMask(cloneDefs));
        break;
      case "icons":
        var burgIcons = el.querySelector("#burgIcons");
        if (burgIcons) defs = defs.concat(collectBurgIconDefs(burgIcons));
        var anchors = el.querySelector("#anchors");
        if (anchors) defs = defs.concat(collectAnchorDef());
        break;
      case "burgIcons":
        defs = defs.concat(collectBurgIconDefs(el));
        break;
      case "anchors":
        defs = defs.concat(collectAnchorDef());
        break;
      case "compass":
        defs = defs.concat(collectCompassDef());
        break;
      case "gridOverlay":
        defs = defs.concat(collectGridPattern(el));
        break;
      case "labels":
        defs = defs.concat(collectTextPaths(el, cloneDefs));
        break;
      case "emblems":
        defs = defs.concat(collectEmblemDefs(el));
        break;
    }

    return defs;
  }

  // --- Extract landmass content + defs (for "with landmass" variants) ---

  function getLandmassData(cloneSvg) {
    var cloneDefs = cloneSvg.querySelector("defs");
    var landmassEl = cloneSvg.querySelector("#landmass");
    if (!landmassEl) return null;

    return {
      contentHtml: landmassEl.cloneNode(true).outerHTML,
      defs: deduplicateDefs(collectLandMask(cloneDefs).concat(collectFilters(landmassEl, cloneSvg)))
    };
  }

  // --- Build SVG string ---

  function buildSvg(defsHtml, contentHtml) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"\n' +
      '     width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">\n' +
      '  <defs>' + defsHtml + '</defs>\n' +
      '  <g id="viewbox">' + contentHtml + '</g>\n' +
      '</svg>';
  }

  // --- Convert multiple images to base64 sequentially ---

  function convertImagesSequential(images, idx, callback) {
    if (idx >= images.length) return callback();
    convertImageToBase64(images[idx], function () {
      convertImagesSequential(images, idx + 1, callback);
    });
  }

  // --- Prepare styled clone (async due to base64 conversion) ---

  function prepareStyledClone(callback) {
    var mapEl = document.getElementById("map");
    var cloneEl = mapEl.cloneNode(true);
    cloneEl.id = "svgLayerExportClone";
    cloneEl.style.position = "absolute";
    cloneEl.style.left = "-9999px";
    document.body.appendChild(cloneEl);

    // Reset to full map dimensions
    cloneEl.setAttribute("width", w);
    cloneEl.setAttribute("height", h);
    var viewbox = cloneEl.querySelector("#viewbox");
    if (viewbox) viewbox.removeAttribute("transform");

    // Inline styles
    inlineStyles(cloneEl);

    // Collect all images that need base64 conversion
    var imagesToConvert = [];

    // Ocean pattern
    var oceanicPattern = cloneEl.querySelector("#oceanicPattern");
    if (oceanicPattern) imagesToConvert.push(oceanicPattern);

    // Texture
    var textureImg = cloneEl.querySelector("#texture > image");
    if (textureImg) imagesToConvert.push(textureImg);

    // Marker images
    var markerImgs = cloneEl.querySelectorAll('#markers image[href]:not([href=""])');
    for (var i = 0; i < markerImgs.length; i++) imagesToConvert.push(markerImgs[i]);

    // Also check xlink:href for marker images
    var markerImgsXlink = cloneEl.querySelectorAll('#markers image[xlink\\:href]:not([xlink\\:href=""])');
    for (var j = 0; j < markerImgsXlink.length; j++) {
      if (imagesToConvert.indexOf(markerImgsXlink[j]) === -1) imagesToConvert.push(markerImgsXlink[j]);
    }

    // Army images
    var armyImgs = cloneEl.querySelectorAll('#armies image[href]:not([href=""])');
    for (var k = 0; k < armyImgs.length; k++) imagesToConvert.push(armyImgs[k]);

    convertImagesSequential(imagesToConvert, 0, function () {
      // Convert href -> xlink:href for SVG 1.1 compat
      convertToXlinkHref(cloneEl);
      callback(cloneEl);
    });
  }

  // --- Check if layer element has visible content ---

  function hasContent(el) {
    if (!el) return false;
    return el.children.length > 0 || el.childNodes.length > 0;
  }

  // --- Check if element is visible (not hidden via display:none or .hidden class) ---

  function isVisible(el) {
    if (!el) return false;
    if (el.style.display === "none") return false;
    if (el.classList.contains("hidden")) return false;
    if (el.getAttribute("display") === "none") return false;
    return true;
  }

  // --- IDs to skip in the "all visible" export (debug, ruler, etc.) ---
  var SKIP_IDS = { "debug": true, "ruler": true };

  // --- Build "all visible layers" SVG ---

  function buildAllVisibleSvg(cloneSvg) {
    var viewbox = cloneSvg.querySelector("#viewbox");
    if (!viewbox) return null;

    var allDefs = [];
    var allContent = [];
    var children = viewbox.children;

    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var childId = child.id || "";

      if (SKIP_IDS[childId]) continue;
      if (!isVisible(child)) continue;
      if (!hasContent(child)) continue;

      // Collect defs for this layer
      var defs = collectGenericDefs(childId, child, cloneSvg);
      allDefs = allDefs.concat(defs);

      // Collect content
      allContent.push(child.cloneNode(true).outerHTML);
    }

    if (allContent.length === 0) return null;

    var deduped = deduplicateDefs(allDefs);
    return buildSvg(deduped.join("\n"), allContent.join("\n"));
  }

  // --- Load JSZip ---

  function loadJSZip(callback) {
    if (window.JSZip) return callback();
    var script = document.createElement("script");
    script.src = JSZIP_CDN;
    script.onload = callback;
    script.onerror = function () {
      alert("Failed to load JSZip library");
    };
    document.head.appendChild(script);
  }

  // --- Main export logic ---

  function doExport() {
    prepareStyledClone(function (cloneSvg) {
      var zip = new JSZip();
      var landmassData = getLandmassData(cloneSvg);
      var fileCount = 0;

      for (var i = 0; i < LAYERS.length; i++) {
        var layer = LAYERS[i];
        var layerEl = cloneSvg.querySelector("#" + layer.id);

        if (!hasContent(layerEl)) continue;

        // Collect layer-specific defs
        var layerDefs = collectLayerDefs(layer.id, layerEl, cloneSvg);
        var layerContentHtml = layerEl.cloneNode(true).outerHTML;

        // Build standalone SVG
        var defsHtml = layerDefs.join("\n");
        var standaloneSvgStr = buildSvg(defsHtml, layerContentHtml);

        // Convert href -> xlink:href in the final SVG string (already done on clone but
        // outerHTML may have serialized back to href in some browsers)
        zip.file(mapNameValue + "-" + layer.label + ".svg", standaloneSvgStr);
        fileCount++;

        // Build "with landmass" variant (skip for landmass itself)
        if (layer.id !== "landmass" && landmassData) {
          var combinedDefs = deduplicateDefs(landmassData.defs.concat(layerDefs));
          var combinedDefsHtml = combinedDefs.join("\n");
          var combinedContentHtml = landmassData.contentHtml + "\n" + layerContentHtml;
          var withLandmassSvgStr = buildSvg(combinedDefsHtml, combinedContentHtml);

          zip.file(mapNameValue + "-" + layer.label + "-landmass.svg", withLandmassSvgStr);
          fileCount++;
        }
      }

      // Build "all visible layers" combined SVG
      var allVisibleSvg = buildAllVisibleSvg(cloneSvg);
      if (allVisibleSvg) {
        zip.file(mapNameValue + "-all-visible.svg", allVisibleSvg);
        fileCount++;
      }

      // Clean up
      cloneSvg.remove();

      if (fileCount === 0) {
        alert("No visible layers found to export");
        return;
      }

      zip.generateAsync({ type: "blob" }).then(function (content) {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(content);
        a.download = mapNameValue + "-svg-layers.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    });
  }

  loadJSZip(doExport);
})();
