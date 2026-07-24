import { describe, expect, it } from "vitest";
import { ROUTE_GROUP_DEFAULTS, ROUTE_TYPE_DEFAULTS, routeGroupStyle, routeTypeStyle } from "./route-styles";

// Every overland type the generator can emit (routes-generator.ts assigns these).
const EMITTED_TYPES = ["royal", "main", "market", "town", "local", "trail", "footpath"];
const GROUPS = ["roads", "trails", "searoutes", "airroutes", "traderoutes"];

describe("ROUTE_TYPE_DEFAULTS", () => {
  it("styles every type the generator can emit, so none renders unstyled", () => {
    for (const t of EMITTED_TYPES) {
      const s = routeTypeStyle(t);
      expect(s, t).toBeDefined();
      expect(s!["stroke-width"], t).toBeGreaterThan(0);
      expect(s!, t).toHaveProperty("stroke-dasharray");
    }
  });

  it("orders width by importance: royal > main > market > town > local > trail > footpath", () => {
    const w = EMITTED_TYPES.map(t => ROUTE_TYPE_DEFAULTS[t]["stroke-width"]);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThan(w[i - 1]);
  });

  it("keeps the trunk roads solid and the paths dotted with a round cap", () => {
    expect(ROUTE_TYPE_DEFAULTS.royal["stroke-dasharray"]).toBeNull();
    expect(ROUTE_TYPE_DEFAULTS.main["stroke-dasharray"]).toBeNull();
    for (const dotted of ["trail", "footpath"]) {
      expect(ROUTE_TYPE_DEFAULTS[dotted]["stroke-linecap"]).toBe("round");
      // a near-zero dash length renders as a dot only with a round cap
      expect(ROUTE_TYPE_DEFAULTS[dotted]["stroke-dasharray"]!.startsWith("0.5")).toBe(true);
    }
  });

  it("gives market/town/local distinct dashes, not one shared pattern", () => {
    const dashes = ["market", "town", "local"].map(t => ROUTE_TYPE_DEFAULTS[t]["stroke-dasharray"]);
    expect(new Set(dashes).size).toBe(3);
  });
});

describe("ROUTE_GROUP_DEFAULTS", () => {
  it("styles every route group, including the special sea/air/trade lanes", () => {
    for (const g of GROUPS) {
      const s = routeGroupStyle(g);
      expect(s, g).toBeDefined();
      expect(s!["stroke-width"], g).toBeGreaterThan(0);
    }
  });

  it("makes trade lanes bolder than a town road", () => {
    expect(ROUTE_GROUP_DEFAULTS.traderoutes["stroke-width"]).toBeGreaterThan(ROUTE_TYPE_DEFAULTS.town["stroke-width"]);
  });
});

describe("accessors", () => {
  it("return undefined for an unknown type/group rather than throwing", () => {
    expect(routeTypeStyle("nonsense")).toBeUndefined();
    expect(routeGroupStyle("nonsense")).toBeUndefined();
  });
});
