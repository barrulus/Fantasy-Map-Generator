import { describe, expect, it } from "vitest";
import { buildLabelBoxes, type LabelGroupStyle } from "./webgl-burg-labels";
import type { GlyphMetric } from "./label-layout";

const metrics: Record<string, GlyphMetric> = {
  A: { advance: 1, u0: 0, v0: 0, u1: 1, v1: 1 },
  b: { advance: 0.5, u0: 1, v0: 0, u1: 2, v1: 1 }
};
const geom = { cellEm: 1, originXEm: 0, baselineYEm: 1 };
const styles: Record<string, LabelGroupStyle> = {
  city: { order: 1, fontSize: 4, minZoom: 4 },
  capital: { order: 0, fontSize: 6, minZoom: 1 }
};

describe("buildLabelBoxes", () => {
  it("creates one box per live burg with half-extents from its name + group fontSize", () => {
    const burgs = [
      {},
      { i: 1, x: 100, y: 100, name: "Ab", group: "capital" },
      { i: 2, x: 200, y: 200, name: "A", group: "city", removed: true }
    ] as any;
    const boxes = buildLabelBoxes(burgs, styles, metrics, geom);
    expect(boxes).toHaveLength(1); // burg 2 removed
    const b = boxes[0];
    expect(b.id).toBe(1);
    expect(b.order).toBe(0);
    expect(b.fontSize).toBe(6);
    // "Ab": advance 1 + 0.5 = 1.5 em * fontSize 6 = 9 map units wide => halfW 4.5
    expect(b.halfW).toBeCloseTo(4.5);
  });

  it("applies labelDx/labelDy override to the anchor", () => {
    const burgs = [{}, { i: 1, x: 100, y: 100, name: "A", group: "city", labelDx: 5, labelDy: -3 }] as any;
    const boxes = buildLabelBoxes(burgs, styles, metrics, geom);
    expect(boxes[0].x).toBe(105);
    expect(boxes[0].y).toBe(97);
  });
});
