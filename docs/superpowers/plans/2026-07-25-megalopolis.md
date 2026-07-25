# Megalopolis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Burgs sharing a cell act as one composite city — one icon/label below a zoom threshold, one economic node (anchor-seeded market, pooled production capacity, combined trade gravity, treasury pooled on the anchor).

**Architecture:** A megalopolis is derived, never stored (spec: `docs/superpowers/specs/2026-07-25-megalopolis-design.md`). New pure module `src/generators/megalopolis.ts` is the single source of membership truth. Economy passes skip non-anchor members and give anchors pooled population. Rendering: GPU icons keep TWO instance buffers (composite vs full) picked by scale at draw time (no shader change); GPU labels get a `maxZoom` gate in `selectVisibleLabels` plus per-anchor composite label boxes; SVG path toggles member/composite visibility in `invokeActiveZooming`.

**Tech Stack:** TypeScript + vitest (jsdom); classic JS in `public/` for main.js/general.js hooks.

## Global Constraints

- DO NOT modify `src/generators/trade-network-generator.ts` (uncommitted user WIP at lines 30-73), `src/generators/trade-network-generator.test.ts`, `src/generators/routes-generator.test.ts`, `src/services/io/auto-update.ts`, or `.gitignore`. All megalopolis trade changes go in `routes-generator.ts` and NEW test files.
- Anchor = `pack.cells.burg[cell]` (primary ground burg). Members = all non-removed burgs with the same `.cell`. A megalopolis needs ≥2 members incl. ≥1 ground burg.
- No save-format changes. Pooled treasury lives on `anchor.treasury`.
- Generation stays one-burg-per-cell; megalopolises arise only from editing.
- Commits: explicit `git add` paths only, `--no-verify`, no Co-Authored-By/AI attribution.
- Verify with `npx tsc --noEmit` and `npx vitest run <file>`; pre-existing failures allowed ONLY in `routes-generator.test.ts` (2 seam tests, user WIP).
- Public JS edits require cache-bust bumps in `src/index.html` (`main.js?v=1.137.12`, `general.js?v=1.137.6-mb1` — bump to `-mega1` variants).

---

### Task 1: Core module `megalopolis.ts`

**Files:**
- Create: `src/generators/megalopolis.ts`
- Test: `src/generators/megalopolis.test.ts`

**Interfaces:**
- Produces (all later tasks consume these):
  - `MEGALOPOLIS_SPLIT_ZOOM = 4` (scale threshold: composite below, individual at/above)
  - `COMPOSITE_ICON_SCALE = 1.6`, `RING_ICON_SCALE = 2.2`
  - `interface Megalopolis { cell: number; anchor: Burg; members: Burg[]; population: number }`
  - `findMegalopolises(burgs: Burg[], cellsBurg: ArrayLike<number>): Map<number, Megalopolis>`
  - `groupedMemberIds(megas: Map<number, Megalopolis>): Set<number>` — non-anchor member ids
  - `pooledPopulation(megas: Map<number, Megalopolis>): Map<number, number>` — anchorId → Σ population
  - `megalopolisName(anchor: Burg): string` — `` `Greater ${anchor.name}` ``

- [ ] **Step 1: Write failing tests** — create `src/generators/megalopolis.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  findMegalopolises,
  groupedMemberIds,
  megalopolisName,
  pooledPopulation
} from "./megalopolis";

const burg = (i: number, cell: number, extra: Record<string, unknown> = {}) =>
  ({ i, cell, x: 0, y: 0, name: `b${i}`, population: 1, ...extra }) as any;

describe("findMegalopolises", () => {
  const cellsBurg = new Uint32Array(20);

  it("groups 2+ burgs sharing a cell, anchor first", () => {
    cellsBurg.fill(0);
    cellsBurg[5] = 2;
    const burgs = [burg(0, 0), burg(1, 3), burg(2, 5, { population: 2 }), burg(3, 5, { population: 1 })];
    const megas = findMegalopolises(burgs, cellsBurg);
    expect(megas.size).toBe(1);
    const m = megas.get(5)!;
    expect(m.anchor.i).toBe(2);
    expect(m.members.map(b => b.i)).toEqual([2, 3]);
    expect(m.population).toBe(3);
  });

  it("includes flying members in the group and its population", () => {
    cellsBurg.fill(0);
    cellsBurg[5] = 2;
    const burgs = [burg(0, 0), burg(2, 5, { population: 2 }), burg(4, 5, { flying: 1, population: 0.5 })];
    const m = findMegalopolises(burgs, cellsBurg).get(5)!;
    expect(m.members.map(b => b.i)).toEqual([2, 4]);
    expect(m.population).toBe(2.5);
  });

  it("ignores single-burg cells, removed burgs, and sky-only cells", () => {
    cellsBurg.fill(0);
    cellsBurg[5] = 2;
    const burgs = [
      burg(0, 0),
      burg(1, 3), // lone
      burg(2, 5),
      burg(3, 5, { removed: true }), // dead co-resident -> cell 5 back to lone
      burg(4, 9, { flying: 1 }),
      burg(5, 9, { flying: 1 }) // sky-only cell 9: no ground anchor
    ];
    expect(findMegalopolises(burgs, cellsBurg).size).toBe(0);
  });
});

describe("helpers", () => {
  it("groupedMemberIds excludes anchors; pooledPopulation keys anchors", () => {
    const cellsBurg = new Uint32Array(10);
    cellsBurg[5] = 2;
    const burgs = [burg(0, 0), burg(2, 5, { population: 2 }), burg(3, 5), burg(6, 5, { flying: 1 })];
    const megas = findMegalopolises(burgs, cellsBurg);
    expect([...groupedMemberIds(megas)].sort()).toEqual([3, 6]);
    expect(pooledPopulation(megas).get(2)).toBe(4);
    expect(pooledPopulation(megas).has(3)).toBe(false);
  });

  it("megalopolisName derives from the anchor", () => {
    expect(megalopolisName(burg(2, 5, { name: "Varenne" }))).toBe("Greater Varenne");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/generators/megalopolis.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/generators/megalopolis.ts`:

