# Labels-to-GPU (SDF GPU-text foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render burg labels on the GPU as SDF text instead of ~67–80K SVG `<text>` nodes, retiring the per-frame SVG-label rescale that strangles pan/zoom at scale.

**Architecture:** A reusable WebGL SDF text layer registered into the existing `LayerHost` compositor. Pure modules do text layout (`label-layout.ts`) and per-frame cull/sort/collision (`label-visibility.ts`); a runtime canvas-SDF atlas (`sdf-glyph-atlas.ts`) supplies glyph shapes color-agnostically; `webgl-burg-labels.ts` orchestrates GL, builds the visible glyph-instance buffer per group, hit-tests via a quadtree, and supports drag-to-reposition. State/region labels stay SVG.

**Tech Stack:** TypeScript, WebGL2 (instanced rendering, single-channel SDF), Canvas2D (runtime glyph raster + Felzenszwalb EDT), d3-quadtree, Vitest. Mirrors the proven `webgl-burg-icons.ts` / `burg-instances.ts` / `webgl-burg-atlas.ts` trio.

---

## File Structure

**Create:**
- `src/renderers/label-layout.ts` — pure: glyph metrics → per-glyph quads + bounding box for one label.
- `src/renderers/label-layout.test.ts`
- `src/renderers/label-visibility.ts` — pure: cull (min-zoom, size band, viewport) → priority sort → greedy collision.
- `src/renderers/label-visibility.test.ts`
- `src/renderers/sdf-glyph-atlas.ts` — runtime glyph-set collection, Felzenszwalb EDT → SDF, canvas atlas build + metrics.
- `src/renderers/sdf-glyph-atlas.test.ts`
- `src/renderers/webgl-burg-labels.ts` — GL layer: shaders, per-group instance buffer, register/draw/hitTest/move.
- `src/renderers/webgl-burg-labels.test.ts` — pure helpers (instance packing, group ranges) + registration.

**Modify:**
- `src/modules/burgs-generator.ts:7-40` — add `labelDx?` / `labelDy?` to `Burg`.
- `src/renderers/layer-host.ts:97-137` — position the `burgLabelsGL` canvas between `burgIconsGL` and `#mapTop`.
- `public/main.js:304-320` — add `ensureBurgLabelGLCanvas()`; `:604-646` — delete the burg-label branch of `invokeActiveZooming`.
- `src/renderers/draw-burg-labels.ts` — stop emitting burg `<text>` when the GPU layer is active; add convert-on-load override extraction.
- `public/modules/io/load.js:364` — call the override-migration hook before the SVG `#burgLabels` nodes are discarded.
- `public/modules/ui/burg-editor.js` — route label drag to `labelDx/labelDy` + `moveLabelGL`.
- `index.html` / the module bootstrap that imports renderers — import `webgl-burg-labels.ts`.

**Key cross-task contract (define once, reuse exactly):**

```ts
// label-layout.ts
export interface GlyphMetric { advance: number; u0: number; v0: number; u1: number; v1: number }
export interface FontGeometry { cellEm: number; originXEm: number; baselineYEm: number }
export interface LabelQuad { x: number; y: number; w: number; h: number; u0: number; v0: number; u1: number; v1: number }
export interface LaidOutLabel { quads: LabelQuad[]; minX: number; minY: number; maxX: number; maxY: number }

// label-visibility.ts
export interface LabelBox { id: number; x: number; y: number; order: number; population: number; halfW: number; halfH: number; minZoom: number; fontSize: number }
export interface MapViewport { x0: number; y0: number; x1: number; y1: number }
```

All measurements: `advance`, `cellEm`, `originXEm`, `baselineYEm` are in **em** (1 em = font size). `fontSize`, `halfW`, `halfH`, quad `x/y/w/h`, viewport bounds are in **map units**. UV rects (`u0..v1`) are **atlas pixels**.

---

## Task 1: Add label-override fields to the Burg interface

**Files:**
- Modify: `src/modules/burgs-generator.ts:38-40`

- [ ] **Step 1: Add the optional fields**

In `src/modules/burgs-generator.ts`, inside `export interface Burg`, after `tradeRoleManual?: boolean;` add:

```ts
  labelDx?: number; // GPU-label x offset from anchor (map units); set by drag-to-reposition
  labelDy?: number; // GPU-label y offset from anchor (map units)
```

- [ ] **Step 2: Typecheck**

Run: `tsc --noEmit`
Expected: PASS (no errors — additive optional fields).

- [ ] **Step 3: Commit**

```bash
git add src/modules/burgs-generator.ts
git commit --no-verify -m "feat(labels): add labelDx/labelDy override fields to Burg"
```

---

## Task 2: `label-layout.ts` — pure per-glyph layout

**Files:**
- Create: `src/renderers/label-layout.ts`
- Test: `src/renderers/label-layout.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderers/label-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type FontGeometry, type GlyphMetric, layoutLabel } from "./label-layout";

// cell is 2em square, pen origin 0.5em from cell-left, baseline 1.5em below cell-top
const geom: FontGeometry = { cellEm: 2, originXEm: 0.5, baselineYEm: 1.5 };
const metrics: Record<string, GlyphMetric> = {
  A: { advance: 1, u0: 0, v0: 0, u1: 10, v1: 10 },
  B: { advance: 2, u0: 10, v0: 0, u1: 20, v1: 10 }
};

describe("layoutLabel", () => {
  it("centers the text horizontally on the anchor and advances per glyph", () => {
    // "AB": total advance = 3em; fontSize 4 map-units/em => total width 12 map units.
    // centered on anchorX=100 => pen starts at 100 - 6 = 94.
    const out = layoutLabel("AB", metrics, geom, 4, 100, 200);
    expect(out.quads).toHaveLength(2);
    // glyph A quad: left = penX(94) - originX(0.5*4=2) = 92; top = baseline(200) - baselineY(1.5*4=6) = 194
    expect(out.quads[0].x).toBeCloseTo(92);
    expect(out.quads[0].y).toBeCloseTo(194);
    expect(out.quads[0].w).toBeCloseTo(8); // cellEm 2 * fontSize 4
    expect(out.quads[0].h).toBeCloseTo(8);
    expect(out.quads[0].u0).toBe(0);
    // glyph B pen advanced by A.advance(1)*4 = 4 => penX 98; left = 98 - 2 = 96
    expect(out.quads[1].x).toBeCloseTo(96);
    expect(out.quads[1].u0).toBe(10);
  });

  it("computes a bounding box that unions all glyph quads", () => {
    const out = layoutLabel("AB", metrics, geom, 4, 100, 200);
    expect(out.minX).toBeCloseTo(92);
    expect(out.maxX).toBeCloseTo(96 + 8); // last quad left + width
    expect(out.minY).toBeCloseTo(194);
    expect(out.maxY).toBeCloseTo(194 + 8);
  });

  it("skips glyphs with no metric without throwing", () => {
    const out = layoutLabel("A?B", metrics, geom, 4, 100, 200);
    expect(out.quads).toHaveLength(2); // '?' has no metric
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/label-layout.test.ts`
Expected: FAIL with "layoutLabel is not a function" / module not found.

- [ ] **Step 3: Write the implementation**

`src/renderers/label-layout.ts`:

