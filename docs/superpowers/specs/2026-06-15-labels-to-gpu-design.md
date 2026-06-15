# Labels-to-GPU — SDF GPU-text foundation (design)

**Status:** Approved design. Ready for an implementation plan.
**Date:** 2026-06-15
**Predecessor:** `docs/superpowers/specs/2026-06-15-labels-to-gpu-brief.md` (direction sketch)
**Builds on:** the renderer-agnostic `LayerHost` compositor (`src/renderers/layer-host.ts`) and the
WebGL burg-icon layer (`src/renderers/{webgl-burg-icons,webgl-burg-atlas,burg-instances}.ts`).

## Problem

On a large map every burg has an SVG `<text>` label. A 67K-burg map carries ~67K `<text>` nodes; an
80K map ~80K. Even with per-group `.hidden` culling, the nodes stay in the DOM, so the giant `#labels`
SVG repaints on every pan/zoom transform. Measured 2026-06-15 (headless, clean): **~500 ms/frame
(~2 fps) zooming at 67K burgs** — the burg-label layer is what strangles pan/zoom at scale, independent
of the (perf-neutral) layer split. The WebGL burg-icon work moved *icons* to the GPU but never touched
*labels*. Labels are the prize.

## Goal

Build the **proper SDF GPU-text foundation** — a reusable WebGL text layer — with **burg labels as the
first client**. Crisp text at any zoom and a durable foundation (later able to serve other text) are
goals in themselves, not just a one-off perf patch. State/region/ocean labels stay SVG (few, curved,
high-fidelity); the interleave system lets them coexist with a GPU burg-label layer.

### Non-goals (v1)

- GPU rendering of state/region/ocean labels (stay SVG).
- A prebuilt/bundled-font MSDF asset pipeline (runtime canvas-SDF was chosen instead; see Decisions).
- Autosave-at-scale work — a separate, adjacent problem (flagged in the brief, not bundled here).

## Decisions (from brainstorm)

1. **Primary goal:** GPU-text foundation (SDF), burg labels as first client — not a minimal perf hack.
2. **Glyph atlas source:** **runtime single-channel SDF from Canvas2D.** Collect the distinct glyph set
   from `pack.burgs` names × each group's live font, rasterize each glyph, compute a distance field
   (EDT on the alpha), pack into an atlas. Rebuild on font change (mirrors `buildBurgAtlas`). Handles
   any user-picked font + any Unicode glyph. MSDF was rejected because it can't be generated cleanly at
   runtime; single-channel SDF is the realistic runtime technique and is fine for label-sized text
   (accepts slight softening on sharp corners).
3. **Placement/LOD:** **parity with today + GPU-cheap collision culling.** Anchor each label at
   `burg.x/y + group dx/dy`; same per-group min-zoom bands; same on-screen-size visibility band (cull if
   <6px or >60px). *Plus*: hide lower-priority labels that overlap higher-priority ones (priority =
   group `order`, population as tiebreak).
4. **Interaction:** **click-to-edit + drag.** Click → `editBurg`; drag → per-label offset stored in
   `burg.labelDx/labelDy` and a single-label GPU update (`moveLabelGL`, analogous to `moveBurgGL`).
5. **Override migration:** **convert on load.** Before discarding existing SVG `#burgLabels` nodes, read
   any `text x/y` that differs from the default anchor and convert it to `burg.labelDx/labelDy`, so
   user-dragged label positions in existing maps survive.

## Architecture

Four focused, independently testable modules, mirroring the burg-icon trio:

| Module | Responsibility | Burg-icon analog |
|---|---|---|
| `src/renderers/sdf-glyph-atlas.ts` | Collect distinct glyph set from `pack.burgs` names × each group's live font; rasterize each glyph via Canvas2D; compute single-channel SDF (EDT on alpha); pack into atlas texture; return glyph metrics (advance, bearing, atlas UV rect). Rebuild on font change. | `webgl-burg-atlas.ts` |
| `src/renderers/label-layout.ts` | **Pure.** Given a burg + group style + glyph metrics, produce per-glyph quads (local offsets) and the label's bounding box (incl. dx/dy + override). No GL, no DOM. | (new) |
| `src/renderers/label-visibility.ts` | **Pure.** Per-frame CPU pass: min-zoom + viewport cull → sort by priority (group `order`, pop tiebreak) → greedy collision-place via spatial grid → emit surviving label set. Pure function of (labels, transform, viewport). | replaces burg-label parts of `invokeActiveZooming` |
| `src/renderers/webgl-burg-labels.ts` | GL orchestration: SDF shader (fill + halo from per-group uniforms), build the **visible** glyph instance buffer (segmented per group), `registerLayer({renderer:"webgl"})`, `drawLabelsGL`, hit-test quadtree over visible label boxes, `moveLabelGL`. | `webgl-burg-icons.ts` |

**Central constraint.** Burg *icons* upload a static instance buffer once and let the GPU cull. Labels
**cannot** — collision and text layout both depend on zoom — so the visible glyph instance buffer is
**rebuilt per transform-change frame** from the culled+collided set. This is bounded (thousands of
visible labels → tens of thousands of glyph quads, not the ~470K total) and runs inside the existing
`zoomRaf` / `LayerHost.onFrame` tick. Two load-bearing assumptions, both validated by reasoning and to
be re-confirmed in implementation: the distinct glyph set is small (generated names, mostly Latin +
diacritics, < ~200 chars); the simultaneously-visible label set is bounded by viewport + min-zoom bands.

## Per-frame pipeline

The layer registers into `LayerHost` like burgs; `onFrameLayers()` calls `layer.draw()` each tick.

```
drawLabelsGL(transform):
  if transform unchanged since last frame AND not dirty:
    re-issue last draw            // still map = 1 draw call, no CPU rebuild
  else:
    visible        = labelVisibility(labels, transform, viewport)   // cull -> sort -> collide
    glyphInstances = visible.flatMap(labelLayout)                   // per-glyph quads, grouped
    upload glyphInstances (segmented per group)
    rebuild label-box quadtree from `visible`                       // hit-test truth = what's drawn
  for each visible group: set per-group uniforms; drawArraysInstanced(group slice)
```

Cost-control levers:

- **Transform-gated rebuild.** Cull/collide/layout only re-runs when the transform changed (or a dirty
  flag is set by edits/restyle). A still map costs one draw call.
- **Active-gesture LOD (hook, default off).** During a fast gesture we can run viewport+min-zoom cull
  but defer the O(n) collision pass to settle (reuse the `scheduleActiveZooming` 120 ms timer), so
  frames stay cheap mid-fling and overlaps resolve on stop. Build the hook; default to collide-every-
  frame unless profiling shows it's needed (visible set may be small enough not to).

## Style fidelity (SDF shader)

FMG styles burg labels **per group**: font-family, font-size (`data-size`, map units), fill, and a
stroke/halo (`stroke` + `stroke-width`) for legibility over terrain.

- **Atlas stores shape only** (color-agnostic distance field). A fill/color/size change is a **uniform
  update, no atlas rebuild**; only a *font* change rebuilds the atlas.
- **Fill + halo in one pass.** SDF two-threshold trick: `fill` via `smoothstep` around distance 0.5;
  `halo` via `smoothstep` at a lower threshold, composited under the fill. Per-group uniforms: `uFill`,
  `uHalo`, `uHaloWidth`, plus AA width from `fwidth(dist)` for crisp edges at any zoom.
- **Per-group draw batching.** One `drawArraysInstanced` per *visible group* (handful of draws), each
  with that group's atlas region + color/halo/size uniforms; instance buffer segmented by group.
- **DPR / sub-pixel.** Glyphs rasterize into the SDF at a fixed supersampled cell (≈48–64 px/em) for
  field headroom; shader AA width scales with `fwidth`, giving sub-pixel-correct AA across DPR/zoom.
  Crispness at extreme zoom is bounded by SDF cell resolution — accepted tradeoff for runtime
  generation.
