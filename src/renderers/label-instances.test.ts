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