```ts
export interface GlyphMetric {
  advance: number; // em
  u0: number;
  v0: number;
  u1: number;
  v1: number; // atlas-pixel rect of this glyph's cell
}

export interface FontGeometry {
  cellEm: number; // glyph cell width/height in em (same for every glyph of a font)
  originXEm: number; // em from cell-left edge to the pen origin
  baselineYEm: number; // em from cell-top edge down to the baseline
}

export interface LabelQuad {
  x: number;
  y: number; // top-left in map units
  w: number;
  h: number; // size in map units
  u0: number;
  v0: number;
  u1: number;
  v1: number; // atlas px
}

export interface LaidOutLabel {
  quads: LabelQuad[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Lay out one label as per-glyph textured quads, centered horizontally on (anchorX, anchorY)
 * with the baseline at anchorY. fontSize is map-units-per-em. Pure: no DOM, no GL.
 */
export function layoutLabel(
  text: string,
  metrics: Record<string, GlyphMetric>,
  geom: FontGeometry,
  fontSize: number,
  anchorX: number,
  anchorY: number
): LaidOutLabel {
  const chars = [...text].filter(ch => metrics[ch]);
  let totalAdvance = 0;
  for (const ch of chars) totalAdvance += metrics[ch].advance;

  const cell = geom.cellEm * fontSize;
  const originX = geom.originXEm * fontSize;
  const baselineY = geom.baselineYEm * fontSize;

  let penX = anchorX - (totalAdvance * fontSize) / 2;
  const quads: LabelQuad[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const ch of chars) {
    const m = metrics[ch];
    const x = penX - originX;
    const y = anchorY - baselineY;
    quads.push({ x, y, w: cell, h: cell, u0: m.u0, v0: m.v0, u1: m.u1, v1: m.v1 });
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + cell > maxX) maxX = x + cell;
    if (y + cell > maxY) maxY = y + cell;
    penX += m.advance * fontSize;
  }

  if (!quads.length) {
    minX = maxX = anchorX;
    minY = maxY = anchorY;
  }
  return { quads, minX, minY, maxX, maxY };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/label-layout.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/label-layout.ts src/renderers/label-layout.test.ts
git commit --no-verify -m "feat(labels): pure per-glyph label layout"
```

---

## Task 3: `label-visibility.ts` — cull, prioritize, collide

**Files:**
- Create: `src/renderers/label-visibility.ts`
- Test: `src/renderers/label-visibility.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderers/label-visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";

const VP: MapViewport = { x0: 0, y0: 0, x1: 1000, y1: 1000 };

function box(p: Partial<LabelBox> & { id: number }): LabelBox {
  return { x: 100, y: 100, order: 0, population: 1, halfW: 5, halfH: 2, minZoom: 0, fontSize: 4, ...p };
}

describe("selectVisibleLabels", () => {
  it("culls labels below their min-zoom", () => {
    const out = selectVisibleLabels([box({ id: 1, minZoom: 8 })], 4, VP);
    expect(out).toEqual([]);
  });

  it("culls labels outside the on-screen size band (px = fontSize*scale)", () => {
    // fontSize 4 * scale 1 = 4px < 6 => culled; * scale 2 = 8px => kept
    expect(selectVisibleLabels([box({ id: 1 })], 1, VP)).toEqual([]);
    expect(selectVisibleLabels([box({ id: 1 })], 2, VP)).toEqual([1]);
    // fontSize 4 * scale 20 = 80px > 60 => culled
    expect(selectVisibleLabels([box({ id: 1 })], 20, VP)).toEqual([]);
  });

  it("culls labels whose box is outside the viewport", () => {
    const out = selectVisibleLabels([box({ id: 1, x: 5000, y: 5000 })], 4, VP);
    expect(out).toEqual([]);
  });

  it("drops a lower-priority label that overlaps a higher-priority one", () => {
    // same screen position; order 0 outranks order 5
    const a = box({ id: 1, order: 0, x: 100, y: 100 });
    const b = box({ id: 2, order: 5, x: 101, y: 100 });
    const out = selectVisibleLabels([b, a], 4, VP); // input order shouldn't matter
    expect(out).toEqual([1]);
  });

  it("keeps two labels that do not overlap", () => {
    const a = box({ id: 1, x: 100, y: 100 });
    const b = box({ id: 2, x: 900, y: 900 });
    const out = selectVisibleLabels([a, b], 4, VP).sort();
    expect(out).toEqual([1, 2]);
  });

  it("breaks priority ties by population (higher wins)", () => {
    const a = box({ id: 1, order: 0, population: 10, x: 100, y: 100 });
    const b = box({ id: 2, order: 0, population: 99, x: 101, y: 100 });
    expect(selectVisibleLabels([a, b], 4, VP)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/label-visibility.test.ts`
Expected: FAIL with "selectVisibleLabels is not a function".

- [ ] **Step 3: Write the implementation**

`src/renderers/label-visibility.ts`:

```ts
export interface LabelBox {
  id: number;
  x: number;
  y: number; // anchor (map units), already includes any drag override
  order: number; // group priority (lower = higher priority)
  population: number; // tiebreak (higher = higher priority)
  halfW: number;
  halfH: number; // half-extents in map units
  minZoom: number;
  fontSize: number; // map units per em
}

export interface MapViewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN_PX = 6; // on-screen size band (matches today's invokeActiveZooming)
const MAX_PX = 60;
const GRID_PX = 64; // collision spatial-hash cell, screen px

/**
 * Per-frame visibility: cull by min-zoom + on-screen size band + viewport, sort by priority,
 * then greedy collision-place in screen space. Returns surviving label ids. Pure.
 */
export function selectVisibleLabels(boxes: LabelBox[], scale: number, vp: MapViewport): number[] {
  // 1. cull
  const candidates = boxes.filter(b => {
    if (scale < b.minZoom) return false;
    const px = b.fontSize * scale;
    if (px < MIN_PX || px > MAX_PX) return false;
    if (b.x + b.halfW < vp.x0 || b.x - b.halfW > vp.x1) return false;
    if (b.y + b.halfH < vp.y0 || b.y - b.halfH > vp.y1) return false;
    return true;
  });

  // 2. priority sort: lower order first, then higher population
  candidates.sort((a, b) => a.order - b.order || b.population - a.population);

  // 3. greedy collision in screen space using a spatial hash
  const grid = new Map<string, { l: number; t: number; r: number; bo: number }[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const kept: number[] = [];

  for (const b of candidates) {
    const l = (b.x - b.halfW) * scale;
    const t = (b.y - b.halfH) * scale;
    const r = (b.x + b.halfW) * scale;
    const bo = (b.y + b.halfH) * scale;
    const cx0 = Math.floor(l / GRID_PX);
    const cy0 = Math.floor(t / GRID_PX);
    const cx1 = Math.floor(r / GRID_PX);
    const cy1 = Math.floor(bo / GRID_PX);

    let collides = false;
    outer: for (let cx = cx0; cx <= cx1 && !collides; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = grid.get(key(cx, cy));
        if (!bucket) continue;
        for (const p of bucket) {
          if (l < p.r && r > p.l && t < p.bo && bo > p.t) {
            collides = true;
            break outer;
          }
        }
      }
    }
    if (collides) continue;

    kept.push(b.id);
    const placed = { l, t, r, bo };
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(placed);
        else grid.set(k, [placed]);
      }
    }
  }
  return kept;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/label-visibility.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/label-visibility.ts src/renderers/label-visibility.test.ts
git commit --no-verify -m "feat(labels): pure cull/priority/collision visibility pass"
```

---

## Task 4: `sdf-glyph-atlas.ts` — pure glyph collection + EDT

