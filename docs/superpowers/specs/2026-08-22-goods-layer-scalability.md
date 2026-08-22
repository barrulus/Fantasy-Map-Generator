# Goods layer scalability

**Date:** 2026-08-22
**Status:** approved, in progress
**Files:** `src/renderers/draw-goods.ts` (rewrite), no API changes elsewhere

## Problem

Opening the Goods editor turns the goods layer on (`goods-editor.ts:85` → `Layers.show("goods")` → `drawGoods()`). On large maps this freezes the app: measured 2,568,282 DOM nodes and 2.4 GB heap on a high-cell-count / ~100K-burg map, with 100% CPU on every pan/zoom afterwards.

`drawGoods()` has no aggregation, culling, or caps. Node counts scale linearly with map size:

| Group | Markup emitted | Cost on a large map |
|---|---|---|
| `#goodsCells` | one `<polygon>` per **(cell × produced good)**; `getCellProduction` returns ~4–8 goods per populated cell (biome goods + bonus), each polygon duplicating the full cell points string | 500K–1M+ polygons |
| `#goodsIcons` | `<g><circle/><use/></g>` per cell with `cells.good` set | 3 nodes × resource cells |
| `#goodsBurgs` | plate per producing burg: rect + up to 3×(circle+use+text) ≈ 11–14 nodes | ~1.4M nodes at 100K burgs |

The renderer is upstream's economy-sim code (1.134.1 sync), written for default cell counts. `refreshEditor()` also re-runs the full draw (`goods-editor.ts:103`), causing the GC sawtooth.

## Design

Rewrite `draw-goods.ts` only. Group ids, data attributes, and all consumer contracts stay as-is.

### 1. Cells: merged isoline paths (like `drawBiomes`)

Replace per-good stacked polygons with `getIsolines(pack, getType, {fill: true})` + `buildFillPaths` — the exact pattern `draw-biomes.ts` uses, which yields a handful of `<path>` nodes regardless of cell count.

- Per cell, compute total production of visible goods (existing first pass, unchanged), pick the **dominant good** (largest amount) and an **opacity bucket**: `bucket = 0..4` from `normalize(total, 0, maxTotal)`.
- Isoline type key: `goodId * 5 + bucket + 1` (`+1` because `getIsolines` skips falsy types).
- Color: dominant good's hex color with the bucket alpha baked in as an 8-digit hex (`alpha = 0.1 + 0.9 * (bucket + 1) / 5` ≈ 0.28/0.46/0.64/0.82/1.0, matching the old 0.1–1.0 range) so `buildFillPaths` needs no changes.

Node count: ≤ goods × 5 paths total.

**Visual change (accepted):** a cell previously showed all its produced goods as translucent stacked polygons (an additive blend); it now shows only its dominant good at bucketed intensity. The cell tooltip still lists full per-cell production (computed from data, not DOM — `map-tooltip.ts:241`), and the per-good breakdown remains in the editor.

### 2. Burg plates + resource icons: viewport culling (like `draw-relief-icons`)

Register one `ViewportLayers` layer (`id: "goods"`) with two `Scene`s (icons, plates), mirroring `draw-relief-icons.ts`:

- `drawGoods()` builds the scenes (same data computation as today) and calls `layer.render()`; the reconcile fn rebuilds `#goodsIcons` / `#goodsBurgs` innerHTML from items intersecting `context.bounds`.
- Pan/zoom re-render comes free: `zoom.ts` calls `ViewportLayers.schedule()`; guard bands + rAF batching already handled by the renderer.
- Layer-off clears the groups (reconcile checks `Layers.isOn("goods")`, same as relief), and `Layers.subscribe → renderNow` handles the toggle.

**Zoomed-out cap.** Viewport culling alone doesn't bound the count when the whole map is visible (large maps put all 100K burgs in one viewport). So each group has a hard cap on rendered items:

- Plates: `MAX_PLATES = 1000`. Scene items pre-sorted by total burg production desc; reconcile takes the first 1000 visible, so the biggest producers stay visible when zoomed out. (~14K nodes worst case.)
- Icons: `MAX_ICONS = 4000`, stride-sampled (`every ceil(visible/max)`-th item) to stay spatially uniform — resource icons have no natural priority. (~12K nodes worst case.)

Caps are generous enough that default-size maps render everything, i.e. zero behavior change below the cap.

### Contracts preserved

- Group ids `goodsCells` / `goodsIcons` / `goodsBurgs` unchanged (style presets, style editor, auto-update all reference them).
- Plate markup keeps `<g data-id="${burg.i}">` (click → `ProductionOverview.open`, tooltip `raise()`); icon markup keeps `data-i="${good.i}"` (tooltip).
- Style attrs still read from the groups each draw: `#goodsIcons[data-circle][data-size]`, `#goodsBurgs[data-size]`; style.js already calls `Layers.draw("goods")` after changing them.
- Export: `export.ts:274` `ViewportLayers.renderTo(cloneEl)` materializes registered layers into full-map clones with infinite bounds (caps still apply — an uncapped 1.4M-node export would hang too); the goods `<use>` inlining at `export.ts:401` runs after `renderTo`, order already correct.
- Plate/icon visual geometry (sizes, plate layout, fonts) unchanged.

## Out of scope

- `draw-markets.ts` and trade animation (check separately if they share the pattern).
- Per-good multi-layer cell blending (the old stacked look) — could return later as quantized mixes if missed.
- Editor-side refresh frequency (`refreshEditor` full redraw) — cheap enough after this change.

## Upstream notes (for a later PR)

The renderer is upstream code; the fix is generic and both reused utilities (`getIsolines`/`buildFillPaths`, `Scene`/`ViewportRenderer`) exist upstream since 1.140+. Lessons worth carrying: per-(cell×good) SVG stacking is the dominant cost; innerHTML string size itself is secondary; caps must be count-based, not screen-size-based, because zoomed-out density scales with map size while on-screen glyph size does not.
