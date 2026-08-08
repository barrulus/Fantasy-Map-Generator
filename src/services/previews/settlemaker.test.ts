// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BurgContext } from "@/generators/burg-context";
import {
  buildFlatTierUrl,
  buildSettlemakerUrl,
  MAX_ENCODED_PAYLOAD_BYTES,
  SETTLEMAKER_BASE_URL,
  toSettlemakerInput
} from "./settlemaker";

const ctx = (over: Partial<BurgContext> = {}): BurgContext =>
  ({
    burg: {
      i: 7,
      name: "Toprak",
      population: 13,
      seedKey: "1234560007",
      capital: false,
      port: true,
      citadel: false,
      walls: false,
      plaza: false,
      temple: false,
      shanty: false,
      culture: "Koryo"
    },
    window: { radiusKm: 12, cellCount: 40 },
    approaches: [],
    hydrology: { oceanBearingDeg: 200, harbourSize: "small", coastal: true, lakeside: false },
    terrain: { elevationM: 144 },
    climate: { temperatureC: 14, biome: "Temperate deciduous forest" },
    ...over
  }) as BurgContext;

describe("toSettlemakerInput", () => {
  it("always emits all seven booleans, including the false ones", () => {
    const input = toSettlemakerInput(ctx(), {});
    for (const key of ["port", "citadel", "walls", "plaza", "temple", "shanty", "capital"] as const) {
      expect(input).toHaveProperty(key);
      expect(typeof input[key]).toBe("boolean");
    }
    expect(input.port).toBe(true);
    expect(input.capital).toBe(false);
  });

  it("maps name, population and the declared-but-unread fields", () => {
    const input = toSettlemakerInput(ctx(), {});
    expect(input).toMatchObject({
      name: "Toprak",
      population: 13,
      oceanBearing: 200,
      harbourSize: "small",
      biome: "Temperate deciduous forest",
      elevation: 144,
      temperature: 14,
      culture: "Koryo"
    });
  });

  it("omits optional fields rather than sending null", () => {
    const bare = ctx({
      hydrology: { coastal: false, lakeside: false },
      climate: { temperatureC: 5, biome: "" },
      burg: { ...ctx().burg, culture: undefined }
    });
    const input = toSettlemakerInput(bare, {});
    expect("oceanBearing" in input).toBe(false);
    expect("harbourSize" in input).toBe(false);
    expect("biome" in input).toBe(false);
    expect("culture" in input).toBe(false);
    expect("urbanDensity" in input).toBe(false);
  });

  it("sends land approaches as roadBearings and drops sea and air ones", () => {
    const input = toSettlemakerInput(
      ctx({
        approaches: [
          { routeId: 1, group: "roads", type: "highway", bearingDeg: 90, through: true },
          { routeId: 2, group: "searoutes", type: "sea route", bearingDeg: 180, through: false },
          { routeId: 3, group: "airroutes", bearingDeg: 270, through: false },
          { routeId: 4, group: "trails", type: "trail", bearingDeg: 0, through: false },
          { routeId: 5, group: "traderoutes", bearingDeg: 45, through: true }
        ]
      }),
      {}
    );
    expect(input.roadBearings).toEqual([
      { bearing_deg: 90, route_id: "1", kind: "roads" },
      { bearing_deg: 0, route_id: "4", kind: "trails" },
      { bearing_deg: 45, route_id: "5", kind: "traderoutes" }
    ]);
  });

  it("sends an empty roadBearings array for a genuinely routeless burg, never omits it", () => {
    const input = toSettlemakerInput(ctx({ approaches: [] }), {});
    expect(input.roadBearings).toEqual([]);
    expect("roadBearings" in input).toBe(true);
  });

  it("passes urbanDensity only when positive, and trade only when true", () => {
    expect(toSettlemakerInput(ctx(), { urbanDensity: 8, trade: true })).toMatchObject({
      urbanDensity: 8,
      trade: true
    });
    const off = toSettlemakerInput(ctx(), { urbanDensity: 0, trade: false });
    expect("urbanDensity" in off).toBe(false);
    expect("trade" in off).toBe(false);
  });
});

async function decodeIParam(url: string) {
  const encoded = new URL(url).searchParams.get("i") as string;
  const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return JSON.parse(await new Response(stream).text());
}

describe("buildSettlemakerUrl", () => {
  it("round-trips through the documented codec into a v1 envelope", async () => {
    const { link } = await buildSettlemakerUrl(ctx(), {});
    expect(link.startsWith(`${SETTLEMAKER_BASE_URL}?i=`)).toBe(true);

    const envelope = await decodeIParam(link);
    expect(envelope.v).toBe(1);
    expect(typeof envelope.seed).toBe("number");
    expect(envelope.burg.name).toBe("Toprak");
  });

  it("carries all seven booleans through the encode/decode cycle", async () => {
    const { link } = await buildSettlemakerUrl(ctx(), {});
    const { burg } = await decodeIParam(link);
    for (const key of ["port", "citadel", "walls", "plaza", "temple", "shanty", "capital"]) {
      expect(burg).toHaveProperty(key);
    }
  });

  it("derives a stable numeric seed from the burg seed key", async () => {
    const a = await decodeIParam((await buildSettlemakerUrl(ctx(), {})).link);
    const b = await decodeIParam((await buildSettlemakerUrl(ctx(), {})).link);
    expect(a.seed).toBe(b.seed);

    const other = ctx({ burg: { ...ctx().burg, seedKey: "1234560008" } });
    const c = await decodeIParam((await buildSettlemakerUrl(other, {})).link);
    expect(c.seed).not.toBe(a.seed);
  });

  it("uses the same chrome-free URL for link and preview", async () => {
    const { link, preview } = await buildSettlemakerUrl(ctx(), {});
    expect(preview).toBe(link);
  });

  it("stays inside the payload budget for a heavily-connected burg", async () => {
    const approaches = Array.from({ length: 12 }, (_, i) => ({
      routeId: i,
      group: "roads" as const,
      type: "highway",
      bearingDeg: i * 30,
      through: true
    }));
    const { link } = await buildSettlemakerUrl(ctx({ approaches }), {});
    const encoded = new URL(link).searchParams.get("i") as string;
    expect(encoded.length).toBeLessThan(MAX_ENCODED_PAYLOAD_BYTES);
  });
});

describe("buildFlatTierUrl", () => {
  it("emits the documented flat params and no i=", () => {
    const url = buildFlatTierUrl(toSettlemakerInput(ctx(), { urbanDensity: 8, trade: true }), 42);
    const params = new URL(url).searchParams;
    expect(params.get("i")).toBeNull();
    expect(params.get("name")).toBe("Toprak");
    expect(params.get("pop")).toBe("13");
    expect(params.get("seed")).toBe("42");
    expect(params.get("port")).toBe("1");
    expect(params.get("capital")).toBe("0");
    expect(params.get("oceanBearing")).toBe("200");
    expect(params.get("harbourSize")).toBe("small");
    expect(params.get("urbanDensity")).toBe("8");
    expect(params.get("trade")).toBe("1");
  });

  it("omits trade entirely when false", () => {
    const url = buildFlatTierUrl(toSettlemakerInput(ctx(), {}), 42);
    expect(new URL(url).searchParams.get("trade")).toBeNull();
  });
});
