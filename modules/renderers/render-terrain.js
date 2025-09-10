"use strict";

// Terrain renderer helpers: ensure SVG patterns and provide overlay drawing helpers
window.RenderTerrain = (function () {
  function ensureDefs(opts = {}) {
    const {cultivatedScale = 1, wetlandsScale = 1, dunesScale = 1} = opts;
    const defs = d3.select('#deftemp');
    if (!defs.node()) return;

    // Cultivated: subtle diagonal hatch
    {
      const base = 8;
      const W = Math.max(2, base * cultivatedScale);
      const H = Math.max(2, base * cultivatedScale);
      let p = d3.select('#pattern-cultivated');
      if (!p.node()) {
        p = defs.append('pattern').attr('id', 'pattern-cultivated').attr('patternUnits', 'userSpaceOnUse');
        p.append('rect');
        p.append('path');
      }
      p.attr('width', W).attr('height', H).attr('patternTransform', 'rotate(30)');
      p.select('rect').attr('width', W).attr('height', H).attr('fill', '#d2c56b');
      p.select('path').attr('d', `M0 0 L0 ${H}`).attr('stroke', '#b7aa55').attr('stroke-width', Math.max(0.6, cultivatedScale));
    }

    // Wetland: dotted pattern
    {
      const base = 6;
      const W = Math.max(2, base * wetlandsScale);
      const H = Math.max(2, base * wetlandsScale);
      let p = d3.select('#pattern-wetland');
      if (!p.node()) {
        p = defs.append('pattern').attr('id', 'pattern-wetland').attr('patternUnits', 'userSpaceOnUse');
        p.append('rect');
        p.append('circle');
      }
      p.attr('width', W).attr('height', H);
      p.select('rect').attr('width', W).attr('height', H).attr('fill', '#a6d9a9');
      p.select('circle').attr('cx', W / 2).attr('cy', H / 2).attr('r', Math.max(0.5, 0.7 * wetlandsScale)).attr('fill', '#0a7d2c').attr('opacity', 0.5);
    }

    // Dunes: wave lines
    {
      const baseW = 12, baseH = 6;
      const W = Math.max(4, baseW * dunesScale);
      const H = Math.max(2, baseH * dunesScale);
      let p = d3.select('#pattern-dunes');
      if (!p.node()) {
        p = defs.append('pattern').attr('id', 'pattern-dunes').attr('patternUnits', 'userSpaceOnUse');
        p.append('rect');
        p.append('path');
      }
      p.attr('width', W).attr('height', H);
      p.select('rect').attr('width', W).attr('height', H).attr('fill', '#f2d38d');
      const mid = H / 2; const qx = W / 4; const half = W / 2;
      const d = `M0 ${mid} Q${qx} 0 ${half} ${mid} T${W} ${mid}`;
      p.select('path')
        .attr('d', d)
        .attr('stroke', '#d7b773')
        .attr('fill', 'none')
        .attr('stroke-width', Math.max(0.5, 0.7 * dunesScale))
        .attr('opacity', 0.7);
    }
  }

  function getPalette(opts = {}) {
    const {showWetlands = true, showDunes = true} = opts;
    return {
      1: '#466eab', // ocean
      2: '#8db6ff', // lake
      3: '#d5e7eb', // ice
      4: '#7d6a5a', // mountains
      5: '#aa987f', // highlands
      6: '#c2b59b', // hills
      7: '#e6ddc4', // plains
      8: showWetlands ? 'url(#pattern-wetland)' : '#a6d9a9', // wetland
      9: showDunes ? 'url(#pattern-dunes)' : '#f2d38d', // dunes
      10: '#d2c56b' // cultivated (base color, overlay adds hatch)
    };
  }

  // Draw cultivated intensity overlay (per cell polygons)
  function drawCultivatedOverlay(opts = {}) {
    const g = d3.select('#landcoverOverlay');
    g.selectAll('*').remove();
    if (!pack?.cells?.terrain) return;

    ensureDefs(opts);
    const cells = pack.cells;
    const cultivatedCode = 10;
    const items = [];
    for (const i of cells.i) {
      if (cells.terrain[i] !== cultivatedCode) continue;
      const intensity = cells.cultivatedIntensity?.[i] || 0.6;
      if (intensity <= 0) continue;
      const points = getPackPolygon(i);
      items.push({i, points, intensity});
    }

    const polys = g.selectAll('polygon').data(items).enter().append('polygon');
    polys
      .attr('points', d => d.points)
      .attr('fill', 'url(#pattern-cultivated)')
      .attr('fill-opacity', d => Math.min(0.85, Math.max(0.2, d.intensity)))
      .attr('stroke', 'none');
  }

  return {ensureDefs, getPalette, drawCultivatedOverlay};
})();
