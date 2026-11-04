// @vitest-environment node
import "@/model/physical/river-generator";
import { afterEach, expect, it, vi } from "vitest";
import type { Burg } from "@/model/political/burgs-generator";
import fixture from "@/services/previews/fixtures/moncyia-kindum-waterfront.json";
import { surveyBurgRivers } from "@/services/previews/river-water-survey";
import { burgWaterfront } from "@/services/previews/settlemaker-burg";

afterEach(() => vi.unstubAllGlobals());

it("preserves coastal Kindum's source river despite its marker lying beyond the old preview survey", () => {
  vi.stubGlobal("pack", fixture);
  vi.stubGlobal("options", { map: { graph: fixture.graph } });
  const burg = fixture.burg as Burg;
  const waterfront = burgWaterfront(burg);
  expect(waterfront).toEqual({ riverId: "36", shoreKind: "ocean", shoreFeatureId: "1" });
  expect(surveyBurgRivers(burg, fixture.metresPerMapUnit, 4000).rivers).toEqual([]);
  const survey = surveyBurgRivers(burg, fixture.metresPerMapUnit, 16000, [], waterfront?.riverId);
  expect(survey.omittedRiverIds).not.toContain(36);
  expect(survey.rivers).toHaveLength(1);
  expect(survey.rivers[0]).toMatchObject({ id: "36", courseSource: "fmg-catmull-rom-0.1" });
  expect(survey.rivers[0].centreline.length).toBeGreaterThan(2);
  expect(survey.rivers[0].widthsM.every(width => width > 0)).toBe(true);
});
