# Gravity-Based Maritime Trade Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse, feature-siloed sea-route generators with one gravity-based trade-network builder that produces importance-weighted trunk/feeder/coastal routes and links seam-joined oceans on 360 maps.

**Architecture:** A pure `portImportance` score (`population × roleMult`) feeds a gravity edge selector (`imp·imp/dist²`) that emits three tiers. Ports are pooled by *navigable component* (feature ids unioned by seam links on 360 maps) so cross-seam pairs are possible. Each selected edge is realized by the existing `findPathSegments` A* pathfinder; trunk edges become `type:"major"`, feeder/coastal become `type:"local"`, reusing existing styling and the existing `createRoutesData` merge loops.

**Tech Stack:** TypeScript (`src/modules/routes-generator.ts`), Vitest, Delaunator (via existing `calculateUrquhartEdges`), d3. Build via Nix dev shell (`npx tsc --noEmit`, `npx vitest run`, `npm run build`).

---

## File Structure

- **Modify** `src/modules/routes-generator.ts`:
  - Add module constants `ROLE_MULT`, `SEA_FEEDER_LINKS`, `SEA_TRUNK_HUB_FRACTION`, `SEA_TRUNK_LINKS`, `SEA_COASTAL_CAP_KM`, `SEA_TRUNK_SAFETY_CAP_KM`.
  - Add exported `portImportance(burg)`.
  - Add module type `SeaTradeEdge`.
  - Extract `collectSeamLinks()` from `buildSeaAdjacency()` (pure refactor) and add `buildNavigableComponents()`.
  - Add `selectSeaTradeEdges(ports)` and `generateSeaTradeNetwork(...)`.
  - Delete `generateMajorSeaRoutes` and `generateSeaRoutes`; rewire `createRoutesData`.
- **Modify** `src/modules/routes-generator.test.ts`: add test suites for each new unit.

No other files change (styling reuses existing `#routes #major` / `#routes #local`; `pathUtils.ts` untouched).

---

## Task 1: `portImportance` + role multipliers