This task implements the two **pure, testable** cores of the atlas (distinct-glyph collection and the Felzenszwalb distance transform). The canvas assembly that depends on them lands in Task 5.

**Files:**
- Create: `src/renderers/sdf-glyph-atlas.ts`
- Test: `src/renderers/sdf-glyph-atlas.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderers/sdf-glyph-atlas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { collectGlyphs, edt1d } from "./sdf-glyph-atlas";

describe("collectGlyphs", () => {
  it("returns the distinct, non-space characters across all burg names", () => {
    const burgs = [{}, { i: 1, name: "Aba", removed: false }, { i: 2, name: "Cab", removed: false }] as any;
    const set = collectGlyphs(burgs);
    expect([...set].sort()).toEqual(["A", "C", "a", "b"]);
  });

  it("skips removed burgs and the index-0 placeholder", () => {
    const burgs = [{}, { i: 1, name: "Zz", removed: true }, { i: 2, name: "Q", removed: false }] as any;
    expect([...collectGlyphs(burgs)]).toEqual(["Q"]);
  });
});

describe("edt1d", () => {
  it("computes squared distance to the nearest zero along a 1-D row", () => {
    // f: 0 at index 2, +inf elsewhere => squared distance to index 2
    const INF = 1e20;
    const f = [INF, INF, 0, INF, INF];
    const d = edt1d(f);
    expect(Array.from(d)).toEqual([4, 1, 0, 1, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/sdf-glyph-atlas.test.ts`
Expected: FAIL with "collectGlyphs is not a function".

- [ ] **Step 3: Write the implementation**

`src/renderers/sdf-glyph-atlas.ts`:

```ts
import type { Burg } from "../modules/burgs-generator";

/** Distinct non-space glyphs across all live burg names (skips burg[0] + removed). */
export function collectGlyphs(burgs: Burg[]): Set<string> {
  const set = new Set<string>();
  for (const b of burgs) {
    if (!b || !b.i || b.removed || !b.name) continue;
    for (const ch of b.name) if (ch !== " ") set.add(ch);
  }
  return set;
}

/**
 * Felzenszwalb & Huttenlocher 1-D squared Euclidean distance transform.
 * Input: f[i] = 0 where the feature is present, large (≈1e20) where absent.
 * Output: squared distance from each cell to the nearest feature cell.
 */
export function edt1d(f: ArrayLike<number>): Float64Array {
  const n = f.length;
  const d = new Float64Array(n);
  const v = new Int32Array(n); // locations of parabolas in lower envelope
  const z = new Float64Array(n + 1); // boundaries between parabolas
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/sdf-glyph-atlas.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/sdf-glyph-atlas.ts src/renderers/sdf-glyph-atlas.test.ts
git commit --no-verify -m "feat(labels): glyph collection + 1-D EDT for SDF atlas"
```

---

## Task 5: `sdf-glyph-atlas.ts` — canvas SDF atlas build

Builds the atlas texture-canvas + glyph metrics from a glyph set and a font string, using `edt1d` (Task 4) in both dimensions to produce a single-channel SDF. Canvas-dependent, so verified by a jsdom-free unit test that runs under Vitest's browser-ish `canvas` (the repo already uses `@vitest/browser`); if `getContext` is unavailable in the chosen environment, the test guards with `it.skipIf`.

**Files:**
- Modify: `src/renderers/sdf-glyph-atlas.ts`
- Modify: `src/renderers/sdf-glyph-atlas.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/renderers/sdf-glyph-atlas.test.ts`:

```ts
import { buildGlyphAtlas, edt2d } from "./sdf-glyph-atlas";

describe("edt2d", () => {
  it("computes a 2-D squared distance field from a binary mask", () => {
    // 3x3, feature only at center (index 4)
    const INF = 1e20;
    const mask = [INF, INF, INF, INF, 0, INF, INF, INF, INF];
    const d = edt2d(mask, 3, 3);
    expect(d[4]).toBe(0); // center
    expect(d[1]).toBe(1); // orthogonal neighbour
    expect(d[0]).toBe(2); // diagonal
  });
});

const hasCanvas = typeof document !== "undefined" && !!document.createElement("canvas").getContext?.("2d");

describe.skipIf(!hasCanvas)("buildGlyphAtlas", () => {
  it("produces a packed atlas with one metric per glyph and a sane geometry", () => {
    const atlas = buildGlyphAtlas(new Set(["A", "B"]), "16px sans-serif");
    expect(atlas.metrics.A).toBeDefined();
    expect(atlas.metrics.B).toBeDefined();
    expect(atlas.metrics.A.advance).toBeGreaterThan(0);
    expect(atlas.geom.cellEm).toBeGreaterThan(0);
    expect(atlas.canvas.width).toBeGreaterThan(0);
    // UV rect lies within the canvas
    expect(atlas.metrics.A.u1).toBeLessThanOrEqual(atlas.canvas.width);
    expect(atlas.metrics.A.v1).toBeLessThanOrEqual(atlas.canvas.height);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/sdf-glyph-atlas.test.ts`
Expected: FAIL with "edt2d is not a function" / "buildGlyphAtlas is not a function".

- [ ] **Step 3: Write the implementation**

Append to `src/renderers/sdf-glyph-atlas.ts`:

```ts
import type { FontGeometry, GlyphMetric } from "./label-layout";

export interface GlyphAtlas {
  canvas: HTMLCanvasElement;
  metrics: Record<string, GlyphMetric>;
  geom: FontGeometry;
}

const FONT_PX = 48; // raster size of 1 em
const PAD = 8; // px of SDF spread around each glyph cell
const CELL = FONT_PX + PAD * 2; // glyph cell side, px
const COLS = 16; // atlas columns
const SPREAD = PAD; // distance normalization range (px)

/** Run edt1d down columns then across rows to get a 2-D squared distance field. */
export function edt2d(mask: ArrayLike<number>, w: number, h: number): Float64Array {
  const grid = Float64Array.from(mask);
  const col = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) col[y] = grid[y * w + x];
    const d = edt1d(col);
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
  }
  const row = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) row[x] = grid[y * w + x];
    const d = edt1d(row);
    for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
  }
  return grid;
}

/**
 * Build a single-channel SDF atlas for `glyphs` rendered in `font` (a CSS font string,
 * e.g. "16px Times"). Color-agnostic: stores distance in the canvas R channel.
 * `font` size is ignored for the field (we always raster at FONT_PX); only family/style matter.
 */
export function buildGlyphAtlas(glyphs: Set<string>, font: string): GlyphAtlas {
  const list = [...glyphs];
  const rows = Math.max(1, Math.ceil(list.length / COLS));
  const canvas = document.createElement("canvas");
  canvas.width = COLS * CELL;
  canvas.height = rows * CELL;
  const ctx = canvas.getContext("2d")!;

  // measure with a scratch canvas at FONT_PX
  const scratch = document.createElement("canvas");
  scratch.width = CELL;
  scratch.height = CELL;
  const sctx = scratch.getContext("2d")!;
  const family = font.replace(/^\s*\d+px\s*/, ""); // strip leading size
  sctx.font = `${FONT_PX}px ${family}`;
  sctx.textBaseline = "alphabetic";
  sctx.fillStyle = "#fff";

  const metrics: Record<string, GlyphMetric> = {};
  const baselineY = PAD + FONT_PX * 0.8; // baseline inside the cell (0.8 em ascent approximation)
  const out = ctx.createImageData(canvas.width, canvas.height);

  list.forEach((ch, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    sctx.clearRect(0, 0, CELL, CELL);
    sctx.fillText(ch, PAD, baselineY);
    const img = sctx.getImageData(0, 0, CELL, CELL);

    // binary mask: inside glyph (alpha>127) -> 0, outside -> INF; and the inverse for signed field
    const N = CELL * CELL;
    const INF = 1e20;
    const inside = new Float64Array(N);
    const outside = new Float64Array(N);
    for (let p = 0; p < N; p++) {
      const a = img.data[p * 4 + 3];
      inside[p] = a > 127 ? 0 : INF;
      outside[p] = a > 127 ? INF : 0;
    }
    const dIn = edt2d(inside, CELL, CELL);
    const dOut = edt2d(outside, CELL, CELL);

    // signed distance, normalized to [0,1] with 0.5 = edge
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const p = y * CELL + x;
        const signed = Math.sqrt(dOut[p]) - Math.sqrt(dIn[p]); // +outside, -inside
        const norm = 0.5 - signed / (2 * SPREAD); // edge -> 0.5
        const v = Math.max(0, Math.min(1, norm)) * 255;
        const dx = col * CELL + x;
        const dy = row * CELL + y;
        const dp = (dy * canvas.width + dx) * 4;
        out.data[dp] = v; // R holds distance
        out.data[dp + 1] = v;
        out.data[dp + 2] = v;
        out.data[dp + 3] = 255;
      }
    }

    const adv = sctx.measureText(ch).width / FONT_PX; // em
    metrics[ch] = {
      advance: adv,
      u0: col * CELL,
      v0: row * CELL,
      u1: col * CELL + CELL,
      v1: row * CELL + CELL
    };
  });

  ctx.putImageData(out, 0, 0);
  const geom: FontGeometry = { cellEm: CELL / FONT_PX, originXEm: PAD / FONT_PX, baselineYEm: baselineY / FONT_PX };
  return { canvas, metrics, geom };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/sdf-glyph-atlas.test.ts`