```ts
import type { Burg } from "./burgs-generator";

// A megalopolis is DERIVED, never stored: all non-removed burgs sharing a cell
// (ground + flying) when there are >=2 members including >=1 ground burg. The
// anchor is the cell's primary ground burg (pack.cells.burg[cell]); it holds
// the pooled treasury and hosts the market. See
// docs/superpowers/specs/2026-07-25-megalopolis-design.md

// Scale threshold: below -> one composite icon/label; at/above -> individual members.
export const MEGALOPOLIS_SPLIT_ZOOM = 4;
export const COMPOSITE_ICON_SCALE = 1.6;
export const RING_ICON_SCALE = 2.2;

export interface Megalopolis {
  cell: number;
  anchor: Burg;
  members: Burg[]; // anchor first
  population: number; // sum over members, flying included
}

export function findMegalopolises(burgs: Burg[], cellsBurg: ArrayLike<number>): Map<number, Megalopolis> {
  const byCell = new Map<number, Burg[]>();
  for (const b of burgs) {
    if (!b || !b.i || b.removed) continue;
    const list = byCell.get(b.cell);
    if (list) list.push(b);
    else byCell.set(b.cell, [b]);
  }

  const megas = new Map<number, Megalopolis>();
  for (const [cell, list] of byCell) {
    if (list.length < 2) continue;
    const anchorId = cellsBurg[cell];
    if (!anchorId) continue; // no ground burg -> sky-only stack, not a megalopolis
    const anchor = list.find(b => b.i === anchorId);
    if (!anchor) continue; // stale slot; derive nothing rather than guess
    const members = [anchor, ...list.filter(b => b.i !== anchorId)];
    const population = members.reduce((sum, b) => sum + (b.population || 0), 0);
    megas.set(cell, { cell, anchor, members, population });
  }
  return megas;
}

export function groupedMemberIds(megas: Map<number, Megalopolis>): Set<number> {
  const ids = new Set<number>();
  for (const m of megas.values()) for (const b of m.members) if (b.i !== m.anchor.i) ids.add(b.i);
  return ids;
}

export function pooledPopulation(megas: Map<number, Megalopolis>): Map<number, number> {
  const pooled = new Map<number, number>();
  for (const m of megas.values()) pooled.set(m.anchor.i, m.population);
  return pooled;
}

export function megalopolisName(anchor: Burg): string {
  return `Greater ${anchor.name}`;
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/generators/megalopolis.test.ts` → PASS.
- [ ] **Step 5: Commit**

```bash
git add src/generators/megalopolis.ts src/generators/megalopolis.test.ts
git commit --no-verify -m "feat(megalopolis): derived same-cell burg grouping module"
```

---

### Task 2: Treasury transfer on anchor removal

**Files:**
- Modify: `src/generators/burgs-generator.ts` (`BurgModule.remove`, ~line 1470: the `cellSlotAfterRemoval` line added by multi-burg work)
- Test: `src/generators/burgs-generator.test.ts` (append)

**Interfaces:**
- Consumes: `cellSlotAfterRemoval` (same file). `rn` is a global already used in this file.
- Produces: behavior only — on removing a slot-owning burg with a promoted successor, `burg.treasury` moves to the successor.

- [ ] **Step 1: Failing test** — append to `src/generators/burgs-generator.test.ts` (it already stubs pack/DOM per existing `Burgs.remove`-adjacent patterns; if `Burgs.remove` needs too much DOM stubbing, test the extracted helper instead — see Step 3, which extracts `transferTreasuryOnRemoval`):

