import FlatQueue from "flatqueue";
import { beforeAll, describe, expect, it } from "vitest";
import type { Point } from "../generators/voronoi";
import { findPath, findPathTree, meander } from "./pathUtils";

// ---------------------------------------------------------------------------
// Fork tests: findPath / findPathTree
// ---------------------------------------------------------------------------

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

describe("findPathTree", () => {
  beforeAll(() => {
    (globalThis as any).window = (globalThis as any).window ?? {};
    (globalThis as any).window.FlatQueue = FlatQueue;
  });

  it("returns a shortest path to every target from one search", () => {
    const g = makeGrid(5); // ids 0..24, 4-connected, unit cost
    const paths = findPathTree(0, [4, 20, 24], () => 1, g);

    expect([...paths.keys()].sort((a, b) => a - b)).toEqual([4, 20, 24]);
    // each path starts at the source, ends at its target, and is a shortest path
    // (Manhattan distance + 1 cells on a unit-cost 4-connected grid)
    expect(paths.get(4)![0]).toBe(0);
    expect(paths.get(4)![paths.get(4)!.length - 1]).toBe(4);
    expect(paths.get(4)!.length).toBe(5); // 0->1->2->3->4
    expect(paths.get(24)!.length).toBe(9); // 8 steps corner-to-corner
  });

  it("settles a target that is impassable to ENTER (a port on land, reached by discovery)", () => {
    // Real ports sit on land cells (cost Infinity to enter) reached across water.
    // The target must still be returned, terminating the path like findPath's isExit.
    const g = makeGrid(5);
    const land = new Set([12, 24]); // both targets cost Infinity to enter
    const getCost = (_: number, next: number) => (land.has(next) ? Infinity : 1);
    const paths = findPathTree(0, [12, 24], getCost, g);

    expect(paths.has(12)).toBe(true);
    expect(paths.has(24)).toBe(true);
    expect(paths.get(24)![paths.get(24)!.length - 1]).toBe(24); // path actually ends at the target
  });

  it("omits unreachable targets", () => {
    const g = makeGrid(5);
    const blocked = new Set([19, 23]); // wall off cell 24's only two approaches
    const getCost = (_: number, next: number) => (blocked.has(next) ? Infinity : 1);
    const paths = findPathTree(0, [12, 24], getCost, g);

    expect(paths.has(12)).toBe(true);
    expect(paths.has(24)).toBe(false);
  });

  it("excludes the start cell from its own targets", () => {
    const g = makeGrid(5);
    const paths = findPathTree(7, [7, 8], () => 1, g);
    expect(paths.has(7)).toBe(false);
    expect(paths.has(8)).toBe(true);
  });

  it("returns an empty map when there are no reachable targets", () => {
    const g = makeGrid(5);
    expect(findPathTree(0, [], () => 1, g).size).toBe(0);
    expect(findPathTree(3, [3], () => 1, g).size).toBe(0); // only target is the start
  });

  it("stops exploring beyond maxCost, dropping targets that are farther by water", () => {
    const g = makeGrid(5); // unit cost: path cost == step count
    // target 4 costs 4 steps; target 24 costs 8 steps
    const paths = findPathTree(0, [4, 24], () => 1, g, { maxCost: 5 });

    expect(paths.has(4)).toBe(true);
    expect(paths.has(24)).toBe(false);
  });

  it("maxCost bounds the number of expanded cells", () => {
    const g = makeGrid(11); // 121 cells
    const far = 120; // opposite corner, cost 20 — far beyond the bound
    const stats = { expanded: 0 };
    const paths = findPathTree(0, [far], () => 1, g, { maxCost: 4, stats });

    expect(paths.size).toBe(0);
    // expansion stays within the cost-4 ball (15 cells), not the whole grid
    expect(stats.expanded).toBeLessThanOrEqual(15);
  });

  it("still settles a target discovered from a frontier cell at maxCost", () => {
    const g = makeGrid(5);
    // target 4 is 4 steps away; the cell before it (cost 3) is within the bound,
    // and discovery settles targets before the cost gate — exactly like land ports.
    const paths = findPathTree(0, [4], () => 1, g, { maxCost: 3 });
    expect(paths.has(4)).toBe(true);
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

// ---------------------------------------------------------------------------
// Upstream tests: meander (addMeandering low-level utility)
// ---------------------------------------------------------------------------

describe("addMeandering", () => {
  // Cells positions arranged along x-axis with enough spacing to trigger interior point insertion
  const linearCellPositions: Point[] = [
    [0, 0],
    [10, 0],
    [20, 0],
    [30, 0],
    [40, 0],
    [50, 0]
  ];
  const linearCells = [0, 1, 2, 3, 4, 5];

  it("returns one entry in anchorIndices per input cell, with anchorIndices[0] === 0", () => {
    const { anchorIndices } = meander(linearCells, linearCellPositions);
    expect(anchorIndices.length).toBe(linearCells.length);
    expect(anchorIndices[0]).toBe(0);
  });

  it("preserves anchor positions in the output", () => {
    const { points, anchorIndices } = meander(linearCells, linearCellPositions);
    for (let k = 0; k < linearCells.length; k++) {
      const expected = linearCellPositions[linearCells[k]];
      const actual = points[anchorIndices[k]];
      expect(actual[0]).toBe(expected[0]);
      expect(actual[1]).toBe(expected[1]);
    }
  });

  it("inserts interior meander points on perpendicular side; reversing puts them on opposite side", () => {
    const forward = meander(linearCells, linearCellPositions);
    const reversed = meander(linearCells.slice().reverse(), linearCellPositions);

    expect(forward.points.length).toBeGreaterThan(forward.anchorIndices.length);
    expect(reversed.points.length).toBe(forward.points.length);

    // Find any interior point in forward output and confirm at least one has non-zero y (perpendicular offset)
    const interiorYs = forward.points
      .map((p, i) => (forward.anchorIndices.includes(i) ? null : p[1]))
      .filter((y): y is number => y !== null);
    expect(interiorYs.some(y => y !== 0)).toBe(true);

    // Sum of interior y-offsets should flip sign when input is reversed (mirror symmetry).
    const interiorYReversed = reversed.points
      .map((p, i) => (reversed.anchorIndices.includes(i) ? null : p[1]))
      .filter((y): y is number => y !== null);
    const forwardSign = Math.sign(interiorYs.reduce((s, y) => s + y, 0));
    const reverseSign = Math.sign(interiorYReversed.reduce((s, y) => s + y, 0));
    expect(forwardSign).not.toBe(0);
    expect(reverseSign).not.toBe(0);
    expect(forwardSign).not.toBe(reverseSign);
  });

  it("shrinks meander amplitude as startStep increases", () => {
    // Use cells.length >= 6 and modest spacing so both startStep values land in the same branch
    // (single interior point per segment), letting us compare amplitudes directly.
    const cells = [0, 1, 2, 3, 4, 5];
    const positions: Point[] = [
      [0, 0],
      [7, 0],
      [14, 0],
      [21, 0],
      [28, 0],
      [35, 0]
    ];

    const lowStep = meander(cells, positions, { startStep: 30 });
    const highStep = meander(cells, positions, { startStep: 60 });

    expect(lowStep.points.length).toBe(highStep.points.length);

    // Compare interior point amplitudes (distance from y=0)
    const lowInterior = lowStep.points.filter((_, i) => !lowStep.anchorIndices.includes(i));
    const highInterior = highStep.points.filter((_, i) => !highStep.anchorIndices.includes(i));
    expect(lowInterior.length).toBeGreaterThan(0);
    expect(highInterior.length).toBe(lowInterior.length);

    const lowAmplitude = Math.abs(lowInterior[0][1]);
    const highAmplitude = Math.abs(highInterior[0][1]);
    expect(highAmplitude).toBeLessThan(lowAmplitude);
    // Perpendicular direction (sign of y offset) is the same since cells are in same order
    expect(Math.sign(lowInterior[0][1])).toBe(Math.sign(highInterior[0][1]));
  });

  it("resolves an off-map (-1) entry to the nearest map edge via bounds", () => {
    const cells = [0, 1, -1];
    const positions: Point[] = [
      [50, 50],
      [50, 80] // near bottom edge
    ];
    const { points, anchorIndices } = meander(cells, positions, {
      bounds: { width: 100, height: 100 }
    });

    // Anchor for the -1 cell should be projected to the bottom edge (y=100), using cell 1's position
    const lastAnchorIdx = anchorIndices[2];
    const lastAnchor = points[lastAnchorIdx];
    expect(lastAnchor[0]).toBe(50);
    expect(lastAnchor[1]).toBe(100);
  });

  it("flips meander direction at acute turns to smooth cusps, never moving anchors", () => {
    const angleAt = (points: Point[], i: number) => {
      const [px, py] = points[i - 1];
      const [cx, cy] = points[i];
      const [nx, ny] = points[i + 1];
      const ax = px - cx;
      const ay = py - cy;
      const bx = nx - cx;
      const by = ny - cy;
      const cos = (ax * bx + ay * by) / (Math.hypot(ax, ay) * Math.hypot(bx, by));
      return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    };

    // A serpentine backbone whose cell turns would otherwise fold into acute "V" cusps once the
    // perpendicular meander offsets are applied.
    const cells = [0, 1, 2, 3, 4, 5];
    const positions: Point[] = [
      [0, 0],
      [10, 8],
      [20, 0],
      [30, 8],
      [40, 0],
      [50, 8]
    ];
    const { points, anchorIndices } = meander(cells, positions, { startStep: 6 });

    // Anchors (real control points: confluences, ports) must stay exactly on their cell centres —
    // displacing them would tear tributary confluences apart or pull river ports off the course.
    for (let k = 0; k < cells.length; k++) {
      expect(points[anchorIndices[k]]).toEqual(positions[cells[k]]);
    }

    // No corner — at an anchor or a meander point — is left acute after flipping.
    let minAngle = 180;
    for (let i = 1; i < points.length - 1; i++) minAngle = Math.min(minAngle, angleAt(points, i));
    expect(minAngle).toBeGreaterThan(88);

    // Flipping mirrors a meander point across its baseline, so the amplitude is preserved (not
    // flattened): a straight backbone still carries its meander S-curve off the centreline.
    const straight = meander(linearCells, linearCellPositions, { startStep: 10 });
    expect(Math.max(...straight.points.map(p => Math.abs(p[1])))).toBeGreaterThan(0);
  });

  it("honours explicit anchors override", () => {
    const cells = [0, 1, 2];
    const positions: Point[] = [
      [0, 0],
      [10, 0],
      [20, 0]
    ];
    const overrideAnchors: Point[] = [
      [5, 5],
      [15, 5],
      [25, 5]
    ];
    const { points, anchorIndices } = meander(cells, positions, { anchors: overrideAnchors });

    for (let k = 0; k < cells.length; k++) {
      const actual = points[anchorIndices[k]];
      expect(actual[0]).toBe(overrideAnchors[k][0]);
      expect(actual[1]).toBe(overrideAnchors[k][1]);
    }
  });
});
