# Design: Renderer-Agnostic Layer System — Foundation + Burg Interleave

**Status:** Approved design, ready for implementation planning.
**Scope:** Phases 1–3 of the brief (`2026-06-14-renderer-agnostic-layers-brief.md`): the
`Layer` interface, a `LayerHost` compositor that wraps today's SVG layers with **zero behavior
change**, and migration of the existing WebGL burg layer so it can sit at an arbitrary z-slot
(e.g. burgs *under* SVG labels). Generalized save/load, multi-WebGL-layer UI, and any second
WebGL layer are explicitly **out of scope** (deferred to a later spec).

## Goal

Decouple each map layer from *how* it is drawn so that (1) z-order can change freely at runtime
and (2) a WebGL layer can be interleaved between SVG layers. This phase proves the architecture
end-to-end with one real consumer (burgs) while leaving the default all-SVG map byte-identical
to today.

## Decisions (resolved during design)

- **Architecture: C with A's mechanism.** Keep SVG as the default renderer; allow specific heavy
  layers to be WebGL; achieve interleaving by slotting a `<canvas>` between stacked SVG fragments.
  Defer the single-context compositor (approach B).
- **Compositor behavior: passthrough.** When no WebGL layer needs to sit *between* SVG layers,
  the DOM stays exactly as today (one `#map` SVG, one `#viewbox`, one transform). Restructuring is
  opt-in and reversible — it only happens when interleaving is actually required.
- **Shared `<defs>` mitigation up front.** Cross-SVG-root `url(#…)` resolution is the one fragile
  area; a verification spike gates the approach, with a bounded duplication fallback.

## Current state (the model being extended)

- `#map` SVG → `#viewbox` `<g>` → every layer is a `<g>` child. **DOM order = z-order.**
- Pan/zoom is one `transform` attribute on `#viewbox`, written each frame in `zoomRaf`
  (`public/main.js`). The live transform is exposed via `window.getMapTransform()`.
- Layer reordering: jQuery sortable on `#mapLayers` `<li>`s → `moveLayer()` maps each `<li>` id to
  a `<g>` via `getLayer()` → `insertAfter/insertBefore`. **Reordering moves the populated `<g>`;
  it does not re-run `drawX()`.** Toggling runs `drawX()` to populate or empties the `<g>`.
- The one WebGL layer (burgs): `src/renderers/{webgl-burg-icons,webgl-burg-atlas,burg-instances}.ts`.
  A single `<canvas id="burgIconsGL">` created as a **sibling of `#map`, stacked on top**,
  `pointer-events:none`, transform-synced in `zoomRaf` via `drawBurgGL()`. When active, the SVG
  burg group is emptied and a d3-quadtree augments click/hover/relocate handlers. **Limitation:**
  one canvas, one z-depth (top) — cannot interleave.

## Architecture: a passthrough layer compositor

Three structural states. The compositor (`LayerHost`) converges the DOM to the correct state via
an idempotent `reconcile()`.

### State 0 — Passthrough (default; byte-identical to today)

One `#map` SVG, one `#viewbox`, all `<g>` layers as children, one transform. Active whenever no
visible WebGL layer has a visible SVG layer above it — i.e. all-SVG maps **and** the current
"burg GL on top" arrangement. Zero behavior change for the common case.

### State 1 — Interleaved (split)

Triggered when a visible WebGL layer (burgs) has ≥1 visible SVG layer above it in z-order. The
stack is split at the canvas's z-slot:

```
 wrapper
 ├─ #map     (SVG)    ← #viewbox:    all <g> at/below the canvas slot   (owns <defs>)
 ├─ #burgIconsGL (canvas) ← the WebGL layer at its z-slot, pointer-events:none
 └─ #mapTop  (SVG)    ← #viewboxTop: <g>s above the canvas slot         (refs #map's <defs>)
```

Both `#viewbox` and `#viewboxTop` receive the same `translate/scale` each frame; the canvas
redraws via `draw(transform)` as it already does.

### The split boundary is derived, not invented

The boundary = the DOM position of the burg layer's existing `#icons`/`#burgIcons` group, which
the `toggleBurgIcons` `<li>` in `#mapLayers` already lets the user drag. "Where the WebGL layer
sits in z" is already expressed by the existing UI; the compositor reads that position
(`splitIndex()`) to decide the split point. Layers after that position move to `#viewboxTop`.

### Transitions

Split ↔ merge happen only on events that change interleaving need: burg-GL activate/deactivate,
or a reorder that crosses the burg layer's z-slot. Toggles and same-side reorders are unchanged.
Merge-back must restore the exact original `#viewbox` child order and delete `#mapTop` + the
canvas.

## The `Layer` interface

```ts
interface Layer {
  id: string;                  // e.g. "toggleBurgIcons" — matches the #mapLayers <li> id
  renderer: "svg" | "webgl";
  visible: boolean;            // mirrors layerIsOn(id)
  draw(t: MapTransform): void; // svg: no-op (rides the transform); webgl: render at t
  clear(): void;               // svg: empty the <g>; webgl: clear the canvas
  hitTest?(mapX: number, mapY: number): HitResult | null; // webgl only
  destroy(): void;
}
```

- **SVG layers** are thin wrappers over an existing `<g>`: `draw()` is a no-op (they ride the
  viewbox transform), `clear()` empties the group. They exist so the host can reason about
  z-order and renderer uniformly. **The existing `drawX()` functions stay where they are and are
  not taken over in this phase** — keeps the diff small and behavior unchanged.
- **The WebGL burg layer** wraps `webgl-burg-icons.ts`: `draw → drawBurgGL`,
  `clear → destroyBurgGL`, `hitTest → hitTestBurg`, `visible ← burgWebglActive()`.

