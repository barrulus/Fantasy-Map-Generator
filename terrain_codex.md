# Terrain

This is a **single, end-to-end plan** for a **full Terrain layer** in FMG that _adds_ **Cultivated (farmland)** while also classifying **all other terrains** in a coherent pass. Hand this to an agent as the implementation spec.

---

# Full Terrain Layer (with Farmland) — Implementation Plan

## 0) Goal & Placement in Pipeline

Produce a **terrain** layer (categorical + intensities) that captures the physical surface (mountains, hills, plains, wetlands, dunes, glaciers, etc.) **and** human land-use (**cultivated**) driven by burg populations.

**Pipeline (updated):**
`heightmap → moisture/temperature → biomes → states → burgs → terrain (this module) → routes`

_(Terrain runs after burgs so farmland can be allocated, and before routes so roads can respond to terrain & fields.)_

---

## 1) Terrain Taxonomy (top-level `terrain` + optional `subtype`)

**Land/Water split**

- `ocean` (deep), `coast` (littoral), `lake`

**Orography**

- `glacier_ice` (snowline & polar),
- `mountains` (elevation + slope),
- `highlands` (plateau),
- `hills` (moderate slope/relief),
- `plains` (low slope)

**Aridity / Vegetation**

- `desert` (hot/arid), `cold_desert` (arid + cold),
- `steppe` (semi-arid grass),
- `grassland` (mesic),
- `savanna` (seasonal),
- `forest_broadleaf`, `forest_conifer`, `rainforest`

**Wetlands / Special**

- `swamp`, `marsh`, `bog/fen` (collapse to `wetland` with `subtype`),
- `delta_floodplain`

**Surface Form**

- `dunes` (aeolian), `bare_rock/scree`, `volcanic/barren`, `salt_flat`

**Human Land-use**

- `cultivated` (farmland), with intensity and burg attribution

> Keep **biome** as a separate concept. Terrain is **physical + land-use**; biome remains **ecological**. They inform each other but aren’t identical.

---

## 2) Inputs (existing + derived)

- **Cells**: elevation/height, water, temperature, moisture, biome, rivers/lakes, coastline
- **Burgs**: location, population, port flag, state/culture
- **Derived layers (compute once):**

  - `slope`, `ruggedness`, `relative_relief` (from heightmap)
  - `dist_to_river`, `dist_to_coast`, `floodplain index` (river order + low slope)
  - `rain_shadow / aridity index` (windward/leeward if available; else moisture proxy)
  - `permafrost index` (temperature + altitude)
  - `sandiness proxy` (from biome + coastal/leeward dunes)
  - `hydric index` (moisture + flatness + river/lake adjacency)

---

## 3) Classification Strategy (order matters)

The classifier runs **once** and writes `cell.terrain`, `cell.terrainSubtype`, and optional intensities.

**A. Hard overrides (highest precedence)**

1. `ocean`, `lake` by water mask
2. `glacier_ice` by temperature/permafrost & elevation thresholds
3. `volcanic/barren` if FMG marks volcanic peaks (else from slope + bare biome)

**B. Orography**
4\) `mountains` (elev ≥ H1 _or_ slope ≥ S1 _and_ relative_relief ≥ R1)
5\) `highlands` (elev ≥ H0 _or_ relief ≥ R0) not already mountains
6\) `hills` (slope between S0..S1 or relief R0..R1)
7\) remaining default to `plains`

**C. Hydrology & Wetness**
8\) `wetland` where hydric index ≥ W1 (subtype `swamp/marsh/bog` via pH/flow proxy)
9\) `delta_floodplain` = (floodplain + coastal/river mouth + low slope)

**D. Aridity / Vegetation refinement (only for cells not set above)**
10\) Assign **cover** based on temperature & (moisture − aridity), with latitude/elevation lapse rate:

- `desert` / `cold_desert`, `steppe`, `grassland`, `savanna`, `forest_broadleaf`, `forest_conifer`, `rainforest`
- Store as `terrain` where orography is `plains/highlands`; if orography is `hills/mountains`, keep the orography in `terrain` and write vegetation to `terrainSubtype` (e.g., `mountains + conifer`).

**E. Surface forms**
11\) `dunes` if sandiness high AND arid AND low relief (override vegetation on those cells)
12\) `salt_flat` if arid AND endorheic low spots (near playas)

**F. Human land-use (farmland)**
13\) Run **Farmland Allocation** (Section 4) and set cells to `cultivated` (with intensity).
\- Farmland **can override** steppe/grassland/plains/savanna/forest edges and floodplains; **cannot override** glaciers, open water, steep mountains, dunes, salt, deep wetlands.
\- Keep original classification in `terrainBase` to allow toggling back.

**G. Smoothing/Regionalization**
14\) Majority filter (1–2 passes) + contiguity preference to reduce speckle
15\) Merge contiguous regions to polygons (optional) for labels

---

## 4) Farmland Allocation (demand-driven by burgs)

**Per-burg demand**

```
annual_food_need = P_b * food_need_per_capita * (1 + buffer) * (1 - import_factor)
effective_yield(cell) = base_yield(biome) * moisture_bonus * (1 - slope_penalty) * (1 - elevation_penalty) * floodplain_bonus
required_area_b = annual_food_need / avg_local_yield * (1 + fallow_ratio)
```

