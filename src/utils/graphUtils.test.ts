import { beforeAll, describe, expect, it } from "vitest";
import type { Point } from "../generators/voronoi";
import { calculateVoronoi } from "./graphUtils";

beforeAll(() => {
  // TIME is an app-wide profiling global guarded as `TIME && console.time(...)`.
  (globalThis as any).TIME = (globalThis as any).TIME ?? false;
});

describe("calculateVoronoi", () => {
  // Delaunator drops exactly-coincident input points, so the Voronoi builder never
  // assigns a neighbour list for the duplicate's index. calculateVoronoi must still
  // return a cells.c that is consistent with the dense cells.i it generates, or
  // downstream consumers (markupPack: `for (const n of neighbors[cellId])`) crash
  // with "neighbors[cellId] is not iterable".
  it("never leaves a cells.c hole when input has coincident points", () => {
    const points: Point[] = [
      [0, 0],
      [100, 0],
      [50, 80],
      [150, 80],
      [100, 160],
      [50, 80] // exact duplicate of index 2
    ];
    const boundary: Point[] = [
      [-500, -500],
      [600, -500],
      [600, 660],
      [-500, 660]
    ];

    const { cells } = calculateVoronoi(points, boundary);

    for (const i of cells.i) {
      expect(Array.isArray(cells.c[i]), `cells.c[${i}] should be an array`).toBe(true);
      expect(Array.isArray(cells.v[i]), `cells.v[${i}] should be an array`).toBe(true);
    }
  });
});
