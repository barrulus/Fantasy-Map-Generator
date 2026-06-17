import {
  type BurgQuadtree,
  buildBurgInstances,
  buildBurgQuadtree,
  type GroupRender,
  hitTestBurg,
  INSTANCE_STRIDE
} from "./burg-instances";
import { registerLayer } from "./layer-host";
import { type BurgAtlas, buildBurgAtlas } from "./webgl-burg-atlas";

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
  // a minimum on-screen size keeps tiny icons tappable/visible
  float sizePx = max(aSize * uScale, 3.0);
  vec2 centerScreen = aPos * uScale + uTranslate;
  vec2 cornerScreen = centerScreen + (aCorner - 0.5) * sizePx;
  vec2 devicePx = cornerScreen * uDpr;
  vec2 clip = (devicePx / uViewport) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  float col = mod(aTile, uCols);
  float row = floor(aTile / uCols);
  // flip the corner's Y for the atlas lookup so tiles aren't drawn upside-down
  vec2 uvCorner = vec2(aCorner.x, 1.0 - aCorner.y);
  vUV = (vec2(col, row) + uvCorner) * uTile;
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
let prog: WebGLProgram;
let instanceBuf: WebGLBuffer;
let quadBuf: WebGLBuffer;
let atlasTex: WebGLTexture;
let atlas: BurgAtlas | null = null;
let instanceCount = 0;
let burgQuadtree: BurgQuadtree | null = null;
const uniforms: Record<string, WebGLUniformLocation | null> = {};

function compile(src: string, type: number): WebGLShader {
  const s = gl!.createShader(type)!;
  gl!.shaderSource(s, src);
  gl!.compileShader(s);
  if (!gl!.getShaderParameter(s, gl!.COMPILE_STATUS))
    throw new Error(gl!.getShaderInfoLog(s) || "shader compile failed");
  return s;
}

// BURG_MIN_ZOOM lives in public/main.js as a literal; mirror the needed keys here.
const MIN_ZOOM: Record<string, number> = {
  capital: 1,
  "skyburg-capital": 2,
  skyburg: 4,
  "skyburg-mid": 6,
  "skyburg-small": 8,
  city: 4,
  town: 6,
  fort: 7,
  monastery: 7,
  caravanserai: 7,
  trading_post: 7,
  village: 10,
  hamlet: 14
};

function groupRenders(): Record<string, GroupRender> {
  const out: Record<string, GroupRender> = {};
  if (!atlas) return out;
  for (const [name, t] of Object.entries(atlas.tiles)) {
    out[name] = { tileIndex: t.tileIndex, size: t.size, minZoom: MIN_ZOOM[name] ?? 0 };
  }
  return out;
}

export async function initBurgGL(): Promise<void> {
  const canvas = (window as any).ensureBurgGLCanvas() as HTMLCanvasElement;
  gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: true });
  if (!gl) {
    console.error("WebGL2 unavailable; burg GL disabled");
    return;
  }
  prog = gl.createProgram()!;
  gl.attachShader(prog, compile(VERT, gl.VERTEX_SHADER));
  gl.attachShader(prog, compile(FRAG, gl.FRAGMENT_SHADER));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(prog) || "program link failed");
  for (const u of ["uTranslate", "uScale", "uViewport", "uDpr", "uCols", "uTile", "uAtlas", "uAtlasSize"])
    uniforms[u] = gl.getUniformLocation(prog, u);

  quadBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  instanceBuf = gl.createBuffer()!;
  atlasTex = gl.createTexture()!;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  await rebuildBurgGL();
}

export async function rebuildBurgGL(): Promise<void> {
  if (!gl) {
    await initBurgGL();
    return;
  }
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
  burgQuadtree = buildBurgQuadtree((window as any).pack.burgs);
  (window as any).__burgGLids = ids;
  drawBurgGL();
  (window as any).LayerHost?.reconcile(); // position the canvas at its z-slot once instances are ready
}

