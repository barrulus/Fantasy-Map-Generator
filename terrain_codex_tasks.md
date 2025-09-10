# Terrain Codex Implementation — Analysis and Task Plan

This document translates `terrain_codex.md` into a concrete, repo-aligned plan to implement a full Terrain layer (including Cultivated/Farmland) in Fantasy Map Generator (FMG). It covers current-state analysis, architecture, data model updates, integration points, and a phased task plan with clear file targets and deliverables.

---

## Current State Analysis (Repo)

- Layers and pipeline:
  - `main.js:756–793` builds the generation pipeline without a terrain module yet; relevant steps include `Rivers.generate()`, `Biomes.define()`, `Cultures.generate()`, `BurgsAndStates.generate()`, `Routes.generate()`. Proposed insertion point: after burgs, before routes.
  - Existing SVG groups include `#biomes` and `#terrain`. Note: `#terrain` is used for relief icons, not for categorical land-cover.
    - Relief icons renderer: `modules/renderers/draw-relief-icons.js`
    - Relief layer toggles: `modules/ui/layers.js:752–767` (`toggleRelief`, `drawReliefIcons`)

- Rendering patterns to reuse:
  - Biomes are rendered by isolines grouped by ID → fill paths: `modules/ui/layers.js:271–286`. We can replicate this approach for terrain categories.

- Data structures and save/load:
  - `pack.cells` arrays include `biome`, `burg`, `state`, `routes`, etc. No terrain-specific arrays yet.
  - Save: `modules/io/save.js:102–158` composes a `.map` payload from `pack` and `grid`. New arrays must be serialized here.
  - Load: `modules/io/load.js:382–459` rehydrates `pack` fields and toggles layers. New arrays must be parsed and applied here.

- Routes integration baseline:
  - Cost cache in `modules/routes-generator.js:100–138` uses height, habitability, burg factor, water type. It does not yet consider terrain categories or farmland.
  - Cost evaluator in `modules/routes-generator.js:994–1053` is where new terrain-based costs/penalties can be applied per route tier.

- Surfaces availability:
  - Heights exist (`pack.cells.h`) but there’s no precomputed `slope`, `relief`, `hydric`, etc. We will add a new helper module to compute and cache these.

- UI structure:
  - Layer toggles live in `modules/ui/layers.js`. We should add a dedicated toggle and draw function for the full Terrain view, separate from relief icons.

---

## Proposed Architecture (Repo-Aligned)

- Classification and orchestration:
  - `modules/terrain-generator.js` (new): drives the end-to-end terrain classification, writes `pack.cells` arrays, and calls farmland allocator.

- Environmental surfaces:
  - `modules/env-surfaces.js` (new): computes `slope`, `relative_relief`, `ruggedness`, `hydric index`, `floodplain index`, `aridity index`, and optional `permafrost`, `sandiness` proxies. Uses typed arrays.

- Farmland allocation:
  - `modules/farmland-allocator.js` (new): demand-driven multi-source grower keyed by `(distance_cost, -FSS)` satisfying per-burg food/area requirements.

- Rendering:
  - `modules/renderers/render-terrain.js` (new): renders a categorical Terrain overlay similar to biomes via isolines; produces optional palette PNG export.
  - New SVG group `#landcover` for the categorical Terrain layer to avoid colliding with existing `#terrain` (relief icons). Insert near other groups in `main.js`.

- UI:
  - `modules/ui/terrain-panel.js` (new): adds terrain options (threshold sliders, farmland tuning, smoothing rounds), and registers a new layer toggle `toggleTerrainFull` + drawer `drawTerrain` inside `modules/ui/layers.js`.