- `import_factor`: higher for ports & major river nodes
- Seed defaults from your medieval density doc; expose all as options

**Suitability (FSS)**

- From `effective_yield` normalized 0–1; +proximity to rivers/coasts; −penalty for wetlands (unless drained option enabled); −penalty for >S_farm slope

**Allocator**

- Multi-source region grow from each burg using a **priority queue** keyed by `(dist_cost, -FSS)` until `required_area_b` met
- **Distance decay** to encourage tight belts around towns and along valleys
- **Conflicts** resolved by higher pressure = `remaining_area_b / dist_cost`
- Write:

  - `terrain="cultivated"`,
  - `cultivatedIntensity` (0–1),
  - `cultivatedBy` (burg id)
  - `farmlandArea` aggregated per burg/state

---

## 5) Data Model (additions)

**Cells**

- `terrain` (enum above)
- `terrainSubtype` (optional: vegetation on hills/mountains; wetland type; etc.)
- `terrainBase` (pre-farmland category for toggles)
- `cultivatedIntensity` (0–1), `cultivatedBy` (int | -1)
- `forestDensity` (0–1) if you want canopy-aware styling
- `wetness` (0–1) retained for effects

**Burgs / States**

- `burgs.farmlandArea` (ha), `importFactor` resolved
- `states.cultivatedArea`, `cultivatedPerCapita`

**Exports**

- Cell GeoJSON with properties above
- Optional dissolved polygons per terrain class
- Palette PNG (terrain index) for fast rasterized overlays

---

## 6) Rendering (Canvas + Leaflet/QGIS)

- **Z-order**: water → wetlands/deltas → cultivated → grass/savanna/forest → hills/highlands → mountains → ice/dunes/salt
- **Textures**:

  - cultivated: patchwork hatching/noise aligned to aspect
  - dunes: gentle ridge lines; wetlands: stipple/wavelet texture; mountains: shading already present

- **Intensity mapping**:

  - cultivatedIntensity → saturation/brightness
  - forestDensity → tree symbol density (optional)

- **Layer toggles**:

  - “Terrain (full)”, plus subtoggles for “Show cultivated overlay”, “Show wetlands/deltas”, “Show vegetation on elevation”

---

## 7) Effects on Other Systems

- **Routes**: prefer cultivated, plains, valleys; penalize wetlands/dunes/steep slopes; avoid splitting large cultivated polygons (small extra cost to encourage skirt roads)
- **Population feedback (optional)**: modest positive feedback from cultivated area into burg population cap on re-gen
- **Labels**: auto-name major polygons (“The Wheatlands”, “Red Dunes”, “Black Bog”) using state/culture dictionaries

---

## 8) UI & Tuning Options

- Sliders: slope thresholds (mountain/hill), snowline/elevation lapse, aridity cutpoints
- Farmland: per-biome yields, fallow ratio, buffer %, max farm slope, river/coast bonus, port import factor, max radius (km)
- Wetlands: aggressiveness, drainage option
- Dunes & salt flats: enable/disable + sensitivity
- Smoothing rounds & polygon dissolve tolerance

---

## 9) Implementation (FMG JS) — Files & Hooks

- `modules/terrain-generator.js` (new): orchestrates steps 2–3–4–5 above
- `modules/farmland-allocator.js` (new): the demand/suitability multi-source grower
- `modules/env-surfaces.js` (new or extend): slope, relief, hydric, floodplain, aridity helpers
- `layers/render-terrain.js` (new): styling & canvas draws (and palette export)
- `ui/terrain-panel.js` (new): options & toggles
- **Hook** in main flow:

  ```js
  BurgsAndStates.generate();
  Terrain.generate({
    cells,
    burgs,
    rivers,
    lakes,
    biomesData,
    options: Terrain.defaults(),
  });
  Routes.generate(); // terrain-aware
  ```

- **Save/Load**: include new fields; fall back gracefully if absent

---

## 10) py-fmg / PostGIS Variant (optional path)

- Load cells/burgs; compute surfaces with SQL (`ST_Slope`, `ST_TPI` analogs via rasters, or Python)
- Build terrain via CASE logic; allocate farmland with a PQ grower (distance from burg along low-cost graph; FSS as weight)
- Write attributes back; dissolve polygons with `ST_Union`; export GeoJSON/MBTiles

---

## 11) Testing & Validation

- **Unit**: threshold functions (mountain/hill), suitability, allocator conflict resolution
- **Property tests**:

  - cultivated cells slope ≤ S_farm (almost always)
  - wetlands within X km of water and low slope
  - dunes appear only in arid + sandy zones

- **Regression**: snapshot terrain index rasters for known seeds
- **Sanity dashboards**:

  - histogram of terrain by biome; cultivated area per burg vs population; mean slope of cultivated cells; share of roads by terrain

---

## 12) Performance Notes

- Precompute and cache all surfaces; use typed arrays
- Farmland grower: cap search radius using heuristic
  `r_max ≈ sqrt(required_area / mean_FSS_density)`
- Parallelize per-burg expansions in tiles where safe (web worker)

---

## 13) Deliverables

- New modules (terrain + farmland + surfaces + renderer + UI)
- Updated schema + save/load migration
- Palette PNG + style guide
- Exporters (GeoJSON, optional raster)
- README: thresholds, tunables, and example configs
- Example seeds & screenshots (including cultivated overlay)
