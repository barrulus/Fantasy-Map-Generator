import { describe, expect, test } from "vitest";
import { capVisible, cellFillColor, encodeCellFill, strideVisible } from "./draw-goods";

describe("cell fill encoding", () => {
  test("keys are truthy and unique per good and intensity bucket", () => {
    const keys = [encodeCellFill(0, 0), encodeCellFill(0, 1), encodeCellFill(1, 0), encodeCellFill(1, 1)];
    expect(Math.min(...keys)).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("full intensity renders the good color fully opaque", () => {
    const key = encodeCellFill(3, 1);
    expect(cellFillColor(key, goodId => (goodId === 3 ? "#966f33" : "#000000"))).toBe("#966f33ff");
  });

  test("zero intensity renders the faintest bucket, not invisible", () => {
    const key = encodeCellFill(3, 0);
    expect(cellFillColor(key, () => "#966f33")).toBe("#966f3347");
  });
});

describe("capVisible", () => {
  const bounds = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const items = [
    { x: 10, y: 10 },
    { x: 500, y: 10 },
    { x: 20, y: 20 },
    { x: 30, y: 30 }
  ];

  test("keeps input order and drops out-of-bounds items", () => {
    expect(capVisible(items, bounds, 10)).toEqual([items[0], items[2], items[3]]);
  });

  test("stops at the cap", () => {
    expect(capVisible(items, bounds, 2)).toEqual([items[0], items[2]]);
  });

  test("pad extends the bounds", () => {
    expect(capVisible([{ x: -5, y: 50 }], bounds, 10, 10)).toHaveLength(1);
  });
});

describe("strideVisible", () => {
  const bounds = { x0: 0, y0: 0, x1: 100, y1: 100 };
  const items = Array.from({ length: 10 }, (_, i) => ({ x: i * 10, y: 50 }));

  test("returns all visible items when under the cap", () => {
    expect(strideVisible(items, bounds, 20)).toHaveLength(10);
  });

  test("samples uniformly down to the cap", () => {
    expect(strideVisible(items, bounds, 3)).toEqual([items[0], items[4], items[8]]);
  });

  test("drops out-of-bounds items before sampling", () => {
    const mixed = [...items, ...Array.from({ length: 10 }, (_, i) => ({ x: 1000 + i, y: 50 }))];
    expect(strideVisible(mixed, bounds, 3)).toEqual([items[0], items[4], items[8]]);
  });
});
