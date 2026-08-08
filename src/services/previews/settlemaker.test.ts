// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { BurgContext } from "@/generators/burg-context";
import { toSettlemakerInput } from "./settlemaker";

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