```ts
import { transferTreasuryOnRemoval } from "./burgs-generator"; // merge into existing import

describe("transferTreasuryOnRemoval", () => {
  it("moves the removed anchor's treasury to the promoted successor", () => {
    const anchor = makeBurg(3, 10, { treasury: 120.5 });
    const successor = makeBurg(7, 10, { treasury: 10 });
    transferTreasuryOnRemoval(anchor, 7, [makeBurg(0, 0), anchor, successor]);
    expect(successor.treasury).toBe(130.5);
    expect(anchor.treasury).toBe(0);
  });

  it("does nothing when there is no successor or no treasury", () => {
    const anchor = makeBurg(3, 10, { treasury: 50 });
    transferTreasuryOnRemoval(anchor, 0, [makeBurg(0, 0), anchor]);
    expect(anchor.treasury).toBe(50); // no successor -> pool dies with the burg (cell emptied)
    const poor = makeBurg(4, 11);
    transferTreasuryOnRemoval(poor, 9, [makeBurg(0, 0), poor, makeBurg(9, 11)]); // no treasury -> no-op
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/generators/burgs-generator.test.ts` → FAIL (not exported).
- [ ] **Step 3: Implement** — in `burgs-generator.ts`, next to `cellSlotAfterRemoval`, add:

```ts
// When a slot-owning burg is removed and a co-located ground burg is promoted,
// the megalopolis treasury pool moves to the promoted successor.
export function transferTreasuryOnRemoval(burg: Burg, successorId: number, burgs: Burg[]): void {
  if (!successorId || successorId === burg.i || !burg.treasury) return;
  const successor = burgs.find(b => b && b.i === successorId);
  if (!successor) return;
  successor.treasury = rn((successor.treasury || 0) + burg.treasury, 2);
  burg.treasury = 0;
}
```

And in `remove()` replace:

```ts
    pack.cells.burg[burg.cell] = cellSlotAfterRemoval(pack.cells.burg[burg.cell], burg, pack.burgs);
    burg.removed = true;
```

with:

```ts
    const ownedSlot = pack.cells.burg[burg.cell] === burg.i;
    const newSlot = cellSlotAfterRemoval(pack.cells.burg[burg.cell], burg, pack.burgs);
    if (ownedSlot) transferTreasuryOnRemoval(burg, newSlot, pack.burgs);
    pack.cells.burg[burg.cell] = newSlot;
    burg.removed = true;
```

