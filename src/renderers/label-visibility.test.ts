import { describe, expect, it } from "vitest";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";

const VP: MapViewport = { x0: 0, y0: 0, x1: 1000, y1: 1000 };

function box(p: Partial<LabelBox> & { id: number }): LabelBox {
  return { x: 100, y: 100, order: 0, population: 1, halfW: 5, halfH: 2, minZoom: 0, fontSize: 4, ...p };
}

describe("selectVisibleLabels", () => {
  it("culls labels below their min-zoom", () => {
    const out = selectVisibleLabels([box({ id: 1, minZoom: 8 })], 4, VP);
    expect(out).toEqual([]);
  });

  it("culls labels outside the on-screen size band (px = fontSize*scale)", () => {
    // fontSize 4 * scale 1 = 4px < 6 => culled; * scale 2 = 8px => kept
    expect(selectVisibleLabels([box({ id: 1 })], 1, VP)).toEqual([]);
    expect(selectVisibleLabels([box({ id: 1 })], 2, VP)).toEqual([1]);
    // fontSize 4 * scale 20 = 80px > 60 => culled
    expect(selectVisibleLabels([box({ id: 1 })], 20, VP)).toEqual([]);
  });

  it("culls labels whose box is outside the viewport", () => {
    const out = selectVisibleLabels([box({ id: 1, x: 5000, y: 5000 })], 4, VP);
    expect(out).toEqual([]);
  });

  it("drops a lower-priority label that overlaps a higher-priority one", () => {
    // same screen position; order 0 outranks order 5
    const a = box({ id: 1, order: 0, x: 100, y: 100 });
    const b = box({ id: 2, order: 5, x: 101, y: 100 });
    const out = selectVisibleLabels([b, a], 4, VP); // input order shouldn't matter
    expect(out).toEqual([1]);
  });

  it("keeps two labels that do not overlap", () => {
    const a = box({ id: 1, x: 100, y: 100 });
    const b = box({ id: 2, x: 900, y: 900 });
    const out = selectVisibleLabels([a, b], 4, VP).sort();
    expect(out).toEqual([1, 2]);
  });

  it("breaks priority ties by population (higher wins)", () => {
    const a = box({ id: 1, order: 0, population: 10, x: 100, y: 100 });
    const b = box({ id: 2, order: 0, population: 99, x: 101, y: 100 });
    expect(selectVisibleLabels([a, b], 4, VP)).toEqual([2]);
  });
});
