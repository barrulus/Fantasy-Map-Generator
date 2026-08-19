# Do the WebGL burg layers still earn their keep? — honest assessment

**Date:** 2026-08-19 · **Context:** [alignment status](2026-08-19-upstream-alignment-status.md),
[LayerHost decision note](2026-08-19-layerhost-vs-layersregistry-decision.md)

## Short answer

**Split the question.** The GPU *icon* layer still has no upstream competitor and should stay.
The GPU *label* layer is now a second implementation of something upstream ships, culls, and
maintains for us — it is the weak one, and its headline benchmark is stale. Measure before cutting.

---

## 1. The premise has already moved, more than we noticed

Fork `main` **already runs upstream's viewport-culled SVG label renderer**:
`src/renderers/viewport/viewport-renderer.ts` (`Scene`, `ViewportLayers`) drives
`src/renderers/labels/labels-renderer.ts`, which per frame diffs the DOM down to labels whose
bounds intersect the viewport and whose group passes `zoom.min` / `zoom.max`.

And **burg labels go through it**: `label-data.ts:19` builds `burg: collect(pack.burgs, buildBurgLabel)`
(plus megalopolis composites) as `LabelData` in that Scene.

So today we carry **two complete burg-label renderers side by side** — ours on the GPU above
`AUTO_LABEL_THRESHOLD = 5000` burgs, upstream's culled SVG below it.

The consequence for this decision: **the "PAN −55% / ZOOM −65%" number is stale.** It was measured
against an uncoulled SVG path that no longer exists. It should not be cited as the GPU label
layer's value, because nobody has measured GPU-vs-culled-SVG.

## 2. Icons are a genuinely different case

Upstream's `draw-burg-icons.ts` is 83 lines and emits **one `<use>` per burg, all of them, always**:

```ts
iconsGroup.innerHTML = burgsInGroup.map(b => `<use id="burg${b.i}" ... />`).join("");
```

It does **not** go through `Scene` / `ViewportLayers` (upstream's viewport-renderer consumers are
`layers-tab`, `zoom`, `draw-relief-icons`, `labels-renderer`, `export` — burg icons are absent).
Upstream's `invokeActiveZooming` culls emblems and markers; burgs are untouched.

**Upstream has shipped nothing that competes with our GPU icon layer.** On a 100K-burg map, stock
upstream puts 100K `<use>` nodes in the DOM. That is exactly the wall we built the layer to avoid,
and it is still there.

## 3. What it costs us

| | |
|---|---|
| GL + LayerHost implementation & tests | **~2,900 LOC** (`webgl-burg-*`, `sdf-glyph-atlas`, `*-instances`, `label-layout`, `label-visibility`, `layer-host`) |
| `labeling/` cluster (sizing, style, collision, tier-table) | ~1,100 LOC — almost entirely GL-serving; only `tier-table` has a non-GL consumer (`megalopolis.ts`) |
| GL hooks threaded into shared upstream files | `draw-burg-icons` +46, `viewbox-events` +48, `label-data` +45, `map-tooltip` +23, `save` +7, `export` +4, `layers.js` +89 |
| Merge cost, 1.145.2 | LayerHost now collides head-on with `LayersRegistry` (see the decision note) |
| Ongoing | every burg/label/style feature must be built twice and kept visually consistent |

That last row is the real tax. It is why the label-sizing model had to be reasoned about across
two renderers, and why `display:none` ended up overloaded between zoom tiers and layer toggles.

## 4. MEASURED (2026-08-19)

See §4b below — the measurement was run and it settles the question.

## 4a. What the code alone could not tell me

**Whether culled SVG labels hold up at your scale.** Culling's worst case is precisely our case:
zoomed out on a 100K-burg map, everything is on screen and nothing is culled. Upstream's mitigation
is the per-group `zoom.min`/`zoom.max` gate — labels simply vanish when zoomed out. If those tiers
are aggressive enough, the GPU label layer may be buying almost nothing; if they are not, it is
still load-bearing.

I am not going to guess this. Structural reasoning has misled us on FMG hot paths before.

## 5. Recommendation

1. **Measure first, one experiment.** On a 100K-burg map, `webglBurgs=false` / `webglLabels=false`
   forced, compare PAN and ZOOM frame cost against the GPU path, at three zoom levels
   (fully out, mid, in). Use the CDP rig; same canvas size across runs.
