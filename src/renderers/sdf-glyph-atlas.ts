import type { Burg } from "../generators/burgs-generator";
import type { FontGeometry, GlyphMetric } from "./label-layout";

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
        const signed = Math.sqrt(dOut[p]) - Math.sqrt(dIn[p]); // + inside glyph, - outside
        // inside glyph -> >0.5, outside -> <0.5, edge -> 0.5 (matches shader smoothstep fill at 0.5)
        const norm = 0.5 + signed / (2 * SPREAD);
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
