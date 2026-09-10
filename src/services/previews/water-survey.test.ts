// @vitest-environment node
import { describe, expect, it } from "vitest";
import { closestPoint } from "@/utils/shoreline-geometry";
import type { WaterPoint as Point } from "./water-context-types";
import type { SurveyBoundary } from "./water-survey";
import { WaterSurveyIndex } from "./water-survey";

const bounds = { minX: -50000, minY: -50000, maxX: 50000, maxY: 50000 };
const rectangle = (x1: number, y1: number, x2: number, y2: number) => `M${x1},${y1}H${x2}V${y2}H${x1}Z`;
const land = (shore: number): SurveyBoundary => ({
  id: 1,
  kind: "island",
  path: rectangle(-50000, -50000, shore, 50000)
});
const survey = (features: SurveyBoundary[], burg = { x: 0, y: 0 }) =>
  new WaterSurveyIndex(features, bounds).survey({ burg, metresPerMapUnit: 1, oceanAt: () => 9 });
const inside = (point: Point, polygon: Point[]) => {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      result = !result;
  }
  return result;
};

describe("measured water survey", () => {
  it("keeps the Tarrimas-Ha 11,115 m shore outside a complete 3 km survey", () => {
    const result = survey([land(11115)]);
    expect(result.waterContext).toMatchObject({ version: 1, status: "measured", surveyRadiusM: 3000, bodies: [] });
    expect(result.coastlineGeometry).toEqual([]);
  });

  it("places a nearby shore at its measured distance from the actual burg", () => {
    const result = survey([land(140)], { x: 100, y: 20 });
    expect(result.waterContext.bodies).toEqual([
      { featureId: "9", kind: "ocean", distanceM: 40, bearingDeg: 90, polygonIndices: [0] }
    ]);
    expect(result.coastlineGeometry[0]).toEqual([
      { x: 40, y: -3000 },
      { x: 3000, y: -3000 },
      { x: 3000, y: 3000 },
      { x: 40, y: 3000 }
    ]);
  });

  it("preserves a finite lake and a dry island using filled pieces", () => {
    const result = survey([
      land(50000),
      { id: 2, kind: "lake", path: rectangle(40, -100, 200, 100) },
      { id: 3, kind: "island", path: rectangle(80, -20, 120, 20) }
    ]);
    expect(result.waterContext.bodies[0]).toMatchObject({
      kind: "lake",
      featureId: "2",
      distanceM: 40,
      bearingDeg: 90
    });
    const wet = (p: Point) => result.coastlineGeometry.some(poly => inside(p, poly));
    expect(wet({ x: 60, y: 0 })).toBe(true);
    expect(wet({ x: 100, y: 0 })).toBe(false);
    expect(wet({ x: 210, y: 0 })).toBe(false);
  });

  it("uses geometry for both sides of a peninsula even when the ocean ID is the same", () => {
    const result = survey([{ id: 1, kind: "island", path: rectangle(-50, -50000, 40, 50000) }]);
    expect(result.waterContext.bodies).toHaveLength(1);
    expect(result.waterContext.bodies[0].polygonIndices).toHaveLength(2);
    expect(result.waterContext.bodies[0].distanceM).toBe(40);
    expect(result.coastlineGeometry.some(poly => inside({ x: -100, y: 0 }, poly))).toBe(true);
    expect(result.coastlineGeometry.some(poly => inside({ x: 100, y: 0 }, poly))).toBe(true);
    expect(result.coastlineGeometry.some(poly => inside({ x: 0, y: 0 }, poly))).toBe(false);
  });

  it("finds a curved shore entering the survey although its endpoints are outside", () => {
    const result = survey([
      {
        id: 1,
        kind: "island",
        path: "M-50000,-50000H50000V-4000H4000C1333.3333,-2000 1333.3333,2000 4000,4000H50000V50000H-50000Z"
      }
    ]);
    expect(result.waterContext.bodies).toHaveLength(1);
    expect(result.waterContext.bodies[0].distanceM).toBeCloseTo(2000, 1);
    const distances = result.coastlineGeometry.flatMap(poly =>
      poly.map((p, i) => {
        const q = closestPoint({ x: 0, y: 0 }, p, poly[(i + 1) % poly.length]);
        return Math.hypot(q.x, q.y);
      })
    );
    expect(Math.min(...distances)).toBeCloseTo(result.waterContext.bodies[0].distanceM, 6);
  });

  it("does not invent a shoreline on the crop when the burg is inside a large lake", () => {
    const result = survey([land(50000), { id: 2, kind: "lake", path: rectangle(-10000, -10000, 10000, 10000) }]);
    expect(result.waterContext.bodies[0].distanceM).toBe(10000);
    expect(result.coastlineGeometry).toHaveLength(1);
    expect(inside({ x: 0, y: 0 }, result.coastlineGeometry[0])).toBe(true);
  });

  it("reports missing local river widths instead of substituting mouth width", () => {
    const result = new WaterSurveyIndex([land(11115)], bounds).survey({
      burg: { x: 0, y: 0 },
      metresPerMapUnit: 1,
      oceanAt: () => 9,
      omittedRiverIds: [8, 3, 8]
    });
    expect(result.waterContext.omittedRivers).toEqual([
      { riverId: "3", reason: "local-width-unavailable" },
      { riverId: "8", reason: "local-width-unavailable" }
    ]);
  });

  it.each([0.1, 0.0001])("keeps %s m straight channels and land necks without rounding them closed", width => {
    const channel = survey([
      { id: 1, kind: "island", path: rectangle(-50000, -50000, 40, 50000) },
      { id: 2, kind: "island", path: rectangle(40 + width, -50000, 50000, 50000) }
    ]);
    expect(channel.coastlineGeometry.some(poly => inside({ x: 40 + width / 2, y: 0 }, poly))).toBe(true);
    const neck = survey([{ id: 1, kind: "island", path: rectangle(40, -50000, 40 + width, 50000) }]);
    expect(neck.coastlineGeometry.some(poly => inside({ x: 40 + width / 2, y: 0 }, poly))).toBe(false);
  });

  it("rejects ambiguous curved channels instead of changing their topology", () => {
    expect(() =>
      survey([
        { id: 1, kind: "island", path: "M-50000,-50000H40V-100Q40.1,0 40,100V50000H-50000Z" },
        { id: 2, kind: "island", path: rectangle(40.15, -50000, 50000, 50000) }
      ])
    ).toThrow("cannot preserve");
    expect(() => survey([land(50000), { id: 2, kind: "lake", path: "M40,0C40.1,.1 39.9,.1 40,0Z" }])).toThrow(
      "cannot preserve"
    );
  });

  it("exports the full survey square without internal crop closures outside the disc", () => {
    const result = survey([
      land(50000),
      { id: 2, kind: "lake", path: rectangle(2800, 500, 4000, 4000) },
      { id: 3, kind: "island", path: rectangle(2800, 2000, 2850, 2500) }
    ]);
    expect(result.coastlineGeometry.some(poly => inside({ x: 2900, y: 2900 }, poly))).toBe(true);
    expect(result.waterContext.bodies[0].distanceM).toBeCloseTo(Math.hypot(2800, 500), 6);
  });

  it("measures the exposed union shore when land features overlap", () => {
    const result = survey([
      { id: 1, kind: "island", path: rectangle(-100, -100, 40, 100) },
      { id: 2, kind: "island", path: rectangle(20, -50, 200, 50) }
    ]);
    expect(result.waterContext.bodies[0].distanceM).toBeCloseTo(Math.hypot(40, 50), 6);
  });

  it.each([1000, 1609.344, 1852])("keeps equivalent geography fixed at %s metres per unit", scale => {
    const index = new WaterSurveyIndex(
      [{ id: 1, kind: "island", path: rectangle(-50000 / scale, -50000 / scale, 40 / scale, 50000 / scale) }],
      {
        minX: -50000 / scale,
        minY: -50000 / scale,
        maxX: 50000 / scale,
        maxY: 50000 / scale
      }
    );
    const result = index.survey({ burg: { x: 0, y: 0 }, metresPerMapUnit: scale, oceanAt: () => 9 });
    expect(result.waterContext.bodies[0].distanceM).toBeCloseTo(40, 8);
    expect(result.waterContext.bodies[0].bearingDeg).toBe(90);
  });

  it("fails rather than claiming to survey outside known map coverage", () => {
    expect(() => survey([land(11115)], { x: 49900, y: 0 })).toThrow("known geography");
  });
});
