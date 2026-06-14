# WebGL Burg-Icon Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render burg icons (~80K) on a GPU-composited stacked `<canvas>` instead of ~80K SVG `<use>` nodes, so pan/zoom no longer repaint them and the ~1.5GB of burg DOM is eliminated — while preserving click-to-edit, hover-tooltip, and relocate.

## STATUS: COMPLETE (2026-06-14) — branch `feat/webgl-burg-icons`, unmerged

All phases A–C implemented and verified in-browser; 11 commits. Full vitest suite 175 passing
(+5 new burg-instances tests); the 2 failures are pre-existing trade-network WIP, unrelated.

- **Phase A (render):** stacked canvas → per-group texture atlas (handles circle/triangle/cross/
  square/diamond + custom symbols) → instanced WebGL2 renderer, GPU min-zoom culled, transform-
  synced via `window.getMapTransform()`. A/B on a 24.5K-burg map: burg `<use>` nodes **24506→0**,
  PAN **1516→688ms (−55%)**, ZOOM **4584→1585ms (−65%)**. Scales with burg count + reclaims ~1.5GB RAM.
- **Phase B (interactivity):** d3-quadtree hit-test (tested) augments the existing viewbox handlers
  (`clicked`, `showMapTooltip`, relocate) — canvas stays `pointer-events:none`. Click-to-edit,
  hover tooltip, relocate all verified to target the correct burg.
- **Phase C (lifecycle/default):** toggle/add/remove/restyle/save-load wired (single-burg ops
  rebuild the whole GL layer — fine for occasional edits); **auto-default ON above 5000 burgs**;
  Options → "GPU burgs" select (Auto/On/Off, persisted). SVG renderer is the fallback for any value.

Key correction from the spec: burg icons are varied shapes with styles on the live `<g>` attrs, so
a **per-group atlas** replaced the spec's "in-shader circles". Renderers: `src/renderers/
webgl-burg-icons.ts`, `webgl-burg-atlas.ts`, `burg-instances.ts` (+ `.test.ts`).

Deferred (not blocking): anchors still SVG (~6K, culled); single-burg buffer-patching instead of
full rebuild; opacity not baked into atlas tiles; the quality-bracket (from the levers work) as a
size-gated option.

---


**Architecture:** A WebGL2 canvas (`#burgIconsGL`) is stacked over the SVG `#map`, sized to the viewport, `pointer-events:none`. Each burg group's symbol (circle/triangle/cross/square/custom, with its fill+stroke) is baked once into a tile of a **texture atlas**; each burg is one **instanced textured quad** (position in map coords, size, atlas tile index, minZoom). A uniform carries the same `scale`/`viewX`/`viewY` as the viewbox transform, updated each frame in `zoomRaf` — so pan/zoom is a uniform update + one instanced draw, no SVG repaint. Because the canvas is `pointer-events:none`, interactivity is added by **augmenting the existing viewbox event handlers** (`clicked()`, `showMapTooltip()`, `relocateBurgOnClick()`) with a CPU **d3-quadtree** burg hit-test when WebGL mode is active. The whole feature is behind a flag with the existing SVG renderer as fallback.

