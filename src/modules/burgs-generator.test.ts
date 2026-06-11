import { describe, expect, it } from "vitest";
import { nearestBurgId, skyburgAltitude, skyburgGroupFromPopulation, skyburgPlacementWeight } from "./burgs-generator";

describe("skyburgGroupFromPopulation", () => {
  it("assigns 'skyburg' to population >= 0.8", () => {
    expect(skyburgGroupFromPopulation(0.8)).toBe("skyburg");
    expect(skyburgGroupFromPopulation(1.0)).toBe("skyburg");
    expect(skyburgGroupFromPopulation(1.5)).toBe("skyburg");
  });

  it("assigns 'skyburg-mid' to population 0.4–0.799", () => {
    expect(skyburgGroupFromPopulation(0.4)).toBe("skyburg-mid");
    expect(skyburgGroupFromPopulation(0.6)).toBe("skyburg-mid");
    expect(skyburgGroupFromPopulation(0.799)).toBe("skyburg-mid");
  });

  it("assigns 'skyburg-small' to population < 0.4", () => {
    expect(skyburgGroupFromPopulation(0.2)).toBe("skyburg-small");
    expect(skyburgGroupFromPopulation(0.39)).toBe("skyburg-small");
  });

  it("boundary: 0.8 is 'skyburg', 0.799 is 'skyburg-mid'", () => {
    expect(skyburgGroupFromPopulation(0.8)).toBe("skyburg");
    expect(skyburgGroupFromPopulation(0.799)).toBe("skyburg-mid");
  });

  it("boundary: 0.4 is 'skyburg-mid', 0.399 is 'skyburg-small'", () => {
    expect(skyburgGroupFromPopulation(0.4)).toBe("skyburg-mid");
    expect(skyburgGroupFromPopulation(0.399)).toBe("skyburg-small");
  });
});

describe("skyburgAltitude", () => {
  it("clamps to 50 ft at and below the population floor", () => {
    expect(skyburgAltitude(0.1)).toBe(50);
    expect(skyburgAltitude(0.05)).toBe(50);
  });

  it("clamps to 500 ft at and above 1.5 units (sky capital range)", () => {
    expect(skyburgAltitude(1.5)).toBe(500);
    expect(skyburgAltitude(4)).toBe(500);
  });

  it("is monotonic non-decreasing and rounded to 10 ft", () => {
    let prev = 0;
    for (let p = 0.1; p <= 1.5; p += 0.05) {
      const alt = skyburgAltitude(p);
      expect(alt % 10).toBe(0);
      expect(alt).toBeGreaterThanOrEqual(prev);
      prev = alt;
    }
  });

  it("midpoint of the range sits near the middle of 50-500", () => {
    expect(skyburgAltitude(0.8)).toBe(280); // 50 + 450 * 0.5 = 275 -> 280
  });
});

describe("skyburgPlacementWeight", () => {
  it("full weight on coastal cells (|t| = 1)", () => {
    expect(skyburgPlacementWeight(1)).toBe(1);
    expect(skyburgPlacementWeight(-1)).toBe(1);
  });

  it("half weight one ring out (|t| = 2)", () => {
    expect(skyburgPlacementWeight(2)).toBe(0.5);
    expect(skyburgPlacementWeight(-2)).toBe(0.5);
  });

  it("low weight everywhere else (deep water t=0, far inland t>=3, far offshore t<=-3)", () => {
    expect(skyburgPlacementWeight(0)).toBe(0.15);
    expect(skyburgPlacementWeight(3)).toBe(0.15);
    expect(skyburgPlacementWeight(-3)).toBe(0.15);
  });
});

describe("nearestBurgId", () => {
  const burgs = [0, { x: 10, y: 10 }, { x: 50, y: 50 }, { x: 51, y: 49 }] as any[];

  it("returns the id of the burg closest to the point", () => {
    expect(nearestBurgId(burgs, [1, 2, 3], 0, 0)).toBe(1);
    expect(nearestBurgId(burgs, [1, 2, 3], 52, 48)).toBe(3);
  });

  it("only considers the given ids", () => {
    expect(nearestBurgId(burgs, [2], 0, 0)).toBe(2);
  });

  it("returns -1 for an empty id list", () => {
    expect(nearestBurgId(burgs, [], 0, 0)).toBe(-1);
  });
});
