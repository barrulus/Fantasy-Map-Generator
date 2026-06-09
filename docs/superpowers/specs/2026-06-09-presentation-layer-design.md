# PRD — Presentation Layer: view/data separation for FMG

- **Status:** Draft for review
- **Date:** 2026-06-09
- **Author:** barrulus
- **Baseline:** clean upstream (`Azgaar/Fantasy-Map-Generator` master, v1.122.x). This design is
  written as if no interim importer/exporter patches exist; it is the long-term target.

---

## 1. Summary

FMG's data model describes *what exists* in a world (cells, burgs, states, …) but a large and
growing amount of *how the map looks* lives only in the serialized SVG or in single-purpose
`.map` string sections: manual label positions, user-added labels, applied style, layer
visibility, rulers, fonts, uploaded emblems, and more. Because this state has no home in the
model, it cannot be reconstructed from data alone, it bloats save files (these maps are 8–73 MB,
~90% SVG), and it blocks a clean view/data separation.

This PRD introduces a **presentation layer**: one cleanly-separated, serializable block that
holds all view/style/annotation state, alongside the existing pure **data** model. The SVG
becomes a *pure projection* of `data + presentation` with no hidden state. Existing maps are
preserved by a **migrate-on-load** extractor that lifts their SVG-only state into the new model.
Delivery is **phased**; the design is complete now.

---

## 2. Problem statement

A catalogue of all state currently held outside the data model was compiled from an exhaustive
scan of 13 community `.map` files spanning **v1.4 → v1.123**. It groups into:

| Group | Examples | Current storage |
|---|---|---|
| **A. Label geometry & typography** | burg/state/province label drag-offsets; user-added free-text labels (+ curve paths); label-group fonts/fills | `transform` on `<text>`; `<text id="labelN">` + `defs #textPaths`; group attrs |
| **B. Fonts** | used / custom web fonts | `.map` section 34 |
| **C. Style-as-data** | full per-element style; heightmap colour schemes; terrs render attrs; ocean-layer depth; texture (incl. embedded base64); CSS; hatch fills; user defs | SVG element attributes; `<defs>`; `<style>` |
| **D. Layer & view config** | layer visibility/toggles; active preset; view transform | `display:none` + `buttonoff` class; localStorage |
| **E. Chrome & annotations** | rulers; legend; compass; scale bar; vignette; fogging | `.map` §33; SVG groups/transforms |
| **F. Custom assets** | uploaded coat-of-arms images | base64 `<image>` in `#defs-emblems` |

Already in the data model (listed for completeness, out of scope here): generated COA specs,
markers, zones, routes, rivers, military, provinces, cultures, religions, states, burgs,
population, biomes, notes; and on the goods branch goods/markets/deals.

**Consequences today:** loading a map re-derives state by *inspecting the DOM* (`layerIsOn`,
`hasChildren`, `getUsedFonts(svg)`, scheme/`oceanLayers` attribute reads); any edit not embedded
in the saved SVG is lost; data-only exports (JSON) silently drop all of the above; and the SVG
cannot be regenerated or dropped without losing user work.

---

## 3. Goals / Non-goals

**Goals**
- Give every catalogued item (A1–F2) a typed home in a `presentation` model.
- Make the SVG a pure projection: re-rendering from `data + presentation` reproduces the map exactly.
- Preserve every existing `.map` at full fidelity via migrate-on-load.
- Enable dropping the embedded SVG from `.map` (major file-size reduction) once complete.
- Keep `.map` and JSON formats evolving (not a new format); both carry `data` + `presentation`.

**Non-goals (YAGNI)**
- No new rendering engine (canvas/WebGL); no change to world-generation algorithms.
- No live collaboration or multi-document support.
- The goods `cells.good`/`cells.market` JSON-export omission is a *data*-layer fix, not presentation.
- No redesign of the editors' UI; only their *write target* changes.

---

## 4. Architecture

### 4.1 The split

The document has two concerns:

- **`data`** — the world model (cells, vertices, features, entities, biomes, notes, goods…). *What exists.*
- **`presentation`** — how it is shown. *What it looks like.* New.

**Governing invariant:** *Delete the rendered SVG, re-render from `data + presentation`, and
nothing is lost.* Every catalogue item must have a home in `presentation`; no renderer or loader
may recover state by reading the DOM.

### 4.2 The `presentation` schema