- Data model additions on `pack.cells`:
  - `terrain` (Uint16/Uint8 enum), `terrainSubtype` (Uint16/Uint8 enum or packed int), `terrainBase` (pre-farmland),
    `cultivatedIntensity` (Float32Array 0–1), `cultivatedBy` (Uint16 burg id or 0), optional `forestDensity` (Float32Array 0–1), `wetness` (Float32Array 0–1).
  - On `pack.burgs` / `pack.states`: `farmlandArea`, `cultivatedArea`, `cultivatedPerCapita` as numbers.
  - Save/Load: extend `modules/io/save.js` and `modules/io/load.js` with backward-compatible slots.

- Routing:
  - Extend `modules/routes-generator.js` cost cache and evaluators to account for new terrain and farmland (cheaper across cultivated/plains/valley cells; higher penalties for wetlands/dunes/steep mountains; respect farmland polygon integrity with small split penalty).

---

## Terrain Taxonomy Mapping (From Codex)

- Land/Water: `ocean`, `coast`, `lake` (existing water masks)
- Orography: `glacier_ice`, `mountains`, `highlands`, `hills`, `plains`
- Aridity/Vegetation: `desert`, `cold_desert`, `steppe`, `grassland`, `savanna`, `forest_broadleaf`, `forest_conifer`, `rainforest`
- Wetlands/Special: `wetland` with subtype `swamp|marsh|bog`, `delta_floodplain`
- Surface forms: `dunes`, `bare_rock`, `volcanic`, `salt_flat`
- Human land-use: `cultivated` with intensity and burg attribution

Notes:
- Keep biome/ecology separate; write vegetation to `terrainSubtype` when orography is dominant (e.g., `mountains + conifer`).
- `terrainBase` stores pre-farmland class for toggles.

---

## Integration Points (Concrete Files)

- Add generation step in pipeline:
  - Insert after burgs and before routes in `main.js:779–783`:
    - `Terrain.generate({ cells: pack.cells, burgs: pack.burgs, rivers: pack.rivers, lakes: grid.features, biomesData, options: Terrain.defaults() });`

- Add new DOM group for rendering:
  - In `main.js:36–66` where groups are created, append:
    - `let landcover = viewbox.append("g").attr("id", "landcover");`

- Save/Load model fields:
  - Save arrays in `modules/io/save.js:140–320` next free slots; keep old indices stable.
  - Load arrays in `modules/io/load.js:382–459` with presence checks to remain backward-compatible.

- Routes cost integration:
  - Extend cost cache and evaluators in `modules/routes-generator.js:100–138` and `modules/routes-generator.js:994–1053` to include terrain-based modifiers and a farmland integrity penalty (light deterrent to bisect large cultivated blocks).

- UI toggles and panel:
  - Add `toggleTerrainFull` + `drawTerrain` in `modules/ui/layers.js` (mirroring `toggleBiomes`/`drawBiomes`).
  - Register panel and controls in `modules/ui/terrain-panel.js`. Wire to global options and localStorage like other editors.

---

## Phased Task Plan

Phase 0 — Scaffolding
- Create stubs: `modules/terrain-generator.js`, `modules/farmland-allocator.js`, `modules/env-surfaces.js`, `modules/renderers/render-terrain.js`, `modules/ui/terrain-panel.js`.
- Add `#landcover` group in `main.js` and a placeholder toggle in `modules/ui/layers.js`.
- Wire `Terrain.generate()` call in `main.js` behind a feature flag.

Phase 1 — Environmental Surfaces
- Implement `env-surfaces.js` to compute typed arrays:
  - slope (from neighbor height diffs), relative_relief (local max–min in k-neighborhood), ruggedness (stdev of slope),
    hydric index (moisture + flatness + water adjacency), floodplain index (river order + low slope), aridity index (from prec/temp + rain-shadow proxy),
    permafrost (temp + altitude), sandiness proxy (arid + coastal/leeward).
- Cache results on `Terrain.surfaces` and/or `pack.cells.*` expando fields with prefixes.

