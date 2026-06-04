# Global Trade Hub Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sea-trade trunk tier with a separate global trade hub network — a two-tier port hierarchy (hubs + waystations) wired by multi-hop, water-respecting routes, rendered as its own `traderoutes` layer.

**Architecture:** A pure, unit-testable module `trade-network-generator.ts` owns the topology (role assignment, leg graph, multi-hop routing). `routes-generator.ts` stays the glue: it builds inputs from `pack`, calls the module, draws each unique leg (straight, or a water-path fallback when a straight leg clips land), and emits the new route group. Airroutes are extracted to their own sibling module to shrink `routes-generator.ts`.

**Tech Stack:** TypeScript, Vitest, d3, Delaunator, flatqueue. Build: `tsc --noEmit`; tests: `npx vitest run`.

---

## Design reference

Spec: `docs/superpowers/specs/2026-06-04-global-trade-hub-network-design.md`

Key existing code this plan touches (verified):
- `Burg` interface: `src/modules/burgs-generator.ts:7`
- `Route` interface (group union): `src/modules/routes-generator.ts:254`
- `portImportance` (exported): `src/modules/routes-generator.ts:56`
- `buildNavigableComponents(): Map<featureId, componentId>`: `src/modules/routes-generator.ts:654`
- `selectSeaTradeEdges` (trunk tier to remove): `src/modules/routes-generator.ts:989`
- `generateSeaTradeNetwork` (returns `{trunkRoutes, localRoutes}`): `src/modules/routes-generator.ts:~1145`
- `generateAirRoutes` (to extract): `src/modules/routes-generator.ts:1372`
- `calculateUrquhartEdges` (stays; injected into air module): `src/modules/routes-generator.ts:365`
- `createRoutesData` assembly + `mergeRoutes`/`getPoints`: `src/modules/routes-generator.ts:1408`
- SVG group setup: `public/main.js:64-68`
- Layer clear selectors + toggle: `public/modules/ui/layers.js:804,838`
- Style block to clone: `public/styles/default.json:221` (`#airroutes`)
- `wrapDistanceSquared(a,b,wrap,width)`, `isWrapEnabled()`: exported from `src/modules/routes-generator.ts`

**Note on a spec deviation:** the spec said "promote `calculateUrquhartEdges` to a shared util." Simpler and lower-risk: keep it in `routes-generator.ts` and **inject the computed edges** into the extracted air-routes function. Same decoupling, no risky move of the wrap variant. This plan does that.

---

## Task 1: Add trade-role fields to Burg

**Files:**
- Modify: `src/modules/burgs-generator.ts:7-38`

- [ ] **Step 1: Add the fields to the Burg interface**

In `src/modules/burgs-generator.ts`, inside `export interface Burg { ... }`, after `altitude?: number;`:

```typescript
  tradeRole?: "hub" | "waystation";
  tradeRoleManual?: boolean;
```

- [ ] **Step 2: Verify type-check passes**

Run: `tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/modules/burgs-generator.ts
git commit -m "feat(trade): add tradeRole/tradeRoleManual fields to Burg"
```

---

## Task 2: Extract airroutes into its own module

Behavior-preserving refactor. The extracted function is pure: it takes sky ports + precomputed Urquhart edges and returns `Route[]`.

**Files:**
- Create: `src/modules/air-routes-generator.ts`
- Create: `src/modules/air-routes-generator.test.ts`
- Modify: `src/modules/routes-generator.ts` (remove `generateAirRoutes` method body lines 1372-1406; update caller at line 1424)

- [ ] **Step 1: Write the failing test**

Create `src/modules/air-routes-generator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildAirRoutes } from "./air-routes-generator";

describe("buildAirRoutes", () => {
  const skyPorts = [
    { i: 1, x: 0, y: 0, cell: 10 },
    { i: 2, x: 100, y: 0, cell: 20 },
    { i: 3, x: 50, y: 80, cell: 30 }
  ] as any[];

  it("emits one direct point-line route per Urquhart edge", () => {
    const edges = [
      [0, 1],
      [1, 2]
    ];
    const routes = buildAirRoutes(skyPorts, edges);
    expect(routes.length).toBe(2);
    expect(routes[0].group).toBe("airroutes");
    // first route is a straight 2-point line between sky ports 0 and 1
    expect(routes[0].points).toEqual([
      [0, 0, 10],
      [100, 0, 20]
    ]);
  });

  it("returns no routes when there are fewer than 2 sky ports", () => {
    expect(buildAirRoutes([skyPorts[0]], []).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/air-routes-generator.test.ts`
