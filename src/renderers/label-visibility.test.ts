import { describe, expect, it } from "vitest";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";
import { groupCeilPx, groupFloorPx, groupMinZoom, groupRank } from "./labeling/tier-table";

const VP: MapViewport = { x0: 0, y0: 0, x1: 1000, y1: 1000 };

function box(p: Partial<LabelBox> & { id: number }): LabelBox {
  return {
    x: 100,
    y: 100,
    order: 0,
    population: 1,
    halfWEm: 1.25,
    halfHEm: 0.5,
    d: 4,
    minZoom: 0,
    floorPx: 6,
    ceilPx: 60,
    ...p
  };
}

const ids = (out: { id: number }[]) => out.map(v => v.id);

describe("selectVisibleLabels — tier gating", () => {
  it("culls labels below their min-zoom", () => {
    expect(selectVisibleLabels([box({ id: 1, minZoom: 8 })], 4, VP, { hideLabels: true })).toEqual([]);
  });

  it("ignores min-zoom when hideLabels is off", () => {
    expect(ids(selectVisibleLabels([box({ id: 1, minZoom: 8 })], 4, VP, { hideLabels: false }))).toEqual([1]);
  });

  it("culls labels whose box is outside the viewport", () => {
    expect(selectVisibleLabels([box({ id: 1, x: 5000, y: 5000 })], 4, VP, { hideLabels: true })).toEqual([]);
  });
});

describe("selectVisibleLabels — size never culls", () => {
  // Regression: this is the whole point of the phase. A tiny label is clamped up, not dropped.
  it("keeps a label that is smaller than the floor and reports the floor size", () => {
    const out = selectVisibleLabels([box({ id: 1, d: 1 })], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(6);
  });

  it("keeps a label that is larger than the ceiling and reports the ceiling size", () => {
    const out = selectVisibleLabels([box({ id: 1 })], 1000, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(60);
  });

  it("reports natural size inside the band", () => {
    expect(selectVisibleLabels([box({ id: 1 })], 5, VP, { hideLabels: true })[0].px).toBe(20);
  });

  // Regression: Nomia's capital (d=2.49, minZoom 1) was invisible below scale 2.41.
  it("shows a small-font capital at scale 1", () => {
    const capital = box({
      id: 1,
      d: 2.49,
      minZoom: groupMinZoom("capital"),
      order: groupRank("capital"),
      floorPx: groupFloorPx("capital"),
      ceilPx: groupCeilPx("capital")
    });
    const out = selectVisibleLabels([capital], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(11);
  });
});

describe("selectVisibleLabels — rescale option", () => {
  // Regression: rescaleLabels.checked=false was honoured by the SVG path only. The size shown
  // must feed the same option through to the GPU path.
  it("reports the raw unclamped size when rescale is false, even below the floor", () => {
    const out = selectVisibleLabels([box({ id: 1, d: 1 })], 1, VP, { hideLabels: true, rescale: false });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(1); // raw d * scale, not clamped up to the floor (6)
  });

  it("still clamps to the floor/ceiling when rescale is omitted (defaults true)", () => {
    const out = selectVisibleLabels([box({ id: 1, d: 1 })], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(6);
  });
});

describe("selectVisibleLabels — collision", () => {
  it("drops a lower-priority label that overlaps a higher-priority one", () => {
    const a = box({ id: 1, order: 0, x: 100, y: 100 });
    const b = box({ id: 2, order: 5, x: 101, y: 100 });
    expect(ids(selectVisibleLabels([b, a], 4, VP, { hideLabels: true }))).toEqual([1]);
  });

  it("keeps two labels that do not overlap", () => {
    const a = box({ id: 1, x: 100, y: 100 });
    const b = box({ id: 2, x: 900, y: 900 });
    expect(ids(selectVisibleLabels([a, b], 4, VP, { hideLabels: true })).sort()).toEqual([1, 2]);
  });

  it("breaks priority ties by population (higher wins)", () => {
    const a = box({ id: 1, order: 0, population: 10, x: 100, y: 100 });
    const b = box({ id: 2, order: 0, population: 99, x: 101, y: 100 });
    expect(ids(selectVisibleLabels([a, b], 4, VP, { hideLabels: true }))).toEqual([2]);
  });

  it("lets a capital win a collision against an overlapping hamlet", () => {
    const capital = box({ id: 1, order: groupRank("capital"), x: 100, y: 100 });
    const hamlet = box({ id: 2, order: groupRank("hamlet"), x: 101, y: 100 });
    expect(ids(selectVisibleLabels([hamlet, capital], 4, VP, { hideLabels: true }))).toEqual([1]);
  });

  // Collision must use the size actually drawn: a clamped-up label occupies more room than its
  // natural extents, so two labels that look separate at natural size can genuinely overlap.
  it("collides using the clamped size, not the natural size", () => {
    // d=1 at scale 1 is clamped 6x up to the 6px floor, so these two now overlap
    const a = box({ id: 1, d: 1, order: 0, x: 100, y: 100 });
    const b = box({ id: 2, d: 1, order: 5, x: 103, y: 100 });
    expect(ids(selectVisibleLabels([a, b], 1, VP, { hideLabels: true }))).toEqual([1]);
  });
});
