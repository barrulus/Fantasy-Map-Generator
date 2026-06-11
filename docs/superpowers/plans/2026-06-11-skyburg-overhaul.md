# Skyburg Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Population-scaled skyburg altitude (50–500 ft above the local surface), a guaranteed 100-person population floor, a sky capital that founds a zero-territory sky state, terrain-weighted (coast-hugging) placement, and flying-aware elevation displays/exports.

**Architecture:** Pure helpers (`skyburgAltitude`, `skyburgPlacementWeight`, `nearestBurgId`) exported from `burgs-generator.ts` and unit-tested; the sky capital is flagged at placement time so the existing `createStates()` machinery founds the sky state, with three small guards in `states-generator.ts` (seed skip, flying burg-state assignment, label pole). UI/export changes are mechanical.

**Tech Stack:** TypeScript (`src/modules/`, vitest), legacy JS UI (`public/modules/ui/`, `public/main.js`), bookmarklet tools (`tools/geojson-exports/`).

**Spec:** `docs/superpowers/specs/2026-06-11-skyburg-overhaul-design.md`

**Key facts for an engineer with zero context:**

- Commands: `npx tsc --noEmit` (type check), `npx vitest run` (tests), `npx vitest run src/modules/<file>.test.ts -t <pattern>` (subset). Nix flake provides deps — never `npm install`.
- Generation pipeline (`public/main.js:731-746`): `Burgs.generate()` → `States.generate()` → `Burgs.specify()` → `defineStateForms` → `Provinces.generate()` → `Military.generate()`. Populations don't exist until `specify()`, so the capital is chosen at placement and altitude is assigned in `specify()`.
- Modules register as globals: `window.Burgs = new BurgModule()` (`burgs-generator.ts:1193`), `window.States = new StatesModule()` (end of `states-generator.ts`). Tests get instances via dynamic import + `g.window.<Name>` (see `routes-generator.test.ts` for the pattern).
- `FlatQueue`, `biomesData`, `populationRate`, `urbanization`, `TIME` are runtime globals (typed in `src/types/global.ts`); vitest runs must stub them.
- The repo working tree has an UNRELATED uncommitted hunk in `src/index.html` (splash preload). Before starting: `git stash push -m "wip: splash preload (user change)" -- src/index.html`, create branch `feat/skyburg-overhaul` at HEAD, `git branch -f main origin/main`, and `git stash pop` after the final commit. The two docs commits already on local main ride along on the branch.
- Pre-commit hook runs biome; one pre-existing unrelated warning in `trade-network-generator.ts` is normal. If the hook reformats a staged file, `git add` the file and `git commit --amend --no-edit`.
- No Co-Authored-By lines in commit messages.

---

### Task 0: Branch setup

**Files:** none

- [ ] **Step 1: Stash the user's hunk and branch**

```bash
git stash push -m "wip: splash preload (user change)" -- src/index.html
git switch -c feat/skyburg-overhaul
git branch -f main origin/main
```

Expected: branch created; `git log --oneline -3` shows the skyburg spec commit at HEAD.

---

### Task 1: Pure helpers — `skyburgAltitude`, `skyburgPlacementWeight`, `nearestBurgId` (TDD)

**Files:**
- Modify: `src/modules/burgs-generator.ts` (next to `skyburgGroupFromPopulation`, line ~53)
- Test: `src/modules/burgs-generator.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/burgs-generator.test.ts`. The import at the top of the file currently reads `import { skyburgGroupFromPopulation } from "./burgs-generator";` — extend it to:

```ts
import { nearestBurgId, skyburgAltitude, skyburgGroupFromPopulation, skyburgPlacementWeight } from "./burgs-generator";
```

Append:

```ts
describe("skyburgAltitude", () => {
  it("clamps to 50 ft at and below the population floor", () => {
    expect(skyburgAltitude(0.1)).toBe(50);
    expect(skyburgAltitude(0.05)).toBe(50);
  });

  it("clamps to 500 ft at and above 1.5 units (sky capital range)", () => {
    expect(skyburgAltitude(1.5)).toBe(500);
    expect(skyburgAltitude(4)).toBe(500);
  });

  it("is monotonic non-decreasing and rounded to 10 ft", () => {
    let prev = 0;
    for (let p = 0.1; p <= 1.5; p += 0.05) {
      const alt = skyburgAltitude(p);
      expect(alt % 10).toBe(0);
      expect(alt).toBeGreaterThanOrEqual(prev);
      prev = alt;
    }
  });

  it("midpoint of the range sits near the middle of 50-500", () => {
    expect(skyburgAltitude(0.8)).toBe(280); // 50 + 450 * 0.5 = 275 -> 280
  });
});

describe("skyburgPlacementWeight", () => {
  it("full weight on coastal cells (|t| = 1)", () => {
    expect(skyburgPlacementWeight(1)).toBe(1);
    expect(skyburgPlacementWeight(-1)).toBe(1);
  });

  it("half weight one ring out (|t| = 2)", () => {
    expect(skyburgPlacementWeight(2)).toBe(0.5);
    expect(skyburgPlacementWeight(-2)).toBe(0.5);
  });

  it("low weight everywhere else (deep ocean, far inland, t = 0)", () => {
    expect(skyburgPlacementWeight(0)).toBe(0.15);
    expect(skyburgPlacementWeight(3)).toBe(0.15);
    expect(skyburgPlacementWeight(-3)).toBe(0.15);
  });
});

describe("nearestBurgId", () => {
  const burgs = [
    0,
    { x: 10, y: 10 },
    { x: 50, y: 50 },
    { x: 51, y: 49 }
  ] as any[];

  it("returns the id of the burg closest to the point", () => {
    expect(nearestBurgId(burgs, [1, 2, 3], 0, 0)).toBe(1);
    expect(nearestBurgId(burgs, [1, 2, 3], 52, 48)).toBe(3);
  });

  it("only considers the given ids", () => {
    expect(nearestBurgId(burgs, [2], 0, 0)).toBe(2);
  });

  it("returns -1 for an empty id list", () => {
    expect(nearestBurgId(burgs, [], 0, 0)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/burgs-generator.test.ts`
Expected: FAIL — `skyburgAltitude`, `skyburgPlacementWeight`, `nearestBurgId` are not exported.

- [ ] **Step 3: Implement the helpers**

In `src/modules/burgs-generator.ts`, directly after `skyburgGroupFromPopulation` (ends ~line 57), add:

```ts
// Flying-burg altitude in feet above the local surface (ground or sea).
// Population-scaled: tiny settlements hover low, the largest sky cities ride
// high. Linear from 50 ft at the 0.1-unit floor to 500 ft at 1.5+ units,
// rounded to 10 ft.
export function skyburgAltitude(population: number): number {
  const t = Math.min(Math.max((population - 0.1) / 1.4, 0), 1);
  return Math.round((50 + 450 * t) / 10) * 10;
}

// Acceptance weight for a skyburg candidate by the cell's distance-to-coast
// field (cells.t): hug coastlines and islands, thin out over open ocean and
// deep inland.
export function skyburgPlacementWeight(t: number): number {
  const d = Math.abs(t);
  if (d === 1) return 1;
  if (d === 2) return 0.5;
  return 0.15;
}

// Id of the burg (among `ids`) closest to (ax, ay); -1 if ids is empty.
export function nearestBurgId(burgs: { x: number; y: number }[], ids: number[], ax: number, ay: number): number {
  let best = -1;
  let bestD = Infinity;
  for (const id of ids) {
    const b = burgs[id];
    const d = (b.x - ax) ** 2 + (b.y - ay) ** 2;
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/burgs-generator.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/burgs-generator.ts src/modules/burgs-generator.test.ts
git commit -m "feat(skyburg): altitude, placement-weight, and nearest-burg helpers"
```

---

### Task 2: Population floor, sky-capital population, altitude assignment, capital group (TDD)

**Files:**
- Modify: `src/modules/burgs-generator.ts` (`definePopulation` ~line 612, `specify()` ~line 909, `defineGroup` flying branch ~line 860, group skip ~line 874, default groups list ~line 816)
- Test: `src/modules/burgs-generator.test.ts` (append)