**Tech Stack:** Raw WebGL2 (no three.js — three is `import type` only / not bundled; a 2D instanced layer doesn't need a scene graph), TypeScript renderers in `src/renderers/`, d3-quadtree (already a dep), vitest for pure units, the `perfdata/` CDP harness for in-browser perf/correctness.

**Design provenance:** supersedes the "in-shader circles, no atlas" assumption in `docs/superpowers/specs/2026-06-13-webgl-burg-icons-design.md` — exploration found burg groups use varied symbols (circle/triangle/cross/square + user-customizable) with styles read from the live `<g>` attributes, so a per-group atlas is used. Canvas integration is the spec's approved "stacked HTML canvas overlay".

**Key facts from exploration (file:line):**
- Burg icon = `<use href="#icon-X" x y id="burg{i}" data-id="{i}">` in `#burgIcons > g#{group}`; built by `src/renderers/draw-burg-icons.ts:26`.
- Group symbol via `g.dataset.icon` / the use `href`; styles (`fill`,`stroke`,`stroke-width`,`opacity`) are **live `<g>` attributes**; icon render radius = group computed `font-size` / 2 (symbol `#icon-circle` is `viewBox="0 0 10 10"` `width="1em"`, `<circle cx=0 cy=0 r=5>`), `index.html:8026`.
- Click: viewbox delegation `clicked()` `public/modules/ui/editors.js:28` → `editBurg(id)` `public/modules/ui/burg-editor.js:8` (reads `data-id`; **accepts an explicit id**).
- Hover: `showMapTooltip()` `public/modules/ui/general.js:178` keys off `subgroup === "burgIcons"`.
- Relocate (no drag; click-to-place): `relocateBurgOnClick()` `public/modules/ui/burg-editor.js:418` uses `d3.mouse(viewbox)`; updates `burgIcons.select('#burg'+id).attr('x','y')` + `burg.x/y` (`:438`,`:454`).
- Toggle: `toggleBurgIcons()` `public/modules/ui/layers.js:929` → `drawBurgIcons()`; off-path does `icons.selectAll("circle, use").remove()`.
- Stacked canvas precedent: `#canvas` is `position:absolute; pointer-events:none` (`public/index.css:83`) and is transform-synced via `ctx.setTransform(scale,0,0,scale,viewX,viewY)` in `zoomRaf` (`public/main.js`).
- Screen→map: `d3.mouse(viewbox)` returns map coords directly.
- Global transform vars: `scale`, `viewX`, `viewY` in `public/main.js`.

**Verification reality:** GL context, atlas raster, and DOM integration cannot be unit-tested meaningfully; they are verified in-browser via the `perfdata/` CDP harness + visual checks. The **pure** units (instance-buffer builder, quadtree hit-test) ARE unit-tested with vitest. Do not fabricate unit tests for GL/DOM code.

---

## File Structure

- Create `src/renderers/webgl-burg-icons.ts` — the WebGL2 renderer: context + program + shaders, atlas build, instance-buffer build, transform-synced draw, lifecycle (init/destroy/rebuild). Exposes a small global API.
- Create `src/renderers/webgl-burg-atlas.ts` — builds the per-group texture atlas from the live SVG symbols/styles (SVG→Image→2D canvas tiles) and returns tile UV rects + per-group render size.
- Create `src/renderers/burg-instances.ts` — **pure** functions: build the instance Float32Array from burgs + per-group {tileIndex, size, minZoom}; and the burg quadtree + `hitTestBurg`. (Pure = unit-tested.)
- Create `src/renderers/burg-instances.test.ts` — vitest for the pure functions.
- Modify `public/main.js` — create `#burgIconsGL` canvas; in `zoomRaf` update the GL uniform on transform; resize hook.
- Modify `public/index.css` — `#burgIconsGL` positioning.
- Modify `src/renderers/draw-burg-icons.ts` — branch WebGL vs SVG; route `drawBurgIcon`/`removeBurgIcon` to the active renderer.
- Modify `public/modules/ui/layers.js` — `toggleBurgIcons` branch + flag option.
- Modify `public/modules/ui/editors.js` — `clicked()` burg hit-test when GL active.
- Modify `public/modules/ui/general.js` — `showMapTooltip()` burg hit-test when GL active.
- Modify `public/modules/ui/burg-editor.js` — `relocateBurgOnClick` updates the GL instance.

Flag: `window.webglBurgs` (boolean), default decided in Phase C. A single helper `burgWebglActive()` (in webgl-burg-icons.ts, exposed on window) returns `window.webglBurgs && layerIsOn("toggleBurgIcons") && pack.burgs.length > 1`.

---

## Phase A — Atlas + render (flag default OFF; zero behavior change until flipped)

### Task A0: Branch

- [ ] **Step 1:** `git checkout main && git pull && git checkout -b feat/webgl-burg-icons`
  Expected: new branch off current main (`b8d15ee4` or later).

### Task A1: Stacked canvas element + flag plumbing

**Files:** Modify `public/main.js`, `public/index.css`.

- [ ] **Step 1: CSS for the GL canvas** — add to `public/index.css` after the `#canvas` block (`:86`):

```css
#burgIconsGL {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
```

- [ ] **Step 2: Create + size the canvas in main.js.** After the `#canvas`/`svgWidth` setup (near `let svgWidth = graphWidth;`), add:

```js
// WebGL burg-icon canvas (stacked over the SVG, transform-synced in zoomRaf).
window.webglBurgs = JSON.safeParse(localStorage.getItem("webglBurgs")) ?? false;
function ensureBurgGLCanvas() {
  let c = document.getElementById("burgIconsGL");
  if (!c) {
    c = document.createElement("canvas");
    c.id = "burgIconsGL";
    document.getElementById("map").after(c); // sibling of the SVG, stacked above
  }
  // size in device pixels to the on-screen map rect
  const rect = document.getElementById("map").getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.style.width = rect.width + "px";
  c.style.height = rect.height + "px";
  c.width = Math.round(rect.width * dpr);
  c.height = Math.round(rect.height * dpr);
  return c;
}
window.ensureBurgGLCanvas = ensureBurgGLCanvas;
```

- [ ] **Step 3: Syntax check.** `node --check public/main.js` → "syntax OK".

- [ ] **Step 4: Browser check.** Reload `localhost:5173`; in console: `ensureBurgGLCanvas()` then `getComputedStyle(burgIconsGL).position` → `"absolute"`, and the canvas overlaps the map with no visual change (transparent, pointer-events none). No console errors; panning still works.

- [ ] **Step 5: Commit.** `git add public/main.js public/index.css && git commit -m "feat(webgl-burgs): stacked GL canvas element + flag"`

### Task A2: Instance-buffer builder (PURE — unit tested)

**Files:** Create `src/renderers/burg-instances.ts`, `src/renderers/burg-instances.test.ts`.

- [ ] **Step 1: Write the failing test** (`src/renderers/burg-instances.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { buildBurgInstances, type GroupRender } from "./burg-instances";

const groups: Record<string, GroupRender> = {
  city:   { tileIndex: 0, size: 4, minZoom: 4 },
  hamlet: { tileIndex: 1, size: 2, minZoom: 14 },
};

describe("buildBurgInstances", () => {
  it("packs x,y,size,tileIndex,minZoom per non-removed burg, skipping burg[0] and removed", () => {
    const burgs = [
      {},                                            // index 0 placeholder
      { i: 1, x: 10, y: 20, group: "city" },
      { i: 2, x: 30, y: 40, group: "hamlet", removed: true },
      { i: 3, x: 50, y: 60, group: "hamlet" },
    ] as any;
    const { data, count, ids } = buildBurgInstances(burgs, groups);
    expect(count).toBe(2);                           // burg 1 and 3
    expect(ids).toEqual([1, 3]);
    // stride 5: x,y,size,tileIndex,minZoom
    expect(Array.from(data.slice(0, 5))).toEqual([10, 20, 4, 0, 4]);
    expect(Array.from(data.slice(5, 10))).toEqual([50, 60, 2, 1, 14]);
  });

  it("falls back to a default group render when a burg's group is unknown", () => {
    const burgs = [{}, { i: 1, x: 1, y: 2, group: "mystery" }] as any;
    const { data, count } = buildBurgInstances(burgs, groups, { tileIndex: 7, size: 3, minZoom: 0 });
    expect(count).toBe(1);
    expect(Array.from(data.slice(0, 5))).toEqual([1, 2, 3, 7, 0]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails.** `npx vitest run src/renderers/burg-instances.test.ts` → FAIL ("buildBurgInstances is not a function" / module not found).

- [ ] **Step 3: Implement** (`src/renderers/burg-instances.ts`):

```ts
import type { Burg } from "../modules/burgs-generator";

export interface GroupRender {
  tileIndex: number; // atlas tile for this group's baked symbol
  size: number;      // rendered icon diameter in map units (group font-size)
  minZoom: number;   // BURG_MIN_ZOOM for this group (GPU cull threshold)
}

export const INSTANCE_STRIDE = 5; // x, y, size, tileIndex, minZoom

export function buildBurgInstances(
  burgs: Burg[],
  groups: Record<string, GroupRender>,
  fallback: GroupRender = { tileIndex: 0, size: 2, minZoom: 0 }
): { data: Float32Array; count: number; ids: number[] } {
  const data = new Float32Array(burgs.length * INSTANCE_STRIDE);
  const ids: number[] = [];
  let n = 0;
  for (const b of burgs) {
    if (!b || !b.i || b.removed) continue; // skip index-0 placeholder + removed
    const g = groups[b.group as string] || fallback;
    const o = n * INSTANCE_STRIDE;
    data[o] = b.x!; data[o + 1] = b.y!; data[o + 2] = g.size;
    data[o + 3] = g.tileIndex; data[o + 4] = g.minZoom;
    ids.push(b.i);
    n++;
  }
  return { data: data.subarray(0, n * INSTANCE_STRIDE), count: n, ids };
}
```

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/renderers/burg-instances.test.ts` → PASS (2 tests).

- [ ] **Step 5: Commit.** `git add src/renderers/burg-instances.ts src/renderers/burg-instances.test.ts && git commit -m "feat(webgl-burgs): pure instance-buffer builder + tests"`

### Task A3: Per-group texture atlas builder

**Files:** Create `src/renderers/webgl-burg-atlas.ts`.

Renders each active burg group's symbol (with its live `<g>` fill/stroke/stroke-width) into a tile of a 2D canvas atlas. Each tile is `TILE`×`TILE` px; the symbol is drawn centered. Returns the atlas canvas, per-group `{tileIndex, uv, size}` where `size` is the group's computed font-size (map-unit diameter), and `tileIndex` row/col → UV rect.

- [ ] **Step 1: Implement** (`src/renderers/webgl-burg-atlas.ts`):

```ts
const TILE = 64;            // px per tile (atlas raster resolution)
const COLS = 8;             // 8x8 = up to 64 group tiles

export interface AtlasTile { tileIndex: number; size: number; } // size = map-unit diameter
export interface BurgAtlas {
  canvas: HTMLCanvasElement;
  tiles: Record<string, AtlasTile>; // by group name
  cols: number; rows: number; tile: number;
}

// Serialize one group's symbol to an <svg> data URL using the live #icon-* symbol
// content + the group's current fill/stroke/stroke-width, sized to fill the tile.
function symbolSVG(symbolId: string, fill: string, stroke: string, strokeWidth: number): string {
  const sym = document.getElementById(symbolId.replace(/^#/, ""));
  const viewBox = sym?.getAttribute("viewBox") || "0 0 10 10";
  const inner = sym?.innerHTML || `<circle cx="0" cy="0" r="5"/>`;
  // viewBox "0 0 10 10" with shapes centered at the origin (e.g. circle cx0 cy0 r5):
  // shift the viewBox to -5..5 so the centered symbol is fully visible.
  const [, , vbw, vbh] = viewBox.split(/\s+/).map(Number);
  const vb = `${-vbw / 2} ${-vbh / 2} ${vbw} ${vbh}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="${vb}">` +
    `<g fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}">${inner}</g></svg>`
  );
}

function loadImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

// Build the atlas for all current #burgIcons groups. Reads live <g> attributes.
export async function buildBurgAtlas(): Promise<BurgAtlas> {
  const groupEls = Array.from(document.querySelectorAll<SVGGElement>("#burgIcons > g"));
  const rows = Math.max(1, Math.ceil(groupEls.length / COLS));
  const canvas = document.createElement("canvas");
  canvas.width = COLS * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext("2d")!;
  const tiles: Record<string, AtlasTile> = {};

  await Promise.all(
    groupEls.map(async (g, idx) => {
      const symbolId = g.dataset.icon || g.querySelector("use")?.getAttribute("href") || "#icon-circle";
      const fill = g.getAttribute("fill") || "#ffffff";
      const stroke = g.getAttribute("stroke") || "#000000";
      const sw = +(g.getAttribute("stroke-width") || 1);
      const fontSize = parseFloat(getComputedStyle(g).fontSize) || 2; // map-unit diameter
      const img = await loadImage(symbolSVG(symbolId, fill, stroke, sw));
      const col = idx % COLS, row = Math.floor(idx / COLS);
      ctx.drawImage(img, col * TILE, row * TILE, TILE, TILE);
      tiles[g.id] = { tileIndex: idx, size: fontSize };
    })
  );

  return { canvas, tiles, cols: COLS, rows, tile: TILE };
}
```

- [ ] **Step 2: Browser check (visual).** With the perf harness page open, in console:
```js
const a = await (await import("/src/renderers/webgl-burg-atlas.ts")).buildBurgAtlas();
document.body.appendChild(a.canvas); a.canvas.style = "position:fixed;top:0;right:0;z-index:9999;background:#888";
console.log(a.tiles);
```
Expected: a small grid of the burg symbols (white circles/triangles/squares with dark stroke) appears top-right; `a.tiles` maps each group id → `{tileIndex, size>0}`. Remove the appended canvas after.

- [ ] **Step 3: Commit.** `git add src/renderers/webgl-burg-atlas.ts && git commit -m "feat(webgl-burgs): per-group texture atlas builder"`

### Task A4: WebGL2 renderer (program, shaders, draw)

**Files:** Create `src/renderers/webgl-burg-icons.ts`.

Instanced unit-quad, textured from the atlas. Vertex shader maps map-coords → clip space with the viewbox transform and culls below `minZoom`; fragment shader samples the atlas tile.

- [ ] **Step 1: Implement the renderer** (`src/renderers/webgl-burg-icons.ts`):

```ts
import { buildBurgAtlas, type BurgAtlas } from "./webgl-burg-atlas";
import { buildBurgInstances, INSTANCE_STRIDE, type GroupRender } from "./burg-instances";
import { buildBurgQuadtree, type BurgQuadtree } from "./burg-instances";