**Files:**
- Modify: `src/modules/routes-generator.ts` (add constants + exported function near the top, after the existing module-level wrap helpers around line 30)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/modules/routes-generator.test.ts`. First extend the existing import at the top of the file:

```ts
import { isWrapEnabled, portImportance, wrapDeltaX, wrapDistanceSquared } from "./routes-generator";
```

Then add this suite at the end of the file:

```ts
describe("portImportance", () => {
  const port = (population: number, settlementType: string, capital = 0) =>
    ({ population, settlementType, capital }) as any;

  it("ranks roles capital > largePort > regionalCenter > marketTown > village > hamlet at equal population", () => {
    const cap = portImportance(port(1, "capital"));
    const lp = portImportance(port(1, "largePort"));
    const rc = portImportance(port(1, "regionalCenter"));
    const mt = portImportance(port(1, "marketTown"));
    const vil = portImportance(port(1, "largeVillage"));
    const ham = portImportance(port(1, "hamlet"));
    expect(cap).toBeGreaterThan(lp);
    expect(lp).toBeGreaterThan(rc);
    expect(rc).toBeGreaterThan(mt);
    expect(mt).toBeGreaterThan(vil);
    expect(vil).toBeGreaterThan(ham);
  });

  it("scales with population within a role", () => {
    expect(portImportance(port(2, "marketTown"))).toBeGreaterThan(portImportance(port(1, "marketTown")));
  });

  it("treats the capital flag as the capital role regardless of settlementType", () => {
    expect(portImportance(port(1, "hamlet", 1))).toBe(portImportance(port(1, "capital")));
  });

  it("defaults unknown roles to a 1.0 multiplier and missing population to 0", () => {
    expect(portImportance(port(2, "mystery"))).toBe(2);
    expect(portImportance({} as any)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t portImportance`
Expected: FAIL — `portImportance is not a function` (import unresolved).

- [ ] **Step 3: Write minimal implementation**

In `src/modules/routes-generator.ts`, after the existing `wrapDistanceSquared` export (around line 30), add:

```ts
// Trade-importance role weights (population multiplier). Higher = bigger hub.
const ROLE_MULT: Record<string, number> = {
  capital: 3.0,
  largePort: 2.2,
  regionalCenter: 1.6,
  marketTown: 1.2,
  largeVillage: 1.0,
  smallVillage: 1.0,
  hamlet: 0.8
};

// Sea-trade-network density preset ("medium/balanced"). Retune here.
const SEA_FEEDER_LINKS = 3; // top gravity partners each port connects to
const SEA_TRUNK_HUB_FRACTION = 0.1; // fraction of a component's ports that are hubs (min 2)
const SEA_TRUNK_LINKS = 3; // top hub-to-hub gravity partners per hub
const SEA_COASTAL_CAP_KM = 120; // max length for short coastal Urquhart pairs
const SEA_TRUNK_SAFETY_CAP_KM = 600; // upper bound so two lone hubs cannot span the map

// Trade importance of a port: population weighted by its settlement role.
export function portImportance(burg: Burg): number {
  const role = burg.capital ? "capital" : (burg.settlementType ?? "");
  const mult = ROLE_MULT[role] ?? 1.0;
  return (burg.population ?? 0) * mult;
}
```

`Burg` is already imported at line 4 (`import type { Burg } from "./burgs-generator";`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t portImportance`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): port importance scoring + sea-trade density constants"
```

---

## Task 2: Extract `collectSeamLinks()` (refactor `buildSeaAdjacency`)

This is a behavior-preserving refactor so the seam matching can be shared with `buildNavigableComponents`. The existing `buildSeaAdjacency` test must stay green.

**Files:**
- Modify: `src/modules/routes-generator.ts:506-556` (`buildSeaAdjacency`)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Add this suite to `src/modules/routes-generator.test.ts`:

```ts
describe("collectSeamLinks", () => {
  it("pairs each west-edge water cell with the nearest east-edge water cell by latitude", () => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1, 2, 3, 4, 5]),
        h: [0, 0, 0, 30, 0, 0],
        p: [
          [10, 10],
          [90, 12],
          [50, 50],
          [10, 80],
          [88, 82],
          [12, 78]
        ] as [number, number][],
        c: [[], [], [], [], [], []] as number[][]
      }
    };

    const links = (Routes as any).collectSeamLinks() as Array<[number, number]>;
    const has = (a: number, b: number) => links.some(([w, e]) => w === a && e === b);
    expect(has(0, 1)).toBe(true); // west(y10) -> east(y12)
    expect(has(5, 4)).toBe(true); // west(y78) -> east(y82)
    expect(links.length).toBe(2); // only the two west water cells produce links
  });

  it("returns no links when an edge has no water", () => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1]),
        h: [0, 0],
        p: [
          [10, 10],
          [50, 50]
        ] as [number, number][],
        c: [[], []] as number[][]
      }
    };
    expect((Routes as any).collectSeamLinks()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t collectSeamLinks`
Expected: FAIL — `Routes.collectSeamLinks is not a function`.

- [ ] **Step 3: Refactor `buildSeaAdjacency` to use the new helper**

Replace the entire `buildSeaAdjacency` method body (currently `src/modules/routes-generator.ts:506-556`) with:

```ts
  // West/east edge water-cell pairs matched by latitude. Shared by buildSeaAdjacency
  // (to add neighbour links) and buildNavigableComponents (to union features).
  private collectSeamLinks(): Array<[number, number]> {
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

    if (!westEdge.length || !eastEdge.length) return [];

    // Sort east cells by latitude for nearest-y matching via binary search.
    eastEdge.sort((a, b) => cells.p[a][1] - cells.p[b][1]);
    const eastY = eastEdge.map(c => cells.p[c][1]);

    const links: Array<[number, number]> = [];
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
      links.push([w, eastEdge[best]]);
    }

    return links;
  }

  // Copy of pack.cells.c with seam links added between west-edge and east-edge
  // water cells. pack.cells.c itself is never mutated. Sea-route pathfinding only.
  private buildSeaAdjacency(): number[][] {
    const { cells } = pack;
    const links = this.collectSeamLinks();
    if (!links.length) return cells.c;

    // Shallow-copy the neighbour array; only edge cells get fresh inner arrays.
    const c = cells.c.slice();
    const link = (a: number, b: number) => {
      if (c[a] === cells.c[a]) c[a] = cells.c[a].slice();
      if (c[b] === cells.c[b]) c[b] = cells.c[b].slice();
      if (!c[a].includes(b)) c[a].push(b);
      if (!c[b].includes(a)) c[b].push(a);
    };

    for (const [w, e] of links) link(w, e);

    return c;
  }