Phase 2 — Terrain Classification
- Implement deterministic pass writing `pack.cells.terrain`, `terrainSubtype`, `terrainBase`:
  - A) Hard overrides: water masks, `glacier_ice`, `volcanic/barren` (if detectable; else slope + bare biome proxy).
  - B) Orography by thresholds: mountains/highlands/hills/plains (use H0/H1, S0/S1, R0/R1 from options).
  - C) Hydrology: wetland + subtype; delta/floodplain.
  - D) Vegetation refinement into subtype for elevated orography; otherwise as primary class on plains/highlands.
  - E) Surface forms: dunes, salt flats (override vegetation where applicable).
  - G) Smoothing: majority filter 1–2 passes + contiguity preference.
- Provide `Terrain.defaults()` with sensible thresholds and sliders mapping (see UI section).

Phase 3 — Farmland Allocation
- Compute per-burg demand from `burg.population`, `food_need_per_capita`, buffer, import factor (ports/river hubs), fallow ratio.
- Compute `FSS` (suitability) from `effective_yield`: base yield per biome/cover, moisture bonus, slope and elevation penalties, floodplain bonus, river/coast bonuses; optionally wetland drainage toggle.
- Implement multi-source grower using a priority queue keyed by `(dist_cost, -FSS)`, with distance decay and conflict resolution by pressure (`remaining_area / dist_cost`).
- Write `terrain="cultivated"`, `cultivatedIntensity`, `cultivatedBy`; maintain `terrainBase` for toggling.
- Aggregate `burgs.farmlandArea`, `states.cultivatedArea`, `states.cultivatedPerCapita`.

Phase 4 — Data Model + Save/Load
- Add arrays to `pack.cells` (typed arrays per field) and scalar aggregates to `burgs`/`states`.
- Update `modules/io/save.js` to serialize new arrays in a backward-compatible manner; bump VERSION as appropriate.
- Update `modules/io/load.js` to detect and load new arrays if present; initialize defaults if absent.

Phase 5 — Rendering
- Implement `render-terrain.js`:
  - Use isolines like biomes to group cells by `terrain` → fill polygons into `#landcover`.
  - Map `cultivatedIntensity` to saturation/brightness; optionally texture hatching for cultivated and stipple for wetlands/dunes.
  - Add palette export (indexed color PNG) for fast raster overlays.
- Z-order: water → wetlands/deltas → cultivated → grass/savanna/forest → hills/highlands → mountains → ice/dunes/salt.

Phase 6 — UI + Options
- New toggle: “Terrain (full)” controlling `#landcover` visibility, with subtoggles:
  - Show cultivated overlay, show wetlands/deltas, show vegetation on elevation.
- Options panel sliders:
  - Thresholds: mountain/hill slope, snowline/lapse rate, aridity cutpoints.
  - Farmland: yields per cover/biome, fallow ratio, buffer %, max farm slope, river/coast bonus, port import factor, max radius.
  - Wetlands aggressiveness + drainage toggle; dunes/salt sensitivity; smoothing rounds.
- Persist options and re-run `Terrain.generate()` on change.

Phase 7 — Routes Integration
- Extend route cost cache to include terrain factors:
  - Cheaper: cultivated, plains; moderate: grassland/savanna; expensive: wetlands/dunes; very expensive/blocked: steep mountains, glaciers, salt flats.
  - Small penalty when a route splits large cultivated polygons (to prefer skirting fields).
- Update land path cost in `createCostEvaluator` and adjust `getHeuristicScale` if needed.
- Ensure critical routes (royal/majorSea) retain their override behavior.

Phase 8 — Performance & Smoothing
- Use typed arrays and avoid allocations in hot loops.
- Cap farmland search radius via `r_max ≈ sqrt(required_area / mean_FSS_density)`.
- Optional web worker for per-burg grower on large maps.

Phase 9 — Validation
- Sanity checks:
  - cultivated slope ≤ S_farm for >95% of cells;
  - wetlands near water and low slope;
  - dunes only in arid + sandy zones.