const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;     // unit quad corner 0..1
layout(location=1) in vec2 aPos;        // burg map position
layout(location=2) in float aSize;      // map-unit diameter
layout(location=3) in float aTile;      // atlas tile index
layout(location=4) in float aMinZoom;   // cull threshold
uniform vec2 uTranslate;                // viewX, viewY (screen px)
uniform float uScale;                   // zoom k
uniform vec2 uViewport;                 // canvas device px (w,h)
uniform float uDpr;
uniform float uCols, uTile;             // atlas layout
out vec2 vUV;
out float vCulled;
void main() {
  vCulled = uScale < aMinZoom ? 1.0 : 0.0;
  // map -> screen px: p*scale + translate ; then to device px (*dpr) ; then to clip
  float sizePx = aSize * uScale;        // on-screen diameter
  vec2 centerScreen = aPos * uScale + uTranslate;
  vec2 cornerScreen = centerScreen + (aCorner - 0.5) * sizePx;
  vec2 devicePx = cornerScreen * uDpr;
  vec2 clip = (devicePx / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float col = mod(aTile, uCols);
  float row = floor(aTile / uCols);
  vUV = (vec2(col, row) + aCorner) * uTile;  // pixel coords into atlas (scaled below)
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in float vCulled;
uniform sampler2D uAtlas;
uniform vec2 uAtlasSize;  // px
out vec4 outColor;
void main() {
  if (vCulled > 0.5) discard;
  vec4 c = texture(uAtlas, vUV / uAtlasSize);
  if (c.a < 0.01) discard;
  outColor = c;
}`;

let gl: WebGL2RenderingContext | null = null;
let prog: WebGLProgram, instanceBuf: WebGLBuffer, quadBuf: WebGLBuffer, atlasTex: WebGLTexture;
let atlas: BurgAtlas | null = null;
let instanceCount = 0;
let quadtree: BurgQuadtree | null = null;
let uniforms: Record<string, WebGLUniformLocation | null> = {};

function compile(src: string, type: number): WebGLShader {
  const s = gl!.createShader(type)!;
  gl!.shaderSource(s, src); gl!.compileShader(s);
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS)) throw new Error(gl!.getShaderInfoLog(s) || "shader");
  return s;
}

function groupRenders(): Record<string, GroupRender> {
  // BURG_MIN_ZOOM lives in public/main.js as a literal; mirror the needed keys here.
  const MIN: Record<string, number> = {
    capital: 1, "skyburg-capital": 2, skyburg: 4, "skyburg-mid": 6, "skyburg-small": 8,
    city: 4, town: 6, fort: 7, monastery: 7, caravanserai: 7, trading_post: 7,
    village: 10, hamlet: 14,
  };
  const out: Record<string, GroupRender> = {};
  for (const [name, t] of Object.entries(atlas!.tiles)) {
    out[name] = { tileIndex: t.tileIndex, size: t.size, minZoom: MIN[name] ?? 0 };
  }
  return out;
}

export async function initBurgGL(): Promise<void> {
  const canvas = (window as any).ensureBurgGLCanvas() as HTMLCanvasElement;
  gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true });
  if (!gl) { console.error("WebGL2 unavailable; burg GL disabled"); return; }
  prog = gl.createProgram()!;
  gl.attachShader(prog, compile(VERT, gl.VERTEX_SHADER));
  gl.attachShader(prog, compile(FRAG, gl.FRAGMENT_SHADER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
  for (const u of ["uTranslate","uScale","uViewport","uDpr","uCols","uTile","uAtlas","uAtlasSize"])
    uniforms[u] = gl.getUniformLocation(prog, u);

  quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
  instanceBuf = gl.createBuffer()!;
  atlasTex = gl.createTexture()!;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  await rebuildBurgGL();
}

export async function rebuildBurgGL(): Promise<void> {
  if (!gl) return;
  atlas = await buildBurgAtlas();
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const renders = groupRenders();
  const fallback = Object.values(renders)[0] || { tileIndex: 0, size: 2, minZoom: 0 };
  const { data, count, ids } = buildBurgInstances((window as any).pack.burgs, renders, fallback);
  instanceCount = count;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  quadtree = buildBurgQuadtree((window as any).pack.burgs);
  (window as any).__burgGLids = ids;
  drawBurgGL();
}

export function drawBurgGL(): void {
  if (!gl || !atlas) return;
  const w = (window as any).scale, vx = (window as any).viewX, vy = (window as any).viewY;
  const canvas = gl.canvas as HTMLCanvasElement;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!instanceCount) return;
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  const stride = INSTANCE_STRIDE * 4;
  const attribs: [number, number, number][] = [[1,2,0],[2,1,8],[3,1,12],[4,1,16]];
  for (const [loc, sizeN, off] of attribs) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, sizeN, gl.FLOAT, false, stride, off);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.uniform2f(uniforms.uTranslate!, vx, vy);
  gl.uniform1f(uniforms.uScale!, w);
  gl.uniform2f(uniforms.uViewport!, canvas.width, canvas.height);
  gl.uniform1f(uniforms.uDpr!, window.devicePixelRatio || 1);
  gl.uniform1f(uniforms.uCols!, atlas.cols);
  gl.uniform1f(uniforms.uTile!, atlas.tile);
  gl.uniform2f(uniforms.uAtlasSize!, atlas.canvas.width, atlas.canvas.height);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.uniform1i(uniforms.uAtlas!, 0);

  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
}

export function resizeBurgGL(): void {
  if (!gl) return;
  (window as any).ensureBurgGLCanvas();
  drawBurgGL();
}

export function destroyBurgGL(): void {
  const c = document.getElementById("burgIconsGL") as HTMLCanvasElement | null;
  if (gl && c) gl.clear(gl.COLOR_BUFFER_BIT);
  gl = null; atlas = null; instanceCount = 0; quadtree = null;
}

export function burgWebglActive(): boolean {
  return !!(window as any).webglBurgs && (window as any).layerIsOn?.("toggleBurgIcons") &&
    (window as any).pack?.burgs?.length > 1;
}

export function getBurgQuadtree(): BurgQuadtree | null { return quadtree; }

declare global {
  var initBurgGL: () => Promise<void>;
  var rebuildBurgGL: () => Promise<void>;
  var drawBurgGL: () => void;
  var resizeBurgGL: () => void;
  var destroyBurgGL: () => void;
  var burgWebglActive: () => boolean;
}
Object.assign(window, { initBurgGL, rebuildBurgGL, drawBurgGL, resizeBurgGL, destroyBurgGL, burgWebglActive });
```

(Quadtree functions `buildBurgQuadtree`/`BurgQuadtree` are added to `burg-instances.ts` in Task B1; until then, comment out the two quadtree lines in `rebuildBurgGL` and the import to let A4 compile/render. Re-enable in B1.)

- [ ] **Step 2: Temporarily stub quadtree** so Phase A renders before Phase B exists: in `rebuildBurgGL` comment out the `quadtree = buildBurgQuadtree(...)` line and the `buildBurgQuadtree` import; leave `getBurgQuadtree` returning null.

- [ ] **Step 3: Type-check.** `npx tsc --noEmit` → no new errors in these files.

- [ ] **Step 4: Browser render check.** Reload; in console: `window.webglBurgs = true; await initBurgGL();` then a burg layer should render on the GL canvas. Compare against the SVG icons (still visible underneath): GL circles/shapes sit exactly on the burg positions, same sizes/colors. Pan/zoom: call `drawBurgGL()` after a manual `scale`/`viewX` change to confirm the transform maps correctly. Note mismatches.

- [ ] **Step 5: Commit.** `git add src/renderers/webgl-burg-icons.ts && git commit -m "feat(webgl-burgs): WebGL2 instanced atlas renderer + transform-synced draw"`

### Task A5: Wire transform-sync + hide SVG icons when GL active; measure

**Files:** Modify `public/main.js`, `src/renderers/draw-burg-icons.ts`.

- [ ] **Step 1: Drive GL from zoomRaf.** In `public/main.js` `zoomRaf`'s RAF callback, after `viewbox.attr("transform", ...)`, add:

```js
    if (window.burgWebglActive && window.burgWebglActive()) window.drawBurgGL();
```

- [ ] **Step 2: Resize hook.** Where the window-resize handler updates `svgWidth`/`svgHeight` (search `window.addEventListener("resize"` / `changeMapSize`), add `window.resizeBurgGL && window.resizeBurgGL();`.

- [ ] **Step 3: Branch the SVG renderer.** In `src/renderers/draw-burg-icons.ts` `burgIconsRenderer()`, at the top:

```ts
  if ((window as any).burgWebglActive?.()) {
    (window as any).initBurgGL ? (window as any).rebuildBurgGL() : (window as any).initBurgGL();
    // ensure the SVG groups are empty so nothing double-renders
    document.querySelectorAll("#burgIcons > g").forEach(g => (g.innerHTML = ""));
    return;
  }
```
(Keep the existing SVG path below for when the flag is off.)

- [ ] **Step 4: Browser measure.** Use `perfdata/ab-levers.mjs` pattern (or a new `perfdata/measure-burggl.mjs`): regenerate a heavy map, set `window.webglBurgs=true`, `drawBurgIcons()`, then pan/zoom and capture Task/Paint + frame times. Compare to flag-off (SVG). Expected: with GL on, pan/zoom paint drops markedly (burg nodes gone from SVG) and burg DOM node count falls to ~0. Record numbers.

- [ ] **Step 5: Commit.** `git add public/main.js src/renderers/draw-burg-icons.ts && git commit -m "feat(webgl-burgs): transform-sync in zoomRaf + SVG fallback branch"`

---

## Phase B — Interactivity (augment existing handlers; flag still gates)

### Task B1: Burg quadtree + hit-test (PURE — unit tested)

**Files:** Modify `src/renderers/burg-instances.ts` and `src/renderers/burg-instances.test.ts`.

- [ ] **Step 1: Write failing tests** (append to `burg-instances.test.ts`):

```ts
import { buildBurgQuadtree, hitTestBurg } from "./burg-instances";

describe("burg hit-test", () => {
  const burgs = [{}, { i: 1, x: 100, y: 100, group: "city" }, { i: 2, x: 300, y: 300, group: "hamlet" }] as any;
  const sizes = { city: 4, hamlet: 2 } as Record<string, number>;
  const qt = buildBurgQuadtree(burgs);
  it("returns the burg under the cursor within its on-screen radius", () => {
    // at scale 10, city radius = size/2 * ... hit tolerance handled in map units
    expect(hitTestBurg(qt, 101, 101, 10, sizes)).toBe(1);
  });
  it("returns null when the cursor is far from any burg", () => {
    expect(hitTestBurg(qt, 5000, 5000, 10, sizes)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail.** `npx vitest run src/renderers/burg-instances.test.ts` → new tests FAIL.

- [ ] **Step 3: Implement** (append to `burg-instances.ts`):

```ts
import { quadtree, type Quadtree } from "d3-quadtree";

export type BurgQuadtree = Quadtree<Burg>;

export function buildBurgQuadtree(burgs: Burg[]): BurgQuadtree {
  return quadtree<Burg>()
    .x(b => b.x!)
    .y(b => b.y!)
    .addAll(burgs.filter(b => b && b.i && !b.removed));
}

// hitX/hitY in MAP coords; tolerance = max(icon radius in map units, a min screen-px radius / scale)
export function hitTestBurg(
  qt: BurgQuadtree, hitX: number, hitY: number, scale: number, sizeByGroup: Record<string, number>
): number | null {
  const minScreenPx = 6; // always allow a 6px tap target
  const found = qt.find(hitX, hitY, 1e9);
  if (!found || found.i == null) return null;
  const rMap = Math.max((sizeByGroup[found.group as string] || 2) / 2, minScreenPx / Math.max(scale, 0.0001));
  const dx = found.x! - hitX, dy = found.y! - hitY;
  return dx * dx + dy * dy <= rMap * rMap ? found.i : null;
}
```

- [ ] **Step 4: Run tests, verify pass.** `npx vitest run src/renderers/burg-instances.test.ts` → all PASS.

- [ ] **Step 5: Re-enable the quadtree in the renderer** (Task A4 Step 2 stub): uncomment the `buildBurgQuadtree` import and the `quadtree = buildBurgQuadtree(...)` line in `rebuildBurgGL`; make `getBurgQuadtree` return it. Also expose a `sizeByGroup` map (from `atlas.tiles`) via `getBurgSizes()` for hit-testing.

```ts
export function getBurgSizes(): Record<string, number> {
  const out: Record<string, number> = {};
  if (atlas) for (const [name, t] of Object.entries(atlas.tiles)) out[name] = t.size;
  return out;
}
```
Add `getBurgSizes` to the window assign + `declare global`.

- [ ] **Step 6: Commit.** `git add src/renderers/burg-instances.ts src/renderers/burg-instances.test.ts src/renderers/webgl-burg-icons.ts && git commit -m "feat(webgl-burgs): burg quadtree + hit-test (tested), wired into renderer"`

### Task B2: Click-to-edit via hit-test

**Files:** Modify `public/modules/ui/editors.js` (`clicked()`).

- [ ] **Step 1: Add a burg hit-test branch.** In `clicked()` (around `:15`), before the existing element-walk logic, add:

```js
  if (window.burgWebglActive && window.burgWebglActive()) {
    const [mx, my] = d3.mouse(ensureEl("viewbox"));
    const qt = window.getBurgQuadtree && window.getBurgQuadtree();
    if (qt) {
      const id = window.hitTestBurg(qt, mx, my, scale, window.getBurgSizes());
      if (id) return editBurg(id);
    }
  }
```
(Expose `hitTestBurg`, `getBurgQuadtree`, `getBurgSizes` on window — already done in B1/A4.)

- [ ] **Step 2: Browser check.** With `webglBurgs=true` and a map drawn: click a GL burg dot → the Burg editor opens for the correct burg (verify name matches the dot's location). Clicking empty land does the normal thing. No regressions with the flag off.

- [ ] **Step 3: Commit.** `git add public/modules/ui/editors.js && git commit -m "feat(webgl-burgs): click-to-edit burgs via quadtree hit-test"`

### Task B3: Hover tooltip via hit-test

**Files:** Modify `public/modules/ui/general.js` (`showMapTooltip()`).

- [ ] **Step 1: Add a hover branch.** In `showMapTooltip()` (around `:178`), early, add:

```js
  if (window.burgWebglActive && window.burgWebglActive()) {
    const [mx, my] = d3.mouse(ensureEl("viewbox"));
    const qt = window.getBurgQuadtree && window.getBurgQuadtree();
    const id = qt && window.hitTestBurg(qt, mx, my, scale, window.getBurgSizes());
    if (id) {
      const b = pack.burgs[id];
      tip(`${b.name}. ${b.group || ""}. Population: ${si(b.population * populationRate * urbanization)}. Click to edit`);
      return;
    }
  }
```
(Mirrors the existing burg tooltip text/format; reuse the same `si()/populationRate` expression already used nearby in this function.)

- [ ] **Step 2: Browser check.** Hover a GL burg dot → tooltip shows the burg name/population; moving off clears it. Cursor over land behaves normally.

- [ ] **Step 3: Commit.** `git add public/modules/ui/general.js && git commit -m "feat(webgl-burgs): hover tooltip for GL burgs via hit-test"`

### Task B4: Relocate updates the GL instance

**Files:** Modify `public/modules/ui/burg-editor.js` (`relocateBurgOnClick`).

- [ ] **Step 1: Update instance on relocate.** In `relocateBurgOnClick` after `burg.x = x; burg.y = y;` (`:454`), add:

```js
    if (window.burgWebglActive && window.burgWebglActive()) window.moveBurgGL(id, x, y);
```

- [ ] **Step 2: Implement `moveBurgGL`** in `webgl-burg-icons.ts` (updates the one instance's x,y in the buffer + the quadtree, then redraws):

```ts
export function moveBurgGL(id: number, x: number, y: number): void {
  if (!gl) return;
  const ids: number[] = (window as any).__burgGLids || [];
  const idx = ids.indexOf(id);
  if (idx < 0) return;
  const o = idx * INSTANCE_STRIDE;
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, o * 4, new Float32Array([x, y]));
  if (quadtree) { const b = (window as any).pack.burgs[id]; quadtree.remove(b); b.x = x; b.y = y; quadtree.add(b); }
  drawBurgGL();
}
```
Add `moveBurgGL` to window assign + `declare global`.

- [ ] **Step 3: Browser check.** Open a burg editor, use "Relocate", click a new spot → the GL dot moves there and clicking the new location selects it (quadtree updated).

- [ ] **Step 4: Commit.** `git add public/modules/ui/burg-editor.js src/renderers/webgl-burg-icons.ts && git commit -m "feat(webgl-burgs): relocate updates GL instance + quadtree"`

---

## Phase C — Integration, lifecycle & default

### Task C1: Toggle, add/remove single burg, restyle, save/load

**Files:** Modify `public/modules/ui/layers.js` (`toggleBurgIcons`), `src/renderers/draw-burg-icons.ts` (`drawBurgIcon`/`removeBurgIcon`).

- [ ] **Step 1: Toggle branch.** In `toggleBurgIcons` (`:929`), when turning ON and `window.webglBurgs`, call the GL path (`drawBurgIcons()` already branches via Task A5); when turning OFF, also clear the GL canvas: replace the off-path so it additionally does `if (window.webglBurgs) window.destroyBurgGL();`.

- [ ] **Step 2: Single-burg add/remove.** In `draw-burg-icons.ts`, `drawBurgIconRenderer(burg)` and `removeBurgIconRenderer(id)`: when `burgWebglActive()`, call `window.rebuildBurgGL()` (simple + correct; single-burg buffer patching is a later optimization). Keep SVG path otherwise.

- [ ] **Step 3: Restyle re-bakes the atlas.** Find where group styles change (style editor apply for `burgIcons`, search `editStyle("burgIcons")` / the style-apply path) and call `window.burgWebglActive() && window.rebuildBurgGL()` after styles apply. (Atlas reads live `<g>` attrs, so a rebuild re-bakes tiles.)

- [ ] **Step 4: Save/load.** Rendering is derived from `pack.burgs`; no save-format change. Confirm the load path calls `drawBurgIcons()` (it does via `drawLayers`) so GL rebuilds on load. Add a browser check after loading a `.map`.

- [ ] **Step 5: Browser checks.** Toggle burg icons off/on; create a new burg (add-burg tool); delete a burg; change burg-icon group style (color/size); save then reload the map. Each reflects on the GL canvas correctly.

- [ ] **Step 6: Commit.** `git add -A && git commit -m "feat(webgl-burgs): toggle/add/remove/restyle/save-load lifecycle"`

### Task C2: Flag default, option UI, final verification

**Files:** Modify `public/modules/ui/layers.js` or the Options UI for the flag; `public/main.js` default.

- [ ] **Step 1: Default + persistence.** Set `window.webglBurgs` default to `true` when `pack.burgs.length > 5000`, else keep SVG; persist the user's explicit choice to `localStorage("webglBurgs")`. Add an Options checkbox "GPU burg rendering" that flips it and calls `drawBurgIcons()` + `destroyBurgGL()` as appropriate.

- [ ] **Step 2: Editing-mode fallback.** When a tool that needs per-burg DOM is active (none found besides relocate, which is handled), no extra work. Document that the SVG fallback is one flag flip away.

- [ ] **Step 3: Final measure (heavy map).** `perfdata/measure-burggl.mjs`: regenerate a heavy map, measure pan/zoom with GL on vs off; record burg DOM node count (≈0 with GL) and browser RAM. Confirm the paint/RAM win.

- [ ] **Step 4: Regression sweep.** Click/hover/relocate/add/delete/restyle/save-load/toggle, with GL on and off; no console errors; SVG fallback visually matches.

- [ ] **Step 5: Cleanup + commit.** Remove scratch perfdata scripts; `git add -A && git commit -m "feat(webgl-burgs): flag default + option UI; final verification"`.

- [ ] **Step 6: Finish the branch.** Use superpowers:finishing-a-development-branch.

---

## Self-Review

- **Spec coverage:** stacked canvas (A1), atlas render (A2–A4, replaces "in-shader circles" after the multi-shape finding), transform-sync (A5), quadtree hit-test for click/hover/relocate (B1–B4), flag+SVG fallback (A5/C2), lifecycle/save-load (C1), anchors deferred (noted, still SVG). ✓
- **Placeholder scan:** GL/atlas/integration code is complete; the only deferred optimization (single-burg buffer patching → full rebuild in C1) is explicit, not a placeholder. ✓
- **Type/name consistency:** `INSTANCE_STRIDE`, `buildBurgInstances`, `GroupRender`, `buildBurgAtlas`/`BurgAtlas`/`tiles`, `buildBurgQuadtree`/`BurgQuadtree`/`hitTestBurg`, `initBurgGL`/`rebuildBurgGL`/`drawBurgGL`/`resizeBurgGL`/`destroyBurgGL`/`moveBurgGL`/`burgWebglActive`/`getBurgQuadtree`/`getBurgSizes` — defined once and referenced consistently across renderer + integration tasks. The A4→B1 quadtree stub/re-enable is called out explicitly. ✓
- **Testing honesty:** vitest only for the pure units (instance builder, quadtree hit-test); GL/atlas/DOM verified in-browser. ✓
- **Risk note:** atlas tiles are raster (slightly soft at extreme zoom — acceptable for small icons); custom non-geometric group symbols are handled by the SVG→Image bake; if a group's symbol fails to load, that tile is blank — add a fallback to `#icon-circle` during implementation if observed.
