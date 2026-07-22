import { describe, expect, it } from "vitest";
import { groupMinZoom, groupRank, groupReferenceD, groupRestPx, groupStartPx } from "./tier-table";

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

describe("size start/rest px", () => {
  it("gives more important tiers a higher start size", () => {
    expect(groupStartPx("capital")).toBeGreaterThan(groupStartPx("city"));
    expect(groupStartPx("city")).toBeGreaterThan(groupStartPx("town"));
    expect(groupStartPx("village")).toBeGreaterThan(groupStartPx("hamlet"));
  });

  it("gives more important tiers a higher resting size", () => {
    expect(groupRestPx("capital")).toBeGreaterThan(groupRestPx("city"));
    expect(groupRestPx("city")).toBeGreaterThan(groupRestPx("hamlet"));
  });

  it("always starts above its resting size, for every tier", () => {
    for (const g of [
      "capital",
      "skyburg-capital",
      "city",
      "skyburg",
      "town",
      "skyburg-mid",
      "fort",
      "monastery",
      "caravanserai",
      "trading_post",
      "skyburg-small",
      "village",
      "hamlet",
      "nonsense"
    ])
      expect(groupStartPx(g)).toBeGreaterThan(groupRestPx(g));
  });

  it("falls back to the smallest tier's bounds for unknown groups", () => {
    expect(groupStartPx("nonsense")).toBe(12);
    expect(groupRestPx("nonsense")).toBe(8.5);
  });
});

describe("groupReferenceD", () => {
  it("gives more important tiers a higher reference size", () => {
    expect(groupReferenceD("capital")).toBeGreaterThan(groupReferenceD("city"));
    expect(groupReferenceD("city")).toBeGreaterThan(groupReferenceD("town"));
    expect(groupReferenceD("village")).toBeGreaterThan(groupReferenceD("hamlet"));
  });

  it("falls back to the town/city-tier reference for unknown groups", () => {
    expect(groupReferenceD("nonsense")).toBe(3.32);
  });
});
