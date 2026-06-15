# Brief: Renderer-Agnostic Layer System (free z-order, mix SVG + WebGL)

**Audience:** an engineer/agent picking this up cold. Assumes familiarity with the DOM and
WebGL basics but not with FMG internals — read the "Current state" section first.

## Goal

Make every map layer **independent of its rendering method**, so that:
1. Layer **draw order (z-index) can be changed freely** at runtime (the existing layer-order UI in FMG), and
2. **SVG and WebGL layers can be interleaved** in any order (e.g. a WebGL burg layer *under* SVG labels but *over* the SVG states fill).

This is the prerequisite Azgaar called out for the WebGL work (PR #1352): "make all layers
independent on rendering method first," so layer order is free and renderers can mix. The
existing WebGL burg layer (see below) proves the perf win but is a single canvas pinned on
top — it cannot interleave, which is exactly the limitation to remove.

## Current state (read before designing)

- All map layers are SVG `<g>` elements, children of `#viewbox` (`public/main.js` top, ~lines 40–90).
  **DOM order = z-order.** Pan/zoom is one transform attribute on `#viewbox` (`zoomRaf` in `public/main.js`).
- Each layer is populated by a renderer that writes SVG into its `<g>` (e.g.
  `src/renderers/draw-*.ts`, `public/modules/ui/layers.js` `drawRoutes/drawStates/...`).
- Layer order is already user-changeable: `public/modules/ui/layers.js` has a `getLayers()` /
  layer-ordering preset mechanism that reorders the `<g>` children. So the *concept* of
  "ordered layers" exists; today every layer just happens to be SVG.
- **The one WebGL layer that exists** (a working reference, built 2026-06): burg icons.
  - `src/renderers/webgl-burg-icons.ts` — WebGL2, instanced textured quads from a per-group
    texture atlas (`webgl-burg-atlas.ts`), transform-synced each frame to the viewbox via a
    uniform (reads `window.getMapTransform()` from main.js), GPU min-zoom culling.
  - It is a **single stacked `<canvas id="burgIconsGL">`** over the SVG, `pointer-events:none`,
    transform-synced in `zoomRaf`. When active, the SVG `#burgIcons` group is emptied.
  - Interactivity: the canvas captures no events; clicks/hover/relocate fall through to the
    SVG viewbox and a **d3-quadtree hit-test** (in `burg-instances.ts`) augments the existing
    handlers (`clicked()` in editors.js, `showMapTooltip()` in general.js, relocate in burg-editor.js).
  - **Limitation to fix:** one canvas, one z-depth (on top). It cannot sit between SVG layers.

## The core problem to solve: interleaving renderers by z-order

A single overlay canvas can only be at one z-depth. To interleave WebGL and SVG arbitrarily you
need one of these architectures — pick during a brainstorming/design pass and justify it:

- **A. Multiple stacked canvases, slotted by z.** Each WebGL layer is its own positioned
  `<canvas>`; the compositor inserts each canvas into the stack at the correct z relative to the
  SVG layers (SVG layers stay in `#viewbox`; canvases are siblings ordered by CSS `z-index` or
  DOM order in a wrapper). Simplest extension of today's model. Cost: N canvases = N WebGL
  contexts (browsers cap ~16 contexts) and N composited layers; fine for a few WebGL layers,
  not for "every layer is WebGL."
- **B. One WebGL canvas, layers as draw passes, SVG composited in.** A single WebGL context
  draws all WebGL layers in order into one canvas; SVG layers that must appear *between* WebGL
  layers are rasterized (e.g. `foreignObject`/`drawImage` of the SVG) into the GL pipeline at the
  right pass, or split into separate stacked SVG fragments. Most powerful (true free ordering,
  one context) but the hardest — SVG↔GL compositing and crisp text are the sharp edges.
- **C. Hybrid:** keep SVG as the default renderer; allow specific heavy layers to be WebGL
  via approach A; only support interleaving for the WebGL layers that need it. Pragmatic; gets
  90% of the value (burgs, relief, routes, cells) without a full compositor.

Recommendation to evaluate first: **C with A's mechanism** — a `LayerHost` that owns an ordered
list of layers, each tagged `renderer: "svg" | "webgl"`, and lays out SVG `<g>`s and WebGL
`<canvas>`es interleaved by the layer order. Defer the single-context compositor (B) unless the
goal is literally "all layers WebGL."

## What to build (proposed shape — refine in design)

1. **A `Layer` interface** (renderer-agnostic): `{ id, name, renderer, zIndex, visible,
   draw(transform), clear(), hitTest?(mapX, mapY) , destroy() }`. SVG layers wrap a `<g>`;
   WebGL layers wrap a canvas+program. Existing `draw-*` renderers become SVG-layer `draw()`s.
2. **A `LayerHost`/compositor** that holds the ordered layer list, owns the z-ordering (driven by
   the existing layer-order UI in `layers.js`), and on each `zoomRaf` frame updates the shared
   transform and calls `draw(transform)` on the WebGL layers (SVG layers ride the `#viewbox`
   transform as today). It interleaves SVG `<g>` and `<canvas>` elements in the DOM/stack to
   match `zIndex`.
3. **A shared transform source** (already exists: `window.getMapTransform()`), and a shared
   screen↔map helper for hit-testing.
4. **Unified hit-testing:** for WebGL layers, route the existing viewbox event delegation
   (`clicked`, `showMapTooltip`, drag/relocate) through each layer's `hitTest()` in top-down z
   order — generalize what the burg quadtree already does so any WebGL layer can participate.
5. **Migrate the burg WebGL layer onto the new interface** as the first real consumer (it already
   has render + atlas + quadtree hit-test; this proves the interface).
6. **Layer-order UI + save/load:** the order preset must work across renderers; persist which
   layers are WebGL; rebuild on map load.

## Key challenges / sharp edges (call these out in the plan)

- **WebGL context budget** (approach A): browsers limit live contexts (~16). Don't give every
  layer its own context — pool or share programs, or cap which layers are WebGL.
- **Crisp text / SVG fidelity:** labels are SVG and must stay SVG (or use SDF) — don't try to
  move text to WebGL. Interleaving a WebGL fill *under* SVG labels is the realistic target.
- **Transform sync precision:** the WebGL uniform must match the SVG `translate/scale` exactly,
  including device-pixel-ratio, or layers drift on pan/zoom (see how `webgl-burg-icons.ts`
  maps map→screen→device→clip).
- **Hit-testing order:** must respect z (topmost layer under the cursor wins), and fall through
  to SVG when no WebGL layer claims the point. The canvas(es) stay `pointer-events:none`.
- **Editing modes:** tools that manipulate per-element SVG (drag a label, edit a route) must
  keep working — either the layer stays SVG while being edited, or the WebGL layer exposes an
  edit path (the burg layer falls back to SVG-style hit-test + buffer update).
- **Resize / canvas sizing:** each WebGL canvas must track the map rect (DPR-aware) on resize.
- **Save format:** rendering is derived from `pack`, so no data-format change — but persist the
  per-layer renderer choice + order.

## Reference material

- Existing single WebGL layer (working): `src/renderers/{webgl-burg-icons,webgl-burg-atlas,burg-instances}.ts`.
- Layer ordering today: `public/modules/ui/layers.js` (`getLayers`, the order preset, the per-layer toggles).
- Transform/zoom hot path: `zoomRaf` + `window.getMapTransform` in `public/main.js`.
- Azgaar's relief WebGL POC: PR #1352 (https://github.com/Azgaar/Fantasy-Map-Generator/pull/1352)
  — uses Three.js + `foreignObject` + texture atlas; note it's a POC and (per Azgaar) needs the
  layer re-architecture done first, which is exactly this brief.

## Suggested phasing

1. Design pass (brainstorm A vs B vs C; pick and write a spec). Decide context budget + interleave model.
2. Build the `Layer` interface + `LayerHost`; wrap the existing SVG layers in it with **zero
   behavior change** (still all SVG, same order). Ship/verify parity first.
3. Migrate the burg WebGL layer onto the interface; prove a WebGL layer can sit at an arbitrary
   z-slot between SVG layers (e.g. burgs under labels). Verify hit-testing + layer-order UI.
4. Generalize hit-testing and the layer-order UI/save-load across renderers.
5. (Optional) add a second WebGL layer (relief or cells) to validate the multi-WebGL-layer path
   and the context budget.

## Acceptance

- The layer-order UI reorders a mixed SVG/WebGL stack and the visual z-order follows.
- A WebGL layer can be placed below an SVG layer and above another, correctly.
- Click/hover/edit work on both SVG and WebGL layers regardless of order.
- Pan/zoom stays in sync across renderers with no drift; perf for the WebGL layers matches the
  current burg layer (pan/zoom paint dominated by SVG layers only).
- No regression with all-SVG ordering (the default).
