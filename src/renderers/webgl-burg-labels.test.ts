import { describe, expect, it } from "vitest";
import type { FontGeometry, GlyphMetric } from "./label-layout";
import type { GroupStyle } from "./labeling/label-style";
import { buildLabelBoxes, hexToRgb } from "./webgl-burg-labels";

const GEOM: FontGeometry = { cellEm: 1.333, originXEm: 0.167, baselineYEm: 0.967 };
const METRICS: Record<string, GlyphMetric> = {
  A: { advance: 0.6, u0: 0, v0: 0, u1: 64, v1: 64 },
  b: { advance: 0.5, u0: 64, v0: 0, u1: 128, v1: 64 }
};

function style(p: Partial<GroupStyle> = {}): GroupStyle {
  return {
    group: "capital",
    rank: 0,
    fontSize: 4,
    minZoom: 1,
    floorPx: 11,
    ceilPx: 96,
    fill: "#000000",
    halo: "#ffffff",
    haloWidth: 1,
    hidden: false,
    ...p
  };
}

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
  });
  it("parses 3-digit shorthand hex", () => {
    expect(hexToRgb("#fff")).toEqual([1, 1, 1]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#f80")).toEqual([1, 136 / 255, 0]);
  });
  it("parses rgb() form", () => {
    expect(hexToRgb("rgb(255, 128, 0)")).toEqual([1, 128 / 255, 0]);
  });
  it("falls back to black on unparseable input", () => {
    expect(hexToRgb("nonsense")).toEqual([0, 0, 0]);
  });
});

describe("buildLabelBoxes", () => {
  const burgs = [{}, { i: 1, name: "Ab", group: "capital", x: 100, y: 200, population: 5 }] as any;

  it("emits em-relative half extents that are independent of the authored size", () => {
    const small = buildLabelBoxes(burgs, { capital: style({ fontSize: 2 }) }, METRICS, GEOM)[0];
    const large = buildLabelBoxes(burgs, { capital: style({ fontSize: 8 }) }, METRICS, GEOM)[0];
    expect(small.halfWEm).toBeCloseTo(large.halfWEm, 10);
    expect(small.halfHEm).toBeCloseTo(large.halfHEm, 10);
    // (0.6 + 0.5)/2 + 0.167
    expect(small.halfWEm).toBeCloseTo(0.717, 3);
    expect(small.halfHEm).toBeCloseTo(0.6665, 4);
  });

  it("carries the tier bounds and authored size through from the style", () => {
    const b = buildLabelBoxes(burgs, { capital: style({ fontSize: 2.49 }) }, METRICS, GEOM)[0];
    expect(b.d).toBeCloseTo(2.49, 5);
    expect(b.floorPx).toBe(11);
    expect(b.ceilPx).toBe(96);
    expect(b.minZoom).toBe(1);
    expect(b.order).toBe(0);
  });

  it("applies the per-burg label override to the anchor", () => {
    const moved = [{}, { ...burgs[1], labelDx: 5, labelDy: -3 }] as any;
    const b = buildLabelBoxes(moved, { capital: style() }, METRICS, GEOM)[0];
    expect(b.x).toBe(105);
    expect(b.y).toBe(197);
  });

  it("skips burgs whose group has no style shell", () => {
    expect(buildLabelBoxes(burgs, { hamlet: style({ group: "hamlet" }) }, METRICS, GEOM)).toEqual([]);
  });
});
