"use strict";

// Minimal farmland allocator (MVS): allocate farmland cells around burgs
// Writes: pack.cells.terrainBase (Uint8), cultivatedIntensity (Float32), cultivatedBy (Uint16)
// and sets pack.cells.terrain = cultivated on allocated cells.
window.FarmlandAllocator = (function () {
  const CODES = {
    cultivated: 10,
    ocean: 1,
    lake: 2,
    glacier_ice: 3,
    mountains: 4,
    highlands: 5,
    hills: 6,
    plains: 7,
    wetland: 8,
    dunes: 9
  };

  function defaults() {
    return {
      cellsPerThousand: 4, // farmland cells to allocate per 1k pop (tunable)
      maxSteps: 45, // BFS search radius in cell steps
      maxSlope: 6, // disallow steeper slopes
      minFSS: 5 // minimal suitability score to consider
    };
  }

  function allocate({cells = pack.cells, options} = {}) {
    options = Object.assign(defaults(), options || {});
    const {cellsPerThousand, maxSteps, maxSlope, minFSS} = options;

    const n = cells.i.length;
    if (!cells.terrainBase || cells.terrainBase.length !== n) cells.terrainBase = new Uint8Array(cells.terrain);
    if (!cells.cultivatedIntensity || cells.cultivatedIntensity.length !== n) cells.cultivatedIntensity = new Float32Array(n);
    if (!cells.cultivatedBy || cells.cultivatedBy.length !== n) cells.cultivatedBy = new Uint16Array(n);

    const slope = pack.terrainSurfaces?.slope;
    const hydric = pack.terrainSurfaces?.hydric;
    const visitedGlobal = new Uint8Array(n);

    const disallowed = new Set([CODES.ocean, CODES.lake, CODES.glacier_ice, CODES.mountains, CODES.dunes]);

    // reset burg totals
    for (const b of pack.burgs) if (b && b.i && !b.removed) b.farmlandArea = 0;

    for (const b of pack.burgs) {
      if (!b?.i || b.removed || b.flying) continue;
      const required = Math.max(0, Math.round((b.population || 0) * cellsPerThousand));
      if (!required) continue;

      const start = b.cell;
      // BFS gather candidates within maxSteps
      const queue = [start];
      const dist = new Uint16Array(n);
      const visited = new Uint8Array(n);
      visited[start] = 1;

      const candidates = [];
      while (queue.length) {
        const cur = queue.shift();
        const d = dist[cur];
        if (d > maxSteps) continue;

        const t = cells.terrain[cur];
        const isAllowed = !disallowed.has(t) && (slope ? slope[cur] <= maxSlope : true) && cells.h[cur] >= 20;
        if (isAllowed) {
          const fss = suitability(cur);
          if (fss >= minFSS) {
            const score = fss - d * 0.4; // distance decay
            candidates.push({cell: cur, score, fss, dist: d});
          }
        }

        for (const nx of cells.c[cur]) {
          if (visited[nx]) continue;
          visited[nx] = 1;
          dist[nx] = d + 1;
          queue.push(nx);
        }
      }

      // Sort by score, allocate top N cells not yet cultivated
      candidates.sort((a, b2) => b2.score - a.score);
      let allocated = 0;
      for (let k = 0; k < candidates.length && allocated < required; k++) {
        const i = candidates[k].cell;
        if (visitedGlobal[i]) continue; // already allocated to another burg
        // Skip wetlands by default (can be drained later via option)
        if (cells.terrain[i] === CODES.wetland) continue;
        // Mark cultivated
        cells.terrain[i] = CODES.cultivated;
        // Intensity: combine normalized suitability and inverse distance
        const fssNorm = Math.min(candidates[k].fss / 30, 1);
        const distNorm = Math.max(0, 1 - candidates[k].dist / Math.max(1, maxSteps));
        cells.cultivatedIntensity[i] = Math.max(0.2, 0.6 * fssNorm + 0.4 * distNorm);
        cells.cultivatedBy[i] = b.i;
        visitedGlobal[i] = 1;
        allocated++;
        b.farmlandArea += (cells.area?.[i] || 0);
      }
    }

    // Aggregate by state
    const states = pack.states || [];
    for (const s of states) { if (s && s.i && !s.removed) { s.cultivatedArea = 0; s.cultivatedPerCapita = 0; } }
    if (cells.area && cells.state) {
      for (const i of cells.i) {
        if (cells.terrain[i] !== CODES.cultivated) continue;
        const st = cells.state[i];
        if (!states[st] || states[st].removed) continue;
        states[st].cultivatedArea = (states[st].cultivatedArea || 0) + (cells.area[i] || 0);
      }
      // per capita (using states population if present)
      for (const s of states) {
        if (!s || s.removed) continue;
        const pop = s.population || 0;
        if (pop > 0 && s.cultivatedArea) s.cultivatedPerCapita = s.cultivatedArea / pop;
      }
    }

    function suitability(i) {
      let s = 0;
      const biome = cells.biome?.[i] || 0;
      // base: grassland/savanna best, forest moderate, steppe moderate, deserts poor
      if (biome === 4) s += 25; // Grassland
      else if (biome === 3) s += 18; // Savanna
      else if (biome === 5 || biome === 6 || biome === 8) s += 12; // seasonal/deciduous/rainforest edges
      else if (biome === 2 || biome === 1) s += 4; // deserts
      else s += 8;
      if (hydric) s += Math.min(hydric[i], 20);
      if (slope) s -= Math.min(slope[i] * 2, 20);
      return Math.max(0, s);
    }
  }

  return {defaults, allocate};
})();
