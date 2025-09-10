"use strict";

// Minimal categorical Terrain layer (MVS): orography + wetlands + dunes + ice
// Writes pack.cells.terrain (Uint8) and optional terrainSubtype (unused in MVS)
window.Terrain = (function () {
  const CODES = {
    ocean: 1,
    lake: 2,
    glacier_ice: 3,
    mountains: 4,
    highlands: 5,
    hills: 6,
    plains: 7,
    wetland: 8,
    dunes: 9,
    cultivated: 10
  };

  function defaults() {
    return {
      // Orography thresholds (height units: 0..100)
      H1: 75, // mountains elev threshold
      H0: 55, // highlands elev threshold
      // Slope / relief thresholds (height units)
      S1: 10, // mountains slope
      S0: 4,  // hills slope
      R1: 20,
      R0: 10,
      // Wetness / aridity
      W1: 28, // wetland hydric index
      iceTemp: -8 // temperature threshold for glacier_ice
    };
  }

  function generate({cells = pack.cells, biomesData, options} = {}) {
    options = Object.assign(defaults(), options || {});
    const n = cells.i.length;
    if (!cells.terrain || cells.terrain.length !== n) cells.terrain = new Uint8Array(n);
    if (!cells.terrainSubtype || cells.terrainSubtype.length !== n) cells.terrainSubtype = new Uint8Array(n);

    // Compute supporting surfaces
    const {slope, relief, hydric} = EnvSurfaces.compute({cells, gridCells: grid.cells});

    const {H1, H0, S1, S0, R1, R0, W1, iceTemp} = options;
    const t = cells.terrain;

    for (const i of cells.i) {
      const h = cells.h[i];
      const type = grid.cells.t[cells.g[i]]; // water mask: -2 lake, -1 coast, 0 ocean?, 1 coast line etc.
      const temp = grid.cells.temp[cells.g[i]];

      // A. Hard overrides
      if (h < 20) { t[i] = CODES.ocean; continue; }
      // not deep water but check lakes
      if (grid.features[grid.cells.f[cells.g[i]]]?.type === "lake") { t[i] = CODES.lake; continue; }
      if (temp <= iceTemp) { t[i] = CODES.glacier_ice; continue; }

      // B. Orography
      if (h >= H1 || (slope[i] >= S1 && relief[i] >= R1)) { t[i] = CODES.mountains; continue; }
      if (h >= H0 || relief[i] >= R0) { t[i] = CODES.highlands; continue; }
      if (slope[i] >= S0 || relief[i] >= R0 / 2) { t[i] = CODES.hills; continue; }
      t[i] = CODES.plains;
    }

    // C. Wetlands (refine on land only)
    for (const i of cells.i) {
      if (t[i] === CODES.plains || t[i] === CODES.hills || t[i] === CODES.highlands) {
        if (hydric[i] >= W1) t[i] = CODES.wetland;
      }
    }

    // E. Dunes (simple proxy: desert biomes on flat terrain)
    // Biomes: 1=Hot desert, 2=Cold desert per modules/biomes.js default set
    if (cells.biome) {
      for (const i of cells.i) {
        if (t[i] === CODES.plains || t[i] === CODES.highlands) {
          const b = cells.biome[i];
          if ((b === 1 || b === 2) && slope[i] < S0) t[i] = CODES.dunes;
        }
      }
    }

    // Store simple surfaces for downstream use
    pack.terrainSurfaces = {slope, relief, hydric};

    // G. Smoothing (1 pass majority filter on local neighborhood, ignore water/ice)
    smoothTerrain({cells, exclude: new Set([CODES.ocean, CODES.lake, CODES.glacier_ice])});

    // F. Farmland allocation (simple MVS)
    // Preserve base before farmland
    cells.terrainBase = new Uint8Array(cells.terrain);
    if (window.FarmlandAllocator?.allocate) {
      try { FarmlandAllocator.allocate({cells}); } catch (e) { console.error("Farmland allocation failed:", e); }
    }
  }

  function smoothTerrain({cells, rounds = 1, exclude = new Set()}) {
    const n = cells.i.length;
    const t = cells.terrain;
    const tmp = new Uint8Array(n);
    for (let r = 0; r < rounds; r++) {
      for (const i of cells.i) {
        const cur = t[i];
        if (exclude.has(cur)) { tmp[i] = cur; continue; }
        const counts = new Map();
        const neibs = cells.c[i];
        counts.set(cur, (counts.get(cur) || 0) + 1);
        for (let k = 0; k < neibs.length; k++) {
          const v = t[neibs[k]];
          if (exclude.has(v)) continue;
          counts.set(v, (counts.get(v) || 0) + 1);
        }
        let best = cur, bestCount = -1;
        for (const [code, c] of counts) {
          if (c > bestCount) { bestCount = c; best = code; }
        }
        tmp[i] = best;
      }
      t.set(tmp);
    }
  }

  return {defaults, generate};
})();
