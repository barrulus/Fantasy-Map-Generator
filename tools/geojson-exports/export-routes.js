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

  var features = pack.routes
    .filter(function (r) {
      return r.points && r.points.length >= 2;
    })
    .map(function (r) {
      var coordinates = r.points.map(function (p) {
        return getCoords(p[0], p[1]);
      });

      var name = "";
      try {
        name = window.Routes.generateName(r);
      } catch (e) {
        name = "Route " + r.i;
      }

      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coordinates,
        },
        properties: {
          id: r.i,
          name: name,
          group: r.group || "",
          feature: r.feature || 0,
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
  a.download = (window.mapName ? window.mapName.value : "map") + "-routes.geojson";
  a.click();
  URL.revokeObjectURL(a.href);
})();
