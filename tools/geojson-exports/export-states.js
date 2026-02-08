(function () {
  "use strict";

  if (!window.pack) {
    alert("Open this on Fantasy Map Generator");
    return;
  }

  var pack = window.pack;
  var mapCoordinates = window.mapCoordinates;

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
    coords.push(coords[0]); // close ring
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

  var features = pack.states
    .filter(function (s) {
      return s.i && !s.removed;
    })
    .map(function (s) {
      var cellIds = [];
      for (var i = 0; i < pack.cells.i.length; i++) {
        if (pack.cells.state[i] === s.i && pack.cells.h[i] >= 20) {
          cellIds.push(i);
        }
      }

      return {
        type: "Feature",
        geometry: {
          type: "MultiPolygon",
          coordinates: buildMultiPolygon(cellIds),
        },
        properties: {
          id: s.i,
          name: s.name || "",
          fullName: s.fullName || "",
          form: s.formName || "",
          color: s.color || "",
          area: s.area || 0,
          cells: s.cells || 0,
          burgs: s.burgs || 0,
          rural: Math.round((s.rural || 0) * window.populationRate),
          urban: Math.round((s.urban || 0) * window.populationRate),
          totalPopulation: Math.round(
            ((s.rural || 0) + (s.urban || 0)) * window.populationRate
          ),
        },
      };
    });

  var geojson = {
    type: "FeatureCollection",
    features: features,
  };

  var blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: "application/geo+json",
  });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (window.mapName ? window.mapName.value : "map") + "-states.geojson";
  a.click();
  URL.revokeObjectURL(a.href);
})();