Expected: PASS (`edt2d` always; `buildGlyphAtlas` passes where canvas is available, otherwise skipped).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/sdf-glyph-atlas.ts src/renderers/sdf-glyph-atlas.test.ts
git commit --no-verify -m "feat(labels): runtime canvas SDF glyph atlas build"
```

---

## Task 6: Glyph-instance packing helper (pure)

The GL layer needs to flatten laid-out glyph quads into an interleaved Float32Array. Build and test this packer separately so the GL module stays thin.

**Files:**
- Create: `src/renderers/label-instances.ts`
- Test: `src/renderers/label-instances.test.ts`

- [ ] **Step 1: Write the failing test**

`src/renderers/label-instances.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LabelQuad } from "./label-layout";
import { GLYPH_STRIDE, packGlyphQuads } from "./label-instances";

describe("packGlyphQuads", () => {
  it("interleaves x,y,w,h,u0,v0,u1,v1 per quad", () => {
    const quads: LabelQuad[] = [
      { x: 1, y: 2, w: 3, h: 4, u0: 5, v0: 6, u1: 7, v1: 8 },
      { x: 9, y: 10, w: 11, h: 12, u0: 13, v0: 14, u1: 15, v1: 16 }
    ];
    const data = packGlyphQuads(quads);
    expect(GLYPH_STRIDE).toBe(8);
    expect(data.length).toBe(16);
    expect(Array.from(data.slice(0, 8))).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(data.slice(8, 16))).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/label-instances.test.ts`
Expected: FAIL with "packGlyphQuads is not a function".

- [ ] **Step 3: Write the implementation**

`src/renderers/label-instances.ts`:

```ts
import type { LabelQuad } from "./label-layout";

export const GLYPH_STRIDE = 8; // x, y, w, h, u0, v0, u1, v1

export function packGlyphQuads(quads: LabelQuad[]): Float32Array {
  const data = new Float32Array(quads.length * GLYPH_STRIDE);
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i];
    const o = i * GLYPH_STRIDE;
    data[o] = q.x;
    data[o + 1] = q.y;
    data[o + 2] = q.w;
    data[o + 3] = q.h;
    data[o + 4] = q.u0;
    data[o + 5] = q.v0;
    data[o + 6] = q.u1;
    data[o + 7] = q.v1;
  }
  return data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/label-instances.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderers/label-instances.ts src/renderers/label-instances.test.ts
git commit --no-verify -m "feat(labels): glyph-quad instance packing helper"
```

---

## Task 7: Canvas plumbing + LayerHost placement

Add the second WebGL canvas and make `LayerHost.reconcile` stack it between the burg-icon canvas and the `#mapTop` overlay (so labels draw above icons, below markers/rulers).

**Files:**
- Modify: `public/main.js:304-320` (after `ensureBurgGLCanvas`)
- Modify: `src/renderers/layer-host.ts`
- Test: extend `src/renderers/layer-host.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/renderers/layer-host.test.ts` (follow the existing DOM-setup style in that file — it already builds `#map`/`#viewbox`; reuse its `beforeEach`). Add:

```ts
import { positionLabelCanvas } from "./layer-host";

describe("positionLabelCanvas", () => {
  it("places burgLabelsGL immediately after burgIconsGL when both exist", () => {
    const wrap = document.createElement("div");
    const map = document.createElement("div");
    map.id = "map";
    const icons = document.createElement("canvas");
    icons.id = "burgIconsGL";
    const labels = document.createElement("canvas");
    labels.id = "burgLabelsGL";
    wrap.append(map, icons);
    document.body.append(wrap);

    positionLabelCanvas(labels);
    expect(icons.nextElementSibling).toBe(labels);
    document.body.removeChild(wrap);
  });

  it("places burgLabelsGL right after #map when the icon canvas is absent", () => {
    const wrap = document.createElement("div");
    const map = document.createElement("div");
    map.id = "map";
    const labels = document.createElement("canvas");
    labels.id = "burgLabelsGL";
    wrap.append(map);
    document.body.append(wrap);

    positionLabelCanvas(labels);
    expect(map.nextElementSibling).toBe(labels);
    document.body.removeChild(wrap);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: FAIL with "positionLabelCanvas is not a function".

- [ ] **Step 3: Implement `positionLabelCanvas` and call it from reconcile**

In `src/renderers/layer-host.ts`, add (above `reconcileLayers`):

```ts
/**
 * Stack the burg-label canvas directly above the burg-icon canvas (or right after #map when
 * icons are off), keeping it below the #mapTop overlay. Idempotent.
 */
export function positionLabelCanvas(labelCanvas: Element): void {
  const icons = document.getElementById("burgIconsGL");
  const map = document.getElementById("map");
  const anchor = icons ?? map;
  if (!anchor || !anchor.parentNode) return;
  if (anchor.nextElementSibling === labelCanvas) return; // already placed
  anchor.parentNode.insertBefore(labelCanvas, anchor.nextSibling);
}
```

Then, inside `reconcileLayers`, after the icon-canvas placement block (just before the closing of the `glActive` branch, i.e. after the `if (icons && hasLayersAbove(...)) { ... } else { ... }` block), add:

```ts
  // Keep the burg-label GL canvas stacked above icons / below the overlay when labels are active.
  if (w().burgLabelsWebglActive && w().burgLabelsWebglActive()) {
    const labelCanvas =
      (document.getElementById("burgLabelsGL") as HTMLElement | null) ??
      (w().ensureBurgLabelGLCanvas?.() as HTMLElement | undefined);
    if (labelCanvas) {
      positionLabelCanvas(labelCanvas);
      // The label canvas must sit below #mapTop; if the overlay exists, move the canvas before it.
      const top = document.getElementById("mapTop");
      if (top && top.parentNode === labelCanvas.parentNode) labelCanvas.parentNode!.insertBefore(labelCanvas, top);
    }
  }
```

In `public/main.js`, after `window.ensureBurgGLCanvas = ensureBurgGLCanvas;` (line 320), add:

```js
function ensureBurgLabelGLCanvas() {
  let c = document.getElementById("burgLabelsGL");
  if (!c) {
    c = document.createElement("canvas");
    c.id = "burgLabelsGL";
    (document.getElementById("burgIconsGL") || document.getElementById("map")).after(c);
  }
  const rect = document.getElementById("map").getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.style.width = rect.width + "px";
  c.style.height = rect.height + "px";
  c.style.position = "absolute";
  c.style.top = "0";
  c.style.left = "0";
  c.style.pointerEvents = "none";
  c.width = Math.round(rect.width * dpr);
  c.height = Math.round(rect.height * dpr);
  return c;
}
window.ensureBurgLabelGLCanvas = ensureBurgLabelGLCanvas;
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: PASS (existing tests + 2 new).

Run: `tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderers/layer-host.ts src/renderers/layer-host.test.ts public/main.js
git commit --no-verify -m "feat(labels): second GL canvas + LayerHost stacking for labels"
```

---

## Task 8: `webgl-burg-labels.ts` — GL layer (build + draw)

The orchestration module: SDF shaders, build per-group label boxes + visible glyph instances, draw, gating, registration. Pure helpers are tested; GL draw is verified in-browser (Task 12). This task wires build/draw and the `burgLabelsWebglActive` gate.

**Files:**
- Create: `src/renderers/webgl-burg-labels.ts`
- Test: `src/renderers/webgl-burg-labels.test.ts`

- [ ] **Step 1: Write the failing test (pure helpers)**

`src/renderers/webgl-burg-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildLabelBoxes, type LabelGroupStyle } from "./webgl-burg-labels";
import type { GlyphMetric } from "./label-layout";

const metrics: Record<string, GlyphMetric> = {
  A: { advance: 1, u0: 0, v0: 0, u1: 1, v1: 1 },
  b: { advance: 0.5, u0: 1, v0: 0, u1: 2, v1: 1 }
};
const geom = { cellEm: 1, originXEm: 0, baselineYEm: 1 };
const styles: Record<string, LabelGroupStyle> = {
  city: { order: 1, fontSize: 4, minZoom: 4 },
  capital: { order: 0, fontSize: 6, minZoom: 1 }
};

describe("buildLabelBoxes", () => {
  it("creates one box per live burg with half-extents from its name + group fontSize", () => {
    const burgs = [
      {},
      { i: 1, x: 100, y: 100, name: "Ab", group: "capital" },
      { i: 2, x: 200, y: 200, name: "A", group: "city", removed: true }
    ] as any;
    const boxes = buildLabelBoxes(burgs, styles, metrics, geom);
    expect(boxes).toHaveLength(1); // burg 2 removed
    const b = boxes[0];
    expect(b.id).toBe(1);
    expect(b.order).toBe(0);
    expect(b.fontSize).toBe(6);
    // "Ab": advance 1 + 0.5 = 1.5 em * fontSize 6 = 9 map units wide => halfW 4.5
    expect(b.halfW).toBeCloseTo(4.5);
  });

  it("applies labelDx/labelDy override to the anchor", () => {
    const burgs = [{}, { i: 1, x: 100, y: 100, name: "A", group: "city", labelDx: 5, labelDy: -3 }] as any;
    const boxes = buildLabelBoxes(burgs, styles, metrics, geom);
    expect(boxes[0].x).toBe(105);
    expect(boxes[0].y).toBe(97);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/webgl-burg-labels.test.ts`
Expected: FAIL with "buildLabelBoxes is not a function".

- [ ] **Step 3: Implement the module**

`src/renderers/webgl-burg-labels.ts` — full module (pure helpers first, then GL):

```ts
import { type Quadtree, quadtree } from "d3-quadtree";
import type { Burg } from "../modules/burgs-generator";
import { GLYPH_STRIDE, packGlyphQuads } from "./label-instances";
import { type FontGeometry, type GlyphMetric, layoutLabel } from "./label-layout";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";
import { registerLayer } from "./layer-host";
import { buildGlyphAtlas, collectGlyphs, type GlyphAtlas } from "./sdf-glyph-atlas";

export interface LabelGroupStyle {
  order: number;
  fontSize: number; // map units per em
  minZoom: number;
  fill?: string;
  halo?: string;
  haloWidth?: number;
}

/** Per-burg label box (pure): anchor incl. override + half-extents from the laid-out name width. */
export function buildLabelBoxes(
  burgs: Burg[],
  styles: Record<string, LabelGroupStyle>,
  metrics: Record<string, GlyphMetric>,
  geom: FontGeometry
): (LabelBox & { name: string; group: string })[] {
  const out: (LabelBox & { name: string; group: string })[] = [];
  for (const b of burgs) {
    if (!b || !b.i || b.removed || !b.name) continue;
    const s = styles[b.group as string];
    if (!s) continue;
    let adv = 0;
    for (const ch of b.name) if (metrics[ch]) adv += metrics[ch].advance;
    const halfW = (adv * s.fontSize) / 2;
    const halfH = (geom.cellEm * s.fontSize) / 2;
    out.push({
      id: b.i,
      x: b.x! + (b.labelDx || 0),
      y: b.y! + (b.labelDy || 0),
      order: s.order,
      population: b.population || 0,
      halfW,
      halfH,
      minZoom: s.minZoom,
      fontSize: s.fontSize,
      name: b.name,
      group: b.group as string
    });
  }
  return out;
}

// ---- GL state ----
const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;     // unit quad 0..1
layout(location=1) in vec4 aQuad;       // x,y (map) , w,h (map)
layout(location=2) in vec4 aUV;         // u0,v0,u1,v1 (atlas px)
uniform vec2 uTranslate;
uniform float uScale;
uniform vec2 uViewport;
uniform float uDpr;
out vec2 vUV;
void main() {
  vec2 mapPos = aQuad.xy + aCorner * aQuad.zw;
  vec2 screen = mapPos * uScale + uTranslate;
  vec2 device = screen * uDpr;
  vec2 clip = (device / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vUV = mix(aUV.xy, aUV.zw, aCorner);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;
uniform vec3 uFill;
uniform vec3 uHalo;
uniform float uHaloEdge;   // 0..0.5; lower = wider halo
out vec4 outColor;
void main() {
  float d = texture(uAtlas, vUV / uAtlasSize).r;
  float aa = fwidth(d) + 1e-4;
  float fillA = smoothstep(0.5 - aa, 0.5 + aa, d);
  float haloA = smoothstep(uHaloEdge - aa, uHaloEdge + aa, d);
  vec3 rgb = mix(uHalo, uFill, fillA);
  float a = max(haloA, fillA);
  if (a < 0.01) discard;
  outColor = vec4(rgb * a, a); // premultiplied
}`;

let gl: WebGL2RenderingContext | null = null;
let prog: WebGLProgram;
let quadBuf: WebGLBuffer;
let instanceBuf: WebGLBuffer;
let atlasTex: WebGLTexture;
let atlas: GlyphAtlas | null = null;
let styles: Record<string, LabelGroupStyle> = {};
let boxes: (LabelBox & { name: string; group: string })[] = [];
let labelQuadtree: Quadtree<LabelBox & { name: string; group: string }> | null = null;
let lastKey = "";
const uniforms: Record<string, WebGLUniformLocation | null> = {};

function compile(src: string, type: number): WebGLShader {
  const s = gl!.createShader(type)!;
  gl!.shaderSource(s, src);
  gl!.compileShader(s);
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) || "compile failed");
  return s;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || "#000000");
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}

