(function () {
  "use strict";

  if (!window.pack) {
    alert("Open this on Fantasy Map Generator");
    return;
  }

  var pack = window.pack;
  var mapCoordinates = window.mapCoordinates;
  var mapNameValue = window.mapName ? window.mapName.value : "map";

  function getCoords(x, y) {
    var p = mapCoordinates;
    var w = window.graphWidth;
    var h = window.graphHeight;
    var lon = p.lonW + (x / w) * (p.lonE - p.lonW);
    var lat = p.latN - (y / h) * (p.latN - p.latS);
    return [+lon.toFixed(6), +lat.toFixed(6)];
  }

  function getCellPolygon(cellId) {
    var vertices = pack.vertices;
    var cellVertices = pack.cells.v[cellId];
    if (!cellVertices || !cellVertices.length) return null;
    var coords = cellVertices.map(function (v) {
      return getCoords(vertices.p[v][0], vertices.p[v][1]);
    });
    coords.push(coords[0]);
    return coords;
  }

  function buildMultiPolygon(cellIds) {
    var polygons = [];
    for (var i = 0; i < cellIds.length; i++) {
      var poly = getCellPolygon(cellIds[i]);
      if (poly) polygons.push([poly]);
    }
    return polygons;
  }

  function toGeoJSON(features) {
    return JSON.stringify({ type: "FeatureCollection", features: features }, null, 2);
  }

  // --- Export Functions ---

  function exportBurgs() {
    return pack.burgs
      .filter(function (b) { return b.i && !b.removed; })
      .map(function (b) {
        var state = pack.states[b.state] || {};
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: getCoords(b.x, b.y) },
          properties: {
            id: b.i, name: b.name || "", state: state.name || "",
            population: Math.round((b.population || 0) * window.populationRate),
            capital: b.capital || 0, port: b.port || 0,
            type: b.type || "", group: b.group || "",
            settlementType: b.settlementType || "",
          },
        };
      });
  }

  function exportStates() {
    return pack.states
      .filter(function (s) { return s.i && !s.removed; })
      .map(function (s) {
        var cellIds = [];
        for (var i = 0; i < pack.cells.i.length; i++) {
          if (pack.cells.state[i] === s.i && pack.cells.h[i] >= 20) cellIds.push(i);
        }
        return {
          type: "Feature",
          geometry: { type: "MultiPolygon", coordinates: buildMultiPolygon(cellIds) },
          properties: {
            id: s.i, name: s.name || "", fullName: s.fullName || "",
            form: s.formName || "", color: s.color || "",
            totalPopulation: Math.round(((s.rural || 0) + (s.urban || 0)) * window.populationRate),
          },
        };
      });
  }

  function exportProvinces() {
    return pack.provinces
      .filter(function (p) { return p.i && !p.removed; })
      .map(function (p) {
        var cellIds = [];
        for (var i = 0; i < pack.cells.i.length; i++) {
          if (pack.cells.province[i] === p.i && pack.cells.h[i] >= 20) cellIds.push(i);
        }
        return {
          type: "Feature",
          geometry: { type: "MultiPolygon", coordinates: buildMultiPolygon(cellIds) },
          properties: {
            id: p.i, name: p.name || "", fullName: p.fullName || "",
            state: (pack.states[p.state] || {}).name || "", color: p.color || "",
          },
        };
      });
  }

  function exportCultures() {
    return pack.cultures
      .filter(function (c) { return c.i && !c.removed; })
      .map(function (c) {
        var cellIds = [];
        for (var i = 0; i < pack.cells.i.length; i++) {
          if (pack.cells.culture[i] === c.i && pack.cells.h[i] >= 20) cellIds.push(i);
        }
        return {
          type: "Feature",
          geometry: { type: "MultiPolygon", coordinates: buildMultiPolygon(cellIds) },
          properties: { id: c.i, name: c.name || "", type: c.type || "", color: c.color || "" },
        };
      });
  }

  function exportReligions() {
    return pack.religions
      .filter(function (r) { return r.i && !r.removed; })
      .map(function (r) {
        var cellIds = [];
        for (var i = 0; i < pack.cells.i.length; i++) {
          if (pack.cells.religion[i] === r.i && pack.cells.h[i] >= 20) cellIds.push(i);
        }
        return {
          type: "Feature",
          geometry: { type: "MultiPolygon", coordinates: buildMultiPolygon(cellIds) },
          properties: { id: r.i, name: r.name || "", type: r.type || "", color: r.color || "" },
        };
      });
  }

  function exportRoutes() {
    return pack.routes
      .filter(function (r) { return r.points && r.points.length >= 2; })
      .map(function (r) {
        var coords = r.points.map(function (p) { return getCoords(p[0], p[1]); });
        var name = "";
        try { name = window.Routes.generateName(r); } catch (e) { name = "Route " + r.i; }
        return {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { id: r.i, name: name, group: r.group || "" },
        };
      });
  }

  function exportRivers() {
    return (pack.rivers || [])
      .filter(function (r) { return r.i && !r.removed; })
      .map(function (r) {
        var coords = [];
        var pathEl = document.querySelector("#rivers > path#river" + r.i);
        if (pathEl) {
          var totalLen = pathEl.getTotalLength();
          var step = Math.max(totalLen / 50, 1);
          for (var d = 0; d <= totalLen; d += step) {
            var pt = pathEl.getPointAtLength(d);
            coords.push(getCoords(pt.x, pt.y));
          }
          var last = pathEl.getPointAtLength(totalLen);
          coords.push(getCoords(last.x, last.y));
        }
        if (coords.length < 2) return null;
        return {
          type: "Feature",
          geometry: { type: "LineString", coordinates: coords },
          properties: { id: r.i, name: r.name || "", type: r.type || "" },
        };
      })
      .filter(function (f) { return f !== null; });
  }

  function exportMarkers() {
    return (pack.markers || [])
      .filter(function (m) { return m && !m.removed && m.x != null && m.y != null; })
      .map(function (m) {
        var props = { id: m.i, icon: m.icon || "", type: m.type || "" };
        var notesArray = typeof notes !== "undefined" && Array.isArray(notes) ? notes : [];
        if (notesArray.length) {
          var note = notesArray.find(function (n) { return n.id === "marker" + m.i; });
          if (note) { props.name = note.name || ""; props.legend = note.legend || ""; }
        }
        return {
          type: "Feature",
          geometry: { type: "Point", coordinates: getCoords(m.x, m.y) },
          properties: props,
        };
      });
  }

  // --- Load JSZip and create ZIP ---

  var JSZIP_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  function loadJSZip(callback) {
    if (window.JSZip) return callback();
    var script = document.createElement("script");
    script.src = JSZIP_CDN;
    script.onload = callback;
    script.onerror = function () {
      alert("Failed to load JSZip. Downloading files individually instead.");
      downloadIndividually();
    };
    document.head.appendChild(script);
  }

  function downloadIndividually() {
    var layers = {
      burgs: exportBurgs(),
      states: exportStates(),
      provinces: exportProvinces(),
      cultures: exportCultures(),
      religions: exportReligions(),
      routes: exportRoutes(),
      rivers: exportRivers(),
      markers: exportMarkers(),
    };

    Object.keys(layers).forEach(function (name) {
      var blob = new Blob([toGeoJSON(layers[name])], { type: "application/geo+json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = mapNameValue + "-" + name + ".geojson";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  loadJSZip(function () {
    var zip = new JSZip();

    var layers = {
      burgs: exportBurgs(),
      states: exportStates(),
      provinces: exportProvinces(),
      cultures: exportCultures(),
      religions: exportReligions(),
      routes: exportRoutes(),
      rivers: exportRivers(),
      markers: exportMarkers(),
    };

    Object.keys(layers).forEach(function (name) {
      zip.file(mapNameValue + "-" + name + ".geojson", toGeoJSON(layers[name]));
    });

    zip.generateAsync({ type: "blob" }).then(function (content) {
      var a = document.createElement("a");
      a.href = URL.createObjectURL(content);
      a.download = mapNameValue + "-geojson-export.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    });
  });
})();
