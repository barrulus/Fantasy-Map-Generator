# Seam-Wrapping Sea & Air Routes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let sea routes and air routes cross the east/west map seam on full-globe maps, so continents near opposite edges can trade and ships can circumnavigate.

**Architecture:** All logic is gated on `mapCoordinates.lonT === 360` (a true globe); on any other map nothing changes. Sea routes cross via a seam-augmented adjacency graph used *only* for sea pathfinding (the global `pack.cells.c` is untouched), plus wrap-aware water cost and an opt-in wrapped A\* heuristic. Burg pairing (Urquhart/MST) uses wrap-aware distance. The seam is split and stub-extended only at render time in `Routes.getPath()`; route points stay in `[0, graphWidth]`.

**Tech Stack:** TypeScript, Vitest, d3 (`line`, `curveCatmullRom`), Delaunator. Run type-check with `tsc --noEmit`; tests with `npx vitest run`.

**Spec:** `docs/superpowers/specs/2026-06-02-seam-wrapping-routes-design.md`

**Note on a dropped item:** The spec mentions a `getPoints` sharp-angle smoothing guard. It is unnecessary — `getPoints` skips smoothing for `group === "searoutes"` (the only sea path group), and air routes bypass `getPoints` entirely. No smoothing task is included.

---

## File structure

- `src/types/global.ts` — add a `mapCoordinates` global declaration (currently undeclared for TS).
- `src/modules/routes-generator.ts` — all feature logic: wrap helpers, seam adjacency, wrap-aware cost, generator wiring, `getPath` seam split, wrapped `getLength`.
- `src/utils/pathUtils.ts` — optional `wrapWidth?` param on `findPath` (heuristic only).
- `src/modules/routes-generator.test.ts` — helper, adjacency, Urquhart, `getPath`, `getLength` tests.
- `src/utils/pathUtils.test.ts` — `findPath` cylinder/wrap test.

---

## Task 1: Wrap helpers + global declaration

**Files:**
- Modify: `src/types/global.ts` (add `mapCoordinates` decl)
- Modify: `src/modules/routes-generator.ts` (add exported helpers near top, after imports/before `RoutesModule`)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/modules/routes-generator.test.ts` (the file already imports the module and exposes `Routes`; add a fresh import of the helpers at the top of the file, next to the existing imports):

```ts
import { isWrapEnabled, wrapDeltaX, wrapDistanceSquared } from "./routes-generator";

