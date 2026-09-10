// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Burg } from "@/generators/burgs-generator";
import { surveyBurgWater } from "./burg-water-survey";

afterEach(() => vi.unstubAllGlobals());

describe("unknown physical units", () => {
  it("reports custom units without reading geometry or asserting empty water", () => {
    vi.stubGlobal("options", { map: { units: { distance: { unit: "hexes", scale: 3 } } } });
    expect(surveyBurgWater({ i: 7, x: 100, y: 100 } as Burg)).toEqual({
      waterContext: { version: 1, status: "unknown-units", sourceUnit: "hexes" }
    });
  });
});
