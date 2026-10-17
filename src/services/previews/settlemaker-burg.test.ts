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

async function preview(population: number, endpoint?: string, surveyRadiusM?: number) {
  vi.resetModules();
  vi.stubEnv("VITE_SETTLEMAKER_WATER_CONTEXT_URL", endpoint);
  vi.stubGlobal("options", { map: { units: { population: { urbanization: { density: 8 } } } } });
  vi.stubGlobal("pack", { cells: { haven: [], harbor: [], f: [], r: [] }, features: [] });
  mocks.context.mockReturnValue({ burg: { population }, hydrology: { rivers: [] } });
  mocks.survey.mockReturnValue({ waterContext: { version: 1, status: "unknown-units", sourceUnit: "hex" } });
  const { createSettlemakerPreview } = await import("./settlemaker-burg");
  return createSettlemakerPreview({ i: 1, x: 10, y: 20, tradeRole: "hub" } as Burg, { surveyRadiusM });
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

  it.each([1001, 16973, 100000])(
    "surveys cities of population %s through the configured renderer",
    async population => {
      const result = await preview(population, "https://water.example/fmg");
      expect(mocks.survey).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20 }), [], 4000);
      expect(mocks.url.mock.calls[0][1]).toHaveProperty("baseUrl", "https://water.example/fmg");
      expect(result.link).toBe(result.preview);
    }
  );

  it("accepts an explicit survey radius when the renderer requests more coverage", async () => {
    await preview(16973, "https://water.example/fmg", 7000);
    expect(mocks.survey).toHaveBeenCalledWith(expect.anything(), [], 7000);
  });

  it("accepts a deployment survey radius without changing the endpoint", async () => {
    vi.stubEnv("VITE_SETTLEMAKER_WATER_SURVEY_RADIUS_M", "6000");
    await preview(16973, "https://water.example/fmg");
    expect(mocks.survey).toHaveBeenCalledWith(expect.anything(), [], 6000);
  });

  it.each([0, 2999, NaN, Infinity])("rejects invalid radius %s without falling back", async radius => {
    await expect(preview(16973, "https://water.example/fmg", radius)).rejects.toThrow("at least 3000");
    expect(mocks.survey).not.toHaveBeenCalled();
    expect(mocks.url).not.toHaveBeenCalled();
  });

  it("propagates survey failure without encoding a bearing-only city", async () => {
    mocks.survey.mockImplementationOnce(() => {
      throw new Error("Measured water survey extends beyond this map's known geography");
    });
    await expect(preview(16973, "https://water.example/fmg")).rejects.toThrow("known geography");
    expect(mocks.url).not.toHaveBeenCalled();
  });

  it("rejects the human builder endpoint before surveying", async () => {
    await expect(preview(10, "https://water.example/")).rejects.toThrow("address is invalid");
    expect(mocks.survey).not.toHaveBeenCalled();
  });
});

describe("harbour water body", () => {
  it.each(["river", "lake", "ocean"] as const)("exports the intended river ID only for a %s port", async kind => {
    await preview(9987, "http://127.0.0.1:5228/fmg");
    vi.stubGlobal("pack", {
      cells: { haven: [1], harbor: [kind === "river" ? 0 : 1], f: [0, 2], r: [653] },
      features: [{}, { type: "ocean" }, { type: kind }]
    });
    const { createSettlemakerPreview } = await import("./settlemaker-burg");
    await createSettlemakerPreview({ i: 403, cell: 0, port: 223, x: 396.98, y: 511.28 } as Burg);
    const opts = mocks.url.mock.calls.at(-1)![1];
    expect(opts).toHaveProperty("harbourWaterKind", kind);
    if (kind === "river") expect(opts).toHaveProperty("harbourRiverId", "653");
    else expect(opts).not.toHaveProperty("harbourRiverId");
  });

  it.each(["ocean", "lake"])("uses the port's adjacent %s despite an unrelated drain feature", async type => {
    vi.stubGlobal("pack", {
      cells: { haven: [1], harbor: [1], f: [0, 2], r: [0] },
      features: [{}, { type: "ocean" }, { type }]
    });
    const { harbourWaterKind } = await import("./settlemaker-burg");
    expect(harbourWaterKind({ cell: 0, port: 1 } as Burg)).toBe(type);
  });

  it("identifies an inland river port even when its drain feature is ocean", async () => {
    vi.stubGlobal("pack", { cells: { haven: [0], harbor: [0], f: [1], r: [7] }, features: [{}, { type: "ocean" }] });
    const { harbourWaterKind } = await import("./settlemaker-burg");
    expect(harbourWaterKind({ cell: 0, port: 1 } as Burg)).toBe("river");
    expect(harbourWaterKind({ cell: 0, port: 0 } as Burg)).toBeUndefined();
  });
});
