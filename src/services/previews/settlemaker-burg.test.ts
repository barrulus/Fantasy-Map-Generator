// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Burg } from "@/generators/burgs-generator";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  survey: vi.fn(),
  url: vi.fn(async (_ctx: unknown, _opts: unknown) => ({ link: "preview", preview: "preview" }))
}));
vi.mock("@/generators/burg-context", () => ({ buildBurgContext: mocks.context }));
vi.mock("./burg-water-survey", () => ({ surveyBurgWater: mocks.survey }));
vi.mock("./settlemaker", () => ({ buildSettlemakerUrl: mocks.url }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

async function preview(population: number, endpoint?: string) {
  vi.resetModules();
  vi.stubEnv("VITE_SETTLEMAKER_WATER_CONTEXT_URL", endpoint);
  vi.stubGlobal("options", { map: { units: { population: { urbanization: { density: 8 } } } } });
  mocks.context.mockReturnValue({ burg: { population }, hydrology: { rivers: [] } });
  mocks.survey.mockReturnValue({ waterContext: { version: 1, status: "unknown-units", sourceUnit: "hex" } });
  const { createSettlemakerPreview } = await import("./settlemaker-burg");
  return createSettlemakerPreview({ i: 1, x: 10, y: 20, tradeRole: "hub" } as Burg);
}

describe("measured-water rollout", () => {
  it("keeps current production payloads unchanged until a supporting endpoint is configured", async () => {
    await preview(10);
    expect(mocks.survey).not.toHaveBeenCalled();
    expect(mocks.url.mock.calls[0][1]).toEqual({ urbanDensity: 8, trade: true });
  });

  it("enables the versioned survey through the configured renderer for population 1000", async () => {
    await preview(1000, "https://water.example/fmg");
    expect(mocks.survey).toHaveBeenCalledOnce();
    expect(mocks.url.mock.calls[0][1]).toMatchObject({
      baseUrl: "https://water.example/fmg",
      waterSurvey: { waterContext: { version: 1 } }
    });
  });

  it("retains the legacy city path at population 1001", async () => {
    await preview(1001, "https://water.example/fmg");
    expect(mocks.survey).not.toHaveBeenCalled();
    expect(mocks.url.mock.calls[0][1]).not.toHaveProperty("baseUrl");
  });

  it("rejects the human builder endpoint before surveying", async () => {
    await expect(preview(10, "https://water.example/")).rejects.toThrow("address is invalid");
    expect(mocks.survey).not.toHaveBeenCalled();
  });
});
