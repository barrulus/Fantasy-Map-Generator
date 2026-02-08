(function () {
  "use strict";

  if (!window.pack) {
    alert("Open this on Fantasy Map Generator");
    return;
  }

  const pack = window.pack;
  const mapCoordinates = window.mapCoordinates;

  function getCoords(x, y) {
    const p = mapCoordinates;
    const latN = p.latN;
    const latS = p.latS;
    const lonW = p.lonW;
    const lonE = p.lonE;
    const w = window.graphWidth;
    const h = window.graphHeight;
    const lon = lonW + (x / w) * (lonE - lonW);
    const lat = latN - (y / h) * (latN - latS);
    return [+lon.toFixed(6), +lat.toFixed(6)];
  }

  const features = pack.burgs
    .filter(function (b) {
      return b.i && !b.removed;
    })
    .map(function (b) {
      var state = pack.states[b.state] || {};
      var province = b.cell != null && pack.cells.province
        ? pack.provinces[pack.cells.province[b.cell]] || {}
        : {};
      var culture = pack.cultures[b.culture] || {};
      var religion = b.cell != null && pack.cells.religion
        ? pack.religions[pack.cells.religion[b.cell]] || {}
        : {};

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: getCoords(b.x, b.y),
        },
        properties: {
          id: b.i,
          name: b.name || "",
          state: state.name || "",
          stateId: b.state || 0,
          province: province.name || "",
          culture: culture.name || "",
          religion: religion.name || "",
          population: Math.round((b.population || 0) * window.populationRate),
          populationRaw: b.population || 0,
          capital: b.capital || 0,
          port: b.port || 0,
          citadel: b.citadel || 0,
          walls: b.walls || 0,
          plaza: b.plaza || 0,
          temple: b.temple || 0,
          shanty: b.shanty || 0,
          type: b.type || "",
          group: b.group || "",
          settlementType: b.settlementType || "",
          flying: b.flying || 0,
          skyPort: b.skyPort || 0,
          elevation: b.cell != null ? pack.cells.h[b.cell] : 0,
          temperature: b.cell != null && window.grid
            ? window.grid.cells.temp[pack.cells.g[b.cell]]
            : null,
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
  a.download = (window.mapName ? window.mapName.value : "map") + "-burgs.geojson";
  a.click();
  URL.revokeObjectURL(a.href);
})();