- [ ] **Step 4: Verify** — `npx vitest run src/generators/burgs-generator.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**

```bash
git add src/generators/burgs-generator.ts src/generators/burgs-generator.test.ts
git commit --no-verify -m "feat(megalopolis): transfer pooled treasury to promoted successor on anchor removal"
```

---

### Task 3: Markets — anchor-only seeding, pooled score

**Files:**
- Modify: `src/generators/markets-generator.ts` (`createMarkets` ~lines 51-95; `expandMarkets` burg-assignment loop ~lines 164-178)
- Test: `src/generators/markets-generator.test.ts` (append; follow its existing stub pattern — `globalThis.pack`, private index injection)

**Interfaces:**
- Consumes: `findMegalopolises`, `groupedMemberIds`, `pooledPopulation` from `./megalopolis`.

- [ ] **Step 1: Failing test** — append to `markets-generator.test.ts` a test that calls the private scored/seed path indirectly: stub `pack` with two co-located burgs (anchor id 2 in `pack.cells.burg`) + `graphWidth/graphHeight`, run `Markets.generate(true)` (or the smallest public entry the file already uses for `createMarkets` — mirror the existing `sync`/`addMarket` test setup), and assert: (a) no market has `centerBurgId` equal to the member id, (b) the member burg ends with `burg.market` equal to the anchor's market. If `generate` pulls in too much, test `expandMarkets` assignment only (public via `Markets.expandTerritories`), asserting member inherits `cellMarket[cell]`:

```ts
it("megalopolis: member burgs share the anchor's market and never host a center", () => {
  // arrange per this file's existing pack-stub pattern:
  //   burgs: [{i:0}, anchor {i:1, cell:5, population:2}, member {i:2, cell:5, population:9}]
  //   pack.cells.burg = Uint32Array with [5]=1; pack.cells with p/c arrays as other tests stub
  // act: Markets.generate(true)
  // assert:
  //   expect(pack.markets.some(m => m.centerBurgId === 2)).toBe(false);
  //   expect(pack.burgs[2].market).toBe(pack.burgs[1].market);
});
```

(Fill the arrange block by copying the nearest existing `generate`-style test in this file; the assertions above are the contract.)

- [ ] **Step 2: Run to verify failure** (member with population 9 outscores anchor today and seeds the center).
- [ ] **Step 3: Implement** — in `createMarkets()`:
  - At the top: `const megas = findMegalopolises(pack.burgs, pack.cells.burg); const memberIds = groupedMemberIds(megas); const pooled = pooledPopulation(megas);`
  - Scoring line `let score = burg.population || 0;` → `let score = pooled.get(burg.i) ?? burg.population ?? 0;`
  - In the seeding loop after `if (burg.flying) continue;` add:
    `if (memberIds.has(burg.i)) continue; // only the anchor of a megalopolis can host the market center`
  - In `expandMarkets()`'s burg loop, before the `if (burg.flying)` branch add:
    `if (memberIds.has(burg.i)) { burg.market = cellMarket[burg.cell] || 0; continue; } // grouped members (incl. flying) share the anchor cell's market`
    (recompute `memberIds` locally in `expandMarkets` the same way — it's a different method).
- [ ] **Step 4: Verify** — `npx vitest run src/generators/markets-generator.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**

```bash
git add src/generators/markets-generator.ts src/generators/markets-generator.test.ts
git commit --no-verify -m "feat(megalopolis): markets seed at anchors only, scored by pooled population"
```

---

### Task 4: Production — pooled capacity and treasury

**Files:**
- Modify: `src/generators/production-generator.ts` (`produce()` lines ~19-51; `createBurgProductionState()` ~85; `fillBurgsDemand`/`fillDemandFromMarket` ~336-393)

**Interfaces:**
- Consumes: `findMegalopolises`, `groupedMemberIds`, `pooledPopulation` from `./megalopolis`.
- Note: no production test harness exists (verified); this task is verified by tsc + Task 9's browser checklist. Do not build a heavyweight stub harness for it.

- [ ] **Step 1: Implement `produce()`** — at the top of `produce()` (after `Markets.initializeMarketPrices()`):

```ts
    const megas = findMegalopolises(pack.burgs, pack.cells.burg);
    const memberIds = groupedMemberIds(megas);
    const pooled = pooledPopulation(megas);
```

In the burg loop, after `if (burg.flying) continue;` add:

```ts
      if (memberIds.has(burg.i)) continue; // grouped members produce via their anchor's pooled run
```

Change `const state = this.createBurgProductionState(burg, market, index);` to pass the pooled population:

```ts
      const state = this.createBurgProductionState(burg, market, index, pooled.get(burg.i));
```

- [ ] **Step 2: `createBurgProductionState`** — add optional 4th param and use it:

```ts
  private createBurgProductionState(burg: Burg, market: Market, index: ProductionIndex, populationOverride?: number): BurgProductionState {
    const population = rn(populationOverride ?? burg.population ?? 0, 2);
```

(only the first line inside changes; local-bonus and worker loop then scale off the pooled value automatically).

- [ ] **Step 3: `fillBurgsDemand`** — compute `memberIds`/`pooled` the same way at its top; in its per-burg loop skip grouped members (`if (memberIds.has(burg.i))) continue;`) and, where `fillDemandFromMarket` derives demand from `burg.population`, thread the pooled value through the same override pattern as Step 2 (locate the `getDemandTargets(...)`/population read inside `fillDemandFromMarket` and apply `pooled.get(burg.i) ?? burg.population`). Grouped members' consumer demand is thereby folded into the anchor's buy pass against the pooled treasury.
- [ ] **Step 4: Verify** — `npx tsc --noEmit` clean; `npx vitest run` → no new failures.
- [ ] **Step 5: Commit**

```bash
git add src/generators/production-generator.ts
git commit --no-verify -m "feat(megalopolis): pooled production capacity, demand and treasury on the anchor"
```

---

### Task 5: Trade network — one node per megalopolis

**Files:**
- Modify: `src/generators/routes-generator.ts` ONLY (`generateTradeNetwork` node build ~lines 1305-1331; `portImportance` stays untouched at ~86-90)
- Test: Create `src/generators/megalopolis-trade.test.ts` (do NOT touch `routes-generator.test.ts` / `trade-network-generator*` — user WIP)

**Interfaces:**
- Consumes: `findMegalopolises`, `groupedMemberIds`, `pooledPopulation`, `portImportance`, and `assignTradeRoles` (import from `./trade-network-generator` — importing is fine, only *modifying* that file is banned).

- [ ] **Step 1: Failing test** — create `src/generators/megalopolis-trade.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findMegalopolises, groupedMemberIds, pooledPopulation } from "./megalopolis";
import { portImportance } from "./routes-generator";

const burg = (i: number, cell: number, extra: Record<string, unknown> = {}) =>
  ({ i, cell, x: 0, y: 0, name: `b${i}`, population: 1, port: 1, ...extra }) as any;

describe("megalopolis trade weighting", () => {
  it("anchor importance uses pooled population; members carry none", () => {
    const cellsBurg = new Uint32Array(10);
    cellsBurg[5] = 1;
    const anchor = burg(1, 5, { population: 2 });
    const member = burg(2, 5, { population: 6 });
    const megas = findMegalopolises([{ i: 0 } as any, anchor, member], cellsBurg);
    const memberIds = groupedMemberIds(megas);
    const pooled = pooledPopulation(megas);

    // the exact wrapper generateTradeNetwork will use:
    const importance = (b: any) => {
      const pop = pooled.get(b.i);
      return pop === undefined ? portImportance(b) : portImportance({ ...b, population: pop });
    };
    expect(importance(anchor)).toBe(portImportance({ ...anchor, population: 8 }));
    expect(memberIds.has(member.i)).toBe(true); // member excluded from role assignment
  });
});
```

- [ ] **Step 2: Run to verify failure** — fails only until `portImportance` is exported; if it already is (check `export function portImportance` at routes-generator.ts:86), this test passes immediately — then it is a characterization test; proceed.
- [ ] **Step 3: Implement in `generateTradeNetwork`** — before the `assignTradeRoles(pack.burgs, {...})` call insert:

```ts
    const megas = findMegalopolises(pack.burgs, pack.cells.burg);
    const memberIds = groupedMemberIds(megas);
    const pooledPop = pooledPopulation(megas);
    for (const id of memberIds) pack.burgs[id].tradeRole = undefined; // members never trade independently
    const megalopolisImportance = (b: Burg) => {
      const pop = pooledPop.get(b.i);
      return pop === undefined ? portImportance(b) : portImportance({ ...b, population: pop } as Burg);
    };
