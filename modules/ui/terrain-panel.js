"use strict";

// Lightweight UI panel to tune Terrain thresholds and farmland options
window.TerrainPanel = (function () {
  const STORAGE_KEY = "terrainOptions";

  function getOptions() {
    const saved = JSON.safeParse(localStorage.getItem(STORAGE_KEY));
    return Object.assign(
      {},
      Terrain.defaults(),
      FarmlandAllocator.defaults(),
      {
        smoothingRounds: 1,
        showWetlands: true,
        showDunes: true,
        showCultivatedOverlay: false,
        // texture scales
        cultivatedScale: 1,
        wetlandsScale: 1,
        dunesScale: 1
      },
      saved || {}
    );
  }

  function saveOptions(opts) { localStorage.setItem(STORAGE_KEY, JSON.stringify(opts)); }

  function open() {
    let el = byId("terrainPanel");
    if (!el) {
      el = document.createElement("div");
      el.id = "terrainPanel";
      el.className = "dialog stable";
      el.style.display = "none";
      document.body.appendChild(el);
    }

    const opts = getOptions();
    el.innerHTML = panelHTML(opts);

    $("#terrainPanel").dialog({
      title: "Terrain Options",
      resizable: false,
      width: fitContent(),
      position: {my: "left top", at: "left+20 top+20", of: "svg", collision: "fit"}
    });

    // Wire inputs
    const bind = (id, key, parse = parseFloat) => {
      byId(id).on("input", () => {
        const o = getOptions();
        o[key] = parse(byId(id).value);
        saveOptions(o);
      });
    };

    bind("terr_H1", "H1");
    bind("terr_H0", "H0");
    bind("terr_S1", "S1");
    bind("terr_S0", "S0");
    bind("terr_W1", "W1");
    bind("terr_iceTemp", "iceTemp");
    bind("terr_smooth", "smoothingRounds", v => parseInt(v));
    bind("farm_cpt", "cellsPerThousand", v => parseFloat(v));
    bind("farm_maxSteps", "maxSteps", v => parseInt(v));
    bind("farm_maxSlope", "maxSlope", v => parseFloat(v));
    bind("farm_minFSS", "minFSS", v => parseFloat(v));
    bind("tex_cultivated", "cultivatedScale", v => parseFloat(v));
    bind("tex_wetlands", "wetlandsScale", v => parseFloat(v));
    bind("tex_dunes", "dunesScale", v => parseFloat(v));

    byId("terrainApply").on("click", apply);
    byId("terrainReset").on("click", () => { saveOptions({}); apply(); });

    // Flags
    const bindFlag = (id, key) => {
      const el = byId(id);
      if (el) el.checked = !!opts[key];
      el?.addEventListener('change', () => {
        const o = getOptions();
        o[key] = !!el.checked; saveOptions(o); applyRenderOptions();
      });
    };
    bindFlag('opt_showWetlands', 'showWetlands');
    bindFlag('opt_showDunes', 'showDunes');
    bindFlag('opt_showCultivatedOverlay', 'showCultivatedOverlay');
  }

  function apply() {
    const opts = getOptions();
    try {
      Terrain.generate({cells: pack.cells, biomesData, options: opts});
      applyRenderOptions();
      tip("Terrain rebuilt", false, "success", 1500);
    } catch (e) {
      console.error(e);
      tip("Terrain rebuild failed", false, "error", 2000);
    }
  }

  function applyRenderOptions() {
    const opts = getOptions();
    if (layerIsOn('toggleTerrainFull')) drawTerrain();
    // Cultivated overlay
    if (opts.showCultivatedOverlay) {
      if (!layerIsOn('toggleCultivatedOverlay')) turnButtonOn('toggleCultivatedOverlay');
      drawCultivatedOverlay();
    } else {
      if (layerIsOn('toggleCultivatedOverlay')) d3.select('#landcoverOverlay').selectAll('*').remove();
      turnButtonOff('toggleCultivatedOverlay');
    }
  }

  function toggleOption(key, value) {
    const o = getOptions();
    o[key] = value; saveOptions(o); applyRenderOptions();
  }

  function panelHTML(o) {
    return /* html */ `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:.4em;">
        <label>Mountains H1</label><input id="terr_H1" type="number" value="${o.H1}" step="1" min="20" max="100" />
        <label>Highlands H0</label><input id="terr_H0" type="number" value="${o.H0}" step="1" min="20" max="100" />
        <label>Mountain slope S1</label><input id="terr_S1" type="number" value="${o.S1}" step="0.5" min="0" max="50" />
        <label>Hills slope S0</label><input id="terr_S0" type="number" value="${o.S0}" step="0.5" min="0" max="50" />
        <label>Wetness cutoff W1</label><input id="terr_W1" type="number" value="${o.W1}" step="1" min="0" max="80" />
        <label>Ice temperature</label><input id="terr_iceTemp" type="number" value="${o.iceTemp}" step="1" min="-30" max="5" />
        <label>Smoothing rounds</label><input id="terr_smooth" type="number" value="${o.smoothingRounds}" step="1" min="0" max="3" />
      </div>
      <hr />
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:.4em;">
        <label>Cells per 1k pop</label><input id="farm_cpt" type="number" value="${o.cellsPerThousand}" step="0.1" min="0" max="50" />
        <label>Max steps</label><input id="farm_maxSteps" type="number" value="${o.maxSteps}" step="1" min="1" max="200" />
        <label>Max farm slope</label><input id="farm_maxSlope" type="number" value="${o.maxSlope}" step="0.5" min="0" max="50" />
        <label>Min suitability</label><input id="farm_minFSS" type="number" value="${o.minFSS}" step="0.5" min="0" max="100" />
      </div>
      <hr />
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:.4em;">
        <label>Cultivated texture</label><input id="tex_cultivated" type="range" min="0.5" max="2" step="0.1" value="${o.cultivatedScale}"/>
        <label>Wetlands texture</label><input id="tex_wetlands" type="range" min="0.5" max="2" step="0.1" value="${o.wetlandsScale}"/>
        <label>Dunes texture</label><input id="tex_dunes" type="range" min="0.5" max="2" step="0.1" value="${o.dunesScale}"/>
      </div>
      <div>
        <label><input id="opt_showWetlands" type="checkbox" ${o.showWetlands ? 'checked' : ''}/> Show wetlands texture</label><br/>
        <label><input id="opt_showDunes" type="checkbox" ${o.showDunes ? 'checked' : ''}/> Show dunes texture</label><br/>
        <label><input id="opt_showCultivatedOverlay" type="checkbox" ${o.showCultivatedOverlay ? 'checked' : ''}/> Show cultivated overlay</label>
      </div>
      <div style="margin-top:.6em; text-align:right;">
        <button id="terrainReset">Reset</button>
        <button id="terrainApply">Apply</button>
      </div>`;
  }

  return {open, getOptions, toggleOption, applyRenderOptions};
})();
