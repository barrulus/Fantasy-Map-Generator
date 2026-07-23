import { type Quadtree, quadtree } from "d3-quadtree";
import type { Burg } from "../generators/burgs-generator";
import { GLYPH_STRIDE, packGlyphQuads } from "./label-instances";
import { type FontGeometry, type GlyphMetric, layoutLabel } from "./label-layout";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";
import { getStateLabelObstacles, hashObstacles, type Rect } from "./labeling/label-collision";
import { effectiveLabelPx } from "./labeling/label-sizing";
import { type GroupStyle, readBurgLabelStyles } from "./labeling/label-style";
import { registerLayer } from "./layer-host";
import { buildGlyphAtlas, collectGlyphs, type GlyphAtlas } from "./sdf-glyph-atlas";

/**
 * Per-burg label box (pure): anchor incl. override, plus half-extents in em.
 *
 * Extents are em-relative rather than map units because the drawn size is clamped per tier, so a
 * label's on-screen box is not simply its authored size times the zoom.
 */
export function buildLabelBoxes(
  burgs: Burg[],
  styles: Record<string, GroupStyle>,
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
    out.push({
      id: b.i,
      x: b.x! + (b.labelDx || 0),
      y: b.y! + (b.labelDy || 0),
      order: s.rank,
      population: b.population || 0,
      halfWEm: adv / 2 + geom.originXEm,
      halfHEm: geom.cellEm / 2,
      d: s.fontSize,
      minZoom: s.minZoom,
      startPx: s.startPx,
      restPx: s.restPx,
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
let styles: Record<string, GroupStyle> = {};
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

export function hexToRgb(color: string): [number, number, number] {
  const c = (color || "").trim();
  const six = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (six) return [parseInt(six[1], 16) / 255, parseInt(six[2], 16) / 255, parseInt(six[3], 16) / 255];
  const three = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (three)
    return [
      parseInt(three[1] + three[1], 16) / 255,
      parseInt(three[2] + three[2], 16) / 255,
      parseInt(three[3] + three[3], 16) / 255
    ];
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (rgb) return [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255];
  return [0, 0, 0];
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
  styles = readBurgLabelStyles();
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
  const hideGate = (window as any).hideLabels?.checked !== false;
  const rescaleGate = (window as any).rescaleLabels?.checked !== false;

  // Surviving state labels published by public/main.js's #states branch, in SCREEN coordinates
  // (getBoundingClientRect space — real page pixels). Reproject into this canvas's own local CSS
  // pixel frame (top-left = 0,0) so they line up with the box coordinates `selectVisibleLabels`
  // computes internally (map units * scale + translate). The canvas is sized/positioned to
  // exactly track #map (see ensureBurgLabelGLCanvas in main.js), so a single rect subtraction is
  // enough — no extra viewBox scale factor.
  const rawObstacles = getStateLabelObstacles();
  const canvasRect = rawObstacles.length ? canvas.getBoundingClientRect() : null;
  const obstacles: Rect[] = canvasRect
    ? rawObstacles.map(o => ({
        left: o.left - canvasRect.left,
        top: o.top - canvasRect.top,
        right: o.right - canvasRect.left,
        bottom: o.bottom - canvasRect.top
      }))
    : [];

  // Obstacles can change (state labels re-collide) without the transform changing, so the cache
  // key must fold in a cheap fingerprint of the obstacle set — otherwise burgs would only
  // re-avoid state labels on the next pan/zoom instead of as soon as the states pass settles.
  const key = `${t.scale.toFixed(4)}|${vp.x0.toFixed(1)}|${vp.y0.toFixed(1)}|${hideGate}|${rescaleGate}|${hashObstacles(obstacles)}`;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!boxes.length) return;
  gl.useProgram(prog);

  // transform-gated: only recompute visibility/instances when the view key changes
  if (key !== lastKey) {
    lastKey = key;
    const visible = selectVisibleLabels(boxes, t.scale, vp, {
      hideLabels: hideGate,
      rescale: rescaleGate,
      obstacles,
      translate: { x: t.viewX, y: t.viewY }
    });
    (drawBurgLabelGL as any)._ranges = buildGroupRanges(new Map(visible.map(v => [v.id, v.px])), t.scale);
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
    gl.uniform1f(uniforms.uHaloEdge!, 0.5 - Math.min(0.45, (s?.haloWidth ?? 0.5) / 8));
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

/**
 * Lay out the surviving labels into per-group glyph quads.
 *
 * The shader still works in map units in this phase, so the clamped on-screen size is converted
 * back with px/scale. Moving the quads into screen space is phase 2.
 */
function buildGroupRanges(visible: Map<number, number>, scale: number): { group: string; data: Float32Array }[] {
  if (!atlas) return [];
  const byGroup: Record<string, number[]> = {};
  for (const b of boxes) {
    const px = visible.get(b.id);
    if (px === undefined) continue;
    const mapUnits = scale > 0 ? px / scale : b.d;
    const laid = layoutLabel(b.name, atlas.metrics, atlas.geom, mapUnits, b.x, b.y);
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

/**
 * Half-extents (map units) for hit-testing, matching the clamped size the label is actually
 * drawn at rather than its authored size. Pure so the clamp math is unit-testable without WebGL
 * or window state.
 */
export function labelHitExtents(box: LabelBox, scale: number): { hw: number; hh: number } {
  if (scale <= 0) {
    // Guard: scale is always positive in practice (d3 zoom scale is always positive)
    return { hw: box.halfWEm * box.startPx, hh: box.halfHEm * box.startPx };
  }
  const px = effectiveLabelPx(scale, box.startPx, box.restPx);
  return { hw: (box.halfWEm * px) / scale, hh: (box.halfHEm * px) / scale };
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
    const t = (window as any).getMapTransform?.() || { scale: 1 };
    const { hw, hh } = labelHitExtents(found, t.scale);
    if (mapX >= found.x - hw && mapX <= found.x + hw && mapY >= found.y - hh && mapY <= found.y + hh) return found.id;
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
  scheduleRebuildBurgLabelGL,
  moveLabelGL
});
