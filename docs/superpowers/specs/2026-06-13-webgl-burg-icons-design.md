# WebGL Burg-Icon Layer + Zoom/Pan Paint Reductions — Design

Date: 2026-06-13
Status: Draft for review

## Problem

At high counts (test maps: ~115–128K cells, ~78–82K burgs, ~252K SVG DOM nodes) the
map becomes very slow to pan and zoom. Measured root cause (clean CDP
`Performance.getMetrics` deltas during real mouse pan / wheel zoom):

- **Pan = ~100% Paint.** A drag spends ~3.9s on the main thread, of which Script+Style+Layout
  ≈ 13ms. The cost is the browser re-rasterizing one giant, non-GPU-composited SVG on
  every transform change (the viewbox `<g>` transform attribute).
- **Zoom = Paint + ~7s self-inflicted Layout/Style.** A wheel zoom spends ~12.4s: Paint ~5.2s
  **plus Layout 5.2s + Style 1.7s**. The Layout/Style is caused by `invokeActiveZooming()`
  (`public/main.js:539`) running every frame — it writes attributes (label font-size, marker
  width/height, halo stroke) and **reads computed style** (`d3 .style("display")`,
  `getComputedStyle().display`), forcing synchronous reflow across the whole tree.
- **Layer attribution (scale 4, reliable):** most single layers sit at a ~900ms
  fixed-overhead floor; **`labels` is the largest marginal cost (+844ms)** because burg
  labels are text and are **never culled** — `invokeActiveZooming` explicitly skips them
  (`if (this.id === "burgLabels") return;`, `main.js:559`). Burg **icons** are culled by the
  `BURG_MIN_ZOOM` table and are nearly free at normal zoom; they only dominate at deep zoom.
- **Memory:** the ~157K burg icon+label DOM nodes drive the browser to ~3GB RAM. The burg
  `<use>` nodes are a memory problem as much as a paint problem — cutting node count helps both.

> Note: deep-zoom (scale 10–12, all burgs unculled) profiling is unreliable — the browser
> hits a RAM/tmpfs-cache ceiling and pans become swap/GC thrash. Do not benchmark there.

## Goals

- Make panning and zooming smooth on large maps (target: median frame well under a
  rendering budget; eliminate multi-second main-thread stalls per gesture).
- Cut the burg-icon DOM node count (and its ~1.5GB of RAM) by moving icons to the GPU.
- Keep all existing burg interactions working: click-to-select/edit, drag-to-move, hover
  tooltip/highlight.

## Non-goals

- Moving **labels** (text) to WebGL. SDF/glyph-atlas text is a much larger project; labels
  stay SVG and are addressed by min-zoom culling instead.
