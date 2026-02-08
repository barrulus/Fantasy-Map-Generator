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

  // Extract river paths from SVG since pack.rivers contains metadata
  // but actual geometry is rendered in SVG
  var features = (pack.rivers || [])
    .filter(function (r) {
      return r.i && !r.removed;
    })
    .map(function (r) {
      // Build river coordinates from cells
      var coordinates = [];
      if (r.cells && r.cells.length) {
        for (var i = 0; i < r.cells.length; i++) {
          var cellId = r.cells[i];
          var p = pack.cells.p[cellId];
          if (p) coordinates.push(getCoords(p[0], p[1]));
        }
      } else {
        // Fallback: try to extract from SVG path
        var pathEl = document.querySelector("#rivers > path#river" + r.i);
        if (pathEl) {
          var totalLen = pathEl.getTotalLength();
          var step = Math.max(totalLen / 50, 1);
          for (var d = 0; d <= totalLen; d += step) {
            var pt = pathEl.getPointAtLength(d);
            coordinates.push(getCoords(pt.x, pt.y));
          }
          // add final point
          var last = pathEl.getPointAtLength(totalLen);
          coordinates.push(getCoords(last.x, last.y));
        }
      }

      if (coordinates.length < 2) return null;

      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: coordinates,
        },
        properties: {
          id: r.i,
          name: r.name || "",
          type: r.type || "",
          basin: r.basin || 0,
          parent: r.parent || 0,
          mouth: r.mouth || 0,
          length: r.length || 0,
          width: r.width || 0,
        },
      };
    })
    .filter(function (f) {
      return f !== null;
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
  a.download = (window.mapName ? window.mapName.value : "map") + "-rivers.geojson";
  a.click();
  URL.revokeObjectURL(a.href);
})();
