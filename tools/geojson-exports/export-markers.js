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

  var markers = pack.markers || [];
  var features = markers
    .filter(function (m) {
      return m && !m.removed && m.x != null && m.y != null;
    })
    .map(function (m) {
      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: getCoords(m.x, m.y),
        },
        properties: {
          id: m.i,
          icon: m.icon || "",
          type: m.type || "",
          cell: m.cell || 0,
          dx: m.dx || 0,
          dy: m.dy || 0,
        },
      };
    });

  // Also include notes for markers if available
  var notesArray = typeof notes !== "undefined" && Array.isArray(notes) ? notes : [];
  if (notesArray.length) {
    features.forEach(function (f) {
      var note = notesArray.find(function (n) {
        return n.id === "marker" + f.properties.id;
      });
      if (note) {
        f.properties.name = note.name || "";
        f.properties.legend = note.legend || "";
      }
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
  a.download = (window.mapName ? window.mapName.value : "map") + "-markers.geojson";
  a.click();
  URL.revokeObjectURL(a.href);
})();