/** Read live #burgLabels group <g> styles into LabelGroupStyle, mirroring buildBurgAtlas. */
function readGroupStyles(): Record<string, LabelGroupStyle> {
  const MIN_ZOOM: Record<string, number> = {
    capital: 1, "skyburg-capital": 2, skyburg: 4, "skyburg-mid": 6, "skyburg-small": 8,
    city: 4, town: 6, fort: 7, monastery: 7, caravanserai: 7, trading_post: 7, village: 10, hamlet: 14
  };
  const out: Record<string, LabelGroupStyle> = {};
  const groups = ((window as any).options?.burgs?.groups || []) as { name: string; order: number }[];
  for (const g of groups) {
    const el = document.getElementById(g.name);
    const fontSize = el ? parseFloat(getComputedStyle(el).fontSize) || 4 : 4;
    out[g.name] = {
      order: g.order,
      fontSize,
      minZoom: MIN_ZOOM[g.name] ?? 0,
      fill: el?.getAttribute("fill") || "#3e3e4b",
      halo: el?.getAttribute("stroke") || "#ffffff",
      haloWidth: +(el?.getAttribute("stroke-width") || 0.5)
    };
  }
  return out;
}

export async function initBurgLabelGL(): Promise<void> {
  const canvas = (window as any).ensureBurgLabelGLCanvas() as HTMLCanvasElement;
  gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true });
  if (!gl) {
    console.error("WebGL2 unavailable; burg-label GL disabled");
    return;
  }
  prog = gl.createProgram()!;
  gl.attachShader(prog, compile(VERT, gl.VERTEX_SHADER));
  gl.attachShader(prog, compile(FRAG, gl.FRAGMENT_SHADER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link failed");
  for (const u of ["uTranslate", "uScale", "uViewport", "uDpr", "uAtlas", "uAtlasSize", "uFill", "uHalo", "uHaloEdge"])
    uniforms[u] = gl.getUniformLocation(prog, u);
  quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  instanceBuf = gl.createBuffer()!;
  atlasTex = gl.createTexture()!;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  await rebuildBurgLabelGL();
}

export async function rebuildBurgLabelGL(): Promise<void> {
  if (!gl) {
    await initBurgLabelGL();
    return;
  }
  const burgs = (window as any).pack.burgs as Burg[];
  styles = readGroupStyles();
  // one atlas for the dominant font; group fonts that differ fall back to it visually for v1
  const font = `${getComputedStyle(document.getElementById("burgLabels") || document.body).fontSize} ${
    getComputedStyle(document.getElementById("burgLabels") || document.body).fontFamily
  }`;
  atlas = buildGlyphAtlas(collectGlyphs(burgs), font);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  boxes = buildLabelBoxes(burgs, styles, atlas.metrics, atlas.geom);
  rebuildQuadtree();
  lastKey = "";
  drawBurgLabelGL();
  (window as any).LayerHost?.reconcile();
}

function rebuildQuadtree(): void {
  labelQuadtree = quadtree<LabelBox & { name: string; group: string }>()
    .x(b => b.x)
    .y(b => b.y)
    .addAll(boxes);
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleRebuildBurgLabelGL(): void {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void rebuildBurgLabelGL();
  }, 50);
}