Expected: FAIL — cannot find module `./air-routes-generator`.

- [ ] **Step 3: Create the module**

Create `src/modules/air-routes-generator.ts`:

```typescript
import type { Burg } from "./burgs-generator";
import type { Route } from "./routes-generator";

// Air routes are direct point-to-point lines between sky ports (flying ignores
// terrain). Edges are an Urquhart graph over sky-port positions, computed by the
// caller so this stays a pure, testable transform. `i` is assigned later in
// createRoutesData.
export function buildAirRoutes(skyPorts: Burg[], urquhartEdges: number[][]): Route[] {
  if (skyPorts.length < 2) return [];

  const airRoutes: Route[] = [];
  for (const [fromId, toId] of urquhartEdges) {
    const from = skyPorts[fromId];
    const to = skyPorts[toId];
    airRoutes.push({
      i: 0,
      group: "airroutes",
      feature: 0,
      points: [
        [from.x, from.y, from.cell],
        [to.x, to.y, to.cell]
      ]
    });
  }
  return airRoutes;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/air-routes-generator.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Replace the old method with a call to the new module**

In `src/modules/routes-generator.ts`:

1. Add import near the top (after the `Point` type import):

```typescript
import { buildAirRoutes } from "./air-routes-generator";
```

2. Delete the entire `private generateAirRoutes(burgIndex: RouteBurgIndex) { ... }` method (lines ~1372-1406).

3. In `createRoutesData`, replace the call `const airRoutes = this.generateAirRoutes(burgIndex);` (line ~1424) with:

```typescript
    const airPoints = burgIndex.skyPorts.map(b => [b.x, b.y] as Point);
    const airUrquhart = this.calculateUrquhartEdges(airPoints, isWrapEnabled(), graphWidth);
    const airRoutes = buildAirRoutes(burgIndex.skyPorts, airUrquhart);
```

- [ ] **Step 6: Verify type-check and full suite**

Run: `tsc --noEmit && npx vitest run`
Expected: clean tsc; all tests pass (airroutes behavior unchanged).

- [ ] **Step 7: Commit**

```bash
git add src/modules/air-routes-generator.ts src/modules/air-routes-generator.test.ts src/modules/routes-generator.ts
git commit -m "refactor(routes): extract airroutes into air-routes-generator"
```

---

## Task 3: trade-network-generator — role assignment

Pure function that sets `burg.tradeRole` on hubs and waystations, preserving manual roles.

**Files:**
- Create: `src/modules/trade-network-generator.ts`
- Create: `src/modules/trade-network-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/modules/trade-network-generator.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { assignTradeRoles } from "./trade-network-generator";

// importance = population (simple, deterministic for tests)
const imp = (b: any) => b.population ?? 0;
const isLarge = (b: any) => b.settlementType === "largePort";
const dist2 = (ax: number, ay: number, bx: number, by: number) =>
  (ax - bx) ** 2 + (ay - by) ** 2;

