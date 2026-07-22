import { describe, expect, it } from "vitest";
import { groupCeilPx, groupFloorPx, groupMinZoom, groupRank } from "./tier-table";

describe("groupRank", () => {
  it("ranks settlement tiers by importance (lower rank = higher priority)", () => {
    expect(groupRank("capital")).toBeLessThan(groupRank("city"));
    expect(groupRank("city")).toBeLessThan(groupRank("town"));
    expect(groupRank("town")).toBeLessThan(groupRank("village"));
    expect(groupRank("village")).toBeLessThan(groupRank("hamlet"));
  });

  it("ranks unknown groups below every known tier", () => {
    expect(groupRank("nonsense")).toBeGreaterThan(groupRank("hamlet"));
  });
});

describe("groupMinZoom", () => {
  it("matches the tier gates the SVG and GL paths used separately", () => {
    expect(groupMinZoom("capital")).toBe(1);
    expect(groupMinZoom("city")).toBe(4);
    expect(groupMinZoom("town")).toBe(6);
    expect(groupMinZoom("village")).toBe(10);
    expect(groupMinZoom("hamlet")).toBe(14);
  });

  it("gates unknown/legacy groups at the city tier rather than showing at every zoom", () => {
    // Size no longer culls, so a 0 fallback would render legacy `cities`/`towns` shells (and any
    // custom Burg Groups editor group) at every zoom level. city (4) is the intentional fallback.
    expect(groupMinZoom("nonsense")).toBe(4);
  });
});

describe("size floors and ceilings", () => {
  it("gives more important tiers a higher legibility floor", () => {
    expect(groupFloorPx("capital")).toBeGreaterThan(groupFloorPx("city"));
    expect(groupFloorPx("city")).toBeGreaterThan(groupFloorPx("town"));
    expect(groupFloorPx("village")).toBeGreaterThan(groupFloorPx("hamlet"));
  });

  it("gives more important tiers a higher ceiling", () => {
    expect(groupCeilPx("capital")).toBeGreaterThan(groupCeilPx("city"));
    expect(groupCeilPx("city")).toBeGreaterThan(groupCeilPx("hamlet"));
  });

  it("always leaves room to grow between floor and ceiling", () => {
    for (const g of ["capital", "city", "town", "village", "hamlet", "fort", "nonsense"])
      expect(groupCeilPx(g)).toBeGreaterThan(groupFloorPx(g));
  });

  it("falls back to the smallest tier's bounds for unknown groups", () => {
    expect(groupFloorPx("nonsense")).toBe(6);
    expect(groupCeilPx("nonsense")).toBe(56);
  });
});