```

- [ ] **Step 4: Run tests to verify both new and existing seam tests pass**

Run: `npx vitest run src/modules/routes-generator.test.ts -t "collectSeamLinks|buildSeaAdjacency"`
Expected: PASS — the two new `collectSeamLinks` tests AND the existing `buildSeaAdjacency` test (regression guard) all green.

- [ ] **Step 5: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "refactor(routes): extract collectSeamLinks from buildSeaAdjacency"
```

---

## Task 3: `buildNavigableComponents()`

**Files:**
- Modify: `src/modules/routes-generator.ts` (add method after `buildSeaAdjacency`)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Add this suite to `src/modules/routes-generator.test.ts`:

```ts
describe("buildNavigableComponents", () => {
  // Two edge water cells (feature 1 west, feature 2 east) + ports on each feature.
  const setup = (lonT: number) => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    g.mapCoordinates = { lonT };
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1]),
        h: [0, 0],
        f: [1, 2],
        p: [
          [10, 50],
          [90, 50]
        ] as [number, number][],
        c: [[], []] as number[][]
      },
      burgs: [{}, { i: 1, port: 1, cell: 0 }, { i: 2, port: 2, cell: 1 }]
    };
  };

  it("keeps each port-feature its own component on a non-360 map", () => {
    setup(180);
    const comp = (Routes as any).buildNavigableComponents() as Map<number, number>;
    expect(comp.get(1)).not.toBe(comp.get(2));
  });

  it("unions seam-joined features into one component on a 360 map", () => {
    setup(360);
    const comp = (Routes as any).buildNavigableComponents() as Map<number, number>;
    expect(comp.get(1)).toBe(comp.get(2));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t buildNavigableComponents`
Expected: FAIL — `Routes.buildNavigableComponents is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/modules/routes-generator.ts`, immediately after the `buildSeaAdjacency` method, add:

```ts
  // Map each port-bearing water feature to a navigable-component id. Components are
  // feature ids unioned by seam links (360 maps only); on non-360 maps every
  // feature is its own component (identity), so behaviour is unchanged.
  private buildNavigableComponents(): Map<number, number> {
    const { cells, burgs } = pack;
    const parent = new Map<number, number>();

    const find = (x: number): number => {
      if (!parent.has(x)) parent.set(x, x);
      let root = x;
      while (parent.get(root)! !== root) root = parent.get(root)!;
      let cur = x;
      while (parent.get(cur)! !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    const isRoutablePort = (burg: Burg) => Boolean(burg.i) && !burg.removed && !burg.flying && Boolean(burg.port);

    // Seed union-find with every port-bearing feature.
    for (const burg of burgs) {
      if (isRoutablePort(burg)) find(burg.port as number);
    }

    // Union features joined across the seam (360 maps only).
    if (isWrapEnabled()) {
      for (const [w, e] of this.collectSeamLinks()) union(cells.f[w], cells.f[e]);
    }

    const components = new Map<number, number>();
    for (const burg of burgs) {
      if (isRoutablePort(burg)) {
        const feature = burg.port as number;
        components.set(feature, find(feature));
      }
    }
    return components;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t buildNavigableComponents`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): navigable-component pooling (seam-joined oceans on 360)"
```

---

## Task 4: `selectSeaTradeEdges()` — the gravity tiers

**Files:**
- Modify: `src/modules/routes-generator.ts` (add `SeaTradeEdge` type near other types ~line 212, and the method near the other sea helpers)
- Test: `src/modules/routes-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Add this suite to `src/modules/routes-generator.test.ts`:

```ts
describe("selectSeaTradeEdges", () => {
  beforeAll(() => {
    const g = globalThis as any;
    g.graphWidth = 1000;
    g.graphHeight = 1000; // mapScale = 1 -> km == pixel distance
    g.mapCoordinates = { lonT: 180 }; // wrap off
  });

  // Two clusters: {0,1,2} near (100,100), {3,4} near (600,400). Hubs = ports 0 & 3.
  const ports = [
    { x: 100, y: 100, population: 1.0, settlementType: "capital", capital: 1, cell: 0, port: 1 },
    { x: 130, y: 110, population: 0.5, settlementType: "hamlet", cell: 1, port: 1 },
    { x: 140, y: 90, population: 0.8, settlementType: "marketTown", cell: 2, port: 1 },
    { x: 600, y: 400, population: 1.2, settlementType: "capital", capital: 1, cell: 3, port: 1 },
    { x: 620, y: 420, population: 0.3, settlementType: "hamlet", cell: 4, port: 1 }
  ] as any[];

  const km = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);

  it("emits all three tiers, links every port, dedupes pairs, and respects caps", () => {
    const edges = (Routes as any).selectSeaTradeEdges(ports) as Array<{
      from: number;
      to: number;
      tier: string;
    }>;

    // every port participates in at least one edge
    const touched = new Set<number>();
    edges.forEach(e => {
      touched.add(e.from);
      touched.add(e.to);
    });
    expect(touched.size).toBe(ports.length);

    // no duplicate unordered pair
    const keys = edges.map(e => `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`);
    expect(new Set(keys).size).toBe(keys.length);

    // trunk edge connects the two hubs (ports 0 and 3)
    const trunk = edges.filter(e => e.tier === "trunk");
    expect(trunk.some(e => (e.from === 0 && e.to === 3) || (e.from === 3 && e.to === 0))).toBe(true);

    // at least one feeder and one coastal edge exist
    expect(edges.some(e => e.tier === "feeder")).toBe(true);
    expect(edges.some(e => e.tier === "coastal")).toBe(true);

    // every coastal edge is within the coastal cap; no edge exceeds the trunk safety cap
    edges.forEach(e => {
      if (e.tier === "coastal") expect(km(ports[e.from], ports[e.to])).toBeLessThanOrEqual(120);
      expect(km(ports[e.from], ports[e.to])).toBeLessThanOrEqual(600);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/routes-generator.test.ts -t selectSeaTradeEdges`
Expected: FAIL — `Routes.selectSeaTradeEdges is not a function`.

- [ ] **Step 3: Add the type and the method**

In `src/modules/routes-generator.ts`, near the `Route` interface (~line 212), add the tier types:

```ts
type SeaTradeTier = "trunk" | "feeder" | "coastal";
interface SeaTradeEdge {
  from: number;
  to: number;
  tier: SeaTradeTier;
}
```

Then add this method to the class (place it just before `generateSeaTradeNetwork` from Task 5, e.g. after `generateFootpaths`):