// Coalesce rapid single-burg edits (add/remove/changeGroup are called in per-burg
// loops in several editors/loaders) into ONE rebuild, so N edits cost O(n) not O(n²).
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
export function scheduleRebuildBurgGL(): void {
  if (rebuildTimer) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    void rebuildBurgGL();
  }, 50);
}

export function drawBurgGL(): void {
  if (!gl || !atlas) return;
  // When the layer is inactive (GPU burgs off, below the auto threshold, or the icons layer hidden)
  // keep the canvas clear instead of repainting stale instances. onFrame already skips inactive
  // layers, but direct callers — resizeBurgGL() fires from fitMapToScreen on every refit regardless
  // of state — would otherwise repaint a frozen frame that doesn't ride pan/zoom, leaving burg dots
  // stuck in screen space.
  if (!burgWebglActive()) {
    const c = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return;
  }
  const t = (window as any).getMapTransform?.() || { scale: 1, viewX: 0, viewY: 0 };
  const w = t.scale;
  const vx = t.viewX;
  const vy = t.viewY;
  const canvas = gl.canvas as HTMLCanvasElement;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  if (!instanceCount) return;
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  const stride = INSTANCE_STRIDE * 4;
  const attribs: [number, number, number][] = [
    [1, 2, 0],
    [2, 1, 8],
    [3, 1, 12],
    [4, 1, 16]
  ];
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
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.uniform1i(uniforms.uAtlas!, 0);

  gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
}

export function resizeBurgGL(): void {
  if (!gl) return;
  (window as any).ensureBurgGLCanvas();
  drawBurgGL();
}

export function destroyBurgGL(): void {
  if (gl) {
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
}

const AUTO_BURG_THRESHOLD = 5000; // auto-enable GL above this many burgs

export function burgWebglActive(): boolean {
  const w = window as any;
  const burgs = w.pack?.burgs?.length || 0;
  if (burgs <= 1 || !w.layerIsOn?.("toggleBurgIcons")) return false;
  const pref = w.webglBurgs; // true = forced on, false = forced off, null/undefined = auto
  return pref == null ? burgs > AUTO_BURG_THRESHOLD : !!pref;
}

// Update one burg's instance position (the caller has already set pack.burgs[id].x/y).
export function moveBurgGL(id: number, x: number, y: number): void {
  if (!gl) return;
  const ids: number[] = (window as any).__burgGLids || [];
  const idx = ids.indexOf(id);
  if (idx >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, idx * INSTANCE_STRIDE * 4, new Float32Array([x, y]));
  }
  // burg.x/y already reflect the new position — rebuild the hit-test index from truth.
  burgQuadtree = buildBurgQuadtree((window as any).pack.burgs);
  drawBurgGL();
}

export function getBurgQuadtree(): BurgQuadtree | null {
  return burgQuadtree;
}

export function getBurgSizes(): Record<string, number> {
  const out: Record<string, number> = {};
  if (atlas) for (const [name, t] of Object.entries(atlas.tiles)) out[name] = t.size;
  return out;
}

registerLayer({
  id: "toggleBurgIcons",
  renderer: "webgl",
  visible: () => burgWebglActive(),
  draw: () => drawBurgGL(),
  clear: () => destroyBurgGL(),
  hitTest: (mapX, mapY) => {
    const qt = getBurgQuadtree();
    if (!qt) return null;
    const id = hitTestBurg(qt, mapX, mapY, (window as any).scale ?? 1, getBurgSizes());
    return id ?? null;
  }
});

Object.assign(window, {
  initBurgGL,
  rebuildBurgGL,
  drawBurgGL,
  resizeBurgGL,
  destroyBurgGL,
  burgWebglActive,
  getBurgQuadtree,
  getBurgSizes,
  hitTestBurg,
  moveBurgGL,
  scheduleRebuildBurgGL
});
