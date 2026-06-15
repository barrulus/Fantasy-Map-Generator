# Brief (sketch): Labels-to-GPU — the real pan/zoom win at scale

**Status:** Direction sketch for a future brainstorm/spec. Not a plan. Captures *why* and *the shape*,
so the next session can start from here.

## Why this is the actual bottleneck

The WebGL burg-icon work moved burg **icons** off the DOM (24506 `<use>` → 0, GPU atlas). It never
touched **labels**. On a large map every burg still has an SVG `<text>` label, so:

- A 67K-burg map has **~67K SVG label text nodes**; an 80K map has ~80K.
- Measured 2026-06-15 (headless, clean): **burgs-on-top / `main`'s "fast" path runs ~500 ms/frame
  (~2 fps) at 67K burgs** during a zoom — *with no layer split involved*. The label layer is what
  strangles pan/zoom at scale.
- This is independent of the renderer-agnostic split (which is perf-neutral; see
  `2026-06-15-renderer-agnostic-layers-design.md`). The split was exonerated; **labels are the prize.**

So the next real pan/zoom win is: render burg labels on the GPU instead of as SVG text.

## Why now (and why the layer system mattered)

Labels must sit **above** the fills and the WebGL burg icons, and **below** markers/rulers. That's an
*interleaved* WebGL layer — which is exactly what the just-merged `LayerHost` compositor
(`src/renderers/layer-host.ts`) exists to enable. A GPU label layer registers as a `MapLayer`
(`renderer: "webgl"`) and slots into the z-order like the burg layer already does. The foundation is
in place.

## The shape (to refine in brainstorm)

- **SDF text rendering.** Signed-distance-field glyph atlas + instanced textured quads — the standard
  technique for crisp GPU text at any zoom. Build a glyph atlas per font/style (mirrors
  `webgl-burg-atlas.ts`), emit one instanced quad per glyph (or per label via a baked label-texture
  atlas for simpler v1), positioned from `burg.x/y`. Reuse the instancing + transform-uniform pattern
  already proven in `webgl-burg-icons.ts` (map→screen→device→clip, GPU min-zoom culling).
- **Scope v1 = burg labels only.** They're the 67–80K-node mass and the whole perf problem. Leave
  **state/region labels as SVG** (they're few, use curved text along paths, and need high fidelity) —
  the interleave system lets SVG state labels and a GPU burg-label layer coexist.
- **Deferred-rescale code becomes removable for burg labels.** `invokeActiveZooming`'s per-gesture
  label rescale (`public/main.js`) exists *because* SVG text is expensive to rescale; a GPU layer
  rescales for free in the shader. Burg labels drop out of that path.
- **Hit-testing / editing** via the layer's `hitTest()` (a quadtree over label boxes), exactly like
  the burg-icon quadtree — click a label → `editBurg`. Routed through `LayerHost.hitTestTopDown`,
  already wired.
- **Save format unchanged** — labels derive from `pack.burgs`; only the renderer changes.

## Sharp edges to call out in the brainstorm

- **Crisp text across the full zoom range** — SDF quality, sub-pixel positioning, DPR. The hardest part.
- **Style fidelity** — per-group label fonts/sizes/colors/halos (FMG styles burg labels by group). The
  atlas/shader must reproduce fill + stroke/halo.
- **Label placement / overlap** — FMG currently relies on SVG layout + culling; a GPU layer needs its
  own placement + collision/LOD (or reuse the existing visibility/culling logic feeding instances).
- **Text that isn't burg names** — keep state/region/ocean labels SVG (curved, few, high-fidelity).
- **Editing affordances** — selection highlight, drag-to-move a label: needs a GPU-side or
  fallback-to-SVG edit path (the burg layer's relocate pattern is the template).

## Adjacent, separate problem (flag, don't bundle)

**Autosave at scale.** On a 500K-cell / 80K-burg map, autosave serializes the whole map to IndexedDB
and blocks the main thread (observed 2026-06-15: "stuck autosaving" + multi-second freezes that
confounded perf measurement). This is independent of rendering — worth its own look (debounce /
incremental / Web Worker serialization). Not part of labels-to-GPU.

## Reference material

- Proven GPU-layer template: `src/renderers/{webgl-burg-icons,webgl-burg-atlas,burg-instances}.ts`.
- Interleave foundation: `src/renderers/layer-host.ts` (`registerLayer`, `reconcile`, `onFrame`,
  `hitTestTopDown`), design at `docs/superpowers/specs/2026-06-15-renderer-agnostic-layers-design.md`.
- Deferred SVG-label rescale that GPU labels would retire: `invokeActiveZooming` / `scheduleActiveZooming`
  in `public/main.js`.
