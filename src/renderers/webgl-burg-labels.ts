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
