// @vitest-environment node
import { describe, expect, it } from "vitest";
import { closestPoint, flattenCurve, parseShorePath, ShoreIndex } from "./shoreline-geometry";

describe("canonical shoreline curves", () => {
  it("parses saved absolute and relative line and Bezier commands", () => {
    const curves = parseShorePath("M10,20l5,0v5h-5q-5,0 -5,-5t5,-5c1,0 2,0 3,0s2,0 3,0z", 7);
    expect(curves.every(c => c.feature === 7)).toBe(true);
    expect(curves[0].points).toEqual([
      { x: 10, y: 20 },
      { x: 15, y: 20 }
    ]);
    expect(curves.at(-1)?.points.at(-1)).toEqual({ x: 10, y: 20 });
  });

  it("bounds adaptive flattening error on a cubic curve in metres", () => {
    const controls = [
      { x: 0, y: 0 },
      { x: 2000, y: 4000 },
      { x: 4000, y: -2000 },
      { x: 6000, y: 0 }
    ];
    const poly = flattenCurve(controls, 0.2);
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000,
        u = 1 - t;
      const p = {
        x: 3 * u * u * t * 2000 + 3 * u * t * t * 4000 + t ** 3 * 6000,
        y: 3 * u * u * t * 4000 - 3 * u * t * t * 2000
      };
      const distance = Math.min(
        ...poly.slice(1).map((b, j) => {
          const q = closestPoint(p, poly[j], b);
          return Math.hypot(q.x - p.x, q.y - p.y);
        })
      );
      expect(distance).toBeLessThanOrEqual(0.2);
    }
  });

  it("indexes curve control bounds so an entering arc is not discarded", () => {
    const index = new ShoreIndex(parseShorePath("M4000,-4000C1000,-2000 1000,2000 4000,4000", 1));
    expect(index.query({ minX: -3000, minY: -3000, maxX: 3000, maxY: 3000 })).toHaveLength(1);
  });

  it("rejects unsupported or malformed saved curves instead of declaring dry land", () => {
    expect(() => parseShorePath("M0,0A2,2 0 0 0 5,5", 1)).toThrow("Unsupported");
    expect(() => parseShorePath("M0,0C1,2", 1)).toThrow("Invalid");
  });
});
