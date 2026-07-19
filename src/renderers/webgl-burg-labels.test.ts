import { describe, expect, it } from "vitest";
import type { GlyphMetric } from "./label-layout";
import { buildLabelBoxes, hexToRgb, type LabelGroupStyle, readGroupStyles } from "./webgl-burg-labels";

const metrics: Record<string, GlyphMetric> = {
  A: { advance: 1, u0: 0, v0: 0, u1: 1, v1: 1 },
  b: { advance: 0.5, u0: 1, v0: 0, u1: 2, v1: 1 }
};
const geom = { cellEm: 1, originXEm: 0, baselineYEm: 1 };
const styles: Record<string, LabelGroupStyle> = {
  city: { order: 1, fontSize: 4, minZoom: 4 },
  capital: { order: 0, fontSize: 6, minZoom: 1 }
};

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

  it("carries the group's maxPx ceiling onto each box", () => {
    const capped: Record<string, LabelGroupStyle> = {
      capital: { order: 0, fontSize: 6, minZoom: 1, maxPx: 240 }
    };
    const burgs = [{}, { i: 1, x: 0, y: 0, name: "A", group: "capital" }] as any;
    expect(buildLabelBoxes(burgs, capped, metrics, geom)[0].maxPx).toBe(240);
  });

  it("widens halfW by the cell padding (originXEm)", () => {
    const padGeom = { cellEm: 1, originXEm: 0.25, baselineYEm: 1 };
    const burgs = [{}, { i: 1, x: 0, y: 0, name: "A", group: "city" }] as any;
    const boxes = buildLabelBoxes(burgs, styles, metrics, padGeom);
    // "A": advance 1 * fontSize 4 / 2 = 2, plus originXEm 0.25 * 4 = 1 => halfW 3
    expect(boxes[0].halfW).toBeCloseTo(3);
  });
});

describe("readGroupStyles", () => {
  function mountGroups(...ids: string[]) {
    // DOM order is SVG paint order: least-important first, capitals last (painted on top)
    document.body.innerHTML = `<svg><g id="burgLabels">${ids.map(i => `<g id="${i}"></g>`).join("")}</g></svg>`;
  }

  it("ranks groups by importance, not by DOM order", () => {
    mountGroups("hamlet", "village", "city", "capital");
    const s = readGroupStyles();
    expect(s.capital.order).toBeLessThan(s.city.order);
    expect(s.city.order).toBeLessThan(s.village.order);
    expect(s.village.order).toBeLessThan(s.hamlet.order);
  });

  it("gives important tiers a higher on-screen ceiling than small ones", () => {
    mountGroups("hamlet", "capital");
    const s = readGroupStyles();
    expect(s.capital.maxPx).toBeGreaterThan(s.hamlet.maxPx ?? 60);
  });
});
