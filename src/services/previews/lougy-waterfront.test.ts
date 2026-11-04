// @vitest-environment node
import "@/model/physical/river-generator";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Burg } from "@/model/political/burgs-generator";
import fixture from "@/services/previews/fixtures/lougy-waterfront.json";
import { surveyBurgRivers } from "@/services/previews/river-water-survey";
import { burgWaterfront } from "@/services/previews/settlemaker-burg";

afterEach(() => vi.unstubAllGlobals());

describe("Lougy river associations", () => {
  it.each([
    ["Hasingsbury", "16", "ocean", 8000],
    ["Newcester", "49", "ocean", 20000],
    ["Kinglewes", "105", "ocean", 8000],
    ["Helster", "19", undefined, 14000]
  ])("preserves %s's water relationship despite its cartographic marker offset", (name, riverId, shoreKind, radius) => {
    vi.stubGlobal("pack", fixture);
    vi.stubGlobal("options", { map: { graph: fixture.graph } });
    const burg = fixture.burgs.find(b => b.name === name)! as Burg;
    const relation = burgWaterfront(burg);
    expect(relation).toMatchObject({ riverId });
    expect(relation?.shoreKind).toBe(shoreKind);
    expect(Boolean(burg.port)).toBe(name !== "Hasingsbury");
    const survey = surveyBurgRivers(burg, fixture.metresPerMapUnit, Number(radius), [], String(riverId));
    if (name !== "Kinglewes") expect(survey.omittedRiverIds).not.toContain(Number(riverId));
    const reaches = survey.rivers.filter(r => r.id === riverId);
    expect(reaches.length).toBeGreaterThan(0);
    expect(reaches.every(r => r.widthM > 0 && r.widthsM.every(width => width > 0))).toBe(true);
    if (name === "Newcester") {
      expect(reaches.every(r => r.centreline.every(point => Math.hypot(point.x, point.y) > 10000))).toBe(true);
    }
  });
});
