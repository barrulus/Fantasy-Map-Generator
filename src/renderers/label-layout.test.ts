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