```ts
  // Gravity-based edge selection for one navigable component's ports.
  // Produces deduped trunk/feeder/coastal edges (highest tier wins on collision).
  private selectSeaTradeEdges(ports: Burg[]): SeaTradeEdge[] {
    const n = ports.length;
    const wrap = isWrapEnabled();
    const mapScale = Math.sqrt((graphWidth * graphHeight) / 1_000_000);

    const imp = ports.map(portImportance);
    const d2 = (i: number, j: number) =>
      wrapDistanceSquared([ports[i].x, ports[i].y], [ports[j].x, ports[j].y], wrap, graphWidth);
    const gravity = (i: number, j: number) => (imp[i] * imp[j]) / Math.max(d2(i, j), 1e-9);
    const km = (i: number, j: number) => Math.sqrt(d2(i, j)) / mapScale;

    const tierRank: Record<SeaTradeTier, number> = { coastal: 0, feeder: 1, trunk: 2 };
    const edges = new Map<number, SeaTradeTier>();
    const addEdge = (a: number, b: number, tier: SeaTradeTier) => {
      if (a === b) return;
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = lo * n + hi;
      const current = edges.get(key);
      if (current === undefined || tierRank[tier] > tierRank[current]) edges.set(key, tier);
    };

    const allIndices = Array.from({ length: n }, (_, i) => i);

    // feeder: each port -> its top SEA_FEEDER_LINKS gravity partners (guarantees >= 1 link)
    for (let i = 0; i < n; i++) {
      const partners = allIndices.filter(j => j !== i).sort((a, b) => gravity(i, b) - gravity(i, a));
      for (let k = 0; k < Math.min(SEA_FEEDER_LINKS, partners.length); k++) addEdge(i, partners[k], "feeder");
    }

    // trunk: top hubs by importance, each linked to its top SEA_TRUNK_LINKS hub partners
    const hubCount = Math.min(n, Math.max(2, Math.ceil(SEA_TRUNK_HUB_FRACTION * n)));
    const hubs = [...allIndices].sort((a, b) => imp[b] - imp[a]).slice(0, hubCount);
    for (const h of hubs) {
      const partners = hubs.filter(j => j !== h).sort((a, b) => gravity(h, b) - gravity(h, a));
      let added = 0;
      for (const j of partners) {
        if (added >= SEA_TRUNK_LINKS) break;
        if (km(h, j) > SEA_TRUNK_SAFETY_CAP_KM) continue;
        addEdge(h, j, "trunk");
        added++;
      }
    }

    // coastal: existing Urquhart short pairs, capped at SEA_COASTAL_CAP_KM
    const points = ports.map(p => [p.x, p.y] as Point);
    const urquhartEdges = this.calculateUrquhartEdges(points, wrap, graphWidth);
    for (const [a, b] of urquhartEdges) {
      if (km(a, b) <= SEA_COASTAL_CAP_KM) addEdge(a, b, "coastal");
    }

    const result: SeaTradeEdge[] = [];
    for (const [key, tier] of edges) {
      result.push({ from: Math.floor(key / n), to: key % n, tier });
    }
    return result;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/routes-generator.test.ts -t selectSeaTradeEdges`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(routes): gravity edge selection (trunk/feeder/coastal tiers)"
```

---

## Task 5: `generateSeaTradeNetwork()` + wire into `createRoutesData`, delete old generators

**Files:**
- Modify: `src/modules/routes-generator.ts` — add `generateSeaTradeNetwork`, delete `generateMajorSeaRoutes` (~900-962) and `generateSeaRoutes` (~776-816), rewire `createRoutesData` (~1099-1100)
- Test: full suite + tsc + build

- [ ] **Step 1: Confirm the old generators have no other callers**

Run: `grep -n "generateMajorSeaRoutes\|generateSeaRoutes" src/modules/routes-generator.ts`
Expected: each name appears only at its definition and the single call site in `createRoutesData`. If any other caller exists, stop and reassess.

- [ ] **Step 2: Add `generateSeaTradeNetwork`**

In `src/modules/routes-generator.ts`, add this method (e.g. right after `selectSeaTradeEdges`):

```ts
  // Build the full sea-trade network for all navigable components.
  // Returns trunk routes (rendered as "major") and feeder+coastal routes ("local").
  private generateSeaTradeNetwork(
    connections: Set<number>,
    burgIndex: RouteBurgIndex,
    components: Map<number, number>,
    seaAdjacency?: number[][]
  ) {
    TIME && console.time("generateSeaTradeNetwork");
    const { portsByFeature } = burgIndex;

    // Re-pool ports by navigable component (seam-joined features share a pool on 360).
    const portsByComponent: Record<number, Burg[]> = {};
    for (const [featureId, ports] of Object.entries(portsByFeature)) {
      const component = components.get(Number(featureId)) ?? Number(featureId);
      if (!portsByComponent[component]) portsByComponent[component] = [];
      portsByComponent[component].push(...ports);
    }

    const trunkRoutes: Route[] = [];
    const localRoutes: Route[] = [];

    for (const ports of Object.values(portsByComponent)) {
      if (ports.length < 2) continue;

      const edges = this.selectSeaTradeEdges(ports);
      for (const { from, to, tier } of edges) {
        const a = ports[from];
        const b = ports[to];

        const segments = this.findPathSegments({
          isWater: true,
          connections,
          start: a.cell,
          exit: b.cell,
          seaAdjacency
        });
        for (const segment of segments) {
          this.addConnections(segment, connections);
          const route = {
            feature: a.port as number, // originating port's real feature id
            cells: segment,
            type: tier === "trunk" ? "major" : "local"
          } as Route;
          (tier === "trunk" ? trunkRoutes : localRoutes).push(route);
        }
      }
    }

    TIME && console.timeEnd("generateSeaTradeNetwork");
    return { trunkRoutes, localRoutes };
  }
