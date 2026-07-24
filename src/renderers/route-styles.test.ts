/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyRouteLineStyle,
  ROUTE_GROUP_DEFAULTS,
  ROUTE_TYPE_DEFAULTS,
  readPresetAttrs,
  routeGroupStyle,
  routeTypeStyle
} from "./route-styles";

// Read via fs rather than importing the JSON: the preset lives under public/, outside the TS
// rootDir, so an ESM json import would fight tsc's include config. fs is robust in vitest.
// Use node:url's URL (not the jsdom-patched global URL, which resolves file:// bases against
// window.location instead of the given base) to resolve the path.
const defaultPreset = JSON.parse(
  readFileSync(fileURLToPath(new NodeURL("../../public/styles/default.json", import.meta.url)), "utf8")
) as Record<string, any>;

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

describe("applyRouteLineStyle (preset wins, defaults fill gaps)", () => {
  it("applies the default hierarchy when the preset supplies nothing", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    applyRouteLineStyle(el, ROUTE_TYPE_DEFAULTS.market, undefined);
    expect(el.getAttribute("stroke-width")).toBe("1.1");
    expect(el.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(el.getAttribute("stroke-linecap")).toBe("butt");
  });

  it("lets a preset value override the default", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    applyRouteLineStyle(el, ROUTE_TYPE_DEFAULTS.market, { "stroke-width": 3, stroke: "#abcdef" });
    expect(el.getAttribute("stroke-width")).toBe("3"); // preset wins
    expect(el.getAttribute("stroke")).toBe("#abcdef"); // preset-only attr passes through
    expect(el.getAttribute("stroke-dasharray")).toBe("6 4"); // default fills the gap
  });

  it("removes stroke-dasharray for a solid default (null)", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("stroke-dasharray", "2"); // stale value from a prior render
    applyRouteLineStyle(el, ROUTE_TYPE_DEFAULTS.royal, undefined);
    expect(el.hasAttribute("stroke-dasharray")).toBe(false);
  });
});

describe("default preset matches the hierarchy (width/dash/cap, not colour)", () => {
  it("sets each overland type to its default width and dash", () => {
    for (const type of ["royal", "main", "market", "town", "local", "trail", "footpath"]) {
      const sel = `#routes #${type}`;
      const preset = defaultPreset[sel];
      expect(preset, sel).toBeDefined();
      expect(preset["stroke-width"], sel).toBe(ROUTE_TYPE_DEFAULTS[type]["stroke-width"]);
      const dash = ROUTE_TYPE_DEFAULTS[type]["stroke-dasharray"];
      // solid types carry no dasharray (or null); dashed/dotted carry the exact pattern
      if (dash === null) expect(preset["stroke-dasharray"] ?? null, sel).toBeNull();
      else expect(String(preset["stroke-dasharray"]), sel).toBe(dash);
    }
  });

  it("sets the special groups to their default width", () => {
    for (const group of ["searoutes", "airroutes", "traderoutes"]) {
      const preset = defaultPreset[`#${group}`];
      expect(preset, group).toBeDefined();
      expect(preset["stroke-width"], group).toBe(ROUTE_GROUP_DEFAULTS[group]["stroke-width"]);
    }
  });
});

describe("readPresetAttrs", () => {
  it("returns only present attributes, omitting absent ones", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("stroke-width", "0.35");
    const attrs = readPresetAttrs(el, ["stroke-width", "stroke-dasharray", "stroke-linecap"]);
    expect(attrs).toEqual({ "stroke-width": "0.35" });
    expect(attrs).not.toHaveProperty("stroke-dasharray");
  });
});

describe("preset group style survives applyRouteLineStyle via readPresetAttrs (drawRoutes regression)", () => {
  const attrNames = ["stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "opacity", "filter", "mask"];

  it("keeps a preset's group-level width/dash instead of letting the default clobber them", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("stroke-width", "0.35");
    el.setAttribute("stroke-dasharray", "1 2");

    applyRouteLineStyle(el, ROUTE_GROUP_DEFAULTS.searoutes, readPresetAttrs(el, attrNames));

    expect(el.getAttribute("stroke-width")).toBe("0.35");
    expect(el.getAttribute("stroke-dasharray")).toBe("1 2");
  });

  it("falls back to the default when the element has no line attributes set", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");

    applyRouteLineStyle(el, ROUTE_GROUP_DEFAULTS.searoutes, readPresetAttrs(el, attrNames));

    expect(el.getAttribute("stroke-width")).toBe(String(ROUTE_GROUP_DEFAULTS.searoutes["stroke-width"]));
    expect(el.getAttribute("stroke-dasharray")).toBe(ROUTE_GROUP_DEFAULTS.searoutes["stroke-dasharray"]);
  });
});