- **Visibility band** (6–60 px on-screen) is now owned by `label-visibility` (cull, don't draw),
  preserving today's behavior.

## Interaction, editing & save format

- **Click → edit:** `LayerHost.hitTestTopDown` → `hitTest(mapX,mapY)` → quadtree over *visible* label
  boxes → burg id → `editBurg`. Labels register above icons, so a label-over-icon click resolves to the
  label first (matches SVG z-order).
- **Drag → reposition:** write per-label offset to `burg.labelDx/labelDy` (map units, relative to the
  `x/y + group dx/dy` anchor); `moveLabelGL(id)` rebuilds that label's glyph instances + quadtree entry
  (analogous to `moveBurgGL`). Undefined override = anchored position. Serializes for free via the
  whole-object `JSON.stringify(pack.burgs)` in `save.js` — additive, no positional serializer changes.
- **Selection affordance:** while a label is selected/dragging, draw its selection box on the
  `#viewboxTop` SVG overlay (cheap, crisp, no GPU selection state); commit to the GPU layer on drag-end.
- **Override migration (convert on load):** before discarding SVG `#burgLabels` nodes on load, read any
  `text x/y` differing from the default anchor and convert to `burg.labelDx/labelDy`.

## Retiring the SVG path

- `src/renderers/draw-burg-labels.ts` stops emitting `<text>` for burg groups (state/region labels
  untouched — they live elsewhere and stay SVG).
- The burg-label branch in `invokeActiveZooming` (`public/main.js:622–636`) — per-group font-size
  rescale + `.hidden` band — is **deleted**; the shader rescales for free and `label-visibility` owns
  the bands. (Realizes the brief's "deferred-rescale becomes removable.")
- `#burgLabels` becomes an empty group (kept so existing editor/selector call-sites don't null-crash) or
  is removed with call-sites updated — pick the lower-churn option during implementation. Call-sites to
  audit: `burg-editor.js`, `burgs-overview.js`, `options.js`, `style.js`, `general.js`, `tools.js`,
  `submap-tool.js`, `load.js`, `export.js`.
- Layer toggle: register as `MapLayer` id matching the labels `<li>` (`toggleLabels` / burg-label
  sub-toggle), `visible()` gated like `burgWebglActive()` (auto-on above a burg threshold; honor an
  explicit user pref). Reuse `reconcile()` after rebuild/toggle.

## Testing & verification

- `label-layout.ts` — pure unit tests: per-glyph quad offsets + bounding box from fixed metrics, incl.
  dx/dy and override.
- `label-visibility.ts` — pure, table-driven across zoom levels: min-zoom/visibility-band culling,
  priority sort, greedy collision (overlapping lower-priority dropped).
- `sdf-glyph-atlas.ts` — glyph-set collection (distinct chars from `pack.burgs` × fonts), metric
  extraction, small known-glyph SDF sanity check (center ≈ max distance, edge ≈ 0.5). Canvas-dependent
  parts kept thin.
- `webgl-burg-labels.ts` — following existing burg-layer tests: `registerLayer` wiring, per-group
  instance-buffer segmentation, hit-test returns correct burg id, `moveLabelGL` updates one label,
  transform-gated rebuild skips work when transform unchanged.
- **In-browser perf verification** — the decisive check, per the project method (CDP :9222, forced
  reload, console quiesce, **same canvas size** before/after): zoom frame time at 67K burgs vs the
  ~500 ms/frame baseline. Success = the label layer no longer dominates the frame.

## Reference

- GPU-layer template: `src/renderers/{webgl-burg-icons,webgl-burg-atlas,burg-instances}.ts`.
- Interleave foundation: `src/renderers/layer-host.ts`
  (`registerLayer`, `reconcile`, `onFrame`, `hitTestTopDown`).
- Current SVG label renderer being replaced: `src/renderers/draw-burg-labels.ts`.
- Deferred SVG-label rescale being retired: `invokeActiveZooming` / `scheduleActiveZooming`
  in `public/main.js`.
