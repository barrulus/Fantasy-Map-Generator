import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Point } from "../generators/voronoi";
import { calculateVoronoi, findAllCellsInRadius, findClosestCell } from "./graphUtils";

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

  // A Voronoi vertex is the circumcenter of its Delaunay triangle: equidistant from
  // all three of the triangle's points. Quantizing vertex coordinates (the old
  // Math.floor in circumcenter) breaks this and makes cells visibly blocky once cell
  // spacing approaches the quantization step (high cell counts).
  it("places each vertex at the exact circumcenter of its triangle (no rounding)", () => {
    const points: Point[] = [
      [3.17, 4.93],
      [11.61, 2.27],
      [7.44, 9.81],
      [14.02, 8.66],
      [10.35, 15.49],
      [2.71, 12.08]
    ];
    const boundary: Point[] = [
      [-50, -50],
      [70, -50],
      [70, 66],
      [-50, 66]
    ];

    const { vertices } = calculateVoronoi(points, boundary);
    const allPoints = points.concat(boundary);

    let checked = 0;
    vertices.p.forEach((vertex, t) => {
      const dist = (p: Point) => Math.hypot(vertex[0] - p[0], vertex[1] - p[1]);
      const [ra, rb, rc] = vertices.c[t].map(pointId => dist(allPoints[pointId]));
      expect(Math.abs(ra - rb), `vertex ${t} not equidistant from its triangle points`).toBeLessThan(1e-6);
      expect(Math.abs(ra - rc), `vertex ${t} not equidistant from its triangle points`).toBeLessThan(1e-6);
      checked++;
    });
    expect(checked).toBeGreaterThan(0);
  });
});

describe("packed-cell spatial queries", () => {
  it("reuses one quadtree for repeated queries against the same map", () => {
    const points: [number, number][] = [
      [0, 0],
      [5, 0],
      [10, 0]
    ];
    const mapPoints = vi.spyOn(points, "map");
    const graph = { cells: { p: points } };

    expect(findAllCellsInRadius(5, 0, 6, graph).sort()).toEqual([0, 1, 2]);
    expect(findAllCellsInRadius(5, 0, 2, graph)).toEqual([1]);
    expect(findClosestCell(6, 0, Infinity, graph)).toBe(1);
    expect(mapPoints).toHaveBeenCalledOnce();
  });
});
