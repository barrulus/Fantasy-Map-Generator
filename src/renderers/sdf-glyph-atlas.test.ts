import { describe, expect, it } from "vitest";
import { collectGlyphs, edt1d } from "./sdf-glyph-atlas";
import { buildGlyphAtlas, edt2d } from "./sdf-glyph-atlas";

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