- [ ] **Step 1: Write the failing tests**

`definePopulation` is private on the module instance, which loads via globals — use the dynamic-import pattern. Append to `src/modules/burgs-generator.test.ts`:

```ts
describe("definePopulation for flying burgs", () => {
  let Burgs: any;

  beforeAll(async () => {
    const g = globalThis as any;
    g.window = g.window ?? {};
    g.document = g.document ?? {
      readyState: "complete",
      getElementById: () => null,
      addEventListener: () => {},
      querySelector: () => null
    };
    g.TIME = false;
    g.WARN = false;
    g.ERROR = false;
    g.pack = g.pack ?? {};
    await import("./burgs-generator");
    Burgs = (g.window as any).Burgs;
  });

  const makeFlying = (over: any = {}) => ({ i: 7, cell: 13, flying: 1, ...over }) as any;

  it("never drops below 100 people at default rates", () => {
    const g = globalThis as any;
    g.populationRate = 1000;
    g.urbanization = 1;
    for (let n = 0; n < 200; n++) {
      const burg = makeFlying({ i: n + 1, cell: (n * 37) % 100 });
      (Burgs as any).definePopulation(burg);
      expect(burg.population * 1000 * 1).toBeGreaterThanOrEqual(100);
    }
  });

  it("holds the 100-person floor when urbanization shrinks people-per-unit", () => {
    const g = globalThis as any;
    g.populationRate = 1000;
    g.urbanization = 0.2; // people = units * 200 — old 0.1-unit floor would mean 20 people
    for (let n = 0; n < 200; n++) {
      const burg = makeFlying({ i: n + 1, cell: (n * 37) % 100 });
      (Burgs as any).definePopulation(burg);
      expect(burg.population * 1000 * 0.2).toBeGreaterThanOrEqual(100 - 0.5); // rn() rounds to 3 decimals
    }
    g.urbanization = 1;
  });

  it("gives the sky capital 2-6 units (~2k-6k people)", () => {
    const g = globalThis as any;
    g.populationRate = 1000;
    g.urbanization = 1;
    for (let n = 0; n < 50; n++) {
      const burg = makeFlying({ i: n + 1, cell: (n * 37) % 100, capital: 1 });
      (Burgs as any).definePopulation(burg);
      expect(burg.population).toBeGreaterThanOrEqual(1.9); // gauss min 2 minus jitter
      expect(burg.population).toBeLessThanOrEqual(6.1); // gauss max 6 plus jitter
    }
  });
});
```