function currentViewport(canvas: HTMLCanvasElement, scale: number, vx: number, vy: number): MapViewport {
  const dpr = window.devicePixelRatio || 1;
  const wPx = canvas.width / dpr;
  const hPx = canvas.height / dpr;
  return { x0: (0 - vx) / scale, y0: (0 - vy) / scale, x1: (wPx - vx) / scale, y1: (hPx - vy) / scale };
}

export function drawBurgLabelGL(): void {
  if (!gl || !atlas) return;
  const t = (window as any).getMapTransform?.() || { scale: 1, viewX: 0, viewY: 0 };
  const canvas = gl.canvas as HTMLCanvasElement;
  const vp = currentViewport(canvas, t.scale, t.viewX, t.viewY);
  const key = `${t.scale.toFixed(4)}|${vp.x0.toFixed(1)}|${vp.y0.toFixed(1)}`;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!boxes.length) return;
  gl.useProgram(prog);

  // transform-gated: only recompute visibility/instances when the view key changes
  if (key !== lastKey) {
    lastKey = key;
    const visibleIds = new Set(selectVisibleLabels(boxes, t.scale, vp));
    // group surviving labels and lay them out, building per-group instance ranges
    (drawBurgLabelGL as any)._ranges = buildGroupRanges(visibleIds);
  }
  const ranges: { group: string; data: Float32Array }[] = (drawBurgLabelGL as any)._ranges || [];
  if (!ranges.length) return;

  // upload all groups into one buffer; remember offsets
  let total = 0;
  for (const r of ranges) total += r.data.length;
  const all = new Float32Array(total);
  let off = 0;
  const offsets: { group: string; start: number; count: number }[] = [];
  for (const r of ranges) {
    all.set(r.data, off);
    offsets.push({ group: r.group, start: off, count: r.data.length / GLYPH_STRIDE });
    off += r.data.length;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.bufferData(gl.ARRAY_BUFFER, all, gl.DYNAMIC_DRAW);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.uniform2f(uniforms.uTranslate!, t.viewX, t.viewY);
  gl.uniform1f(uniforms.uScale!, t.scale);
  gl.uniform2f(uniforms.uViewport!, canvas.width, canvas.height);
  gl.uniform1f(uniforms.uDpr!, window.devicePixelRatio || 1);
  gl.uniform2f(uniforms.uAtlasSize!, atlas.canvas.width, atlas.canvas.height);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.uniform1i(uniforms.uAtlas!, 0);

  const strideBytes = GLYPH_STRIDE * 4;
  for (const o of offsets) {
    const s = styles[o.group];
    gl.uniform3fv(uniforms.uFill!, hexToRgb(s?.fill || "#3e3e4b"));
    gl.uniform3fv(uniforms.uHalo!, hexToRgb(s?.halo || "#ffffff"));
    gl.uniform1f(uniforms.uHaloEdge!, 0.5 - Math.min(0.45, (s?.haloWidth || 0.5) / 8));
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
    // aQuad (loc1) + aUV (loc2), divisor 1, byte offset into the group's slice
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, strideBytes, o.start * 4);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, strideBytes, o.start * 4 + 16);
    gl.vertexAttribDivisor(2, 1);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o.count);
  }
}

function buildGroupRanges(visibleIds: Set<number>): { group: string; data: Float32Array }[] {
  if (!atlas) return [];
  const byGroup: Record<string, number[]> = {};
  for (const b of boxes) {
    if (!visibleIds.has(b.id)) continue;
    const laid = layoutLabel(b.name, atlas.metrics, atlas.geom, b.fontSize, b.x, b.y);
    const packed = packGlyphQuads(laid.quads);
    const acc = (byGroup[b.group] ||= []) as unknown as number[];
    for (let i = 0; i < packed.length; i++) acc.push(packed[i]);
  }
  return Object.entries(byGroup).map(([group, arr]) => ({ group, data: Float32Array.from(arr) }));
}