```

Change the call to `assignTradeRoles(pack.burgs.filter(b => !b.i || !memberIds.has(b.i)), { importance: megalopolisImportance, ... })` (rest of the options object unchanged). In the node-build loop (`for (const b of pack.burgs) { if (!b.tradeRole) continue; ...`) add `if (memberIds.has(b.i)) continue;` as the first line (belt-and-braces; roles were cleared above).

- [ ] **Step 4: Verify** — `npx vitest run src/generators/megalopolis-trade.test.ts` PASS; `npx tsc --noEmit` clean; `git diff --name-only` must NOT list trade-network-generator.ts.
- [ ] **Step 5: Commit**

```bash
git add src/generators/routes-generator.ts src/generators/megalopolis-trade.test.ts
git commit --no-verify -m "feat(megalopolis): trade network treats a megalopolis as one node with pooled gravity"
```

---

### Task 6: GPU icons — composite buffer swap

**Files:**
- Modify: `src/renderers/burg-instances.ts` (`buildBurgInstances` lines 12-33; `hitTestBurg` 45-59)
- Modify: `src/renderers/webgl-burg-icons.ts` (`rebuildBurgGL` 112-135; `drawBurgGL` 148-201; `moveBurgGL` 227-238)
- Modify: `src/renderers/webgl-burg-atlas.ts` (add ring tile in `buildBurgAtlas`)
- Test: `src/renderers/burg-instances.test.ts` (append)

**Interfaces:**
- Consumes: `findMegalopolises`, `groupedMemberIds`, `MEGALOPOLIS_SPLIT_ZOOM`, `COMPOSITE_ICON_SCALE`, `RING_ICON_SCALE`, `megalopolisName` (Task 1).
- Produces: `buildBurgInstances(burgs, groups, fallback, opts?)` where `opts = { suppress?: Set<number>; composites?: Array<{x: number; y: number; size: number; tileIndex: number; anchorId: number}> }` — suppressed ids are skipped, composite entries are appended with `minZoom: 0`. `buildCompositeSpecs(megas, groups, ringTileIndex, fallback): composites[]` (new export, same file).

- [ ] **Step 1: Failing tests** — append to `src/renderers/burg-instances.test.ts` (match its existing import/fixture style):

```ts
it("buildBurgInstances suppresses listed ids and appends composite instances", () => {
  const burgs = [null, { i: 1, x: 10, y: 10, group: "city" }, { i: 2, x: 11, y: 11, group: "town" }] as any;
  const groups = { city: { tileIndex: 1, size: 4, minZoom: 0 }, town: { tileIndex: 2, size: 2, minZoom: 0 } };
  const { count, ids, data } = buildBurgInstances(burgs, groups, undefined, {
    suppress: new Set([2]),
    composites: [{ x: 10, y: 10, size: 6.4, tileIndex: 1, anchorId: 1 }]
  });
  expect(count).toBe(2); // burg 1 + composite; burg 2 suppressed
  expect(ids).toEqual([1, 1]); // composite carries the anchor id
  expect(data[5 * 1 + 2]).toBeCloseTo(6.4); // composite size at second instance's size slot
});
```

- [ ] **Step 2: Run to verify failure**, then **implement `burg-instances.ts`**:

```ts
export interface CompositeInstanceSpec { x: number; y: number; size: number; tileIndex: number; anchorId: number }

export function buildBurgInstances(
  burgs: Burg[],
  groups: Record<string, GroupRender>,
  fallback: GroupRender = { tileIndex: 0, size: 2, minZoom: 0 },
  opts?: { suppress?: Set<number>; composites?: CompositeInstanceSpec[] }
): { data: Float32Array; count: number; ids: number[] } {
  const extra = opts?.composites?.length || 0;
  const data = new Float32Array((burgs.length + extra) * INSTANCE_STRIDE);
  const ids: number[] = [];
  let n = 0;
  for (const b of burgs) {
    if (!b || !b.i || b.removed) continue; // skip index-0 placeholder + removed
    if (opts?.suppress?.has(b.i)) continue; // megalopolis members hidden in composite mode
    const g = groups[b.group as string] || fallback;
    const o = n * INSTANCE_STRIDE;
    data[o] = b.x!;
    data[o + 1] = b.y!;
    data[o + 2] = g.size;
    data[o + 3] = g.tileIndex;
    data[o + 4] = g.minZoom;
    ids.push(b.i);
    n++;
  }
  for (const c of opts?.composites ?? []) {
    const o = n * INSTANCE_STRIDE;
    data[o] = c.x;
    data[o + 1] = c.y;
    data[o + 2] = c.size;
    data[o + 3] = c.tileIndex;
    data[o + 4] = 0;
    ids.push(c.anchorId);
    n++;
  }
  return { data: data.subarray(0, n * INSTANCE_STRIDE), count: n, ids };
}

// One enlarged anchor icon + one ring per megalopolis.
export function buildCompositeSpecs(
  megas: Map<number, { anchor: Burg }>,
  groups: Record<string, GroupRender>,
  ringTileIndex: number,
  fallback: GroupRender = { tileIndex: 0, size: 2, minZoom: 0 }
): CompositeInstanceSpec[] {
  const specs: CompositeInstanceSpec[] = [];
  for (const m of megas.values()) {
    const g = groups[m.anchor.group as string] || fallback;
    specs.push({ x: m.anchor.x!, y: m.anchor.y!, size: g.size * COMPOSITE_ICON_SCALE, tileIndex: g.tileIndex, anchorId: m.anchor.i });
    if (ringTileIndex >= 0)
      specs.push({ x: m.anchor.x!, y: m.anchor.y!, size: g.size * RING_ICON_SCALE, tileIndex: ringTileIndex, anchorId: m.anchor.i });
  }
  return specs;
}
```

(import `COMPOSITE_ICON_SCALE`, `RING_ICON_SCALE` and `Megalopolis` types from `../generators/megalopolis`.)

- [ ] **Step 3: Ring tile** — in `webgl-burg-atlas.ts` `buildBurgAtlas`, after the per-group tiles are drawn, draw one extra tile: a stroked circle (canvas 2d: `ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2); ctx.lineWidth = r * 0.18; ctx.strokeStyle = "#fff"; ctx.stroke();` using the same tile cell size the group tiles use) and expose its index on the atlas result as `ringTileIndex: number` (add to the returned object + its type). Follow the file's existing tile-drawing code for exact canvas coordinates.
- [ ] **Step 4: Two buffers in `webgl-burg-icons.ts`** — in `rebuildBurgGL()`:
  - Build `full` instances: `buildBurgInstances(window.pack.burgs, renders, fallback)` (unchanged behavior at/above split zoom).
  - Build `composite` instances: `const megas = findMegalopolises(window.pack.burgs, window.pack.cells.burg); buildBurgInstances(window.pack.burgs, renders, fallback, { suppress: groupedMemberIds(megas), composites: buildCompositeSpecs(megas, renders, atlas.ringTileIndex, fallback) })`.
  - Upload each to its own `gl.ARRAY_BUFFER` (keep the existing buffer for `full`, create a second buffer object for `composite`); store both counts + both id arrays.
  - If `megas.size === 0`, skip the second buffer and draw `full` always (fast path — zero overhead for maps without megalopolises).
  - In `drawBurgGL()`: after reading `t.scale`, pick `const useComposite = compositeBuffer && t.scale < MEGALOPOLIS_SPLIT_ZOOM;` and bind the corresponding buffer/count before the attribute setup + `drawArraysInstanced`.
  - In `moveBurgGL(id, x, y)`: update the x/y of EVERY index matching `id` in BOTH id arrays (member/anchor may appear multiple times), or simply call `scheduleRebuildBurgGL()` when the id belongs to a megalopolis member/anchor.
- [ ] **Step 5: Hit-test redirect** — in the layer registration's `hitTest` (webgl-burg-icons.ts:250-266): after finding the hit burg id, if `getMapTransform().scale < MEGALOPOLIS_SPLIT_ZOOM` and the id is a grouped member, return the anchor's id instead (compute via `findMegalopolises` lazily; cache alongside the buffers built in Step 4).
- [ ] **Step 6: Verify** — `npx vitest run src/renderers/burg-instances.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 7: Commit**

