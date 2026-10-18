// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Burg } from "@/generators/burgs-generator";
import { Coastline } from "@/generators/coastline-generator";
import "@/generators/river-generator";
import { surveyBurgWater } from "./burg-water-survey";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("unknown physical units", () => {
  it("reports custom units without reading geometry or asserting empty water", () => {
    vi.stubGlobal("options", { map: { units: { distance: { unit: "hexes", scale: 3 } } } });
    expect(surveyBurgWater({ i: 7, x: 100, y: 100 } as Burg)).toEqual({
      waterContext: { version: 1, status: "unknown-units", sourceUnit: "hexes" }
    });
  });
});

describe("city survey coverage", () => {
  it("exports nearby river geometry alongside ocean polygons instead of marking every river omitted", () => {
    vi.stubGlobal("options", {
      map: { graph: { width: 100, height: 100 }, units: { distance: { unit: "km", scale: 1 } } }
    });
    vi.stubGlobal("pack", {
      cells: { i: [0], p: [[60, 50]], f: [2] },
      features: [undefined, { i: 1, type: "island" }, { i: 2, type: "ocean" }],
      rivers: [{ i: 7, cells: [0, 1, 2], widthFactor: 1, sourceWidth: 0.15, width: 99 }]
    });
    vi.spyOn(Coastline, "boundaryRevision", "get").mockReturnValue(1);
    vi.spyOn(Coastline, "getFeaturePath").mockReturnValue("M0,0H50.2V100H0Z");
    vi.spyOn(Rivers, "addMeandering").mockReturnValue([
      [45, 50.1, 100],
      [50, 50.1, 200],
      [55, 50.1, 300]
    ]);
    const result = surveyBurgWater({ i: 7, x: 50, y: 50 } as Burg, [7, 99], 4000);
    expect(result.waterContext).toMatchObject({
      status: "measured",
      bodies: [{ kind: "ocean", distanceM: expect.closeTo(200) }],
      omittedRivers: [{ riverId: "99", reason: "local-width-unavailable" }]
    });
    if (!("rivers" in result)) throw new Error("Expected exported river");
    expect(result.rivers).toHaveLength(1);
    expect(result.rivers![0]).toMatchObject({ id: "7", meander: false, widthSource: "fmg-local-width-model" });
    expect(result.rivers![0].centreline[1].y).toBeCloseTo(100);
    expect(result.rivers![0].widthM).toBeLessThan(99000);
  });

  it.each([
    ["km", 1],
    ["mi", 1.609344],
    ["nmi", 1.852]
  ] as const)("uses actual burg coordinates and a larger survey in %s", (unit, kmPerUnit) => {
    vi.stubGlobal("options", {
      map: { graph: { width: 100, height: 100 }, units: { distance: { unit, scale: 1 / kmPerUnit } } }
    });
    vi.stubGlobal("pack", {
      cells: { i: [0], p: [[60, 50]], f: [2] },
      features: [undefined, { i: 1, type: "island" }, { i: 2, type: "ocean" }]
    });
    vi.spyOn(Coastline, "boundaryRevision", "get").mockReturnValue(1);
    vi.spyOn(Coastline, "getFeaturePath").mockReturnValue("M0,0H50.04V100H0Z");
    const result = surveyBurgWater({ i: 7, x: 50, y: 50 } as Burg, [], 6000);
    expect(result.waterContext).toMatchObject({
      status: "measured",
      surveyRadiusM: 6000,
      bodies: [{ kind: "ocean", distanceM: expect.closeTo(40, 5), bearingDeg: 90 }]
    });
    if (result.waterContext.status !== "measured") throw new Error("Expected measured water");
    expect("coastlineGeometry" in result && result.coastlineGeometry[0].some(p => p.x === 6000)).toBe(true);
  });
});

describe("associated shoreline coverage", () => {
  function setup() {
    vi.stubGlobal("options", {
      map: { graph: { width: 100, height: 100 }, units: { distance: { unit: "km", scale: 1 } } }
    });
    vi.stubGlobal("pack", {
      cells: { i: [0], p: [[90, 50]], f: [2] },
      features: [undefined, { i: 1, type: "island" }, { i: 2, type: "ocean" }],
      rivers: []
    });
    vi.spyOn(Coastline, "boundaryRevision", "get").mockReturnValue(1);
    vi.spyOn(Coastline, "getFeaturePath").mockReturnValue("M0,0H69V100H0Z");
  }

  it("finds the associated coast beyond the initial survey and keeps a planning reserve after alignment", () => {
    setup();
    const result = surveyBurgWater({ x: 50, y: 50 } as Burg, [], 8000, undefined, {
      kind: "ocean",
      featureId: "2"
    });
    expect(result.waterContext).toMatchObject({
      surveyRadiusM: 27000,
      bodies: [{ featureId: "2", kind: "ocean", distanceM: 19000 }]
    });
  });

  it("rejects an absent associated feature after searching the available map", () => {
    setup();
    expect(() =>
      surveyBurgWater({ x: 50, y: 50 } as Burg, [], 8000, undefined, {
        kind: "lake",
        featureId: "99"
      })
    ).toThrow("associated shoreline");
  });
});