(`beforeAll` is already imported in this file? It is NOT — the current top import is `import { describe, expect, it } from "vitest";`. Change it to `import { beforeAll, describe, expect, it } from "vitest";`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/burgs-generator.test.ts -t "definePopulation for flying"`
Expected: the urbanization-floor test FAILS (old floor is 0.01 units); the capital test FAILS (no capital branch yet). Note: importing the module may surface missing globals — extend the stub in the test, not the module, if so.

- [ ] **Step 3: Implement the `definePopulation` flying branch**

In `src/modules/burgs-generator.ts` (~line 612), replace:

```ts
    if (burg.flying) {
      // Skyburgs: small floating settlements, 200-1500 people. Skip the
      // ground-route connectivity modifier — flying burgs aren't on roads.
      let population = gauss(0.6, 0.4, 0.2, 1.5);
      population += (((burg.i as number) % 100) - (burg.cell % 100)) / 1000;
      burg.basePopulation = population;
      burg.population = rn(Math.max(population, 0.01), 3);
      return;
    }
```

with:

```ts
    if (burg.flying) {
      // Skyburgs: small floating settlements (~100-1500 people); the sky
      // capital is the cluster's metropolis (~2k-6k). Skip the ground-route
      // connectivity modifier — flying burgs aren't on roads.
      let population = burg.capital ? gauss(3, 1.5, 2, 6) : gauss(0.6, 0.4, 0.2, 1.5);
      population += (((burg.i as number) % 100) - (burg.cell % 100)) / 1000;
      // Hard floor: never below 100 people, whatever the map's population settings
      const peoplePerUnit = (globalThis.populationRate ?? 1000) * (globalThis.urbanization ?? 1);
      const minUnits = peoplePerUnit > 0 ? 100 / peoplePerUnit : 0.1;
      population = Math.max(population, minUnits);
      burg.basePopulation = population;
      burg.population = rn(population, 3);
      return;
    }
```

- [ ] **Step 4: Assign altitude in `specify()`**

In `specify()` (~line 912), the first forEach becomes:

```ts
    pack.burgs.forEach(burg => {
      if (!burg.i || burg.removed || burg.lock) return;
      this.definePopulation(burg);
      if (burg.flying) burg.altitude = skyburgAltitude(burg.population as number);
      this.defineEmblem(burg);
      this.defineFeatures(burg);
    });
```

(`skyburgAltitude` is a module-local export from Task 1 — same file, no import needed.)

- [ ] **Step 5: Capital group in `defineGroup` + default groups list**

(a) The flying branch in `defineGroup` (~line 860) becomes:

```ts
    // Flying burgs: assign group by population tier for zoom-level culling
    if (burg.flying) {
      burg.group = burg.capital ? "skyburg-capital" : skyburgGroupFromPopulation(burg.population as number);
      return;
    }
```

(b) The skyburg-group skip for ground burgs (~line 874) becomes:

```ts
      if (group.name.startsWith("skyburg")) continue; // skip skyburg groups for non-flying burgs
```

(c) In the default groups list (~line 816), insert BEFORE the `{ name: "skyburg", ... }` entry:

```ts
      {
        name: "skyburg-capital",
        active: true,
        order: 10,
        features: { flying: true }
      },
```

- [ ] **Step 6: Run tests + type check**

Run: `npx vitest run src/modules/burgs-generator.test.ts && npx tsc --noEmit`
Expected: all PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add src/modules/burgs-generator.ts src/modules/burgs-generator.test.ts
git commit -m "feat(skyburg): population floor, sky-capital population, altitude from population"
```

---

### Task 3: Terrain-weighted placement + capital selection

**Files:**
- Modify: `src/modules/burgs-generator.ts` (`generateSkyBurgs`, lines ~494-553)

No direct unit test — the loop is RNG-driven; its two new ingredients (`skyburgPlacementWeight`, `nearestBurgId`) are covered by Task 1. Verified manually in Task 6.

- [ ] **Step 1: Apply the placement changes**

In `generateSkyBurgs`: change the attempt budget, add the weight rejection, track placed ids, and pick the capital. The loop section becomes:

```ts
      const skyQuadtree = quadtree();
      const placedIds: number[] = [];
      let added = 0;
      const maxAttempts = skyburgCount * 60; // weighted rejection needs more draws

      for (let attempts = 0; added < skyburgCount && attempts < maxAttempts; attempts++) {
        const theta = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius; // uniform within disc
        const x = ax + Math.cos(theta) * r;
        const y = ay + Math.sin(theta) * r;
        if (x < 0 || x > graphWidth || y < 0 || y > graphHeight) continue;
        if (skyQuadtree.find(x, y, minSpacing) !== undefined) continue;

        const cell = window.findCell(x, y, undefined, pack) as number;
        // Terrain weighting: density traces coastlines and islands inside the
        // disc instead of a uniform circular blob.
        if (Math.random() > skyburgPlacementWeight(cells.t[cell])) continue;

        const culture = cells.culture[cell] || 0;
        const burgId = burgs.length;
        burgs.push({
          cell,
          x,
          y,
          i: burgId,
          state: 0,
          culture,
          name: Names.getCulture(culture),
          feature: cells.f[cell],
          capital: 0,
          port: 0,
          flying: 1,
          skyPort: 1,
          altitude: 500,
          settlementType: "regionalCenter"
        });
        skyQuadtree.add([x, y]);
        placedIds.push(burgId);
        added++;
      }

      // Cluster capital: the most central skyburg. createStates() later founds
      // the sky state from this capital flag.
      const capitalId = nearestBurgId(burgs as { x: number; y: number }[], placedIds, ax, ay);
      if (capitalId !== -1) {
        burgs[capitalId].capital = 1;
        burgs[capitalId].settlementType = "capital";
      }
```

(The `altitude: 500` placement literal stays — `specify()` overwrites it with the population-scaled value; the placeholder just keeps the field defined between generate and specify.)

- [ ] **Step 2: Type check and full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: clean / all pass.

- [ ] **Step 3: Commit**

```bash
git add src/modules/burgs-generator.ts
git commit -m "feat(skyburg): terrain-weighted placement and central capital selection"
```

---

### Task 4: Sky state guards in states-generator (TDD)

**Files:**
- Modify: `src/modules/states-generator.ts` (seed loop ~line 138, burg assignment ~line 252, `getPoles` ~line 310)
- Create: `src/modules/states-generator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/modules/states-generator.test.ts`:

```ts
import FlatQueue from "flatqueue";
import { beforeAll, describe, expect, it } from "vitest";

let States: any;

beforeAll(async () => {
  const g = globalThis as any;
  g.window = g.window ?? {};
  g.document = g.document ?? {
    readyState: "complete",
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null
  };
  g.FlatQueue = FlatQueue;
  g.TIME = false;
  g.WARN = false;
  g.ERROR = false;
  g.pack = g.pack ?? {};
  await import("./states-generator");
  States = (g.window as any).States;
});

// 5x5 all-land grid. State 1 (ground) capital at cell 0; state 2 (sky) capital
// burg flies over cell 12. document.getElementById -> null keeps growthRate
// tiny ((25/2)*1*1 = 12.5), so expansion stays near the seeds — the test only
// cares about seeding and burg assignment, not spread.
const N = 5;

function buildPack() {
  const n = N * N;
  const c: number[][] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const id = y * N + x;
      const neibs: number[] = [];
      if (x > 0) neibs.push(id - 1);
      if (x < N - 1) neibs.push(id + 1);
      if (y > 0) neibs.push(id - N);
      if (y < N - 1) neibs.push(id + N);
      c.push(neibs);
    }
  }
  const cells = {
    i: Uint32Array.from({ length: n }, (_, k) => k),
    c,
    h: new Uint8Array(n).fill(30),
    s: new Int16Array(n).fill(10),
    r: new Uint16Array(n),
    t: new Int8Array(n).fill(2),
    f: new Uint16Array(n).fill(1),
    biome: new Uint8Array(n).fill(5),
    culture: new Uint16Array(n).fill(1),
    fl: new Uint16Array(n),
    state: new Uint16Array(n)
  };
  const burgs: any[] = [
    0,
    { i: 1, capital: 1, cell: 0, x: 0, y: 0, culture: 1 }, // ground capital
    { i: 2, capital: 1, flying: 1, cell: 12, x: 50, y: 50, culture: 1 }, // sky capital
    { i: 3, flying: 1, cell: 7, x: 40, y: 20, culture: 1 }, // ordinary skyburg
    { i: 4, cell: 24, x: 90, y: 90, culture: 1 } // far ground burg (stays neutral)
  ];
  const states: any[] = [
    { i: 0, name: "Neutrals" },
    { i: 1, name: "Ground", capital: 1, center: 0, culture: 1, type: "Generic", expansionism: 1 },
    { i: 2, name: "Sky", capital: 2, center: 12, culture: 1, type: "Generic", expansionism: 1 }
  ];
  const cultures = [{ center: 0 }, { center: 0 }];
  (globalThis as any).pack = { cells, burgs, states, cultures, features: [0, { type: "island" }] };
  (globalThis as any).biomesData = { cost: new Array(13).fill(10) };
}

describe("expandStates with a sky state", () => {
  it("never seeds or claims territory for the flying-capital state", () => {
    buildPack();
    States.expandStates();
    const pack = (globalThis as any).pack;
    expect(pack.cells.state[12]).not.toBe(2); // sky capital cell unclaimed
    expect(Array.from(pack.cells.state)).not.toContain(2); // no cell anywhere
    expect(pack.cells.state[0]).toBe(1); // ground capital seeded normally
  });

  it("assigns flying burgs to the sky state and ground burgs by territory", () => {
    buildPack();
    States.expandStates();
    const { burgs } = (globalThis as any).pack;
    expect(burgs[2].state).toBe(2); // sky capital
    expect(burgs[3].state).toBe(2); // ordinary skyburg, regardless of ground below
    expect(burgs[1].state).toBe(1); // ground capital on its seed cell
    expect(burgs[4].state).toBe(0); // out of expansion range -> neutral
  });

  it("falls back to ground assignment for flying burgs when no sky state exists", () => {
    buildPack();
    const pack = (globalThis as any).pack;
    pack.states.pop(); // remove the sky state
    pack.burgs[2].capital = 0;
    States.expandStates();
    expect(pack.burgs[2].state).toBe(0); // neutral, not some ground state
    expect(pack.burgs[3].state).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/states-generator.test.ts`
Expected: the first two tests FAIL — sky capital cell gets seeded (`cells.state[12] === 2`) and flying burgs get ground-territory states. (The third, no-sky-state fallback, may already pass — it's a regression guard.)

- [ ] **Step 3: Implement the three guards**

(a) Seed loop (`expandStates`, ~line 138) — skip flying capitals:

```ts
    for (const state of states) {
      if (!state.i || state.removed) continue;
      if (burgs[state.capital]?.flying) continue; // sky state: zero ground territory
      const capitalCell = burgs[state.capital].cell;
      cells.state[capitalCell] = state.i;
      const center = state.center;
      cost[center] = 1;
      bfsState[center] = state.i;
      queue.push(center, 1);
    }
```

(b) Burg assignment (end of `expandStates`, ~line 252):

```ts
    const skyState = states.find(s => s.i && !s.removed && burgs[s.capital]?.flying);
    const skyStateId = skyState?.i ?? 0;
    burgs
      .filter(b => b.i && !b.removed)
      .forEach(b => {
        // flying burgs belong to the sky state, never to the ground below them
        b.state = b.flying ? skyStateId : cells.state[b.cell];
      });
```

(c) `getPoles()` (~line 310) — anchor the sky state's label to its capital:

```ts
  getPoles() {
    const getType = (cellId: number) => pack.cells.state[cellId];
    const poles = getPolesOfInaccessibility(pack, getType);

    pack.states.forEach(s => {
      if (!s.i || s.removed) return;
      const capital = pack.burgs[s.capital];
      // sky state owns no cells — pole at the capital so its label sits on the cluster
      s.pole = capital?.flying ? [capital.x, capital.y] : poles[s.i] || [0, 0];
    });
  }
```

- [ ] **Step 4: Run tests + type check**

Run: `npx vitest run src/modules/states-generator.test.ts && npx tsc --noEmit`
Expected: 3 PASS, tsc clean.

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: all pass (no regressions elsewhere).

- [ ] **Step 6: Commit**

```bash
git add src/modules/states-generator.ts src/modules/states-generator.test.ts
git commit -m "feat(skyburg): zero-territory sky state founded by the flying capital"
```

---

### Task 5: UI and export surfaces

**Files:**
- Modify: `public/main.js` (`BURG_MIN_ZOOM`, ~line 551)
- Modify: `public/modules/ui/burg-editor.js` (elevation line, ~line 85)
- Modify: `src/index.html` (elevation markup ~line 3517, altitude tooltip ~line 3582, cache tokens ~lines 8617/8626)
- Modify: `public/modules/ui/burgs-overview.js` (CSV header ~line 555, row ~line 576)
- Modify: `tools/geojson-exports/export-burgs.js` (~line 67)

- [ ] **Step 1: Label zoom threshold**

In `public/main.js` `BURG_MIN_ZOOM` (~line 551), add `"skyburg-capital": 2` so the sky capital's label shows from low zoom:

```js
  const BURG_MIN_ZOOM = {
    states: 0,
    capital: 1, "skyburg-capital": 2, skyburg: 4, "skyburg-mid": 6, "skyburg-small": 8,
    city: 4, town: 6,
    fort: 7, monastery: 7, caravanserai: 7, trading_post: 7,
    village: 10, hamlet: 14
  };
```

- [ ] **Step 2: Burg editor elevation line**

(a) In `src/index.html` (~line 3517), the static suffix moves into JS. Change:

```html
                <span id="burgElevation"></span> above sea level
```

to:

```html
                <span id="burgElevation"></span>
```

(b) In `public/modules/ui/burg-editor.js` (~line 85), change:

```js
    ensureEl("burgElevation").innerHTML = getHeight(pack.cells.h[b.cell]);
```

to:

```js
    ensureEl("burgElevation").innerHTML = b.flying
      ? `${b.altitude || 500} ft above ${pack.cells.h[b.cell] < 20 ? "the sea" : "ground level"}`
      : getHeight(pack.cells.h[b.cell]) + " above sea level";
```

(c) In `src/index.html`, the altitude row tooltip (`#burgAltitudeRow`, ~line 3582) changes from
`data-tip="Altitude above sea level for this flying sky-city"` to
`data-tip="Altitude above the local surface (ground or sea) for this flying sky-city, in feet"`.

(d) Bump cache tokens in `src/index.html`: `burg-editor.js?v=1.122.12` → `?v=1.122.13`, and `burgs-overview.js?v=1.120.5` → `?v=1.122.13`.

- [ ] **Step 3: Burgs overview CSV**

In `public/modules/ui/burgs-overview.js`:

(a) Header (~line 555): after `Elevation (${heightUnit.value}),` insert `Altitude (ft),`:

```js
    let data = `Id,Burg,Province,Province Full Name,State,State Full Name,Culture,Religion,Group,Population,X,Y,Latitude,Longitude,Elevation (${heightUnit.value}),Altitude (ft),Temperature,Temperature likeness,Capital,Port,Citadel,Walls,Plaza,Temple,Shanty Town,Emblem,Preview link\n`; // headers
```

(b) Row (~line 576): after the elevation field, add the altitude field:

```js
      data += parseInt(getHeight(pack.cells.h[b.cell])) + ",";
      data += (b.flying ? b.altitude || 500 : "") + ",";
```

- [ ] **Step 4: GeoJSON export**

In `tools/geojson-exports/export-burgs.js`, after the `skyPort` property (~line 66), add:

```js
          altitude: b.altitude || 0,
```

(`elevation` stays raw terrain `h` — both facts are useful in GIS.)

- [ ] **Step 5: Type check (index.html is in the vite graph)**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add public/main.js public/modules/ui/burg-editor.js public/modules/ui/burgs-overview.js src/index.html tools/geojson-exports/export-burgs.js
git commit -m "feat(skyburg): flying-aware elevation displays, CSV/GeoJSON altitude, capital label zoom"
```

---

### Task 6: Final verification

**Files:** none

- [ ] **Step 1: Full suite + type check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, tsc clean.

- [ ] **Step 2: Restore the user's stashed hunk**

```bash
git stash pop
```

Expected: `src/index.html` shows the splash-preload hunk as the only unstaged change (it merges cleanly — different region of the file).

- [ ] **Step 3: Manual browser verification (user's dev server — do NOT start/stop it)**

Report this checklist for the user (or run via Playwright against the running server if permitted):

1. Generate a new map. The skyburg cluster hugs coastlines/islands instead of a uniform disc; one skyburg has a low-zoom label (the capital).
2. States editor lists the sky state (capital = that skyburg, 0 cells/area). Generation completes with no console errors — specifically `Provinces.generate`, `Military.generate`, diplomacy, and `defineStateForms` tolerate the zero-cell state.
3. Open several skyburgs: Elevation reads "N ft above the sea" / "N ft above ground level"; larger-population skyburgs have higher N (50–500); the capital reads 500 ft and population ≈2k–6k; no skyburg is under 100 people.
4. Burgs overview → export CSV: "Altitude (ft)" column filled for skyburgs, empty for ground burgs.
5. GeoJSON bookmarklet export: burg features carry `altitude`.

If step 2 surfaces a crash in a zero-cell consumer, fix THAT consumer with a minimal guard (e.g., skip states with no cells) and re-run — report what was guarded.