```bash
git add src/renderers/burg-instances.ts src/renderers/burg-instances.test.ts src/renderers/webgl-burg-icons.ts src/renderers/webgl-burg-atlas.ts
git commit --no-verify -m "feat(megalopolis): composite GPU icon buffer below split zoom with ring tile"
```

---

### Task 7: GPU labels — composite name below split zoom

**Files:**
- Modify: `src/renderers/webgl-burg-labels.ts` (`LabelBox` type, `buildLabelBoxes` 18-49, atlas glyph collection line ~170)
- Modify: `src/renderers/label-visibility.ts` (`selectVisibleLabels` min-zoom gate ~line 82)
- Test: `src/renderers/label-visibility.test.ts` and `src/renderers/webgl-burg-labels.test.ts` (append, matching their fixtures)

**Interfaces:**
- Consumes: Task 1 exports.
- Produces: `LabelBox` gains optional `maxZoom?: number`; boxes with `scale >= maxZoom` are never selected.

- [ ] **Step 1: Failing test (visibility gate)** — append to `label-visibility.test.ts` using its existing box fixture helper:

```ts
it("suppresses boxes at or beyond their maxZoom (megalopolis composite labels)", () => {
  const boxes = [
    makeBox({ id: 1, minZoom: 0, maxZoom: 4 }), // composite: visible only below 4
    makeBox({ id: 2, minZoom: 4 })              // member: visible only at/above 4
  ];
  const below = selectVisibleLabels(boxes, 2, viewport, /* other args per fixture */);
  expect(below.map(b => b.id)).toEqual([1]);
  const above = selectVisibleLabels(boxes, 5, viewport, /* other args per fixture */);
  expect(above.map(b => b.id)).toEqual([2]);
});
```