```

- [ ] **Step 3: Rewire `createRoutesData`**

In `createRoutesData` (`src/modules/routes-generator.ts`), replace these two lines (currently ~1099-1100):

```ts
    const majorSeaRoutes = this.generateMajorSeaRoutes(connections, burgIndex, seaAdjacency);
    const seaRoutes = this.generateSeaRoutes(connections, burgIndex, seaAdjacency);
```

with:

```ts
    const components = this.buildNavigableComponents();
    const { trunkRoutes: majorSeaRoutes, localRoutes: seaRoutes } = this.generateSeaTradeNetwork(
      connections,
      burgIndex,
      components,
      seaAdjacency
    );
```

Leave the two downstream `mergeRoutes(majorSeaRoutes)` / `mergeRoutes(seaRoutes)` loops untouched — the variable names are preserved.

- [ ] **Step 4: Delete the old generators**

Delete the entire `generateMajorSeaRoutes` method (from `private generateMajorSeaRoutes(...)` through its closing brace, ~lines 900-962) and the entire `generateSeaRoutes` method (~lines 776-816). Do not delete `generateTownRoads`, `generateFootpaths`, or any road generator.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0, no errors. (If a stale-diagnostic mismatch appears, trust the exit code.)

- [ ] **Step 6: Run the full routes test suite**

Run: `npx vitest run src/modules/routes-generator.test.ts src/utils/pathUtils.test.ts`
Expected: PASS — all suites green (previous 108 + the new ones from Tasks 1-4).

- [ ] **Step 7: Production build**

Run: `npm run build`
Expected: tsc + vite build succeed, output to `../dist/`.

- [ ] **Step 8: Commit**

```bash
git add src/modules/routes-generator.ts
git commit -m "feat(routes): gravity sea-trade network replaces MST/Urquhart sea generators"
```

---

## Task 6: Manual verification (human-in-the-loop)

**Not automatable — requires the running app.** Hand back to the user with these checks:

- [ ] **Normal (non-360) map:** `npm run dev`, generate a map with several coastal burgs. Confirm the sea network is visibly richer than before — bold trunk lines between major ports, thinner feeder/coastal lines, no hairball. Confirm road/trail layers are unchanged.
- [ ] **Long-haul realism:** confirm some trunk routes cut across open water between distant hubs (skipping coastline), as in the user's drawn example.
- [ ] **360 map:** generate a `lonT === 360` map (≥ 2:1 canvas at ~100% locked map size) with ports near both the west and east edges. Confirm trunk/feeder routes wrap across the seam and render as clean edge stubs (no streak across the whole map).
- [ ] **Regression:** load an existing saved `.map` file; confirm it still loads and routes render (styling/types unchanged).

---

## Self-Review Notes

- **Spec coverage:** Component 1 → Task 1; Components 2-3 (navigable components, seam-link sharing) → Tasks 2-3; Component 4 (gravity tiers) → Task 4; Components 5-6 (network builder + wiring) → Task 5; testing section → tests in Tasks 1-4 + Task 5 full-suite run; manual verification → Task 6.
- **Type consistency:** `portImportance(burg: Burg)`, `collectSeamLinks(): Array<[number, number]>`, `buildNavigableComponents(): Map<number, number>`, `selectSeaTradeEdges(ports: Burg[]): SeaTradeEdge[]`, `generateSeaTradeNetwork(connections, burgIndex, components, seaAdjacency?) → { trunkRoutes, localRoutes }`. `SeaTradeEdge.tier` ∈ `SeaTradeTier`. Names used identically across Tasks 4-5.
- **Constants:** `ROLE_MULT`, `SEA_FEEDER_LINKS`, `SEA_TRUNK_HUB_FRACTION`, `SEA_TRUNK_LINKS`, `SEA_COASTAL_CAP_KM`, `SEA_TRUNK_SAFETY_CAP_KM` — defined Task 1, consumed Task 4.
- **No placeholders:** every code/test step contains complete code and exact commands.