```jsonc
presentation: {
  version: <int>,

  // Group C — style as data
  style: {
    preset: <string|null>,                 // named preset, or null if modified
    overrides: { "<selector>": { "<attr>": <value> } },  // C1: applied style as a diff vs preset
    heightmapSchemes: { ocean: <string>, land: <string> }, // C2 (scheme name encodes stops)
    terrs: { terracing, skip, relax, curve, render },      // C3
    oceanLayers: <string>,                 // C4: depth list e.g. "-6,-4,-2"
    texture: { href: <string> } | { blob: <base64> },      // C5
    css: <string>,                         // C6: user <style> content
    hatches: [ { id, def } ],              // C8: pattern defs + which entities reference them
    customDefs: { filters: [...], patterns: [...], masks: [...], gradients: [...] } // C7: user-added only
  },

  // Group D — layer & view config
  layers: { visible: [<id>...], preset: <string>, order: [<id>...] }, // D1, D2
  view: { transform: { k, x, y } },        // D3 (optional; reset by default)

  // Group A — label geometry & typography (overlay on data entities)
  labels: {
    offsets: { burgs: {"<id>": {dx,dy}}, states: {...}, provinces: {...} }, // A1–A3
    custom: [ { id, text, anchor: [x,y] | path: [[x,y]...], font, group, style } ], // A4
    groups: [ { id, name, font, fill, size, style } ]                       // A5
  },

  // Group B — fonts
  fonts: [ { family, src, unicodeRange, variant } ],

  // Group E — chrome & annotations
  annotations: {
    rulers:   [ { type, points: [[x,y]...] } ],          // E1 (structured, not toString)
    legend:   { items, position: {x,y}, visible },       // E2
    compass:  { position: {x,y}, rotation, visible },    // E3
    scaleBar: { position: {x,y} },                       // E4
    vignette: { enabled, params },                       // E5
    fogging:  [ { path: [[x,y]...] | cells: [<id>...] } ] // E6
  },

  // Group F — custom assets
  assets: { emblems: { "<coaId>": { uploadedImage: <base64> } } } // F2
}
```

Two deliberate representational choices:

1. **Style as a preset-diff** (`preset` + `overrides`), not a full dump. An unmodified map stores
   only the preset name; only genuine edits serialize. This is the only correct way to close the
   "un-saved style tweaks" gap without bloating every file. *Risk: see §9.*
2. **Added-label curves become point lists** (`labels.custom[].path`), promoting geometry out of
   a `<defs>` path-string bucket into first-class data.

---

## 5. Save / load format

