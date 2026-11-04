import { beforeAll, describe, expect, it } from "vitest";
import { Measurers as MeasurersModel } from "@/model/annotations/measurers-generator";

let Measurers: any;

beforeAll(async () => {
  const g = globalThis as any;
  g.graphWidth = 1920;
  g.graphHeight = 969;
  await import("@/model/annotations/measurers-generator");
  Measurers = MeasurersModel;
});

describe("createDefaultRuler", () => {
  it("creates a fallback ruler on an all-water map instead of crashing", () => {
    (globalThis as any).pack = {
      features: [0, { i: 1, land: false, border: false, type: "ocean" }],
      vertices: { p: [] },
      measurers: []
    };

    Measurers.createDefaultRuler();

    const ruler = (globalThis as any).pack.measurers[0];
    expect(ruler.type).toBe("Ruler");
    expect(ruler.points).toHaveLength(2);
    for (const [x, y] of ruler.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1920);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(969);
    }
  });
});