- Touching cells/biomes/states/provinces polygon rendering.
- GPU picking. Hit-testing is done on the CPU with the existing quadtree.
- Relief icons (PR #1352's original target — this codebase's maps have ~0 relief icons).

## Plan overview (cheap wins first, then the WebGL build)

The three parts are independent and ship in order so value lands early and the risky part
is last.

### Part 1 — Lever 1: defer `invokeActiveZooming` + kill forced reflows (small, safe)

`zoomRaf` (`public/main.js:180`) currently calls `invokeActiveZooming()` on every coalesced
scale-change frame. Change:

- During an active zoom gesture, keep only the cheap per-frame work (the `viewbox` transform
  attribute, `drawScaleBar`/`fitScaleBar`). **Debounce** `invokeActiveZooming()` to run once,
  ~120ms after the last scale change (trailing). Labels/icons rescale and cull at gesture end
  rather than every frame — fewer nodes paint during the gesture and the per-frame Layout/Style
  collapses.
- Inside `invokeActiveZooming()` replace every computed-style read with the non-flushing
  `layerIsOn(id)` (`layers.js:1027`, checks the toggle button's `.buttonoff` class):
  - `labels.style("display") !== "none"` → `layerIsOn("toggleLabels")`
  - `routes.style("display") !== "none"` → `layerIsOn("toggleRoutes")`
  - `emblems.style("display") !== "none"` → `layerIsOn("toggleEmblems")`
  - `getComputedStyle(group).display === "none"` (burg cull loop) → `layerIsOn("toggleBurgIcons")`
    for `burgIcons`; `anchors` is inside `#icons` so gate on `layerIsOn("toggleBurgIcons")` plus
    `#icons` visibility tracked the same cheap way.

Expected: removes the ~7s Layout+Style from a zoom gesture.

### Part 2 — Lever 2: cull burg labels + optimizeSpeed/filters during interaction (small, safe)

- **Cull burg labels by min-zoom.** burgLabels has the same subgroup structure as burgIcons
  (hamlet…capital, each `<g>` with `data-size`). In `invokeActiveZooming` (or the deferred
  end-of-zoom pass), apply the same `BURG_MIN_ZOOM` cull + font-size rescale to burgLabels
  subgroups that burgIcons already gets, instead of returning early at `main.js:559`.
- **Reduce raster cost during active interaction.** On gesture start, set
  `shape-rendering: optimizeSpeed` on `#map` and drop the expensive blur/drop-shadow filters
  (coastline `#sea_island`, `statesHalo`); restore on gesture end (debounced). Must not clobber
  the user's persisted `shapeRendering` option — save and restore the prior value.

### Part 3 — WebGL burg-icon layer (the main build)

Render burg icons on the GPU instead of as ~82K `<use>` SVG nodes.

#### Architecture: stacked HTML canvas overlay

- A dedicated `<canvas id="burgIconsGL">` positioned absolutely over the SVG map, matching the
  SVG's on-screen rect (like the existing `#canvas` element used in heightmap customization,
  `main.js:215`). `pointer-events` handled in JS (see Interactivity).
- The canvas is one z-layer. Per the approved tradeoff, burg dots render **above** SVG labels
  (labels are offset from the dot, so overlap is minor and acceptable). This avoids the
  `foreignObject` compositing/event fragility that broke PR #1352's POC.
- WebGL2 context. Use a **minimal raw-WebGL2 instanced renderer** (one program, one instanced
  unit-quad, the circle drawn with a signed-distance function in the fragment shader). Plain
  circles need no texture atlas. (three.js is already a dependency, but a single 2D instanced
  points layer is leaner and simpler without the scene graph; documented tradeoff.)

#### Rendering

- One instance per non-removed burg. Per-instance attributes packed into typed arrays:
  position `(x, y)` in map coordinates, radius (from the burg's group icon size), fill color,
  stroke color, stroke width. Built once from `pack.burgs` + group styles; rebuilt on
  burg add/remove/restyle.
- Fragment shader: SDF circle → crisp fill + stroke at any zoom, no re-rasterization.
- Per-group min-zoom culling done by uploading a per-instance `minZoom` and discarding in the
  vertex shader when `scale < minZoom` (mirrors `BURG_MIN_ZOOM`), so culling is free on the GPU
  and needs no DOM work.

#### Transform sync

- A `uniform` (mat3 or translate+scale pair) maps map-coords → clip space using the **same**
  `translate(viewX viewY) scale(scale)` as the viewbox transform.
- Hook `zoomRaf`: on any transform change, update the uniform and request one GL redraw.
  Redrawing ~82K instances is a single instanced draw call (<1ms GPU) and does **not** touch
  the SVG. The existing SVG burg-icon layer is not present when WebGL mode is active.

#### Interactivity (CPU quadtree hit-testing)

- Build a `d3.quadtree` of burg `(x, y)` (FMG already uses quadtrees elsewhere). The canvas
  intercepts pointer events:
  - **screen → map** coords via the inverse transform.
  - Query the quadtree for the nearest burg within its display radius (account for current
    `scale`). Miss → fall through (set `pointer-events: none` momentarily or forward the event)
    so underlying SVG/drag-map behavior still works.
  - **Hover:** show the burg tooltip + a highlight (an extra highlighted instance or an overlay
    ring drawn in the same canvas).
  - **Click:** open the burg editor (same entry point the SVG `<use>` click used).
  - **Drag:** update that instance's position in the buffer + redraw each frame; commit to
    `burg.x/y` and the quadtree on drop.

#### Flag + SVG fallback

- A toggle in Options (e.g. "GPU burg rendering"), default **on** above a burg-count threshold
  (e.g. > 5K) and off below it. When off — or when the burg-icons layer is the active editing
  layer/tool that manipulates individual icon DOM — fall back to the existing SVG renderer
  (`draw-burg-icons.ts`). SVG remains the safety net; de-risks the rollout.
- `draw-burg-icons.ts` branches: WebGL path builds/updates instance buffers; SVG path is the
  current code, unchanged.

#### Out of phase 1

- **Anchors** (~6K port anchors, the `#icon-anchor` glyph). They are culled and far fewer than
  icons; keep them SVG initially. Fast-follow: a small texture atlas with the anchor sprite
  rendered as instanced textured quads in the same canvas.

## Files

- `src/renderers/webgl-burg-icons.ts` — new. WebGL2 context + program, instance-buffer build
  from `pack.burgs`, transform-sync uniform update, redraw, quadtree build + hit-test, drag.
- `src/renderers/draw-burg-icons.ts` — branch WebGL vs SVG on the flag; keep SVG code intact.
- `public/main.js` — `zoomRaf`: debounce `invokeActiveZooming`, update GL uniform on transform;
  `invokeActiveZooming`: swap computed-style reads for `layerIsOn`, add burg-label cull, add
  optimizeSpeed/filter toggling on gesture start/end.
- `public/modules/ui/layers.js` — toggle wiring + the GPU-burg option.
- `public/index.css` — `#burgIconsGL` canvas positioning.
- Burg editor / hotkeys / overview that call `drawBurgIcon`/`removeBurgIcon` — route through the
  active renderer so add/remove/restyle updates the GL buffers when WebGL mode is on.

## Testing & verification

- **Unit (vitest):** instance-buffer builder (positions/colors/radii/minZoom from burgs + group
  styles), screen↔map coordinate transforms, quadtree hit-test (nearest within radius), buffer
  update on add/remove/move.
- **In-browser (perfdata harness):** re-run `perfdata/profile-zoom.mjs` after each part. Confirm
  (a) Part 1 collapses zoom Layout+Style, (b) Part 2 drops normal-zoom pan paint, (c) Part 3
  drops pan/zoom paint at all zooms and cuts burg-node count + browser RAM. Avoid all-layers-on
  deep-zoom sweeps (RAM ceiling).
- **Correctness:** click/drag/hover a burg in WebGL mode; toggle the flag and confirm SVG
  fallback is visually identical; confirm no stuck `optimizeSpeed`/filters after a gesture;
  confirm add/remove/restyle reflect immediately.

## Risks

- **Z-order:** burg dots above labels (accepted). If it looks wrong in practice, revisit
  (separate label-canvas or foreignObject) — but not in phase 1.
- **Color/style parity:** group styles (fill/stroke/opacity, custom group icons that aren't
  circles) must map to instance attributes; non-circle custom group icons may need the
  atlas path sooner. Audit `options.burgs.groups` styles during implementation.
- **Editing-mode interplay:** tools that expect per-burg DOM must use the renderer-agnostic
  selection path. Enumerate these (burg editor, group editor, overview "locate") and route
  through hit-testing.
- **Save/load:** rendering is derived from `pack.burgs`; no save-format change. Verify load
  rebuilds GL buffers.

## Rollout phases

1. Part 1 (defer `invokeActiveZooming` + `layerIsOn`). Measure.
2. Part 2 (cull burg labels + optimizeSpeed/filters). Measure.
3. Part 3a (WebGL icons: render + transform-sync, behind flag, no interactivity yet — visual
   parity check). Measure.
4. Part 3b (quadtree hit-test: click, hover, drag; editor integration).
5. Part 3c (flag default + SVG fallback polish). Optional fast-follow: anchors on GPU.
