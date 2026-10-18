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
vi.mock("./settlemaker", () => ({
  buildSettlemakerUrl: mocks.url,
  SETTLEMAKER_BASE_URL: "https://settlemaker.com/fmg"
}));

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
  it.each([
    [10, 6000],
    [1000, 6000],
    [16973, 8000],
    [173976, 16000]
  ])("exports measured water by default for population %s", async (population, radius) => {
    await preview(population);
    expect(mocks.survey).toHaveBeenCalledWith(expect.anything(), [], radius, undefined, undefined);
    expect(mocks.url.mock.calls[0][1]).toMatchObject({
      urbanDensity: 8,
      trade: true,
      baseUrl: "https://settlemaker.com/fmg",
      waterSurvey: { waterContext: { version: 1 } }
    });
  });

  it("uses measured production water when the endpoint override is empty", async () => {
    await preview(173976, "");
    expect(mocks.survey).toHaveBeenCalledOnce();
    expect(mocks.url.mock.calls[0][1]).toHaveProperty("baseUrl", "https://settlemaker.com/fmg");
  });

  it("enables the versioned survey through the configured renderer for population 1000", async () => {
    await preview(1000, "https://water.example/fmg");
    expect(mocks.survey).toHaveBeenCalledOnce();
    expect(mocks.url.mock.calls[0][1]).toMatchObject({
      baseUrl: "https://water.example/fmg",
      waterSurvey: { waterContext: { version: 1 } }
    });
  });

  it.each([
    [1001, 8000],
    [16973, 8000],
    [100000, 14000],
    [500000, 26000]
  ])("surveys cities of population %s through the configured renderer", async (population, radius) => {
    const result = await preview(population, "https://water.example/fmg");
    expect(mocks.survey).toHaveBeenCalledWith(
      expect.objectContaining({ x: 10, y: 20 }),
      [],
      radius,
      undefined,
      undefined
    );
    expect(mocks.url.mock.calls[0][1]).toHaveProperty("baseUrl", "https://water.example/fmg");
    expect(result.link).toBe(result.preview);
  });

  it("accepts an explicit survey radius when the renderer requests more coverage", async () => {
    await preview(16973, "https://water.example/fmg", 7000);
    expect(mocks.survey).toHaveBeenCalledWith(expect.anything(), [], 7000, undefined, undefined);
  });

  it("accepts a deployment survey radius without changing the endpoint", async () => {
    vi.stubEnv("VITE_SETTLEMAKER_WATER_SURVEY_RADIUS_M", "6000");
    await preview(16973, "https://water.example/fmg");
    expect(mocks.survey).toHaveBeenCalledWith(expect.anything(), [], 6000, undefined, undefined);
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
    await preview(9987);
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

describe("settlement water relations", () => {
  it("keeps a non-port's own river and its shore independently", async () => {
    vi.stubGlobal("pack", {
      cells: {
        haven: [1],
        harbor: [1],
        f: [0, 2],
        r: [7, 0],
        c: [[1]],
        p: [
          [0, 0],
          [1, 0]
        ]
      },
      features: [{}, {}, { type: "ocean" }]
    });
    const { burgWaterfront } = await import("./settlemaker-burg");
    expect(burgWaterfront({ cell: 0, port: 0, x: 0, y: 0 } as Burg)).toEqual({
      riverId: "7",
      shoreKind: "ocean",
      shoreFeatureId: "2"
    });
  });

  it("chooses the nearest neighbouring river without requiring a port", async () => {
    vi.stubGlobal("pack", {
      cells: {
        haven: [0],
        harbor: [0],
        f: [0],
        r: [0, 8, 9],
        c: [[1, 2]],
        p: [
          [0, 0],
          [10, 0],
          [2, 0]
        ]
      },
      features: []
    });
    const { burgWaterfront } = await import("./settlemaker-burg");
    expect(burgWaterfront({ cell: 0, port: 0, x: 0, y: 0 } as Burg)).toEqual({ riverId: "9" });
    expect(burgWaterfront({ cell: 1, port: 0, x: 10, y: 0 } as Burg)).toEqual({ riverId: "8" });
  });

  it("passes a coastal port's original river to the survey even beyond ordinary coverage", async () => {
    await preview(237946);
    vi.stubGlobal("pack", {
      cells: { haven: [1], harbor: [1], f: [0, 2], r: [49], c: [[]] },
      features: [{}, {}, { type: "ocean" }]
    });
    const { createSettlemakerPreview } = await import("./settlemaker-burg");
    await createSettlemakerPreview({ i: 1, cell: 0, port: 1, x: 481.83, y: 230.61 } as Burg);
    expect(mocks.survey).toHaveBeenLastCalledWith(expect.anything(), [], 20000, "49", {
      kind: "ocean",
      featureId: "2"
    });
    expect(mocks.url.mock.calls.at(-1)![1]).toMatchObject({
      waterfront: { riverId: "49", shoreKind: "ocean", shoreFeatureId: "2" }
    });
  });
});
