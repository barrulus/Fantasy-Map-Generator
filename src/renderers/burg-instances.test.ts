import { describe, expect, it } from "vitest";
import { findMegalopolises, MEGALOPOLIS_MIN_ZOOM } from "../generators/megalopolis";
import {
  buildBurgInstances,
  buildBurgQuadtree,
  buildCompositeSpecs,
  type GroupRender,
  hitTestBurg
} from "./burg-instances";

const groups: Record<string, GroupRender> = {
  city: { tileIndex: 0, size: 4, minZoom: 4 },
  hamlet: { tileIndex: 1, size: 2, minZoom: 14 }
};

describe("buildBurgInstances", () => {
  it("packs x,y,size,tileIndex,minZoom per non-removed burg, skipping burg[0] and removed", () => {
    const burgs = [
      {}, // index 0 placeholder
      { i: 1, x: 10, y: 20, group: "city" },
      { i: 2, x: 30, y: 40, group: "hamlet", removed: true },
      { i: 3, x: 50, y: 60, group: "hamlet" }
    ] as any;
    const { data, count, ids } = buildBurgInstances(burgs, groups);
    expect(count).toBe(2); // burg 1 and 3
    expect(ids).toEqual([1, 3]);
    // stride 5: x,y,size,tileIndex,minZoom
    expect(Array.from(data.slice(0, 5))).toEqual([10, 20, 4, 0, 4]);
    expect(Array.from(data.slice(5, 10))).toEqual([50, 60, 2, 1, 14]);
  });

  it("falls back to a default group render when a burg's group is unknown", () => {
    const burgs = [{}, { i: 1, x: 1, y: 2, group: "mystery" }] as any;
    const { data, count } = buildBurgInstances(burgs, groups, { tileIndex: 7, size: 3, minZoom: 0 });
    expect(count).toBe(1);
    expect(Array.from(data.slice(0, 5))).toEqual([1, 2, 3, 7, 0]);
  });
});

describe("burg hit-test", () => {
  const burgs = [{}, { i: 1, x: 100, y: 100, group: "city" }, { i: 2, x: 300, y: 300, group: "hamlet" }] as any;
  const sizes = { city: 4, hamlet: 2 } as Record<string, number>;
  const qt = buildBurgQuadtree(burgs);

  it("leaves burgs of a hidden group out of the index (an unpainted icon isn't clickable)", () => {
    const hiddenHamlet: Record<string, GroupRender> = { ...groups, hamlet: { ...groups.hamlet, hidden: true } };
    expect(hitTestBurg(buildBurgQuadtree(burgs, hiddenHamlet), 301, 301, 10, sizes)).toBeNull();
    expect(hitTestBurg(buildBurgQuadtree(burgs, hiddenHamlet), 101, 101, 10, sizes)).toBe(1);
  });

  it("returns the burg under the cursor within its on-screen radius", () => {
    expect(hitTestBurg(qt, 101, 101, 10, sizes)).toBe(1);
  });

  it("returns null when the cursor is far from any burg", () => {
    expect(hitTestBurg(qt, 5000, 5000, 10, sizes)).toBeNull();
  });

  it("uses a minimum screen-px tap target so tiny icons stay clickable when zoomed out", () => {
    // at scale 1, city radius 2 map units, but the 6px min target / scale 1 = 6 map units
    expect(hitTestBurg(qt, 105, 100, 1, sizes)).toBe(1); // 5 units away, within the 6-unit min
  });
});

describe("megalopolis composite instances", () => {
  it("buildBurgInstances suppresses listed ids and appends composite instances", () => {
    const burgs = [null, { i: 1, x: 10, y: 10, group: "city" }, { i: 2, x: 11, y: 11, group: "hamlet" }] as any;
    const { count, ids, data } = buildBurgInstances(burgs, groups, undefined, {
      suppress: new Set([2]),
      composites: [{ x: 10, y: 10, size: 6.4, tileIndex: 0, anchorId: 1, minZoom: 3 }]
    });
    expect(count).toBe(2); // burg 1 + composite; burg 2 suppressed
    expect(ids).toEqual([1, 1]); // composite carries the anchor id
    const composite = Array.from(data.slice(5, 10));
    expect(composite[0]).toBe(10);
    expect(composite[1]).toBe(10);
    expect(composite[2]).toBeCloseTo(6.4, 5); // Float32 rounding
    expect(composite[3]).toBe(0);
    expect(composite[4]).toBe(3); // capital-tier gate carried through
  });

  it("skips burgs whose group is hidden", () => {
    // A switched-off group sets display:none on its #burgIcons > g shell; GPU icons are
    // built from pack.burgs, so the hidden flag is the only thing that can cull them.
    const withHidden: Record<string, GroupRender> = {
      ...groups,
      skyburg: { tileIndex: 2, size: 3, minZoom: 4, hidden: true }
    };
    const burgs = [{}, { i: 1, x: 10, y: 20, group: "city" }, { i: 2, x: 30, y: 40, group: "skyburg" }] as any;
    const { count, ids } = buildBurgInstances(burgs, withHidden);
    expect(count).toBe(1);
    expect(ids).toEqual([1]);
  });

  it("buildCompositeSpecs emits an enlarged anchor icon plus a ring per megalopolis", () => {
    const cellsBurg = new Uint32Array(10);
    cellsBurg[5] = 1;
    const megas = findMegalopolises(
      [
        { i: 0 },
        { i: 1, cell: 5, x: 10, y: 10, group: "city", population: 2 },
        { i: 2, cell: 5, x: 11, y: 11, group: "hamlet", population: 1 }
      ] as any,
      cellsBurg
    );
    const specs = buildCompositeSpecs(megas, groups, 9);
    expect(specs).toHaveLength(2);
    expect(specs[0]).toEqual({ x: 10, y: 10, size: 4 * 1.6, tileIndex: 0, anchorId: 1, minZoom: MEGALOPOLIS_MIN_ZOOM });
    expect(specs[1]).toEqual({ x: 10, y: 10, size: 4 * 2.2, tileIndex: 9, anchorId: 1, minZoom: MEGALOPOLIS_MIN_ZOOM });
  });
});
