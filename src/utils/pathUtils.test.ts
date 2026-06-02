import FlatQueue from "flatqueue";
import { beforeAll, describe, expect, it } from "vitest";
import { findPath } from "./pathUtils";

// Build a tiny 5×5 grid packed-graph fixture. Each cell's neighbours are
// its 4-connected grid neighbours. Position is its grid coordinate.
function makeGrid(n: number) {
  const cells: any = {
    i: new Uint32Array(n * n),
    c: [] as number[][],
    p: [] as [number, number][]
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const id = y * n + x;
      cells.i[id] = id;
      cells.p.push([x, y]);
      const neibs: number[] = [];
      if (x > 0) neibs.push(id - 1);
      if (x < n - 1) neibs.push(id + 1);
      if (y > 0) neibs.push(id - n);
      if (y < n - 1) neibs.push(id + n);
      cells.c.push(neibs);
    }
  }
  return { cells };
}

describe("findPath", () => {
  beforeAll(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.FlatQueue = FlatQueue;
  });

  it("finds a straight path on a 5x5 grid", () => {
    const g = makeGrid(5);
    const path = findPath(
      0,
      c => c === 24,
      () => 1,
      g
    );
    expect(path).not.toBeNull();
    expect(path![0]).toBe(0);
    expect(path![path!.length - 1]).toBe(24);
    expect(path!.length).toBeLessThanOrEqual(9);
  });

  it("returns null when start is the exit", () => {
    const g = makeGrid(5);
    expect(
      findPath(
        7,
        c => c === 7,
        () => 1,
        g
      )
    ).toBeNull();
  });

  it("respects Infinity costs (impassable cells)", () => {
    const g = makeGrid(5);
    const blocked = new Set([1, 6, 11, 16]); // partial wall at x=1, gap at (1,4) allows routing around
    const getCost = (_: number, next: number) => (blocked.has(next) ? Infinity : 1);
    const path = findPath(0, c => c === 24, getCost, g);
    expect(path).not.toBeNull();
    expect(path!.every(c => !blocked.has(c) || c === 0)).toBe(true);
  });

  it("A* with euclidean heuristic returns same path on uniform cost", () => {
    const g = makeGrid(10);
    const dijkstra = findPath(
      0,
      c => c === 99,
      () => 1,
      g
    );
    const astar = findPath(
      0,
      c => c === 99,
      () => 1,
      g,
      99
    );
    expect(astar).not.toBeNull();
    expect(astar!.length).toBe(dijkstra!.length);
  });

  it("reuses buffers across calls without leaking state", () => {
    const g = makeGrid(10);
    const a = findPath(
      0,
      c => c === 99,
      () => 1,
      g,
      99
    );
    const b = findPath(
      99,
      c => c === 0,
      () => 1,
      g,
      0
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a![0]).toBe(0);
    expect(b![0]).toBe(99);
  });
});

function makeCylinderGrid(n: number) {
  const cells: any = { i: new Uint32Array(n * n), c: [] as number[][], p: [] as [number, number][] };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const id = y * n + x;
      cells.i[id] = id;
      cells.p.push([x, y]);
      const neibs: number[] = [];
      neibs.push(y * n + ((x - 1 + n) % n)); // wrap left
      neibs.push(y * n + ((x + 1) % n)); // wrap right
      if (y > 0) neibs.push(id - n);
      if (y < n - 1) neibs.push(id + n);
      cells.c.push(neibs);
    }
  }
  return { cells };
}

describe("findPath cylinder/seam tests", () => {
  beforeAll(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.FlatQueue = FlatQueue;
  });

  it("crosses the seam when the interior is walled off (wrapWidth heuristic)", () => {
    const n = 7;
    const g = makeCylinderGrid(n);
    const mid = (n - 1) / 2; // column 3 is an impassable wall
    const wall = new Set<number>();
    for (let y = 0; y < n; y++) wall.add(y * n + mid);
    const getCost = (_: number, next: number) => (wall.has(next) ? Infinity : 1);

    const start = 0; // (0,0) — left edge
    const goal = n - 1; // (6,0) — right edge
    const path = findPath(start, c => c === goal, getCost, g, goal, n);

    expect(path).not.toBeNull();
    expect(path![0]).toBe(start);
    expect(path![path!.length - 1]).toBe(goal);
    expect(path!.length).toBe(2);
  });
});
