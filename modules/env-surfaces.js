"use strict";

// Basic environmental surfaces used by Terrain classification (MVS)
// Computes lightweight per-cell typed arrays with minimal cost.
window.EnvSurfaces = (function () {
  function compute({cells = pack.cells, gridCells = grid.cells} = {}) {
    const n = cells.i.length;
    const slope = new Float32Array(n);
    const relief = new Float32Array(n);
    const hydric = new Float32Array(n);

    const h = cells.h; // 0..100
    const neighbors = cells.c;

    // Approximate slope by mean absolute height diff to neighbors
    for (let i = 0; i < n; i++) {
      const neibs = neighbors[i];
      if (!neibs || neibs.length === 0) continue;
      let sum = 0;
      let max = -Infinity, min = Infinity;
      for (let k = 0; k < neibs.length; k++) {
        const v = Math.abs(h[i] - h[neibs[k]]);
        sum += v;
        if (h[neibs[k]] > max) max = h[neibs[k]];
        if (h[neibs[k]] < min) min = h[neibs[k]];
      }
      slope[i] = sum / neibs.length; // 0..~100
      relief[i] = Math.max(0, max - min); // local relief in height units
    }

    // Hydric index: precipitation + river adjacency bonus - slope penalty, masked by land
    const prec = gridCells.prec;
    const river = cells.r;
    for (let i = 0; i < n; i++) {
      const isLand = h[i] >= 20;
      if (!isLand) { hydric[i] = 0; continue; }
      const p = prec[cells.g[i]] || 0; // 0..?
      const riverBonus = river[i] ? 20 : 0;
      const slopePenalty = Math.min(slope[i] * 0.8, 25);
      hydric[i] = Math.max(0, p + riverBonus - slopePenalty);
    }

    return {slope, relief, hydric};
  }

  return {compute};
})();

