import { describe, expect, it } from "vitest";
import { compassBearing, elevationMetres, hashSeedToInt, kmToWorldUnits, scaledPopulation } from "./burg-context";

describe("compassBearing", () => {
  // SVG coordinates: y grows DOWNWARD, so north is negative dy
  it("maps the four cardinals with the y-down sign convention", () => {
    expect(compassBearing(0, -1)).toBe(0); // north
    expect(compassBearing(1, 0)).toBe(90); // east
    expect(compassBearing(0, 1)).toBe(180); // south
    expect(compassBearing(-1, 0)).toBe(270); // west
  });

  it("returns a value in [0, 360)", () => {
    expect(compassBearing(-1, -1)).toBeCloseTo(315, 6);
    expect(compassBearing(0, 0)).toBe(0); // degenerate: no displacement
  });
});

describe("elevationMetres", () => {
  it("uses the land formula above sea level", () => {
    expect(elevationMetres(20, 2)).toBe(4); // (20-18)^2
    expect(elevationMetres(30, 2)).toBe(144); // (30-18)^2
  });

  it("uses the depth formula below sea level", () => {
    expect(elevationMetres(10, 2)).toBe(-50); // ((10-20)/10)*50
  });

  it("returns the deep-water sentinel at or below zero height", () => {
    expect(elevationMetres(0, 2)).toBe(-990);
  });
});

describe("kmToWorldUnits", () => {
  it("divides by the km-per-world-unit scale", () => {
    expect(kmToWorldUnits(12, 3)).toBe(4);
  });

  it("falls back to a scale of 1 when distanceScale is zero or missing", () => {
    expect(kmToWorldUnits(12, 0)).toBe(12);
  });
});

describe("hashSeedToInt", () => {
  it("is deterministic", () => {
    expect(hashSeedToInt("1234560007")).toBe(hashSeedToInt("1234560007"));
  });

  it("separates burgs on the same map and the same burg across maps", () => {
    expect(hashSeedToInt("1234560007")).not.toBe(hashSeedToInt("1234560008"));
    expect(hashSeedToInt("1234560007")).not.toBe(hashSeedToInt("9999990007"));
  });

  it("returns a non-negative 32-bit integer", () => {
    const h = hashSeedToInt("anything");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("scaledPopulation", () => {
  it("applies the same population scaling the watabou builders use", () => {
    expect(scaledPopulation(10, 1000, 0.5)).toBe(5000);
  });

  it("rounds to a whole number of people", () => {
    expect(scaledPopulation(0.0031, 1000, 0.5)).toBe(2);
  });
});
