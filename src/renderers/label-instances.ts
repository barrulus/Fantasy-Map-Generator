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