(adapt `makeBox`/`viewport`/argument list to this test file's existing helpers — copy from a neighboring test.)

- [ ] **Step 2: Implement gate** — in `label-visibility.ts` next to `if (gate && scale < b.minZoom) continue;` add `if (b.maxZoom !== undefined && scale >= b.maxZoom) continue;` (this check is NOT behind `gate` — composite labels must swap even when min-zoom gating is off). Add `maxZoom?: number` to the box type used there.
- [ ] **Step 3: Composite boxes** — in `webgl-burg-labels.ts` `buildLabelBoxes`:
  - Accept the megalopolis map: compute at the top of `rebuildBurgLabelGL()` — `const megas = findMegalopolises(burgs, window.pack.cells.burg); const memberIds = groupedMemberIds(megas);` and pass both in.
  - For any burg in a megalopolis (member OR anchor): `minZoom: Math.max(s.minZoom, MEGALOPOLIS_SPLIT_ZOOM)` on its normal box.
  - After the loop, per megalopolis push a composite box: anchor position/style/group, `name: megalopolisName(m.anchor)`, `population: m.population`, `order: 0` (capital-tier priority, exempt from greedy collision drop), `minZoom: 0`, `maxZoom: MEGALOPOLIS_SPLIT_ZOOM`, `id: m.anchor.i`.
  - Glyphs (line ~170): `atlas = buildGlyphAtlas(collectGlyphs([...burgs, ...[...megas.values()].map(m => ({ name: megalopolisName(m.anchor) }))]), font)` — `collectGlyphs` reads `.name`; verify its parameter type and cast as needed.
- [ ] **Step 4: Verify** — `npx vitest run src/renderers/label-visibility.test.ts src/renderers/webgl-burg-labels.test.ts` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**

```bash
git add src/renderers/webgl-burg-labels.ts src/renderers/label-visibility.ts src/renderers/label-visibility.test.ts src/renderers/webgl-burg-labels.test.ts
git commit --no-verify -m "feat(megalopolis): composite GPU label with maxZoom swap at split zoom"
```

---

### Task 8: SVG path, zoom hook, tooltip, cache-busts

**Files:**
- Modify: `src/renderers/draw-burg-icons.ts` (SVG loop 27-48), `src/renderers/draw-burg-labels.ts` (SVG loop 28-55)
- Modify: `public/main.js` (`invokeActiveZooming` `#burgLabels` branch, lines ~683-757)
- Modify: `public/modules/ui/general.js` (`infoBurg` line ~392)
- Modify: `src/index.html` (bump `main.js?v=1.137.12` → `main.js?v=1.137.12-mega1`, `general.js?v=1.137.6-mb1` → `general.js?v=1.137.6-mega1`)

**Interfaces:** consumes Task 1 exports; classic JS reads them via a tiny window bridge — in `megalopolis.ts` add at the bottom:

```ts
declare global {
  var Megalopolis: {
    find: typeof findMegalopolises;
    memberIds: typeof groupedMemberIds;
    name: typeof megalopolisName;
    SPLIT_ZOOM: number;
  };
}
window.Megalopolis = {
  find: findMegalopolises,
  memberIds: groupedMemberIds,
  name: megalopolisName,
  SPLIT_ZOOM: MEGALOPOLIS_SPLIT_ZOOM
};
```

- [ ] **Step 1: SVG draw loops** — in both SVG loops, add `class="megalopolis-member"` (icons: `.attr("class", ...)` on the `<use>`; labels: on the `<text>`) for burgs in `groupedMemberIds`, and `class="megalopolis-anchor"` on anchors. After each group loop, append per megalopolis a composite element with class `megalopolis-composite`: icons — a `<use>` of the anchor's icon at `1.6×` size plus a `<circle>` ring (r = icon size × 1.1, `fill:none`, `stroke:#fff`); labels — a `<text>` with `megalopolisName(anchor)` at the anchor position. Both composite sets start `display:none` (visibility is owned by the zoom hook).
- [ ] **Step 2: Zoom hook (SVG only)** — in `public/main.js` `invokeActiveZooming`, inside the `#burgLabels` branch AFTER the `burgLabelsWebglActive()` early-return (so GPU mode never runs it), add:

```js
  // megalopolis composite swap (SVG path only)
  const split = window.Megalopolis ? window.Megalopolis.SPLIT_ZOOM : 4;
  const compositeMode = scale < split;
  document.querySelectorAll("#burgIcons .megalopolis-member, #burgLabels .megalopolis-member, #burgIcons .megalopolis-anchor, #burgLabels .megalopolis-anchor")
    .forEach(el => el.style.display = compositeMode ? "none" : "");
  document.querySelectorAll("#burgIcons .megalopolis-composite, #burgLabels .megalopolis-composite")
    .forEach(el => el.style.display = compositeMode ? "" : "none");
```

- [ ] **Step 3: Tooltip** — in `general.js`, replace the `infoBurg.innerHTML = cells.burg[i] ? ...` line:

```js
  if (cells.burg[i]) {
    const coLocated = pack.burgs.filter(b => b.i && !b.removed && b.cell === i);
    infoBurg.innerHTML =
      coLocated.length > 1 && window.Megalopolis
        ? `${window.Megalopolis.name(pack.burgs[cells.burg[i]])} — ${coLocated.length} burgs (${coLocated.map(b => b.name).join(", ")})`
        : pack.burgs[cells.burg[i]].name + " (" + cells.burg[i] + ")";
  } else infoBurg.innerHTML = "no";
```

- [ ] **Step 4: Cache-busts** — bump both tokens in `src/index.html` as listed in Files.
- [ ] **Step 5: Verify** — `npx tsc --noEmit` clean; `npx vitest run` no new failures.
- [ ] **Step 6: Commit**

```bash
git add src/renderers/draw-burg-icons.ts src/renderers/draw-burg-labels.ts public/main.js public/modules/ui/general.js src/index.html src/generators/megalopolis.ts
git commit --no-verify -m "feat(megalopolis): SVG composite swap, cell tooltip, window bridge"
```

---

### Task 9: Overviews, docs, final verification

**Files:**
- Modify: `src/controllers/burgs-overview.ts` (row loop ~269-314)
- Modify: `src/controllers/production-overview.ts` (`open(burgId)` header area ~224-233)
- Modify: `docs/architecture/data_model.md` (one line: treasury on grouped members is always 0; anchor holds the pool — add to the `treasury` bullet)

- [ ] **Step 1: burgs-overview grouped rows** — before the row loop compute `megas`/`memberIds` (Task 1 imports). Sort so members follow their anchor (stable secondary sort by `(memberIds.has(b.i) ? anchorIdOf(b) : b.i)` within the current sort). Anchor rows: append `▸ Greater X (n)` badge via a `<span class="megalopolis-badge" data-cell="${b.cell}">` that toggles `display` of rows with `data-mega-cell="${cell}"`; member rows get `data-mega-cell="${b.cell}"`, an indent (`style="padding-left:1.2em"`), and start hidden. Wire the badge click in the same delegated click handler the table already uses for row buttons.
- [ ] **Step 2: production-overview + burg-editor notes** — in production-overview `open(burgId)`, if the burg is a grouped member, render a banner line `Part of ${megalopolisName(anchor)} — production and treasury are pooled on ${anchor.name}` with a link/button opening `open(anchor.i)`; if it is an anchor of a megalopolis, show `${megalopolisName(burg)} — pooled over N burgs` above the treasury line. In `src/controllers/burg-editor.ts`, where the dialog header/subtitle is composed, add the same one-line "Part of Greater X (n burgs)" note for grouped members (spec requirement).
- [ ] **Step 3: docs** — extend the data_model.md `treasury` line (in the burg object section): "For megalopolises (multiple burgs in one cell) the pool lives on the anchor; grouped members stay at 0."
- [ ] **Step 4: Full verification** — `npx tsc --noEmit && npx vitest run && npm run build`; only allowed failures: the 2 pre-existing seam tests.
- [ ] **Step 5: Commit**

```bash
git add src/controllers/burgs-overview.ts src/controllers/production-overview.ts docs/architecture/data_model.md
git commit --no-verify -m "feat(megalopolis): grouped overview rows, pooled-production notes, docs"
```

- [ ] **Step 6: Manual browser checklist (report to user; their dev session)**
  1. Add 2-3 burgs to one cell; zoom out below split → one enlarged ringed icon + "Greater X" label; zoom in → individual burgs, group label gone (GPU mode: force `webglBurgs` on; SVG mode: force off — verify both).
  2. Click the composite → burg editor opens on the anchor.
  3. Regenerate Economy → member burgs show treasury 0; anchor treasury/product reflect the pool; markets overview shows one market centered at the anchor.
  4. Burgs overview → anchor row shows the ▸ badge; expanding reveals indented member rows.
  5. Delete the anchor → successor promoted, pool transferred (check treasury in burgs overview).
  6. Hover the cell → tooltip lists "Greater X — n burgs (...)".
  7. Save/reload → grouping and pooled treasury survive.