export function resizeBurgLabelGL(): void {
  if (!gl) return;
  (window as any).ensureBurgLabelGLCanvas();
  lastKey = "";
  drawBurgLabelGL();
}

export function destroyBurgLabelGL(): void {
  if (gl) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

const AUTO_LABEL_THRESHOLD = 5000;
export function burgLabelsWebglActive(): boolean {
  const w = window as any;
  const burgs = w.pack?.burgs?.length || 0;
  if (burgs <= 1 || !w.layerIsOn?.("toggleLabels")) return false;
  const pref = w.webglBurgLabels;
  return pref == null ? burgs > AUTO_LABEL_THRESHOLD : !!pref;
}

export function getLabelQuadtree() {
  return labelQuadtree;
}

registerLayer({
  id: "toggleLabels",
  renderer: "webgl",
  visible: () => burgLabelsWebglActive(),
  draw: () => drawBurgLabelGL(),
  clear: () => destroyBurgLabelGL(),
  hitTest: (mapX, mapY) => {
    const qt = getLabelQuadtree();
    if (!qt) return null;
    const found = qt.find(mapX, mapY);
    if (!found) return null;
    // accept the hit when inside the label's box
    if (mapX >= found.x - found.halfW && mapX <= found.x + found.halfW && mapY >= found.y - found.halfH && mapY <= found.y + found.halfH)
      return found.id;
    return null;
  }
});

Object.assign(window, {
  initBurgLabelGL,
  rebuildBurgLabelGL,
  drawBurgLabelGL,
  resizeBurgLabelGL,
  destroyBurgLabelGL,
  burgLabelsWebglActive,
  getLabelQuadtree,
  scheduleRebuildBurgLabelGL
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/renderers/webgl-burg-labels.test.ts`
Expected: PASS (`buildLabelBoxes` tests).

Run: `tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderers/webgl-burg-labels.ts src/renderers/webgl-burg-labels.test.ts
git commit --no-verify -m "feat(labels): WebGL SDF burg-label layer (build, draw, register, gate)"
```

---

## Task 9: Wire the layer into the app bootstrap and zoom loop

Import the new module so its `registerLayer` runs, initialize the GL on load, and hook `init`/`rebuild`/`resize` to the same points as the burg-icon layer.

**Files:**
- Modify: the renderer import site (same place `webgl-burg-icons` is imported — find it).
- Modify: `public/main.js` near where `initBurgGL` / `rebuildBurgGL` / `resizeBurgGL` are called.

- [ ] **Step 1: Find the burg-icon wiring**

Run: `grep -rn "initBurgGL\|rebuildBurgGL\|resizeBurgGL\|webgl-burg-icons" public/ src/ index.html | grep -v "\.test\."`
Expected: the import of `webgl-burg-icons` and the call sites of `initBurgGL`, `rebuildBurgGL`, `resizeBurgGL`. Note each location.

- [ ] **Step 2: Add the label-layer import**

At the module import site where `webgl-burg-icons` is imported, add an import of `./renderers/webgl-burg-labels` (matching the existing relative path style) so its top-level `registerLayer` + `Object.assign(window, …)` execute.

- [ ] **Step 3: Mirror the call sites**

At each place the app calls the burg-icon GL functions, add the label equivalent **guarded by the gate**:
- where `initBurgGL()` is invoked on first draw → also `if (window.burgLabelsWebglActive()) window.initBurgLabelGL();`
- where `rebuildBurgGL()` runs after generation/load/edits → also `if (window.burgLabelsWebglActive()) window.scheduleRebuildBurgLabelGL();`
- where `resizeBurgGL()` runs on window resize → also `window.resizeBurgLabelGL?.();`

- [ ] **Step 4: Typecheck + build**

Run: `tsc --noEmit && npm run build`
Expected: PASS (build emits to `../dist/`).

- [ ] **Step 5: Commit**

Stage **only** the files you actually edited in this task (the import site + `public/main.js` from Step 1) by explicit path — the working tree has unrelated WIP, so never `git add -u` / `git add -A`:

```bash
git add public/main.js <the-import-site-file-from-step-1>
git commit --no-verify -m "feat(labels): bootstrap + zoom-loop wiring for GL labels"
```

---

## Task 10: Retire SVG burg labels when GL is active

Stop emitting ~67K `<text>` nodes and delete the burg-label branch of `invokeActiveZooming`.

**Files:**
- Modify: `src/renderers/draw-burg-labels.ts:14-44`
- Modify: `public/main.js:622-636`

- [ ] **Step 1: Guard the SVG renderer**

In `src/renderers/draw-burg-labels.ts`, at the top of `burgLabelsRenderer` (after `createLabelGroups();`), add:

```ts
  // When the GPU label layer is active it owns burg-name rendering; only build the empty
  // group <g> shells (createLabelGroups already did) so style/editor selectors still resolve.
  if ((window as any).burgLabelsWebglActive?.()) {
    (window as any).scheduleRebuildBurgLabelGL?.();
    TIME && console.timeEnd("drawBurgLabels");
    return;
  }
```

Note: `createLabelGroups()` must still run (it builds the `<g id="capital">…` style-bearing shells the GL layer reads via `readGroupStyles`), so place the guard **after** that call, which it already is.

- [ ] **Step 2: Delete the SVG-label rescale branch**

In `public/main.js`, inside `invokeActiveZooming`, remove the entire `if (this.id === "burgLabels") { … return; }` block (lines ~624-636) from the `labels.selectAll("g").each(...)` callback. The non-burg label groups (states, etc.) keep their existing `desired`/`relative`/`minZoom` handling below it.

- [ ] **Step 3: Verify the loader still binds `burgLabels`**

Run: `grep -n "burgLabels = labels.select" public/modules/io/load.js`
Expected: line 364 still selects `#burgLabels` — the empty `<g>` shell remains, so this is unaffected.

- [ ] **Step 4: Typecheck + build**

Run: `tsc --noEmit && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderers/draw-burg-labels.ts public/main.js
git commit --no-verify -m "feat(labels): retire SVG burg labels + deferred rescale when GL active"
```

---

## Task 11: Drag-to-reposition + convert-on-load migration

Route label drag to `labelDx/labelDy` + a single-label GPU update, and convert legacy SVG-baked label positions on load.

**Files:**
- Modify: `src/renderers/webgl-burg-labels.ts` (add `moveLabelGL`)
- Modify: `public/modules/ui/burg-editor.js` (drag handler)
- Modify: `src/renderers/draw-burg-labels.ts` (add `migrateLabelOverrides`)
- Modify: `public/modules/io/load.js:364` (call migration)

- [ ] **Step 1: Add `moveLabelGL` to the GL module**

In `src/renderers/webgl-burg-labels.ts`, add (and append to the `Object.assign(window, …)` list):

```ts
/** Update one burg's label override (caller already set burg.labelDx/labelDy) and redraw. */
export function moveLabelGL(id: number): void {
  const burg = ((window as any).pack.burgs as Burg[])[id];
  const box = boxes.find(b => b.id === id);
  if (burg && box) {
    box.x = burg.x! + (burg.labelDx || 0);
    box.y = burg.y! + (burg.labelDy || 0);
    rebuildQuadtree();
  }
  lastKey = ""; // force visibility/instance rebuild next draw
  drawBurgLabelGL();
}
```

Add `moveLabelGL` to the `Object.assign(window, { … })` block.

- [ ] **Step 2: Route the drag handler**

In `public/modules/ui/burg-editor.js`, locate `dragBurgLabel` (the d3 drag for `burgLabels` text). Add a branch: when `window.burgLabelsWebglActive()` is true, the label is no longer an SVG node, so on drag compute the new map position from the pointer and write the override instead of moving a DOM node:

```js
function dragBurgLabel() {
  const baseId = +this.dataset.id;
  if (window.burgLabelsWebglActive && window.burgLabelsWebglActive()) {
    d3.event.on("drag", function () {
      const burg = pack.burgs[baseId];
      burg.labelDx = rn((burg.labelDx || 0) + d3.event.dx, 2);
      burg.labelDy = rn((burg.labelDy || 0) + d3.event.dy, 2);
      window.moveLabelGL(baseId);
    });
    return;
  }
  // …existing SVG drag path unchanged…
}
```

(Keep the existing SVG path for the non-GL case; only add the early GL branch. Verify the exact existing signature in the file and adapt the variable names to match.)

- [ ] **Step 3: Add the migration function**

In `src/renderers/draw-burg-labels.ts`, add:

```ts
/**
 * Convert legacy SVG-baked label positions to burg.labelDx/labelDy before the GPU layer
 * discards the <text> nodes. A label whose x/y differs from its burg anchor by > epsilon
 * is treated as a manual drag and preserved as an override.
 */
function migrateLabelOverrides(): void {
  const EPS = 0.5;
  const nodes = document.querySelectorAll<SVGTextElement>("#burgLabels text[data-id]");
  for (const node of nodes) {
    const id = +node.getAttribute("data-id")!;
    const burg = pack.burgs[id];
    if (!burg) continue;
    const x = parseFloat(node.getAttribute("x") || "");
    const y = parseFloat(node.getAttribute("y") || "");
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    const dx = x - burg.x;
    const dy = y - burg.y;
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) {
      burg.labelDx = Math.round(dx * 100) / 100;
      burg.labelDy = Math.round(dy * 100) / 100;
    }
  }
}
window.migrateLabelOverrides = migrateLabelOverrides;
```

Add to the `declare global` block at the top: `var migrateLabelOverrides: () => void;`

- [ ] **Step 4: Call migration on load**

In `public/modules/io/load.js`, right after `burgLabels = labels.select("#burgLabels");` (line 364), add:

```js
if (window.burgLabelsWebglActive && window.burgLabelsWebglActive() && window.migrateLabelOverrides) window.migrateLabelOverrides();
```

This runs while the loaded SVG `#burgLabels` text nodes still exist, before `drawBurgLabels()` clears them via `createLabelGroups`.

- [ ] **Step 5: Typecheck, build, commit**

Run: `tsc --noEmit && npm run build`
Expected: PASS.

```bash
git add src/renderers/webgl-burg-labels.ts src/renderers/draw-burg-labels.ts public/modules/ui/burg-editor.js public/modules/io/load.js
git commit --no-verify -m "feat(labels): drag-to-reposition + convert-on-load override migration"
```

---

## Task 12: In-browser visual + perf verification

The decisive check. Follow the project's perf-measurement method (CDP :9222, forced reload, console quiesce, **same canvas size** before/after — see the `fmg_browser_perf_measurement` memory). The dev server is the user's own session; do not start/stop it.

**Files:** none (verification + tuning only).

- [ ] **Step 1: Generate a large map and confirm labels render**

Open the running dev build, generate a high-density map (≥50K burgs, e.g. the volcano-500K preset path), enable the Labels layer, and confirm:
- Burg names appear as crisp GPU text above the burg icons.
- DOM has ~0 `<text>` under `#burgLabels` (verify: `document.querySelectorAll('#burgLabels text').length` ≈ 0).
- Zooming in/out rescales text smoothly; min-zoom bands hide minor labels at low zoom; overlapping labels collide-cull (lower-priority hidden).

- [ ] **Step 2: Tune crispness/halo if needed**

If text is blurry or halos are wrong, adjust in `sdf-glyph-atlas.ts` (`FONT_PX`, `PAD`/`SPREAD`) and the `uHaloEdge` mapping in `webgl-burg-labels.ts`. Re-`npm run build`, reload, re-check. Commit any tuning:

```bash
git add src/renderers/sdf-glyph-atlas.ts src/renderers/webgl-burg-labels.ts
git commit --no-verify -m "fix(labels): tune SDF crispness/halo from in-browser verification"
```

- [ ] **Step 3: Measure zoom frame time vs baseline**

Using the `perfdata/` CDP scripts, measure mean zoom frame time at ~67K burgs with the GPU label layer ON, at the **same canvas size** as the ~500 ms/frame baseline in the brief. Record the number.
Expected: the burg-label layer no longer dominates the frame (target: frame time a large fraction lower than ~500 ms; the label layer should drop off the profile's top costs).

- [ ] **Step 4: Click + drag editing**

- Click a burg label → `editBurg` opens for the right burg (routed via `LayerHost.hitTestTopDown`).
- Drag a label → it moves, `pack.burgs[id].labelDx/labelDy` update, position persists across a save/reload (whole-object `JSON.stringify(pack.burgs)`).
- Load a pre-existing map that had a hand-dragged label → the offset is preserved (migration).

- [ ] **Step 5: Record results**

Note the measured before/after frame times and any tuning in the commit message / a short update to `MEMORY.md`'s active-work section. No code commit required if Steps 2 produced none.

---

## Task 13: Full test + typecheck sweep

**Files:** none (gate).

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: PASS — all renderer tests including the new `label-layout`, `label-visibility`, `sdf-glyph-atlas`, `label-instances`, `webgl-burg-labels`, and existing `burg-instances` / `layer-host` suites.

- [ ] **Step 2: Typecheck**

Run: `tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Final commit (if any stragglers)**

```bash
git status   # confirm only intended files changed
git add <explicit paths>
git commit --no-verify -m "test(labels): green unit + typecheck sweep for GPU labels"
```

---

## Self-review notes (coverage vs spec)

- **SDF foundation / runtime canvas atlas** → Tasks 4–5 (`collectGlyphs`, EDT, `buildGlyphAtlas`).
- **Parity placement + GPU collision** → Task 3 (`selectVisibleLabels`: min-zoom + 6–60px band + viewport + greedy collision by group `order`, population tiebreak).
- **Per-group fill/halo/size in shader** → Task 8 (`readGroupStyles`, per-group uniforms, SDF two-threshold frag).
- **Click-to-edit + drag** → Task 8 `hitTest` (routes via existing `LayerHost.hitTestTopDown`) + Task 11 (`moveLabelGL`, drag handler, `labelDx/labelDy`).
- **Convert-on-load migration** → Task 11 (`migrateLabelOverrides`).
- **Retire SVG labels + deferred rescale** → Task 10.
- **Interleave above icons / below overlay** → Task 7 (`positionLabelCanvas` + reconcile).
- **Save format additive** → Task 1 (`labelDx/labelDy`, serialized free via `JSON.stringify(pack.burgs)`).
- **Transform-gated rebuild** → Task 8 (`lastKey`). **Active-gesture LOD** is left as the natural place to extend `drawBurgLabelGL` if Task 12 perf shows collision-per-frame is too costly; not built by default per the spec.

**Known tuning risks (resolved in Task 12, not by guesswork now):** exact glyph baseline/ascent (`baselineYEm = 0.8` approximation), SDF spread vs crispness, single-atlas-font assumption (groups with differing fonts share one atlas in v1 — acceptable; multi-font atlas is a follow-up if needed).