### 5.1 `.map`
Keep the line-delimited section structure (the loader's dispatch survives). Three moves:

1. **Add one `presentation` section** — a single JSON blob appended after the data sections,
   version-guarded so older readers ignore it.
2. **Demote the embedded SVG (section 5) from source-of-truth to optional render-cache.** Written
   for backward readers during transition; **droppable in Phase 6** (~90% file-size reduction).
3. **Supersede** the presentation-ish single-purpose sections (rulers §33, fonts §34): still read
   from old files, no longer written (their data now lives in `presentation`).

### 5.2 JSON (Full export)
Top-level becomes `{ info, data, presentation }`:
- `data` = the existing world model (pack/grid/biomes/notes/nameBases).
- `presentation` = the new block.
This is the only export the importer needs; round-trip is `{data,presentation}` in → identical out.

---

## 6. Migration — `extract-presentation`

A single module is the **only** legacy on-ramp. On loading any map without a `presentation`
block, it reads the embedded SVG + legacy sections and populates the model, after which the map is
treated as native. Subsequent saves are clean.

| Legacy source | → presentation target |
|---|---|
| `transform` on burg/state/province `<text>` | `labels.offsets.*` |
| `<text id="labelN">` + `#textPath_labelN` | `labels.custom[]` (path string → point list) |
| label subgroups + their attrs | `labels.groups[]` |
| rulers §33 string | `annotations.rulers[]` (parsed to structured points) |
| fonts §34 | `presentation.fonts` |
| `#texture[data-href]`, scheme attrs, terrs attrs, `oceanLayers` | `style.*` |
| `<style>` content, user `<defs>` | `style.css`, `style.customDefs` |
| `display:none` + toggle-button state | `layers.visible` |
| base64 `<image>` in `#defs-emblems` | `assets.emblems` |
| live element attrs **diffed vs the named preset** | `style.overrides` |

The legacy read path also absorbs the known format quirks (CRLF-inside-SVG normalisation;
version-dependent section indices) before extraction.

**Backward-compat guarantee:** every existing community `.map` (v1.4 → v1.123 in the corpus)
loads at full fidelity.

---

## 7. Renderer & editor changes (the data-flow inversion)

The invariant is enforced by making the SVG write-only.

**Eliminate "read state back from the SVG."** Replace each DOM-inspection with a `presentation` read:
- `layerIsOn()` / load-time `hasChildren`/`isVisible` detection → `presentation.layers`.
- `getUsedFonts(svg)` → `presentation.fonts`.
- ocean depth / schemes / terrs read from element attrs → `presentation.style`.

**Renderers become pure `(data, presentation) → SVG`.** Each gains a presentation input and stops
consulting the DOM for state: `drawLabels` (offsets, custom labels, group typography), `applyStyle`
(preset + overrides), `OceanLayers`/`drawHeightmap` (style.*), `drawRulers`/`drawLegend`/
`drawCompass`/vignette/fogging (annotations.*), and a new `applyLayers(presentation.layers)`.

**Editors write to `presentation`, then re-render.** Dragging a burg label writes
`labels.offsets.burgs[id]` (not a bare DOM transform); "Add label" appends to `labels.custom[]`;
style edits write `style.overrides`; COA upload writes `assets.emblems`; layer toggles write
`layers.visible`.

### 7.1 Module boundaries (independently testable units)
- `presentation-model` — schema, defaults, validation (no DOM).
- `extract-presentation` — legacy SVG/section → presentation (DOM read-only).
- `serialize-style` — live style ↔ `style.overrides` (the preset-diff baseline lives here).
- `presentation-io` — the `.map` section + JSON block read/write.
- Renderers — consume presentation; one responsibility each.

---

## 8. Phased roadmap

Each phase is shippable and behavior-neutral until its renderer switches over.

- **Phase 0 — Framework.** `presentation-model` + defaults; `presentation-io` (write/read the
  block); migration harness wiring; round-trip test scaffold. Presentation starts empty/unused.
- **Phase 1 — Labels (A) + Fonts (B).** Offsets, custom labels (path→points), group typography,
  font set. Extractor + `drawLabels` switch-over + editor writes.
- **Phase 2 — Style-as-data (C).** `serialize-style` (preset-diff baseline); `applyStyle` reads
  overrides; schemes/terrs/oceanLayers/texture/css/hatches. Retires "style lives in SVG attrs."
- **Phase 3 — Layer/view config (D).** Visibility/preset/order as data; `applyLayers` replaces
  SVG-inspection on load; `layerIsOn` reads presentation.
- **Phase 4 — Chrome & annotations (E).** Structured rulers, legend, compass, scaleBar, vignette,
  fogging.
- **Phase 5 — Custom assets (F).** Uploaded emblems; user-added defs.
- **Phase 6 — Drop SVG-as-source-of-truth.** SVG becomes pure output; stop embedding it in `.map`.
  Legacy read path retained for migration only.

---

## 9. Testing & success criteria

The invariants are the spec:

1. **Round-trip:** `save → load → save` yields byte-identical `{data,presentation}`. Per phase.
2. **Re-render fidelity:** discard the SVG, re-render from `data + presentation`, diff against the
   original render (structural/pixel). This is the "no hidden state" proof.
3. **Migration fidelity:** the 13 catalogued community maps (v1.4 → v1.123) load via the extractor;
   every catalogued item lands in `presentation`; re-render matches the legacy SVG. This corpus is
   the migration regression suite.
4. **Decoupling:** `data` alone renders a valid default-styled map; `presentation` alone is inert.

**Success criteria**
- Every catalogue item (A1–F2) has a typed home in `presentation` and survives round-trip.
- No renderer or loader reads state back from the DOM.
- All existing `.map` files load at full fidelity (migrate-on-load).
- A `.map` with the embedded SVG removed re-renders identically (Phase 6).

**Key risk — the style preset-diff baseline (C1).** Computing `style.overrides` requires a reliable
"what the named preset produces" baseline to diff against and to re-apply onto; an inaccurate
baseline silently corrupts style. This is the trickiest correctness point in the design and is
treated as a first-class component (`serialize-style`) with dedicated round-trip tests against all
12 system presets before Phase 2 ships.

---

## 10. Open questions

- **View transform (D3):** persist zoom/pan per map, or always reset on load? (Leaning reset;
  cheap to add later.)
- **`assets.emblems` size:** embedded base64 images can be large; cap/scale on upload, or store
  out-of-band? (Defer to Phase 5.)
- **Phasing of `.map` SVG drop (Phase 6):** opt-in flag first vs. default, given third-party tools
  that read the embedded SVG.

---

## Appendix — catalogue → presentation map

A: `labels.offsets` (A1–A3), `labels.custom` (A4), `labels.groups` (A5), `labels.custom[].style` (A6).
B: `fonts` (B1).
C: `style.overrides` (C1), `style.heightmapSchemes` (C2), `style.terrs` (C3), `style.oceanLayers`
(C4), `style.texture` (C5), `style.css` (C6), `style.customDefs` (C7), `style.hatches` (C8).
D: `layers.visible` (D1), `layers.preset` (D2), `view.transform` (D3).
E: `annotations.rulers` (E1), `.legend` (E2), `.compass` (E3), `.scaleBar` (E4), `.vignette` (E5),
`.fogging` (E6).
F: COA spec stays in data (F1); `assets.emblems` (F2); markers/military stay in data (F3–F5).