- Dashboards: histogram of terrain by biome; cultivated area per burg vs population; mean slope of cultivated; share of roads by terrain.
- Visual snapshots for known seeds.

Phase 10 — Documentation & Examples
- README explaining thresholds, tunables, and example configs.
- Example seeds/screenshots (with cultivated overlay on/off).

---

## Concrete Work Items (Actionable Checklist)

- Terrain engine
  - Implement `modules/env-surfaces.js` surfaces: slope, relief, ruggedness, hydric, floodplain, aridity, permafrost, sandiness.
  - Implement `modules/terrain-generator.js` with classification steps A–G and smoothing.
  - Implement `modules/farmland-allocator.js` with PQ grower, conflict resolution, and outputs.

- Rendering and UI
  - Add `#landcover` group in `main.js` and a `toggleTerrainFull` + `drawTerrain` in `modules/ui/layers.js` using isolines.
  - Implement `modules/renderers/render-terrain.js` with color/texture mapping and intensity styling for cultivated.
  - Implement `modules/ui/terrain-panel.js` with sliders and subtoggles; wire to `Terrain.generate()`.

- Data model and persistence
  - Add `pack.cells.{terrain,terrainSubtype,terrainBase,cultivatedIntensity,cultivatedBy,forestDensity,wetness}`.
  - Add `burgs.farmlandArea`, `states.{cultivatedArea,cultivatedPerCapita}`.
  - Extend `modules/io/save.js` and `modules/io/load.js` to write/read new arrays with backward-compatible checks.

- Routing
  - Extend `modules/routes-generator.js` cost cache and land path cost to include terrain/farmland modifiers and farmland split penalty.

- Hooks and migration
  - Insert `Terrain.generate()` after `BurgsAndStates.generate()` and before `Routes.generate()` in `main.js:779–783`.
  - Ensure `applyLayersPreset()` shows/hides the new layer appropriately after generation.

- QA
  - Add console diagnostics for terrain coverage %, cultivated area per burg, and any cells in invalid combos (e.g., cultivated on glaciers).
  - Manual regression: compare route patterns with/without terrain costs enabled.

---

## Risks & Mitigations

- Performance: Typed arrays + caching; web worker offload for farmland; limit search radius; incremental smoothing.
- Visual clutter: Majority filter and polygon dissolve tolerance; subtoggles for overlays.
- Backward compatibility: Optional load of new arrays; default to recompute when absent.
- Naming collision with existing `#terrain`: Use `#landcover` for the categorical Terrain layer; keep `#terrain` for relief icons.

---

## Deliverables

- New modules: terrain generator, farmland allocator, env surfaces, renderer, UI panel.
- Updated pipeline and persistence: `main.js`, `modules/io/save.js`, `modules/io/load.js`.
- Updated routes behavior: `modules/routes-generator.js`.
- Docs: README section + examples and screenshots.

---

## Open Questions

- Volcanic/barren detection: do we infer from slope + bare biome only, or add explicit volcano markers into `pack.features`?
- Vegetation density (forestDensity): needed for symbol density or out of scope for initial cut?
- Palette PNG export: prefer on-demand export from panel, or automatic after generation?

---

## Minimal Viable Slice (MVS)

- Compute slope/relief/hydric surfaces.
- Classify orography + wetlands + vegetation (as subtype on relief) + dunes/salt.
- No farmland in MVS; render categorical Terrain in `#landcover` with isolines.
- Save/load `terrain` only; routes unchanged.
- Follow-up slice: add farmland allocation + routes integration.

---

## Estimation (High-Level)

- Phase 0–2: 1.5–2.5 days (surfaces + core classifier + rendering)
- Phase 3: 1–2 days (allocator, tuning, aggregates)
- Phase 4–7: 1–2 days (persistence + routes + UI polish)
- QA/docs: 0.5–1 day

These are ballparks; complexity depends on tuning and performance work.

