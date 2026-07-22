import { describe, expect, it } from "vitest";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";
import { groupMinZoom, groupRank, groupRestPx, groupStartPx } from "./labeling/tier-table";

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
    startPx: 32,
    restPx: 15,
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
  it("reports startPx at scale 1", () => {
    const out = selectVisibleLabels([box({ id: 1, startPx: 32, restPx: 15 })], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(32);
  });

  it("reports a size decayed toward restPx at a high scale", () => {
    const out = selectVisibleLabels([box({ id: 1, startPx: 32, restPx: 15 })], 1000, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBeCloseTo(15 + 17 / 1000, 5);
  });

  it("reports the curve value at an intermediate scale", () => {
    expect(
      selectVisibleLabels([box({ id: 1, startPx: 32, restPx: 15 })], 5, VP, { hideLabels: true })[0].px
    ).toBeCloseTo(15 + 17 / 5, 10);
  });

  // Regression: Nomia's capital (small preset font) was invisible below scale 2.41 under the old
  // floor/ceiling model. Under the new model there is no floor to fall below.
  it("shows a small-font capital at scale 1 with its full startPx", () => {
    const capital = box({
      id: 1,
      minZoom: groupMinZoom("capital"),
      order: groupRank("capital"),
      startPx: groupStartPx("capital"),
      restPx: groupRestPx("capital")
    });
    const out = selectVisibleLabels([capital], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(groupStartPx("capital"));
  });
});

describe("selectVisibleLabels — rescale option", () => {
  // Regression: rescaleLabels.checked=false was honoured by the SVG path only. The size shown
  // must feed the same option through to the GPU path.
  it("reports the constant resting size when rescale is false, regardless of scale", () => {
    const out = selectVisibleLabels([box({ id: 1, startPx: 32, restPx: 15 })], 1, VP, {
      hideLabels: true,
      rescale: false
    });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(15);

    const out2 = selectVisibleLabels([box({ id: 1, startPx: 32, restPx: 15 })], 50, VP, {
      hideLabels: true,
      rescale: false
    });
    expect(out2[0].px).toBe(15);
  });

  it("still applies the curve when rescale is omitted (defaults true)", () => {
    const out = selectVisibleLabels([box({ id: 1, startPx: 32, restPx: 15 })], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(32);
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

  // Collision must use the size actually drawn: at scale 1 a label sits at its full startPx, so
  // two labels that look separate at their resting size can genuinely overlap here.
  it("collides using the drawn size, not some other size", () => {
    const a = box({ id: 1, startPx: 32, restPx: 15, order: 0, x: 100, y: 100 });
    const b = box({ id: 2, startPx: 32, restPx: 15, order: 5, x: 103, y: 100 });
    expect(ids(selectVisibleLabels([a, b], 1, VP, { hideLabels: true }))).toEqual([1]);
  });
});
