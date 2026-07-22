import { describe, expect, it } from "vitest";
import { effectiveLabelPx } from "./label-sizing";
import {
  groupMaxZoom,
  groupMinZoom,
  groupRank,
  groupReferenceD,
  groupRestPx,
  groupStartPx,
  REST_PX
} from "./tier-table";

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
      "states",
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

  it("falls back to its own default bounds for unknown groups", () => {
    expect(groupStartPx("nonsense")).toBe(16);
    expect(groupRestPx("nonsense")).toBe(13);
  });
});

describe("groupMaxZoom", () => {
  it("gates states at zoom 10, disappearing rather than continuing to shrink", () => {
    expect(groupMaxZoom("states")).toBe(10);
  });

  it("does not gate any other tier — only states has a max-zoom", () => {
    for (const g of ["capital", "city", "town", "village", "hamlet", "nonsense"]) {
      expect(groupMaxZoom(g)).toBe(Infinity);
    }
  });
});

describe("legacy group aliases (pre-v1.109 `cities`/`towns` shells)", () => {
  it("resolves `cities` to the same values as `city`", () => {
    expect(groupRank("cities")).toBe(groupRank("city"));
    expect(groupMinZoom("cities")).toBe(groupMinZoom("city"));
    expect(groupStartPx("cities")).toBe(groupStartPx("city"));
    expect(groupRestPx("cities")).toBe(groupRestPx("city"));
    expect(groupReferenceD("cities")).toBe(groupReferenceD("city"));
  });

  it("resolves `towns` to the same values as `town`", () => {
    expect(groupRank("towns")).toBe(groupRank("town"));
    expect(groupMinZoom("towns")).toBe(groupMinZoom("town"));
    expect(groupStartPx("towns")).toBe(groupStartPx("town"));
    expect(groupRestPx("towns")).toBe(groupRestPx("town"));
    expect(groupReferenceD("towns")).toBe(groupReferenceD("town"));
  });
});

describe("states vs burgs invariant", () => {
  it(
    "REST_PX.states * 0.5 > REST_PX.capital: draw-state-labels.ts clamps each state's authored " +
      "size to 50-130% of the #states group base — even a state at the minimum 50% ratio must still " +
      "render bigger than the largest burg tier (capital), or a small state would look smaller than " +
      "a burg label, which is the bug this constant exists to prevent.",
    () => {
      expect(REST_PX.states * 0.5).toBeGreaterThan(REST_PX.capital);
    }
  );
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

describe("hierarchy: states > capital > city > town > village > hamlet", () => {
  const tiers = ["states", "capital", "city", "town", "village", "hamlet"];

  it("holds at every tested scale, not just at rest", () => {
    for (const scale of [1, 2, 5, 10, 20]) {
      const sizes = tiers.map(t => effectiveLabelPx(scale, groupStartPx(t), groupRestPx(t)));
      for (let i = 1; i < sizes.length; i++) {
        expect(sizes[i]).toBeLessThan(sizes[i - 1]);
      }
    }
  });

  it("every resting size is legible (>= 11px)", () => {
    for (const px of Object.values(REST_PX)) expect(px).toBeGreaterThanOrEqual(11);
  });

  it("every tier's start size exceeds its resting size, including states", () => {
    for (const t of tiers) expect(groupStartPx(t)).toBeGreaterThan(groupRestPx(t));
  });
});