describe("wrap helpers", () => {
  it("wrapDeltaX returns the shorter cylinder gap", () => {
    expect(wrapDeltaX(10, 100)).toBe(10); // direct is shorter
    expect(wrapDeltaX(90, 100)).toBe(10); // around the seam is shorter
    expect(wrapDeltaX(-90, 100)).toBe(10); // sign-independent
    expect(wrapDeltaX(50, 100)).toBe(50); // exactly half
  });

  it("wrapDistanceSquared wraps X only when enabled", () => {
    // two points near opposite edges, same latitude
    const a: [number, number] = [5, 40];
    const b: [number, number] = [95, 40];
    expect(wrapDistanceSquared(a, b, false, 100)).toBe(90 * 90); // flat: far
    expect(wrapDistanceSquared(a, b, true, 100)).toBe(10 * 10); // wrapped: close
  });

  it("isWrapEnabled is true only at lonT === 360", () => {
    const g = globalThis as any;
    g.mapCoordinates = { lonT: 360 };
    expect(isWrapEnabled()).toBe(true);
    g.mapCoordinates = { lonT: 359.9 };
    expect(isWrapEnabled()).toBe(false);
    g.mapCoordinates = undefined;
    expect(isWrapEnabled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "wrap helpers"`
Expected: FAIL — `isWrapEnabled`/`wrapDeltaX`/`wrapDistanceSquared` are not exported.

- [ ] **Step 3: Add the `mapCoordinates` global declaration**

In `src/types/global.ts`, inside the `declare global { ... }` block alongside the other `var` declarations (e.g. after `var graphWidth: number;`):

```ts
  var mapCoordinates: {
    latT: number;
    latN: number;
    latS: number;
    lonT: number;
    lonW: number;
    lonE: number;
  };
```

- [ ] **Step 4: Implement the helpers**

In `src/modules/routes-generator.ts`, immediately after the import lines and before `const ROUTES_SHARP_ANGLE`, add:

```ts
// --- Seam wrapping (full-globe maps only) ----------------------------------
// On a 360° equirectangular map the east/west edges are a seam: cells and burgs
// near opposite edges are close on the globe but far on the flat map. These
// helpers let sea & air routes cross that seam. Everything is inert unless the
// map spans a full 360° of longitude.

export function isWrapEnabled(): boolean {
  return typeof mapCoordinates !== "undefined" && !!mapCoordinates && mapCoordinates.lonT === 360;
}

// Horizontal gap on a cylinder of the given width: the shorter of going
// directly or around the seam.
export function wrapDeltaX(dx: number, width: number): number {
  const abs = Math.abs(dx);
  return Math.min(abs, width - abs);
}

// distanceSquared variant that wraps in X (and only X) when `wrap` is true.
export function wrapDistanceSquared(
  a: [number, number],
  b: [number, number],
  wrap: boolean,
  width: number
): number {
  const dx = wrap ? wrapDeltaX(a[0] - b[0], width) : a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "wrap helpers"`
Expected: PASS

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/global.ts src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): add seam-wrap helpers and mapCoordinates global decl"
```

---

## Task 2: `findPath` wrapWidth heuristic parameter

**Files:**
- Modify: `src/utils/pathUtils.ts:299` (`findPath` signature + heuristic)
- Test: `src/utils/pathUtils.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the existing `describe("findPath", ...)` block in `src/utils/pathUtils.test.ts`. It builds a cylinder grid (row neighbours wrap x=0 ↔ x=n-1) with a solid wall down the middle column so the *only* connection between the left and right halves is across the seam:

```ts
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
  // The only left↔right connection is the seam (x=0 ↔ x=n-1), so the path is short.
  expect(path!.length).toBe(2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/pathUtils.test.ts -t "crosses the seam"`
Expected: FAIL — `findPath` does not accept a 6th `wrapWidth` argument (TS/compile error or wrong path), and/or the heuristic mis-orders.

- [ ] **Step 3: Add the `wrapWidth` parameter and wrap the heuristic**

In `src/utils/pathUtils.ts`, change the `findPath` signature (line ~299) to add a final optional param:

```ts
export const findPath = (
  start: number,
  isExit: (id: number) => boolean,
  getCost: (current: number, next: number) => number,
  packedGraph: any = {},
  goal?: number,
  wrapWidth?: number
): number[] | null => {
```

Then replace the `heuristic` definition (the `const heuristic = useHeuristic ? (cellId) => {...} : null;` block) with a wrap-aware version:

```ts
  const heuristic = useHeuristic
    ? (cellId: number) => {
        const p = cellsP[cellId];
        let dx = p[0] - gx;
        if (wrapWidth) {
          const abs = Math.abs(dx);
          dx = Math.min(abs, wrapWidth - abs);
        }
        const dy = p[1] - gy;
        return Math.sqrt(dx * dx + dy * dy);
      }
    : null;
```

- [ ] **Step 4: Run the new test and the full pathUtils suite**

Run: `npx vitest run src/utils/pathUtils.test.ts`
Expected: PASS — the new test passes and all pre-existing `findPath` tests still pass (the param is optional and defaults to undefined → identical behavior).

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/pathUtils.ts src/utils/pathUtils.test.ts
git commit -m "feat(pathfinding): optional wrapWidth heuristic for cylinder A*"
```

---

## Task 3: Seam-augmented sea adjacency builder

**Files:**
- Modify: `src/modules/routes-generator.ts` (new private method `buildSeaAdjacency`)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/modules/routes-generator.test.ts`:

```ts
describe("buildSeaAdjacency", () => {
  it("links west-edge water cells to the nearest east-edge water cell by latitude", () => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    // cells: 0 west-water(y10), 1 east-water(y12), 2 interior-water, 3 west-LAND, 4 east-water(y82), 5 west-water(y78)
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1, 2, 3, 4, 5]),
        h: [0, 0, 0, 30, 0, 0],
        p: [[10, 10], [90, 12], [50, 50], [10, 80], [88, 82], [12, 78]] as [number, number][],
        c: [[], [], [], [], [], []] as number[][]
      }
    };

    const adj = (Routes as any).buildSeaAdjacency();

    expect(adj[0]).toContain(1); // west(y10) -> east(y12)
    expect(adj[1]).toContain(0); // bidirectional
    expect(adj[5]).toContain(4); // west(y78) -> east(y82)
    expect(adj[4]).toContain(5);
    expect(adj[3]).toEqual([]); // land edge cell untouched
    expect(g.pack.cells.c[0]).toEqual([]); // global graph NOT mutated
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "buildSeaAdjacency"`
Expected: FAIL — `buildSeaAdjacency` is not a function.

- [ ] **Step 3: Implement `buildSeaAdjacency`**

In `src/modules/routes-generator.ts`, add this private method to `RoutesModule` (place it just before `findPathSegments`):

```ts
  // Copy of pack.cells.c with seam links added between west-edge and east-edge
  // water cells, matched by latitude. pack.cells.c itself is never mutated.
  // Used only for sea-route pathfinding on full-globe maps.
  private buildSeaAdjacency(): number[][] {
    const { cells } = pack;
    const width = graphWidth;
    const margin = grid.spacing; // one-cell band at each edge
    const isWater = (c: number) => cells.h[c] < 20;

    const westEdge: number[] = [];
    const eastEdge: number[] = [];
    for (let i = 0; i < cells.i.length; i++) {
      if (!isWater(i)) continue;
      const x = cells.p[i][0];
      if (x <= margin) westEdge.push(i);
      else if (x >= width - margin) eastEdge.push(i);
    }

    if (!westEdge.length || !eastEdge.length) return cells.c;

    // Sort east cells by latitude for nearest-y matching via binary search.
    eastEdge.sort((a, b) => cells.p[a][1] - cells.p[b][1]);
    const eastY = eastEdge.map(c => cells.p[c][1]);

    // Shallow-copy the neighbour array; only edge cells get fresh inner arrays.
    const c = cells.c.slice();
    const link = (a: number, b: number) => {
      if (c[a] === cells.c[a]) c[a] = cells.c[a].slice();
      if (c[b] === cells.c[b]) c[b] = cells.c[b].slice();
      if (!c[a].includes(b)) c[a].push(b);
      if (!c[b].includes(a)) c[b].push(a);
    };

    for (const w of westEdge) {
      const y = cells.p[w][1];
      let lo = 0;
      let hi = eastY.length - 1;
      let best = 0;
      let bestD = Infinity;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const d = Math.abs(eastY[mid] - y);
        if (d < bestD) {
          bestD = d;
          best = mid;
        }
        if (eastY[mid] < y) lo = mid + 1;
        else hi = mid - 1;
      }
      link(w, eastEdge[best]);
    }

    return c;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "buildSeaAdjacency"`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): build isolated seam-augmented sea adjacency graph"
```

---

## Task 4: Wrap-aware Urquhart edges (ghost-point technique)

**Files:**
- Modify: `src/modules/routes-generator.ts` (`calculateUrquhartEdges` gains optional wrap params)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/modules/routes-generator.test.ts`:

```ts
describe("calculateUrquhartEdges wrap", () => {
  const hasEdge = (edges: number[][], a: number, b: number) =>
    edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  it("connects points across the seam only when wrap is enabled", () => {
    // 0 & 1 hug opposite edges at the same latitude; 2 & 3 are interior anchors
    const points: [number, number][] = [
      [5, 50], // 0 west edge
      [95, 50], // 1 east edge
      [40, 10], // 2
      [60, 90] // 3
    ];

    const flat = (Routes as any).calculateUrquhartEdges(points, false, 100);
    const wrapped = (Routes as any).calculateUrquhartEdges(points, true, 100);

    expect(hasEdge(flat, 0, 1)).toBe(false); // far apart on the flat map
    expect(hasEdge(wrapped, 0, 1)).toBe(true); // close across the seam
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "calculateUrquhartEdges wrap"`
Expected: FAIL — current `calculateUrquhartEdges` ignores extra args and never produces the 0–1 edge.

- [ ] **Step 3: Implement the wrap branch**

In `src/modules/routes-generator.ts`, replace the `calculateUrquhartEdges` method signature and add a wrap branch. Change the signature line:

```ts
  private calculateUrquhartEdges(points: Point[], wrap = false, width = 0) {
```

Keep the existing body for the non-wrap case, but at the very top of the method (after the two early returns for `< 2` / `=== 2` points) insert:

```ts
    if (wrap && width > 0) return this.calculateWrapUrquhartEdges(points, width);
```

Then add the new private method directly below `calculateUrquhartEdges`:

```ts
  // Toroidal (periodic-X) Urquhart graph. Duplicate every point shifted by
  // ±width, triangulate the augmented set, map each edge back to its real
  // index, drop self-loops, and dedupe. Edges from a real left point to a
  // ghost of a real right point become real cross-seam pairings.
  private calculateWrapUrquhartEdges(points: Point[], width: number) {
    const aug: Point[] = [];
    const realOf: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x, y] = points[i];
      aug.push([x, y]);
      realOf.push(i);
      aug.push([x + width, y]);
      realOf.push(i);
      aug.push([x - width, y]);
      realOf.push(i);
    }

    const score = (p0: number, p1: number) => distanceSquared(aug[p0], aug[p1]);
    const { halfedges, triangles } = Delaunator.from(aug);
    const n = triangles.length;
    const removed = new Uint8Array(n);

    for (let e = 0; e < n; e += 3) {
      const p0 = triangles[e];
      const p1 = triangles[e + 1];
      const p2 = triangles[e + 2];
      const p01 = score(p0, p1);
      const p12 = score(p1, p2);
      const p20 = score(p2, p0);
      removed[
        p20 > p01 && p20 > p12
          ? Math.max(e + 2, halfedges[e + 2])
          : p12 > p01 && p12 > p20
            ? Math.max(e + 1, halfedges[e + 1])
            : Math.max(e, halfedges[e])
      ] = 1;
    }

    const seen = new Set<number>();
    const edges: number[][] = [];
    for (let e = 0; e < n; ++e) {
      if (e > halfedges[e] && !removed[e]) {
        const a = realOf[triangles[e]];
        const b = realOf[triangles[e % 3 === 2 ? e - 2 : e + 1]];
        if (a === b) continue;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const key = lo * points.length + hi;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push([a, b]);
      }
    }

    return edges;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "calculateUrquhartEdges wrap"`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): toroidal Urquhart graph for cross-seam burg pairing"
```

---

## Task 5: Wrap-aware water cost + sea pathfinding shim

**Files:**
- Modify: `src/modules/routes-generator.ts` (`createCostEvaluator` water cost; `findPathSegments` shim)

This task is wiring whose end-to-end behavior is exercised by the integration in Task 6 and manual verification. Gate it on `tsc --noEmit` plus the existing suite staying green.

- [ ] **Step 1: Make the water cost wrap-aware**

In `src/modules/routes-generator.ts`, inside `createCostEvaluator`, change `getWaterPathCost` so its distance term wraps. Replace the `const distanceCost = distanceSquared(...)` line inside `getWaterPathCost` with:

```ts
      const wrap = isWrapEnabled();
      const distanceCost = wrapDistanceSquared(pack.cells.p[current], pack.cells.p[next], wrap, graphWidth);
```

(Leave `getLandPathCost` unchanged — land routes never wrap.)

- [ ] **Step 2: Thread the seam adjacency + wrapWidth through `findPathSegments`**

Change the `findPathSegments` signature to accept an optional `seaAdjacency`:

```ts
  private findPathSegments({
    isWater,
    connections,
    start,
    exit,
    routeType,
    seaAdjacency
  }: {
    isWater: boolean;
    connections: Set<number>;
    start: number;
    exit: number;
    routeType?: string;
    seaAdjacency?: number[][];
  }) {
    const getCost = this.createCostEvaluator({ isWater, connections, routeType });
    const wrap = isWater && isWrapEnabled() && !!seaAdjacency;
    const graph = wrap ? { ...pack, cells: { ...pack.cells, c: seaAdjacency } } : pack;
    const pathCells = findPath(start, current => current === exit, getCost, graph, exit, wrap ? graphWidth : undefined);
    if (!pathCells) return [];
    const segments = this.getRouteSegments(pathCells, connections);
    return segments;
  }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full routes suite (no regressions)**

Run: `npx vitest run src/modules/routes-generator.test.ts`
Expected: PASS (all existing + Task 1/3/4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/routes-generator.ts
git commit -m "feat(routes): wrap-aware water cost and seam-graph sea pathfinding shim"
```

---

## Task 6: Wire generators to use wrap (sea + air)

**Files:**
- Modify: `src/modules/routes-generator.ts` (`createRoutesData`, `generateMajorSeaRoutes`, `generateSeaRoutes`, `generateAirRoutes`, `rebuildAirroutes`)

Wiring task; gate on `tsc --noEmit`, the green suite, and manual verification (Task 9).

- [ ] **Step 1: Build the seam adjacency once and pass it to the sea generators**

In `createRoutesData`, build the adjacency up front (after `const burgIndex = ...`) and pass it to the two sea generators:

```ts
    const seaAdjacency = isWrapEnabled() ? this.buildSeaAdjacency() : undefined;
```

Change the two sea-generator calls:

```ts
    const majorSeaRoutes = this.generateMajorSeaRoutes(connections, burgIndex, seaAdjacency);
    const seaRoutes = this.generateSeaRoutes(connections, burgIndex, seaAdjacency);
```

- [ ] **Step 2: Make `generateMajorSeaRoutes` wrap-aware**

Change its signature to accept `seaAdjacency?: number[][]`, use `wrapDistanceSquared` for the MST edge weights, and pass `seaAdjacency` into `findPathSegments`:

```ts
  private generateMajorSeaRoutes(connections: Set<number>, burgIndex: RouteBurgIndex, seaAdjacency?: number[][]) {
```

Replace the MST edge-distance line:

```ts
          dist: distanceSquared([a.x, a.y], [b.x, b.y])
```

with:

```ts
          dist: wrapDistanceSquared([a.x, a.y], [b.x, b.y], isWrapEnabled(), graphWidth)
```

And in the `this.findPathSegments({ isWater: true, connections, start, exit })` call, add `seaAdjacency`:

```ts
        const segments = this.findPathSegments({ isWater: true, connections, start, exit, seaAdjacency });
```

- [ ] **Step 3: Make `generateSeaRoutes` wrap-aware**

Change its signature to accept `seaAdjacency?: number[][]`. Make the Urquhart call wrap-aware, make the km-distance guard wrap-aware, and pass `seaAdjacency` into `findPathSegments`:

```ts
  private generateSeaRoutes(connections: Set<number>, burgIndex: RouteBurgIndex, seaAdjacency?: number[][]) {
```

Replace `const urquhartEdges = this.calculateUrquhartEdges(points);` with:

```ts
      const wrap = isWrapEnabled();
      const urquhartEdges = this.calculateUrquhartEdges(points, wrap, graphWidth);
```

Replace the km-distance line:

```ts
        const kmDistance = Math.sqrt(distanceSquared([a.x, a.y], [b.x, b.y])) / mapScale;
```

with:

```ts
        const kmDistance = Math.sqrt(wrapDistanceSquared([a.x, a.y], [b.x, b.y], wrap, graphWidth)) / mapScale;
```

Add `seaAdjacency` to the `findPathSegments` call:

```ts
        const segments = this.findPathSegments({ isWater: true, connections, start: a.cell, exit: b.cell, seaAdjacency });
```

- [ ] **Step 4: Make air-route generation wrap-aware**

In `generateAirRoutes`, replace `const urquhartEdges = this.calculateUrquhartEdges(points);` with:

```ts
    const urquhartEdges = this.calculateUrquhartEdges(points, isWrapEnabled(), graphWidth);
```

In `rebuildAirroutes`, replace `const urquhartEdges = this.calculateUrquhartEdges(points);` with:

```ts
    const urquhartEdges = this.calculateUrquhartEdges(points, isWrapEnabled(), graphWidth);
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full routes suite (no regressions)**

Run: `npx vitest run src/modules/routes-generator.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/modules/routes-generator.ts
git commit -m "feat(routes): seam-aware sea and air route generation"
```

---

## Task 7: Seam-split rendering in `getPath`

**Files:**
- Modify: `src/modules/routes-generator.ts` (`getPath`, new private `hasSeamCrossing` + `splitAtSeam`)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/modules/routes-generator.test.ts`:

```ts
describe("getPath seam split", () => {
  beforeAll(() => {
    const g = globalThis as any;
    g.graphWidth = 1000;
    g.mapCoordinates = { lonT: 360 };
  });

  const countMoves = (d: string) => (d.match(/M/g) || []).length;

  it("splits a seam-crossing route into two stubs reaching both frame edges", () => {
    // crosses the seam: x jumps from 980 to 20 (|dx| = 960 > 500)
    const points = [
      [940, 300, 0],
      [980, 305, 1],
      [20, 310, 2],
      [60, 315, 3]
    ];
    const d = (Routes as any).getPath({ group: "searoutes", points });
    expect(countMoves(d)).toBe(2); // two sub-paths
    expect(d).toContain("1000"); // one stub runs to the east frame (x=graphWidth)
    expect(/M\s*0[ ,]/.test(d) || d.includes("M0")).toBe(true); // other stub starts at x=0
  });

  it("leaves a normal (non-crossing) route as a single path", () => {
    const points = [
      [100, 300, 0],
      [200, 305, 1],
      [300, 310, 2]
    ];
    const d = (Routes as any).getPath({ group: "searoutes", points });
    expect(countMoves(d)).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "getPath seam split"`
Expected: FAIL — current `getPath` emits one `M` and draws a streak across the map.

- [ ] **Step 3: Implement the split**

In `src/modules/routes-generator.ts`, add two private helpers (place them just above `getPath`):

```ts
  private hasSeamCrossing(points: number[][]): boolean {
    if (!isWrapEnabled()) return false;
    const half = graphWidth / 2;
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(points[i][0] - points[i - 1][0]) > half) return true;
    }
    return false;
  }

  // Split a point list at each seam crossing (|dx| > width/2). At a crossing
  // between prev and curr, append the frame-edge intersection (at the
  // interpolated crossing latitude) to the current run and start the next run
  // at the opposite frame edge. Returns one or more [x, y] runs.
  private splitAtSeam(points: number[][]): number[][][] {
    const width = graphWidth;
    const half = width / 2;
    const runs: number[][][] = [];
    let run: number[][] = [[points[0][0], points[0][1]]];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dx = curr[0] - prev[0];
      if (Math.abs(dx) > half) {
        // dx < 0: prev near east edge, exits at x=width; curr enters at x=0.
        // dx > 0: prev near west edge, exits at x=0;     curr enters at x=width.
        const prevExitX = dx < 0 ? width : 0;
        const currEnterX = dx < 0 ? 0 : width;
        const gap = width - Math.abs(dx); // wrapped horizontal traversal
        const prevToEdge = dx < 0 ? width - prev[0] : prev[0];
        const frac = gap === 0 ? 0 : prevToEdge / gap;
        const yAtSeam = prev[1] + (curr[1] - prev[1]) * frac;
        run.push([prevExitX, yAtSeam]);
        runs.push(run);
        run = [[currEnterX, yAtSeam], [curr[0], curr[1]]];
      } else {
        run.push([curr[0], curr[1]]);
      }
    }
    runs.push(run);
    return runs;
  }
```

Then update `getPath` to use them. Replace the body of `getPath` after the `lineGen.curve(...)` line with:

```ts
    if (this.hasSeamCrossing(points)) {
      return this.splitAtSeam(points)
        .map(run => round(lineGen(run as [number, number][]) as string, 1))
        .join(" ");
    }

    const path = round(lineGen(points.map(p => [p[0], p[1]])) as string, 1);
    return path;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "getPath seam split"`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): split and stub-extend seam-crossing routes at render"
```

---

## Task 8: Wrapped route length

**Files:**
- Modify: `src/modules/routes-generator.ts` (`getLength`, new private `getWrappedLength`)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `src/modules/routes-generator.test.ts`:

```ts
describe("getLength wrapped", () => {
  it("measures a seam route by wrapped distance, not the screen gap", () => {
    const g = globalThis as any;
    g.graphWidth = 1000;
    g.mapCoordinates = { lonT: 360 };
    g.pack = {
      routes: [
        { i: 7, group: "searoutes", points: [[980, 300, 0], [20, 300, 1]] } // |dx|=960 seam crossing
      ]
    };

    const len = Routes.getLength(7);
    // wrapped horizontal gap is 40, not 960
    expect(len).toBeCloseTo(40, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "getLength wrapped"`
Expected: FAIL — current `getLength` calls `routes.select(...).getTotalLength()` (no DOM here → throws or wrong value).

- [ ] **Step 3: Implement wrapped length**

In `src/modules/routes-generator.ts`, add a private helper above `getLength`:

```ts
  private getWrappedLength(points: number[][]): number {
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.sqrt(
        wrapDistanceSquared(
          [points[i - 1][0], points[i - 1][1]],
          [points[i][0], points[i][1]],
          true,
          graphWidth
        )
      );
    }
    return len;
  }
```

Then change `getLength`:

```ts
  getLength(routeId: number): number {
    const route = this.getRoutesIndex().get(routeId);
    if (route && this.hasSeamCrossing(route.points)) {
      return this.getWrappedLength(route.points);
    }
    const path = routes.select(`#route${routeId}`).node() as SVGPathElement;
    return path.getTotalLength();
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "getLength wrapped"`
Expected: PASS

- [ ] **Step 5: Type-check + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): wrapped length for seam-crossing routes"
```

---

## Task 9: Build + manual verification on a full-globe map

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: builds clean (tsc + vite), output to `../dist/`.

- [ ] **Step 2: Generate a full-globe map**

Open the app, generate a map sized so longitude spans the full 360° (a wide map; confirm via the in-app coordinates that `lonT` is 360 — equivalently a map wide enough that `(graphWidth/graphHeight)*latT >= 360`). Prefer a seed/template with continents near both the west and east edges and open water at the seam.

- [ ] **Step 3: Verify sea routes wrap**

Enable the Routes layer. Confirm sea routes between ports near opposite edges render as two clean stubs meeting the left and right frame edges (no horizontal streak across the map), and that the path follows water (does not cut across land).

- [ ] **Step 4: Verify air routes wrap**

With ≥2 sky-ports near opposite edges, confirm air routes also render as edge stubs, not a streak.

- [ ] **Step 5: Verify length display**

Open Routes Overview. Confirm a seam-crossing route reports a short length (consistent with the wrapped gap), not a near-full-map-width length.

- [ ] **Step 6: Verify a regional map is unchanged**

Generate a narrow/regional map (`lonT !== 360`). Confirm routes look identical to current behavior — no wrapping, no stubs, no regressions.

- [ ] **Step 7: Commit any final notes**

If verification surfaced fixes, implement them as their own TDD task above and re-run `npx tsc --noEmit && npx vitest run` before committing.

---

## Self-review notes

- **Spec coverage:** Gate (Task 1), wrap distance (Task 1), wrap-aware Urquhart (Task 4), seam adjacency (Task 3), wrap-aware water cost + pathfinding shim + heuristic (Tasks 2, 5), emergent generation wiring (Task 6), seam-split/extend rendering (Task 7), wrapped length (Task 8), no new persisted fields / in-bounds coords (kept throughout — points stay `[0, graphWidth]`), manual verification incl. regional no-op (Task 9). The spec's `getPoints` smoothing guard is intentionally omitted (searoutes skip smoothing; air routes bypass `getPoints`) — documented at the top.
- **Type consistency:** `seaAdjacency: number[][]` is threaded identically through `buildSeaAdjacency` → `createRoutesData` → `generate{Major,}SeaRoutes` → `findPathSegments`. `calculateUrquhartEdges(points, wrap, width)` signature is used consistently by sea and air generators. `hasSeamCrossing` is reused by `getPath` and `getLength`.
- **Placeholders:** none — every code step shows full code.