describe("assignTradeRoles", () => {
  it("makes each state's capital-nearest qualifying port a hub", () => {
    const cap1 = { i: 1, state: 1, capital: 1, x: 0, y: 0, population: 50, port: 1 };
    const near = { i: 2, state: 1, x: 10, y: 0, population: 30, port: 1, settlementType: "largePort" };
    const far = { i: 3, state: 1, x: 200, y: 0, population: 99, port: 1, settlementType: "largePort" };
    const burgs = [cap1, near, far] as any[];

    assignTradeRoles(burgs, {
      importance: imp,
      isLargePort: isLarge,
      minHubSize: 10,
      capitalByState: new Map([[1, cap1]]),
      dist2
    });

    expect(near.tradeRole).toBe("hub"); // nearest the capital, clears min size
    expect(far.tradeRole).toBe("waystation"); // large port, but not the hub
  });

  it("skips ports below minHubSize and states with no qualifying port", () => {
    const cap2 = { i: 4, state: 2, capital: 1, x: 0, y: 0, population: 50, port: 1 };
    const tiny = { i: 5, state: 2, x: 5, y: 0, population: 2, port: 1 };
    const burgs = [cap2, tiny] as any[];

    assignTradeRoles(burgs, {
      importance: imp,
      isLargePort: isLarge,
      minHubSize: 10,
      capitalByState: new Map([[2, cap2]]),
      dist2
    });

    expect(tiny.tradeRole).toBeUndefined(); // below min size, no hub for state 2
  });

  it("never overrides a manually-set role", () => {
    const manual = {
      i: 6,
      state: 3,
      x: 100,
      y: 0,
      population: 99,
      port: 1,
      settlementType: "largePort",
      tradeRole: "hub",
      tradeRoleManual: true
    };
    const cap3 = { i: 7, state: 3, capital: 1, x: 0, y: 0, population: 50, port: 1, settlementType: "largePort" };
    const burgs = [manual, cap3] as any[];

    assignTradeRoles(burgs, {
      importance: imp,
      isLargePort: isLarge,
      minHubSize: 10,
      capitalByState: new Map([[3, cap3]]),
      dist2
    });

    expect(manual.tradeRole).toBe("hub"); // manual role preserved
    expect(cap3.tradeRole).toBe("hub"); // auto hub for the state (capital is itself a port)
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/trade-network-generator.test.ts`
Expected: FAIL — cannot find module `./trade-network-generator`.

- [ ] **Step 3: Implement assignTradeRoles**

Create `src/modules/trade-network-generator.ts`:

```typescript
import type { Burg } from "./burgs-generator";

export interface TradeRoleConfig {
  importance: (b: Burg) => number;
  isLargePort: (b: Burg) => boolean;
  minHubSize: number;
  capitalByState: Map<number, Burg>;
  dist2: (ax: number, ay: number, bx: number, by: number) => number;
}

// Sets burg.tradeRole on hubs (one per state: the port nearest the capital that
// clears minHubSize) and waystations (every other large port). Burgs flagged
// tradeRoleManual keep whatever role they have and are skipped.
export function assignTradeRoles(burgs: Burg[], cfg: TradeRoleConfig): void {
  const { importance, isLargePort, minHubSize, capitalByState, dist2 } = cfg;

  // Reset non-manual roles so regeneration is idempotent.
  for (const b of burgs) {
    if (!b.tradeRoleManual) b.tradeRole = undefined;
  }

  // Hubs: nearest qualifying port to each state's capital.
  const portsByState = new Map<number, Burg[]>();
  for (const b of burgs) {
    if (b.tradeRoleManual) continue;
    if (!b.i || b.removed || b.flying || !b.port) continue;
    if (importance(b) < minHubSize) continue;
    const s = b.state;
    if (s === undefined) continue;
    const list = portsByState.get(s);
    if (list) list.push(b);
    else portsByState.set(s, [b]);
  }

  const hubs = new Set<Burg>();
  for (const [state, ports] of portsByState) {
    const cap = capitalByState.get(state);
    if (!cap) continue;
    let best: Burg | null = null;
    let bestD = Infinity;
    for (const p of ports) {
      const d = dist2(p.x, p.y, cap.x, cap.y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (best) {
      best.tradeRole = "hub";
      hubs.add(best);
    }
  }

  // Waystations: every large port not already a (manual or auto) hub.
  for (const b of burgs) {
    if (b.tradeRoleManual) continue;
    if (!b.i || b.removed || b.flying || !b.port) continue;
    if (b.tradeRole === "hub" || hubs.has(b)) continue;
    if (isLargePort(b)) b.tradeRole = "waystation";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/trade-network-generator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/trade-network-generator.ts src/modules/trade-network-generator.test.ts
git commit -m "feat(trade): role assignment for hubs and waystations"
```

---

## Task 4: trade-network-generator — leg graph

**Files:**
- Modify: `src/modules/trade-network-generator.ts`
- Modify: `src/modules/trade-network-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/modules/trade-network-generator.test.ts`:

```typescript
import { buildLegGraph, type TradeNode } from "./trade-network-generator";

describe("buildLegGraph", () => {
  // four nodes on a line; component A = {0,1,2}, component B = {3}
  const nodes: TradeNode[] = [
    { index: 0, x: 0, y: 0, component: 1, burg: {} as any },
    { index: 1, x: 10, y: 0, component: 1, burg: {} as any },
    { index: 2, x: 30, y: 0, component: 1, burg: {} as any },
    { index: 3, x: 12, y: 0, component: 2, burg: {} as any }
  ];
  const d2 = (a: TradeNode, b: TradeNode) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  it("links nodes within range R in the same component, both directions", () => {
    const g = buildLegGraph(nodes, 15 * 15, d2); // R = 15
    expect(g[0].sort()).toEqual([1]); // 0-1 (10) yes; 0-2 (30) no
    expect(g[1].sort()).toEqual([0]); // 1-2 (20) > 15 no
  });

  it("never links across navigable components even when within range", () => {
    const g = buildLegGraph(nodes, 15 * 15, d2);
    // node 3 (comp 2) is 2px from node 1 (comp 1) but different ocean -> no edge
    expect(g[3]).toEqual([]);
    expect(g[1]).not.toContain(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/trade-network-generator.test.ts -t "buildLegGraph"`
Expected: FAIL — `buildLegGraph`/`TradeNode` not exported.

- [ ] **Step 3: Implement buildLegGraph + TradeNode**

Add to `src/modules/trade-network-generator.ts`:

```typescript
export interface TradeNode {
  index: number;
  x: number;
  y: number;
  component: number;
  burg: Burg;
}

// Adjacency over trade nodes: an undirected edge exists when two nodes are in the
// same navigable component and within one leg (squared distance <= maxLegDist2).
// O(n^2) over the small trade-node set.
export function buildLegGraph(
  nodes: TradeNode[],
  maxLegDist2: number,
  dist2: (a: TradeNode, b: TradeNode) => number
): number[][] {
  const adj: number[][] = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].component !== nodes[j].component) continue;
      if (dist2(nodes[i], nodes[j]) > maxLegDist2) continue;
      adj[i].push(j);
      adj[j].push(i);
    }
  }
  return adj;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/trade-network-generator.test.ts -t "buildLegGraph"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/trade-network-generator.ts src/modules/trade-network-generator.test.ts
git commit -m "feat(trade): leg graph (same-component, within range)"
```

---

## Task 5: trade-network-generator — multi-hop routing + leg union

**Files:**
- Modify: `src/modules/trade-network-generator.ts`
- Modify: `src/modules/trade-network-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/modules/trade-network-generator.test.ts`:

```typescript
import { routeTradeNetwork, type TradeNetworkResult } from "./trade-network-generator";

describe("routeTradeNetwork", () => {
  // chain: hub0 - way1 - way2 - hub3  (each adjacent pair linked)
  const adj = [
    [1],
    [0, 2],
    [1, 3],
    [2]
  ];

  it("connects hubs via a multi-hop path within the hop cap", () => {
    const res: TradeNetworkResult = routeTradeNetwork(4, adj, [0, 3], 3);
    expect(res.routes.length).toBe(1);
    expect(res.routes[0]).toEqual([0, 1, 2, 3]); // hub..hub through waystations
    // each consecutive leg appears once in the union
    expect(res.legs.map(l => [l.a, l.b])).toEqual([
      [0, 1],
      [1, 2],
      [2, 3]
    ]);
  });

  it("drops hub pairs that need more hops than the cap", () => {
    const res = routeTradeNetwork(4, adj, [0, 3], 2); // 0->3 needs 3 hops
    expect(res.routes.length).toBe(0);
    expect(res.legs.length).toBe(0);
  });

  it("counts shared-leg usage across routes", () => {
    // hub0 - way1 - {hub2, hub3}; routes 0-2 and 0-3 share leg 0-1
    const adj2 = [[1], [0, 2, 3], [1], [1]];
    const res = routeTradeNetwork(4, adj2, [0, 2, 3], 3);
    const shared = res.legs.find(l => l.a === 0 && l.b === 1)!;
    expect(shared.uses).toBe(2); // used by both 0-2 and 0-3
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/trade-network-generator.test.ts -t "routeTradeNetwork"`
Expected: FAIL — `routeTradeNetwork`/`TradeNetworkResult` not exported.

- [ ] **Step 3: Implement routeTradeNetwork**

Add to `src/modules/trade-network-generator.ts`:

```typescript
export interface TradeLeg {
  a: number; // node index (a < b)
  b: number;
  uses: number;
}

export interface TradeNetworkResult {
  routes: number[][]; // each: node-index sequence hub..hub
  legs: TradeLeg[]; // unique undirected legs + usage count
}

// BFS shortest (fewest-hop) path between a pair of nodes, bounded to maxHops legs.
// Returns the node-index path, or null if unreachable within the cap.
function bfsPath(nodeCount: number, adj: number[][], start: number, goal: number, maxHops: number): number[] | null {
  if (start === goal) return null;
  const prev = new Int32Array(nodeCount).fill(-1);
  const depth = new Int32Array(nodeCount).fill(-1);
  const queue = [start];
  depth[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (depth[cur] >= maxHops) continue; // can't extend further
    for (const next of adj[cur]) {
      if (depth[next] !== -1) continue;
      depth[next] = depth[cur] + 1;
      prev[next] = cur;
      if (next === goal) {
        const path = [goal];
        let c = goal;
        while (prev[c] !== -1) {
          c = prev[c];
          path.push(c);
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

// For each unordered hub pair, route a fewest-hop path (<= maxHops) over the leg
// graph. Viable paths become trade routes; their legs are unioned with usage counts.
export function routeTradeNetwork(
  nodeCount: number,
  adj: number[][],
  hubIndices: number[],
  maxHops: number
): TradeNetworkResult {
  const routes: number[][] = [];
  const legMap = new Map<number, TradeLeg>();

  for (let i = 0; i < hubIndices.length; i++) {
    for (let j = i + 1; j < hubIndices.length; j++) {
      const path = bfsPath(nodeCount, adj, hubIndices[i], hubIndices[j], maxHops);
      if (!path) continue;
      routes.push(path);
      for (let k = 0; k < path.length - 1; k++) {
        const a = Math.min(path[k], path[k + 1]);
        const b = Math.max(path[k], path[k + 1]);
        const key = a * nodeCount + b;
        const existing = legMap.get(key);
        if (existing) existing.uses++;
        else legMap.set(key, { a, b, uses: 1 });
      }
    }
  }

  return { routes, legs: [...legMap.values()] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/trade-network-generator.test.ts -t "routeTradeNetwork"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/trade-network-generator.ts src/modules/trade-network-generator.test.ts
git commit -m "feat(trade): multi-hop routing with leg-union usage counts"
```

---

## Task 6: Remove trunk tier; wire the trade network into routes-generator

**Files:**
- Modify: `src/modules/routes-generator.ts` (remove trunk from `selectSeaTradeEdges`/`generateSeaTradeNetwork`; add `generateTradeNetwork` glue; update `createRoutesData`)
- Modify: `src/modules/routes-generator.test.ts` (update the `selectSeaTradeEdges` test that asserts trunk; add a trade-network integration test)

### 6a — Remove the trunk tier

- [ ] **Step 1: Update the selectSeaTradeEdges test (trunk gone)**

In `src/modules/routes-generator.test.ts`, in the `describe("selectSeaTradeEdges", ...)` test "emits all three tiers...", remove the trunk assertions and rename. Replace the three lines:

```typescript
    const trunk = edges.filter(e => e.tier === "trunk");
    expect(trunk.length).toBeGreaterThan(0);
    expect(trunk.every(e => landmass[e.from] !== landmass[e.to])).toBe(true);
```

with:

```typescript
    expect(edges.every(e => e.tier !== "trunk")).toBe(true); // trunk tier removed
```

Also remove `1500` (trunk safety cap) expectation if present in the same test's final loop — keep only the coastal `<= 120` check.

- [ ] **Step 2: Run to confirm it now fails against current code**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "selectSeaTradeEdges"`
Expected: FAIL — current code still emits trunk edges.

- [ ] **Step 3: Strip trunk from selectSeaTradeEdges**

In `src/modules/routes-generator.ts` `selectSeaTradeEdges` (starts line ~989), delete the trunk block: the `landmassOf`/`byLandmass`/`gateways`/`trunkEligible`/`bestCrossing`/`considerCrossing` logic, the cross-seam `if (wrap) { ... }` block, and the `for (const { a, b } of bestCrossing.values()) addEdge(a, b, "trunk");` line. Keep the `feeder` loop, the `coastal` Urquhart loop, and the result construction. Remove `"trunk"` from `tierRank` is unnecessary (leaving it is harmless), but delete the now-unused `SEA_TRUNK_*` constants (`SEA_TRUNK_GATEWAYS_PER_LANDMASS`, `SEA_TRUNK_LINKS_PER_GATEWAY`, `SEA_TRUNK_SAFETY_CAP_KM`).

- [ ] **Step 4: Strip trunk from generateSeaTradeNetwork**

In `generateSeaTradeNetwork`, remove the `trunkRoutes` array, the `trunkEdges` partition and its `for (const e of trunkEdges) layPerEdge(e);` loop, and change the return to only local routes:

```typescript
    return { localRoutes };
```

Update its signature/return type usage accordingly. In `createRoutesData` (line ~1418), change:

```typescript
    const { trunkRoutes: majorSeaRoutes, localRoutes: seaRoutes } = this.generateSeaTradeNetwork(...)
```

to:

```typescript
    const { localRoutes: seaRoutes } = this.generateSeaTradeNetwork(
      connections,
      burgIndex,
      components,
      seaAdjacency
    );
```

and delete the `for (const { feature, cells, merged, type } of this.mergeRoutes(majorSeaRoutes)) { ... }` block (lines ~1475-1485) — the global backbone is now the trade network (added in 6b).

- [ ] **Step 5: Run sea-trade tests + tsc**

Run: `tsc --noEmit && npx vitest run src/modules/routes-generator.test.ts`
Expected: clean tsc; `selectSeaTradeEdges` test passes; hub-dedup + feeder-multi-target tests still pass (they don't rely on trunk).

- [ ] **Step 6: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "refactor(routes): remove sea-trade trunk tier (replaced by trade network)"
```

### 6b — Add the trade-network glue + integration test

- [ ] **Step 7: Write the failing integration test**

Append to `src/modules/routes-generator.test.ts`. Reuse the LAND-port grid pattern (ports on land, water elsewhere). Two states, each with a capital+port, one large-port waystation between them so the hubs connect via a 2-hop route.

```typescript
describe("generateTradeNetwork", () => {
  const N = 13;
  const STEP = 1000 / (N - 1);

  const buildGrid = (landCells: number[]) => {
    const i = new Uint32Array(N * N);
    const c: number[][] = [];
    const p: [number, number][] = [];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const id = y * N + x;
        i[id] = id;
        p.push([x * STEP, y * STEP]);
        const neibs: number[] = [];
        if (x > 0) neibs.push(id - 1);
        if (x < N - 1) neibs.push(id + 1);
        if (y > 0) neibs.push(id - N);
        if (y < N - 1) neibs.push(id + N);
        c.push(neibs);
      }
    }
    const h = new Array(N * N).fill(0); // water
    for (const land of landCells) h[land] = 30;
    return { i, c, p, h, t: new Array(N * N).fill(0), g: new Array(N * N).fill(0), f: new Array(N * N).fill(1) };
  };

  it("produces trade routes connecting state hubs via waystations", () => {
    const g = globalThis as any;
    g.window = g.window ?? {};
    g.window.FlatQueue = FlatQueue; // needed if any leg uses the water-path fallback
    g.graphWidth = 1000;
    g.graphHeight = 1000;
    g.mapCoordinates = { lonT: 180 };

    // Legs must be <= TRADE_LEG_RANGE_KM (300px at mapScale 1) = 3.6 cells. Hubs at
    // cells 1 and 7 are 500px apart (one leg too far), so they only connect via the
    // waystation at cell 4: cap1-way = 250px, way-cap2 = 250px. all land, rest water.
    const cap1 = { i: 1, state: 1, capital: 1, port: 1, cell: 1, x: STEP, y: 0, population: 50, settlementType: "largePort" };
    const cap2 = { i: 2, state: 2, capital: 1, port: 1, cell: 7, x: 7 * STEP, y: 0, population: 50, settlementType: "largePort" };
    const way = { i: 3, state: 1, port: 1, cell: 4, x: 4 * STEP, y: 0, population: 20, settlementType: "largePort" };
    const burgs = [{}, cap1, cap2, way] as any[];
    g.pack = { cells: buildGrid([1, 4, 7]), burgs };
    g.grid = { cells: { temp: [20] } };

    const routes = (Routes as any).generateTradeNetwork();

    expect(cap1.tradeRole).toBe("hub");
    expect(cap2.tradeRole).toBe("hub");
    expect(way.tradeRole).toBe("waystation");
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.every((r: any) => r.group === "traderoutes")).toBe(true);
    // the union of leg endpoints covers both hubs (route reaches hub cells 1 and 7)
    const cells = new Set<number>(routes.flatMap((r: any) => r.points.map((pt: number[]) => pt[2])));
    expect(cells.has(1)).toBe(true);
    expect(cells.has(7)).toBe(true);
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "generateTradeNetwork"`
Expected: FAIL — `generateTradeNetwork` not defined.

- [ ] **Step 9: Add constants + the glue method**

In `src/modules/routes-generator.ts`, add constants near the other `SEA_*` constants:

```typescript
const MIN_HUB_SIZE = 0; // min portImportance to qualify as a state hub (tunable)
const TRADE_LEG_RANGE_KM = 300; // max single-leg sailing distance (refuel range)
const TRADE_MAX_HOPS = 5; // max intermediate-stop legs between two hubs
```

Add imports at the top:

```typescript
import { assignTradeRoles, buildLegGraph, routeTradeNetwork, type TradeNode } from "./trade-network-generator";
```

Add the glue method to `RoutesModule` (near `generateSeaTradeNetwork`):

```typescript
  // Global trade hub network: assign roles, build the leg graph over hubs+waystations,
  // route every viable hub pair multi-hop, then draw each unique leg once (straight,
  // or a water-path fallback when a straight leg would clip land).
  generateTradeNetwork(seaAdjacency?: number[][]): Route[] {
    TIME && console.time("generateTradeNetwork");
    const wrap = isWrapEnabled();
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);
    const dist2 = (ax: number, ay: number, bx: number, by: number) =>
      wrapDistanceSquared([ax, ay], [bx, by], wrap, graphWidth);

    // capital burg per state
    const capitalByState = new Map<number, Burg>();
    for (const b of pack.burgs) {
      if (b.i && !b.removed && b.capital && b.state !== undefined) capitalByState.set(b.state, b);
    }

    assignTradeRoles(pack.burgs, {
      importance: portImportance,
      isLargePort: (b: Burg) => Boolean(b.isLargePort) || b.settlementType === "largePort",
      minHubSize: MIN_HUB_SIZE,
      capitalByState,
      dist2
    });

    // build nodes (hubs + waystations) with their navigable component
    const components = this.buildNavigableComponents();
    const nodes: TradeNode[] = [];
    const hubIndices: number[] = [];
    for (const b of pack.burgs) {
      if (!b.tradeRole) continue;
      const component = components.get(b.port as number) ?? (b.port as number);
      const index = nodes.length;
      nodes.push({ index, x: b.x, y: b.y, component, burg: b });
      if (b.tradeRole === "hub") hubIndices.push(index);
    }
    if (hubIndices.length < 2) {
      TIME && console.timeEnd("generateTradeNetwork");
      return [];
    }

    const maxLegPx = TRADE_LEG_RANGE_KM * mapScale;
    const adj = buildLegGraph(nodes, maxLegPx * maxLegPx, (a, b) => dist2(a.x, a.y, b.x, b.y));
    const { legs } = routeTradeNetwork(nodes.length, adj, hubIndices, TRADE_MAX_HOPS);

    const tradeRoutes: Route[] = [];
    let fallbackLegs = 0;
    for (const leg of legs) {
      const a = nodes[leg.a].burg;
      const b = nodes[leg.b].burg;
      let points: number[][];
      if (this.segmentIsWater(a.x, a.y, b.x, b.y, a.cell, b.cell)) {
        points = [
          [a.x, a.y, a.cell],
          [b.x, b.y, b.cell]
        ];
      } else {
        const segs = this.findPathSegments({
          isWater: true,
          connections: new Set<number>(),
          start: a.cell,
          exit: b.cell,
          seaAdjacency
        });
        const cells = segs[0];
        if (!cells || cells.length < 2) continue;
        points = cells.map(cellId => [...pack.cells.p[cellId], cellId]);
        fallbackLegs++;
      }
      tradeRoutes.push({ i: 0, group: "traderoutes", feature: a.port as number, points });
    }

    TIME &&
      console.log(
        `  trade network: hubs=${hubIndices.length} nodes=${nodes.length} legs=${legs.length} fallback=${fallbackLegs}`
      );
    TIME && console.timeEnd("generateTradeNetwork");
    return tradeRoutes;
  }

  // True if the straight segment A->B stays over water (sampled interior). The two
  // endpoint cells are the land port cells themselves, so samples that snap back to
  // them are ignored — only genuine intervening land triggers the water-path fallback.
  private segmentIsWater(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    startCell: number,
    endCell: number
  ): boolean {
    const steps = 12;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const cell = findClosestCell(x, y, undefined, pack);
      if (cell === undefined || cell === startCell || cell === endCell) continue;
      if (pack.cells.h[cell] >= 20) return false;
    }
    return true;
  }
```

- [ ] **Step 10: Call it from createRoutesData and assemble the group**

In `createRoutesData`, after the air routes block, add:

```typescript
    const tradeRoutes = this.generateTradeNetwork(seaAdjacency);
    for (const route of tradeRoutes) {
      route.i = routes.length;
      routes.push(route);
    }
```

- [ ] **Step 11: Run integration test + full suite + tsc**

Run: `tsc --noEmit && npx vitest run`
Expected: clean tsc; `generateTradeNetwork` test passes; all others pass.

- [ ] **Step 12: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(trade): wire global trade hub network into route generation"
```

---

## Task 7: Render the traderoutes layer

**Files:**
- Modify: `src/modules/routes-generator.ts:256` (Route group union)
- Modify: `public/main.js:68`
- Modify: `public/modules/ui/layers.js:804,838`
- Modify: `public/styles/default.json:221`

- [ ] **Step 1: Add "traderoutes" to the Route group union**

In `src/modules/routes-generator.ts:256`, change:

```typescript
  group: "roads" | "trails" | "searoutes" | "airroutes";
```

to:

```typescript
  group: "roads" | "trails" | "searoutes" | "airroutes" | "traderoutes";
```

- [ ] **Step 2: Verify tsc**

Run: `tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Add the SVG group**

In `public/main.js`, after line 68 (`let airroutes = ...`):

```javascript
let traderoutes = routes.append("g").attr("id", "traderoutes");
```

- [ ] **Step 4: Register the group in the layer clear selectors**

In `public/modules/ui/layers.js`, update both occurrences of the selector (lines ~804 and ~838):

```javascript
    routes.selectAll("#roads, #trails, #searoutes, #airroutes, #traderoutes").html("");
```

- [ ] **Step 5: Add a style block**

In `public/styles/default.json`, after the `"#airroutes": { ... }` block (line ~221), add a sibling (match the surrounding JSON formatting; distinct bold amber dashed look):

```json
  "#traderoutes": {
    "opacity": 1,
    "stroke": "#b8860b",
    "stroke-width": 1.2,
    "stroke-dasharray": "3 2",
    "stroke-linecap": "round"
  },
```

- [ ] **Step 6: Manual verification in the browser**

Run: `npm run dev`, regenerate a map. Expected: amber dashed `traderoutes` lanes connect state hub ports through waystations; toggling routes off clears them; no console errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/routes-generator.ts public/main.js public/modules/ui/layers.js public/styles/default.json
git commit -m "feat(trade): render traderoutes layer (svg group + style + clear)"
```

---

## Task 8: Persist trade roles across save/load

**Files:**
- Inspect: the save/load module for burgs (search first)
- Modify: whichever module serializes/deserializes burg fields
- Modify: `src/modules/trade-network-generator.test.ts` (round-trip if a pure serializer exists) OR add an inline assertion

- [ ] **Step 1: Locate burg serialization**

Run: `grep -rn "JSON.stringify(pack.burgs)\|pack.burgs = \|burgs:.*map\|stringify" public/modules/io src/ 2>/dev/null | grep -i burg | head`
Expected: identifies how burgs are written to the `.map` file. FMG typically serializes `pack.burgs` as JSON objects (full object), in which case `tradeRole`/`tradeRoleManual` persist automatically.

- [ ] **Step 2: Confirm or add field persistence**

If burgs are serialized as whole JSON objects (the common case): no code change needed — verify by saving and reloading a map and confirming `pack.burgs[k].tradeRole` survives. Document this in the commit.

If burgs are serialized field-by-field (explicit column list): add `tradeRole` and `tradeRoleManual` to both the write and read lists, matching the existing pattern for fields like `port`/`capital`.

- [ ] **Step 3: Manual round-trip verification**

Run: `npm run dev`, generate a map, Save (.map), reload it. In the console: `pack.burgs.filter(b => b.tradeRole).length` should be > 0 after reload.
Expected: trade roles survive the round trip.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(trade): persist tradeRole/tradeRoleManual across save/load"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full type-check + test suite**

Run: `tsc --noEmit && npx vitest run`
Expected: clean tsc; all tests pass.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (auto-fixes acceptable; re-stage if any).

- [ ] **Step 3: Browser smoke test on a dense map**

Run: `npm run dev`, generate a large map (500k points). Read the TIME log line `trade network: hubs=… nodes=… legs=… fallback=…` and confirm `generateTradeNetwork` time is small. Confirm hubs sit near state capitals, lanes hop through waystations, and distant/disconnected oceans have no spurious lanes.

- [ ] **Step 4: Update branch-state memory** (optional, if practice continues)

Note the new layer + module structure in the project memory.

---

## Self-review notes

- **Spec coverage:** roles (T1,T3), airroutes extraction (T2), leg graph (T4), multi-hop + viability + leg union (T5), trunk removal (T6a), glue + straight/fallback drawing (T6b), rendering/toggle/style (T7), save/load (T8), perf diag (T6b TIME log). All spec sections map to a task.
- **Type consistency:** `TradeNode`, `TradeLeg`, `TradeNetworkResult`, `TradeRoleConfig`, `assignTradeRoles`, `buildLegGraph`, `routeTradeNetwork`, `buildAirRoutes`, `generateTradeNetwork`, `segmentIsWater` are used consistently across tasks.
- **Known follow-ups (out of scope):** burg-editor UI for manual designation; `traderoutes` styling across the other 11 presets; usage-weighted lane width (data already emitted via `TradeLeg.uses`).