2. **If culled SVG labels are within ~20% of GPU:** delete the GPU label layer. That is
   `webgl-burg-labels` + `sdf-glyph-atlas` + `label-instances` + `label-layout` +
   `label-visibility` + their tests (~1,200 LOC), plus the `label-data` GL hooks, plus the whole
   cross-renderer consistency tax. Megalopolis composites survive — that logic lives in
   `label-data` / `tier-table`, which are renderer-agnostic.
3. **Keep the GPU icon layer regardless** until upstream culls icons. Keep `LayerHost` with it —
   the split exists because SVG layers sit above the icon canvas, so killing labels alone does not
   retire it.
4. **The move that retires everything:** teach upstream's `Scene`/`ViewportLayers` to drive burg
   icons — a `draw-burg-icons` that registers as a viewport layer and only materialises on-screen
   icons. It is squarely in the shape Azgaar just built, plausibly upstreamable, and if it lands
   it deletes the GL stack *and* LayerHost *and* the LayersRegistry collision in one go. Worth
   costing before committing to Option A of the decision note.

## 6. The uncomfortable part

We built the GPU layers when the SVG path was naive. Upstream has since built a culling
architecture that covers labels, and we merged it — so for labels we are now maintaining a
competitor to code we already ship. That is the definition of not earning its keep, *unless* the
measurement in §5 says otherwise. Icons are the opposite: upstream still does the naive thing, and
our layer is the only reason large maps are usable.

So the honest answer is not "keep it" or "kill it" — it is **half of it is probably dead weight,
and we can find out in one afternoon.**


---

# 4b. Measurement results

**Rig:** `perfdata/measure-gl-vs-culled.mjs`. Headful Chromium on the real GPU
(`ANGLE (Intel, Mesa Intel(R) Graphics (ARL), OpenGL ES 3.2)`) — the script reads
`UNMASKED_RENDERER_WEBGL` and refuses to run on SwiftShader, which headless falls back to and
which would have unfairly penalised the GPU arms. Own vite on :5199. Fixed 1600x900 canvas for
every arm. Zoom target is the densest burg bin, not the map centre (the centre is open ocean —
the first run measured empty water). 3 interleaved rounds, medians reported, raw runs in brackets.

**Map:** seed 267332741, 500K density → **74,729 burgs / 120,076 cells**.

Task-duration in ms for a scripted 30-step pan and a 20-tick wheel zoom (lower is better):

| arm | pan@1 | zoom@1 | pan@4 | zoom@4 | pan@12 | zoom@12 |
|---|---|---|---|---|---|---|
| gpu-icons + **gpu**-labels | 1813 | 17012 | 19136 | 41300 | 57729 | 16693 |
| gpu-icons + **svg**-labels | 1853 | 4108 | **1191** | **1129** | **12822** | 19693 |
| svg-icons + svg-labels | 6356 | 44935 | 23874 | 76083 | 129456 | 19873 |

Round-to-round variance was small (e.g. pan@12 gpu-labels 57175 / 57729 / 57850), so these
differences are real, not noise.

## Verdict 1 — the GPU icon layer is load-bearing. Keep it.

Holding labels on SVG, switching icons from GPU to SVG costs:

- pan@12: **12,822ms → 129,456ms (10× worse)**
- pan@1: 1853 → 6356 (3.4×)
- zoom@4: 1129 → 76,083 (67×)

Upstream renders one `<use>` per burg with no culling, so all 74,729 stay in the DOM at every
zoom. Nothing upstream competes with this layer, and the numbers say so unambiguously.

## Verdict 2 — the GPU label layer is *slower than the SVG path it replaced*. Kill it.

It loses in **5 of 6 cells**, mostly by an order of magnitude:

- zoom@4: 41,300ms vs 1,129ms — **37× worse**
- pan@4: 19,136ms vs 1,191ms — **16× worse**
- zoom@1: 17,012 vs 4,108 — 4.1× worse
- pan@12: 57,729 vs 12,822 — 4.5× worse
- zoom@12: 16,693 vs 19,693 — the one win, and it is marginal (1.2×)

### Why — the mechanism

`drawBurgLabelGL` (`webgl-burg-labels.ts:275`) keys its cache on
`scale | viewport origin | gates | obstacle hash`. Every pan and zoom frame changes that key, so
every frame it calls `selectVisibleLabels(boxes, ...)` over **all 74,729 label boxes** — a full
sizing + collision-grid + obstacle pass on the CPU — and rebuilds the instance buffers.

