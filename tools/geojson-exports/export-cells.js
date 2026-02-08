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
    coords.push(coords[0]);
    return coords;
  }

  var features = [];
  for (var i = 0; i < pack.cells.i.length; i++) {
    var poly = getCellPolygon(i);
    if (!poly) continue;

    var state = pack.cells.state ? pack.cells.state[i] : 0;
    var culture = pack.cells.culture ? pack.cells.culture[i] : 0;
    var religion = pack.cells.religion ? pack.cells.religion[i] : 0;
    var province = pack.cells.province ? pack.cells.province[i] : 0;

    features.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [poly],
      },
      properties: {
        id: i,
        height: pack.cells.h[i] || 0,
        biome: pack.cells.biome ? pack.cells.biome[i] : 0,
        biomeName: pack.cells.biome && window.biomesData
          ? window.biomesData.name[pack.cells.biome[i]] || ""
          : "",
        state: state,
        stateName: state ? (pack.states[state] || {}).name || "" : "",
        culture: culture,
        cultureName: culture ? (pack.cultures[culture] || {}).name || "" : "",
        religion: religion,
        religionName: religion ? (pack.religions[religion] || {}).name || "" : "",
        province: province,
        population: pack.cells.pop ? pack.cells.pop[i] : 0,
        burg: pack.cells.burg ? pack.cells.burg[i] : 0,
        river: pack.cells.r ? pack.cells.r[i] : 0,
        feature: pack.cells.f ? pack.cells.f[i] : 0,
      },
    });
  }

  var geojson = {
    type: "FeatureCollection",
    features: features,
  };

  var blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: "application/geo+json",
  });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (window.mapName ? window.mapName.value : "map") + "-cells.geojson";
  a.click();
  URL.revokeObjectURL(a.href);
})();