## `LayerHost` API (`src/renderers/layer-host.ts`, new)

```ts
getOrder(): string[]                  // current z-order (low→high), read from #mapLayers
setOrder(ids: string[]): void         // called after a sortable reorder; recomputes layout
needsInterleave(): boolean            // any visible webgl layer with a visible svg layer above it?
splitIndex(): number                  // DOM index of the burg layer's <g> = canvas slot
reconcile(): void                     // idempotent: split / merge / no-op to match desired state
hitTestTopDown(mapX, mapY): HitResult | null  // walk webgl layers high→low, first hit wins
onFrame(t: MapTransform): void        // zoomRaf calls this: apply t to #viewbox(+Top), draw webgl layers
```

`reconcile()` is the heart: reads order + visibility + `needsInterleave()` and converges the DOM
to State 0 or State 1, moving `<g>`s between `#viewbox` and `#viewboxTop` and creating/destroying
`#mapTop` + the canvas. It is **idempotent** — safe after any toggle, reorder, GL activate, or
map load.

### Wiring into existing code (minimal touch points)

- `moveLayer()` (layers.js) → after the sortable update: `LayerHost.setOrder(...); reconcile()`.
- `zoomRaf` (main.js) → replace the inline `if (burgWebglActive()) drawBurgGL()` with
  `LayerHost.onFrame(t)` (applies the transform to `#viewbox` and, in State 1, `#viewboxTop`,
  then draws WebGL layers).
- Layer toggles / map load / `rebuildBurgGL` → call `reconcile()`.
- `ensureBurgGLCanvas` → canvas insertion point moves from "after #map" to the split slot managed
  by `LayerHost`.

## Sharp edges (must be nailed in the plan)

### 3a. Event delegation across two SVGs

Interaction relies on native SVG events within the single `#map` SVG today (`clicked()` in
editors.js inspecting `event.target`; `showMapTooltip()` in general.js; drag/relocate in
burg-editor.js). When the "above" groups (labels, markers, military, emblems, rulers) move into
`#mapTop`:

- **Their own clicks must still fire.** Listeners bound directly to elements move with them.
  Listeners *delegated from `#viewbox`* will NOT fire for elements now in `#viewboxTop`.
  **Mitigation:** delegate from a common ancestor (the wrapper) or attach the same delegation to
  `#viewboxTop`. The plan must audit which handlers are delegated vs. direct — highest-risk task.
- **Pan/zoom must still work everywhere.** `#mapTop` root is `pointer-events:none` so wheel/drag
  fall through to the main SVG's `d3.zoom`; interactive elements (labels, markers) re-enable
  `pointer-events:auto`. The canvas stays `pointer-events:none`.
- **Hit-test order respects z.** A click resolves top-down: `#mapTop` elements → WebGL
  `hitTestTopDown()` → `#viewbox` elements → fall-through. For this phase (one WebGL layer) this
  generalizes the burg quadtree path that already exists.

### 3b. Shared `<defs>` across SVG roots

`#mapTop`'s groups carry `url(#…)` references (filters, clip-paths, gradients, patterns) to defs
in `#map`. Browsers resolve same-document `url(#)` across separate inline SVG roots **mostly**
(Chrome/FF reliable; Safari historically flaky for some property types). Handled in order:

1. **Verification spike first (go/no-go gate, before any compositor code).** Split the real
   FMG defs-heavy "above" layers (labels with halos, markers) into a second SVG on the target
   browsers and confirm references resolve.
2. **If it holds:** keep one `<defs>` in `#map`, reference cross-root.
3. **Fallback:** duplicate (or relocate to a shared standalone defs node) only the specific defs
   referenced by the "above" layers — a bounded, known set.

This risk exists only in State 1 and only for the layers above the burg canvas; the default map
never touches it.

## Testing

- **Unit (vitest, existing pattern):** `LayerHost` order/`reconcile` logic with a jsdom-mocked
  DOM — State 0 ↔ State 1 transitions, `reconcile()` idempotency, `splitIndex()` derivation, and
  merge-back restoring the exact original `#viewbox` child order.
- **Defs spike (3b):** standalone verification before compositor code lands.
- **Manual browser verification** (NixOS Playwright/CDP setup): big map (>5000 burgs), drag
  `toggleBurgIcons` below/above `toggleLabels`, confirm burgs render under labels, click/hover/
  relocate work in both arrangements, pan/zoom stays in sync with no drift, then toggle GL off →
  confirm the DOM merges back to today's shape.

## Build order

1. **Defs verification spike** → go/no-go.
2. **`Layer` interface + `LayerHost`** with SVG-only layers; wire `moveLayer`/`zoomRaf`/toggles
   through it. **Ship State 0 parity first** (no interleave yet); verify zero behavior change.
3. **Migrate the burg layer** onto the interface; enable State 1; prove burgs at an arbitrary
   z-slot with working hit-test, reorder, and merge-back.

## Acceptance

- The layer-order UI reorders the mixed SVG/WebGL stack and the visual z-order follows.
- The burg WebGL layer can sit below an SVG layer and above another, correctly.
- Click/hover/edit work on both SVG and WebGL layers regardless of order.
- Pan/zoom stays in sync across renderers with no drift.
- **No regression with all-SVG ordering (the default) — DOM identical to today.**

## Out of scope (deferred to a later spec)

- Generalized save/load of per-layer renderer choice.
- Layer-order UI changes for *multiple* WebGL layers and the WebGL context budget (~16) concerns.
- A second WebGL layer (relief/cells) — approach B's single-context compositor.