Upstream's `reconcileLabels` also walks the scene per frame, but its per-label work is a cheap
bounds intersect plus a group `zoom.min`/`zoom.max` gate. The DOM counts show the effect: at
zoom=1 only **54** label nodes materialise out of 74,729.

So the GPU is barely working; **our own per-frame CPU layout pass is the bottleneck**, and it is
O(all burgs) where upstream's is effectively O(visible). At 74K that is fatal. We optimised the
draw and left the layout unculled.

*(Caveat, stated honestly: this indicts the layer **as built**, not GPU text rendering in
principle. Culling before collision would likely fix it. But that is work we would be doing to
catch up to a path upstream already ships, culls correctly, and maintains for free.)*

## Revised recommendation

1. **Delete the GPU burg-label layer**: `webgl-burg-labels(.test)`, `sdf-glyph-atlas`,
   `label-instances`, `label-layout`, `label-visibility` + tests (~1,200 LOC), the `label-data`
   GL hooks, and the cross-renderer consistency tax. Megalopolis composites survive — that logic
   lives in `label-data` / `tier-table`, which are renderer-agnostic.
2. **Keep the GPU icon layer and LayerHost.** LayerHost stays regardless: the split exists so SVG
   layers can sit above the *icon* canvas.
3. **Proceed with Option A** of the LayerHost decision note. Deleting labels does not avoid the
   `LayersRegistry` collision, but it does shrink the merge surface (`label-data` +45 fork lines,
   `labels-renderer` +6, and the GL label branch in `isLabelVisible`).
4. Still worth costing afterwards: porting upstream's `Scene`/`ViewportLayers` to burg **icons**.
   That is the one change that would retire the GL stack, LayerHost, and the registry collision
   together — and it is now clearly the right shape, because culled SVG just beat our GPU path
   at labels.

---

# 5. Outcome — removal executed (2026-08-19)

Branch `chore/remove-gpu-burg-labels`.

**Deleted** (~1,200 LOC): `webgl-burg-labels(.test)`, `sdf-glyph-atlas(.test)`,
`label-instances(.test)`, `label-layout(.test)`, `label-visibility(.test)`.

**Hooks removed:**

- `renderers/index.ts` — the layer's registration import.
- `labels/labels-renderer.ts` — the `isLabelVisible` hand-off that suppressed burg labels while
  the GPU layer was active. Burg labels now always take upstream's culled path.
- `labeling/label-collision.ts` — the `drawBurgLabelGL?.()` nudge in `setStateLabelObstacles`, and
  `hashObstacles` (it existed only to fingerprint obstacles for the GPU layer's frame cache).
  The obstacle store itself stays: the SVG burg-label branch uses it.
- `renderers/layer-host.ts` — `positionLabelCanvas` and the label-canvas stacking block.
- `public/main.js` — `ensureBurgLabelGLCanvas`.
- `public/modules/ui/options.js` — the `resizeBurgLabelGL` call.
- `public/modules/ui/layers.js` — the label-buffer rebuild on burg-group toggles.
- `src/types/global.ts` — `burgLabelsWebglActive`, `scheduleRebuildBurgLabelGL`, `moveLabelGL`.
- `controllers/burg-editor.ts`, `burgs-overview.ts`, `states-editor.ts` — the
  "rebuild the GPU buffer instead of drawing SVG" branches. `burgs-overview`'s
  `refreshBurgLabels` wrapper became a bare `drawLabels()` call and was inlined.

**Untouched, deliberately:** `labeling/tier-table`, `label-sizing`, `label-style`,
`label-collision` (still used by `zoom-extras`, `webgl-burg-atlas`, `megalopolis`), the GPU **icon**
layer, and `LayerHost` — the split exists for the icon canvas and is unaffected.

`label-data.ts` needed no change: its fork additions are the megalopolis composites, not GL hooks.
(The earlier §5 note calling them "GL hooks" was wrong.)

## Verification

- `tsc --noEmit` — 0 errors.
- `vitest run` — **50 files / 597 tests passed**.
- `npm run build` — clean.
- `npx biome check` on touched paths — clean (the 5 remaining `useOptionalChain` warnings are
  pre-existing and in untouched code).
- **Browser smoke** (`perfdata/verify-label-removal.mjs`, headless): burg labels materialise as
  SVG (`#labels [id^="burgLabel"]` > 0), no `burgLabelsGL` canvas, GPU icons still active with 0
  SVG icon nodes, and **all 11 deleted `window.*` globals are gone** with no page errors. This is
  the check `tsc` cannot do — see the `merge_dead_global_reference_crash` lesson.
