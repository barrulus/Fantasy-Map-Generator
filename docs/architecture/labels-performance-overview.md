# Label & viewport rendering performance — approach overview

Written for Azgaar as a map of what the fork tried on label/pan/zoom performance: what
was measured, what worked, what failed, and which parts transfer to base FMG without
adopting WebGL. Everything referenced is on `main` of
[barrulus/Fantasy-Map-Generator](https://github.com/barrulus/Fantasy-Map-Generator).

Test scale throughout: 128K–500K cells, 20K–95K burgs (the fork raises burg density a
lot, which is why these walls were hit early — but base FMG hits the same walls at
lower counts, just later, and river/route labels will multiply label counts too).

## 1. What is actually slow (measured, not guessed)

Clean CDP `Performance.getMetrics` deltas during *real* mouse pan/wheel (synthetic
events understate it):

- **Pan is ~99.7% Paint.** At 78K burgs (~252K SVG nodes): ~3.9s main-thread per pan
  gesture, of which Script+Style+Layout was ~13ms. The browser is re-rasterizing one
  giant non-GPU-composited SVG on every transform. JS is *not* the pan bottleneck —
  optimizing generation-side code does nothing for pan.
- **Zoom adds self-inflicted Layout/Style.** Wheel zoom was ~12.4s: Paint ~5.2s +
  Layout ~5.2s + Style ~1.7s. The Layout/Style share comes from `invokeActiveZooming()`
  running every frame and mixing attribute *writes* with computed-style *reads*
  (`.style("display")`, `getComputedStyle()`) → forced synchronous reflow of the whole
  tree, every frame.
- **Labels are the worst single layer.** Per-layer attribution at scale 4: most layers
  sit at a ~900ms fixed floor; `labels` adds the biggest marginal cost because burg
  labels are text nodes and were never culled (`invokeActiveZooming` explicitly skips
  `#burgLabels`). Burg *icons* are already min-zoom culled and are nearly free at
  normal zoom.
- **Node count is a memory problem too.** 157K burg icon+label nodes push the tab past
  3GB; profiling at deep zoom with everything unculled degenerates into swap/GC thrash
  and produces garbage numbers.

Two expensive red herrings, so you don't chase them:

- A "massive perf regression" report against the layer-compositor work turned out to be
  **autosave** serializing a 500K-cell map on the main thread, confounding every
  measurement. At 67K burgs the *unmodified* fast path was already ~2fps — the
  pre-existing label DOM was the bottleneck all along.
- A production-only "freeze" saga was ultimately the **service worker** serving a stale
  mix of old `main.js` + new hashed bundles. Relevant to base FMG: the Workbox
  StaleWhileRevalidate strategy on non-hashed scripts (`main.js?v=...`) guarantees a
  stale mix after any deploy where the `?v=` token wasn't bumped. NetworkFirst for
  non-hashed scripts + `skipWaiting`/`clientsClaim` fixed it permanently.

## 2. Cheap wins that transfer directly to base FMG (no WebGL, ~50 lines)

Commit `0ae9ce82` (main.js only), A/B'd at 19.6K burgs: **zoom −26%**, pan neutral;
heavier maps benefit more.

1. **Defer `invokeActiveZooming` to gesture-settle** (~120ms after the last zoom
   event). Per-frame it's mostly wasted work; the map still transforms every frame via
   the group transform.
2. **Never read computed style in the zoom path.** Replace `.style("display")` /
   `getComputedStyle()` checks with `layerIsOn()` (a class check on the toggle button).
   This alone removed most of the forced-reflow Style time (404ms → 73ms).
3. **Min-zoom cull burg labels** the same way icons already are (`f312bc68` does icons
   + anchors at low zoom; `0ae9ce82` does labels).

One measured *anti*-win: `shape-rendering: optimizeSpeed` + dropping filters during
gestures **regressed** light maps (+58% pan — the style flip forces two extra full-map
re-rasters at gesture start/end) and barely helped heavy ones. Paint cost is node-count
bound, not antialiasing bound. Don't bother.

## 3. The viewport/visibility system (renderer-agnostic — the part you asked about)

The piece that generalizes is a **pure, screen-space visibility pass** that runs
per-frame, decoupled from any renderer: `src/renderers/label-visibility.ts` +
`src/renderers/labeling/` (tier table, size clamp, group-style reader).

- **Input:** label anchors (map coords), tier, current transform, viewport size.
- **Pipeline: viewport cull → priority sort → greedy collision.** Off-screen labels
  (plus a margin) are dropped first; survivors are sorted by tier rank and population;
  a greedy pass keeps a label only if its screen-space box doesn't intersect an
  already-kept box. Boxes must be the *drawn* (clamped) size — an early bug used the
  unclamped size and hit-testing/collision disagreed with what was on screen.
- **Tiers, not sizes, decide existence.** A shared tier table
  (`src/renderers/labeling/label-tiers.ts`) gives each burg tier a rank, a min-zoom,
  and size bounds. Visibility is gated on min-zoom *only*; the size clamp never culls.
  We first had size-based culling (like upstream's 6–60px rule) and it produced
  "label pops in/out while resizing" artifacts — separating *whether* from *how big*
  killed a whole class of bugs.
- **Cross-system priority:** one collision arena where capitals beat state labels beat
  ordinary burgs (`a5620e18`). Running per-group collision independently looks fine
  until a state name sits exactly on its capital.
- **Sizing is screen-space and decays with zoom:** `px = rest + (start − rest)/scale`,
  clamped per tier. Zoomed out, the few visible labels should dominate; zoomed in,
  labels compete for space and must *shrink* toward a per-tier resting size. The first
  shipped model (`clamp(d·scale, floor, ceil)` — grows with zoom) was wrong in exactly
  the way that's hard to see in code review and obvious on screen. Before touching
  sizing, write down the on-screen px at scales 1/2/5/20 and check the direction.
- **Crucially, the output is just a keep-list with sizes.** The SVG consumer sets
  `display`/`font-size` on existing nodes; the GPU consumer builds instance buffers.
  You can adopt the visibility pass for plain SVG rendering (including future
  river/route labels) without any WebGL. This is the same idea as your PR #1464
  viewport renderer, generalized to labels with tiers + collision.

## 4. The WebGL path (out of scope for you now — context for "eventually")

Two layers, both auto-on above a burg-count threshold, SVG renderer always kept as
fallback:

- **Icons** (`webgl-burg-icons.ts`, `6997dad5`): per-group texture atlas, instanced
  quads. 24.5K SVG burg nodes → 0; pan −55%, zoom −65%.
- **Labels** (`webgl-burg-labels.ts` + `sdf-glyph-atlas.ts`): runtime-baked SDF glyph
  atlas (glyph collection + 1-D EDT, no external deps), per-glyph instanced quads, the
  same visibility pass as §3 feeding the instance buffer. Editing still works: label
  drag uses a transient SVG proxy, then writes back offsets.
- **Compositing prerequisite** (`layer-host.ts`): to keep z-order, a canvas has to sit
  *between* SVG layers, so the SVG stack splits into `#map` (below) / canvas /
  `#mapTop` (above), both driven by the same transform each frame. This is the "layers
  independent of rendering method" requirement from PR #1352.

## 5. Walls hit (so you don't hit them)

- **Clone-based save/export silently drops layers** once the stack is split:
  `cloneNode(#map)` no longer contains the top half. Every serialization path must
  re-unify first (`unifyClonedMapStack`). This shipped broken for two weeks and
  produced .map files that crash stock FMG on load — worst failure of the project.
- **Cached transforms go stale after load.** GPU layers positioned via cached
  `scale/viewX/viewY` vars that only the zoom handler updates; map load resets d3's
  zoom without firing it → labels offset until the first pan. `d3.zoomTransform(node)`
  is the only authoritative source; resync caches after load/submap/transform.
- **Canvas font resolution lies.** Label fonts live on the per-tier group shells, not
  the `#burgLabels` container; reading the container got an inherited default, and the
  atlas quietly baked the wrong font. Also `font-weight` must be carried into the
  canvas font string explicitly. (Your labels-data style-as-data model eliminates this
  whole class — one of the reasons I like that direction.)
- **Per-item ops that trigger full rebuilds go quadratic.** Single-burg add/remove
  each rebuilt the whole atlas + 56K instances + quadtree; called in a loop (remove
  all burgs of a group) that's O(n²). Debounce/batch rebuilds from the start.
- **Classic-script `let` globals are invisible to modules.** `window.scale` is always
  `undefined` because main.js's `scale` is a lexical binding; a module reading it
  computed hit-test tolerances as if at zoom 1. Expose getters explicitly.
- **Measurement discipline:** compare only at identical canvas sizes; drive gestures
  with real input; never trust numbers taken under memory pressure; on a deployed PWA,
  hard-refresh past the service worker before believing any "prod-only" bug.
- **Parity is not worth legibility.** I removed the GPU label halo to match SVG
  rendering exactly; dark text over political fills was unreadable. When renderers
  disagree, fix legibility in both — don't level down.

## 6. On labels-data (#1554)

One concern from reading the branch: the new `drawBurgLabels` renders every burg label
as SVG text with no culling — at high burg counts that recreates the exact wall in §1,
and river/route labels will make it worse. The per-group registry (order/active/zoom
bounds) looks like the natural place to slot a visibility pass like §3: the registry
decides policy, the pass decides per-frame survivors, and the renderer (SVG today, GPU
later) just consumes the keep-list. Happy to help port it onto that branch.

## 7. Where to look

Docs: `docs/superpowers/specs/2026-06-15-labels-to-gpu-brief.md`, design/plan commits
`05522793` / `8da4b56f` / `d960098b`, planner design `9247cfa2`.

| Area | Commits | Files |
|---|---|---|
| Cheap SVG wins | `0ae9ce82`, `f312bc68` | `public/main.js` |
| Visibility pass | `a909662f`, `8b6352b0` | `src/renderers/label-visibility.ts` |
| Tier/sizing system | `5a796e88`, `75092782`, `7b280d43`, `076a5192` | `src/renderers/labeling/` |
| Collision | `cb0691ee`, `a5620e18` | `src/renderers/labeling/`, `draw-state-labels.ts` |
| SDF atlas + GPU labels | `f172300f`…`8edcbca6` | `src/renderers/sdf-glyph-atlas.ts`, `webgl-burg-labels.ts` |
| GPU icons | `6997dad5` | `src/renderers/webgl-burg-icons.ts` |
| Compositor | `17cb9472`, `64b1fa3c` | `src/renderers/layer-host.ts` |
| Perf harnesses | — | `perfdata/ab-levers.mjs`, `perfdata/profile-zoom.mjs` |
