# Trade-Route UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Burg-editor control to manually set a burg's trade role (auto/hub/waystation/none) with immediate trade-network regeneration, plus `#traderoutes` styling in all 12 style presets and stale-selector cleanup.

**Architecture:** A new public `Routes.rebuildTradeRoutes()` (mirroring `rebuildAirroutes()`) strips `group === "traderoutes"` routes, re-runs `generateTradeNetwork` (whose internal `assignTradeRoles` already respects `Burg.tradeRoleManual`), and rebuilds `pack.cells.routes` via `buildLinks`. The burg editor gets a 4-state `<select>` shown only for ports. Preset work is pure JSON edits plus two lines in `style-presets.js`.

**Tech Stack:** TypeScript (`src/modules/routes-generator.ts`, vitest), legacy JS UI (`public/modules/ui/burg-editor.js`), JSON presets (`public/styles/*.json`).

**Spec:** `docs/superpowers/specs/2026-06-11-trade-route-ui-design.md`

**Key facts for an engineer with zero context:**

- Build/test commands: `npx tsc --noEmit` (type check), `npx vitest run src/modules/routes-generator.test.ts` (unit tests). Dependencies come from a Nix develop flake — do NOT run `npm install`.
- `Routes` is a global singleton instance (`window.Routes`); tests import it and call private methods via `(Routes as any)`.
- `Burg.tradeRole?: "hub" | "waystation"` and `Burg.tradeRoleManual?: boolean` already exist (`src/modules/burgs-generator.ts:38-39`). `assignTradeRoles` (`src/modules/trade-network-generator.ts`) resets only non-manual roles and never reassigns manual ones — no changes needed there.
- `generateTradeNetwork(components, seaAdjacency?)` (`src/modules/routes-generator.ts:1235`) only considers burgs with `port` set, calls `assignTradeRoles` itself, builds its own internal connections set, and returns `Route[]` with `i: 0` placeholders (caller renumbers).
- After full generation, `pack.cells.routes` is rebuilt wholesale: `pack.cells.routes = this.buildLinks(pack.routes)` (line 1513). `buildLinks` is a public method. The rebuild reuses this for symmetry instead of per-route bookkeeping.
- `git commit` triggers a biome pre-commit hook; there is one PRE-EXISTING unrelated warning in `trade-network-generator.ts` (useOptionalChain) — it does not block commits.
- Do NOT add Co-Authored-By lines to commit messages.

---

### Task 1: `Routes.rebuildTradeRoutes()` (TDD)

**Files:**
- Modify: `src/modules/routes-generator.ts` (add method after `rebuildAirroutes`, which ends near line 1569)
- Test: `src/modules/routes-generator.test.ts` (new `describe` after the existing `generateTradeNetwork` describe, which starts at line 659)

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/modules/routes-generator.test.ts`. It duplicates the 13×13 grid fixture from the `generateTradeNetwork` describe (each describe in this file is self-contained by convention). Geometry recap: cells 1, 4, 7 are land in row 0; hubs at cells 1 and 7 are one leg too far apart, so the network is two legs through the waystation at cell 4.

```ts
describe("rebuildTradeRoutes", () => {
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

  const setupPack = () => {
    const g = globalThis as any;
    g.window = g.window ?? {};
    g.window.FlatQueue = FlatQueue;
    g.graphWidth = 1000;
    g.graphHeight = 1000;
    g.mapCoordinates = { lonT: 180 };
    g.layerIsOn = () => false; // rebuild must not try to draw in the test env

    const cap1 = {
      i: 1, state: 1, capital: 1, port: 1, cell: 1,
      x: STEP, y: 0, population: 50, settlementType: "largePort"
    } as any;
    const cap2 = {
      i: 2, state: 2, capital: 1, port: 1, cell: 7,
      x: 7 * STEP, y: 0, population: 50, settlementType: "largePort"
    } as any;
    const way = {
      i: 3, state: 1, port: 1, cell: 4,
      x: 4 * STEP, y: 0, population: 20, settlementType: "largePort"
    } as any;

    // pre-existing routes: a road that must survive, a stale trade lane that must go
    const road = { i: 0, group: "roads", feature: 1, points: [[STEP, 0, 1], [4 * STEP, 0, 4]] } as any;
    const staleTrade = { i: 1, group: "traderoutes", feature: 1, points: [[4 * STEP, 0, 4], [7 * STEP, 0, 7]] } as any;

    g.pack = { cells: buildGrid([1, 4, 7]), burgs: [{}, cap1, cap2, way], routes: [road, staleTrade] };
    g.pack.cells.routes = (Routes as any).buildLinks(g.pack.routes);
    g.grid = { cells: { temp: [20] } };

    return { cap1, cap2, way, road };
  };

  it("replaces traderoutes, renumbers uniquely, and leaves other groups untouched", () => {
    const { road } = setupPack();
    (Routes as any).rebuildTradeRoutes();

    const pack = (globalThis as any).pack;
    const trade = pack.routes.filter((r: any) => r.group === "traderoutes");
    const roads = pack.routes.filter((r: any) => r.group === "roads");

    expect(roads).toEqual([road]); // untouched
    expect(trade.length).toBe(2); // cap1<->way and way<->cap2, as in generateTradeNetwork
    const ids = pack.routes.map((r: any) => r.i);
    expect(new Set(ids).size).toBe(ids.length); // unique ids after renumbering

    // cells.routes was rebuilt: every link points at an existing route
    const routeIds = new Set(ids);
    for (const links of Object.values(pack.cells.routes) as any[]) {
      for (const routeId of Object.values(links) as number[]) {
        expect(routeIds.has(routeId)).toBe(true);
      }
    }
  });

  it("manual none on a hub excludes it and promotes the next-best port", () => {
    // NOTE: exclusion does NOT shrink the network — assignTradeRoles picks the
    // nearest qualifying port to the state capital, so `way` is promoted to hub.
    const { cap1, way } = setupPack();
    cap1.tradeRole = undefined;
    cap1.tradeRoleManual = true;

    (Routes as any).rebuildTradeRoutes();

    const pack = (globalThis as any).pack;
    expect(cap1.tradeRole).toBeUndefined(); // manual override survives assignTradeRoles
    expect(way.tradeRole).toBe("hub"); // nearest remaining state-1 port takes over

    const trade = pack.routes.filter((r: any) => r.group === "traderoutes");
    expect(trade.length).toBeGreaterThan(0);
    // the excluded burg's cell is not an endpoint of any trade lane
    const endpoints = trade.flatMap((r: any) => [r.points[0][2], r.points[r.points.length - 1][2]]);
    expect(endpoints).not.toContain(1);
  });

  it("manual hub role survives the rebuild", () => {
    const { way } = setupPack();
    way.tradeRole = "hub";
    way.tradeRoleManual = true;

    (Routes as any).rebuildTradeRoutes();

    expect(way.tradeRole).toBe("hub"); // not demoted back to waystation
  });

  it("is idempotent: consecutive rebuilds keep counts stable with no leftovers", () => {
    setupPack();
    (Routes as any).rebuildTradeRoutes();
    const pack = (globalThis as any).pack;
    const countAfterFirst = pack.routes.filter((r: any) => r.group === "traderoutes").length;
    const totalAfterFirst = pack.routes.length;

    (Routes as any).rebuildTradeRoutes();
    expect(pack.routes.filter((r: any) => r.group === "traderoutes").length).toBe(countAfterFirst);
    expect(pack.routes.length).toBe(totalAfterFirst);
    const ids = pack.routes.map((r: any) => r.i);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/modules/routes-generator.test.ts -t rebuildTradeRoutes`
Expected: 4 FAIL with `rebuildTradeRoutes is not a function`

- [ ] **Step 3: Implement `rebuildTradeRoutes`**

In `src/modules/routes-generator.ts`, directly after the closing brace of `rebuildAirroutes()` (~line 1569), add:

```ts
  // Rebuild the global trade network (group "traderoutes") in place. Called when
  // a burg's trade role changes in the editor. Other route groups are untouched;
  // assignTradeRoles inside generateTradeNetwork skips tradeRoleManual burgs, so
  // manual overrides survive the rebuild.
  rebuildTradeRoutes(): void {
    TIME && console.time("rebuildTradeRoutes");

    pack.routes = pack.routes.filter(r => r.group !== "traderoutes");

    const components = this.buildNavigableComponents();
    const seaAdjacency = isWrapEnabled() ? this.buildSeaAdjacency() : undefined;
    const tradeRoutes = this.generateTradeNetwork(components, seaAdjacency);

    let nextId = this.getNextId();
    for (const route of tradeRoutes) {
      route.i = nextId++;
      pack.routes.push(route);
    }

    pack.cells.routes = this.buildLinks(pack.routes);

    if (layerIsOn("toggleRoutes")) drawRoutes();

    TIME && console.timeEnd("rebuildTradeRoutes");
  }
```

Notes: `buildSeaAdjacency`, `buildNavigableComponents`, `generateTradeNetwork`, `getNextId`, `buildLinks` all already exist on the class. `layerIsOn`/`drawRoutes` are globals declared in `src/types/global.ts:75-77` — same usage as `rebuildAirroutes`. The wholesale `buildLinks` rebuild (not per-route `this.remove()`) avoids DOM access (`viewbox`) so the method is unit-testable, and matches how full generation populates `cells.routes` (line 1513).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/routes-generator.test.ts`
Expected: ALL tests in the file PASS (the 4 new ones plus all pre-existing).

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/routes-generator.ts src/modules/routes-generator.test.ts
git commit -m "feat(trade): Routes.rebuildTradeRoutes for in-place trade-network regeneration"
```

---

### Task 2: Burg-editor trade-role select

**Files:**
- Modify: `src/index.html` (burg editor dialog ~line 3483, script tag ~line 8606)
- Modify: `public/modules/ui/burg-editor.js` (listeners ~line 25-35, `updateBurgValues` ~line 61, `toggleFeature` ~line 165)

No unit tests (legacy JS UI layer has none); verified manually in Task 4.

- [ ] **Step 1: Add the markup**

In `src/index.html`, find the Population row inside `#burgEditor`:

```html
              <div data-tip="Set burg population">
                <div class="label">Population:</div>
                <input id="burgPopulation" type="number" min="0" step="1" style="width: 9em" />
              </div>
```

Insert directly AFTER that `</div>`:

```html
              <div
                id="burgTradeRoleRow"
                data-tip="Trade-network role: Auto lets generation decide; Hub/Waystation/None override it permanently"
                style="display: none"
              >
                <div class="label">Trade role:</div>
                <select id="burgTradeRole" style="width: 9em">
                  <option value="auto">Auto</option>
                  <option value="hub">Hub</option>
                  <option value="waystation">Waystation</option>
                  <option value="none">None</option>
                </select>
              </div>
```

- [ ] **Step 2: Bump the burg-editor cache-bust token**

In `src/index.html` (~line 8606), change:

```html
<script defer src="modules/ui/burg-editor.js?v=1.120.5"></script>
```

to:

```html
<script defer src="modules/ui/burg-editor.js?v=1.122.12"></script>
```

- [ ] **Step 3: Wire the select in burg-editor.js**

In `public/modules/ui/burg-editor.js`:

(a) In the listener block at the top (next to `ensureEl("burgPopulation").on("change", changePopulation);`), add:

```js
  ensureEl("burgTradeRole").on("change", changeTradeRole);
```

(b) In `updateBurgValues()`, after the line `ensureEl("burgAltitude").value = b.altitude || 500;`, add:

```js
    updateTradeRoleControl(b);
```

(c) In `toggleFeature()`, after the line `ensureEl("burgAltitudeRow").style.display = burg.flying ? "block" : "none";`, add:

```js
    updateTradeRoleControl(burg);
```

(d) Add the two new functions near `toggleFeature` (sibling scope):

```js
  function updateTradeRoleControl(burg) {
    ensureEl("burgTradeRoleRow").style.display = burg.port ? "block" : "none";
    const select = ensureEl("burgTradeRole");
    select.options[0].text = !burg.tradeRoleManual && burg.tradeRole ? `Auto (${burg.tradeRole})` : "Auto";
    select.value = burg.tradeRoleManual ? burg.tradeRole || "none" : "auto";
  }

  function changeTradeRole() {
    const burg = pack.burgs[+elSelected.attr("data-id")];
    if (this.value === "auto") {
      delete burg.tradeRoleManual;
    } else {
      burg.tradeRoleManual = true;
      if (this.value === "none") delete burg.tradeRole;
      else burg.tradeRole = this.value;
    }
    Routes.rebuildTradeRoutes();
    updateTradeRoleControl(burg); // refresh the Auto label with the recomputed role
  }
```

Behavior notes from the spec: switching to `auto` leaves `tradeRole` as-is — the rebuild's `assignTradeRoles` resets and recomputes non-manual roles. Toggling port off just hides the row; flags are kept (non-ports are skipped at generation). Port toggling does NOT trigger a trade rebuild.

- [ ] **Step 4: Type check (index.html is in the vite graph)**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/index.html public/modules/ui/burg-editor.js
git commit -m "feat(trade): burg-editor trade-role select with immediate network rebuild"
```

---

### Task 3: `#traderoutes` styling in all presets + stale `#routes #major` cleanup

**Files:**
- Modify: `public/styles/ancient.json`, `atlas.json`, `clean.json`, `cyberpunk.json`, `darkSeas.json`, `gloom.json`, `light.json`, `monochrome.json`, `night.json`, `pale.json`, `watercolor.json` (add `#traderoutes`, remove `#routes #major`)
- Modify: `public/styles/default.json` (remove `#routes #major` only — `#traderoutes` already present)
- Modify: `public/modules/ui/style-presets.js` (properties map ~line 246, type list ~line 371)
- Modify: `src/index.html` (style-presets cache token ~line 8580)

- [ ] **Step 1: Add `#traderoutes` blocks to the 11 presets**

Each preset JSON is a flat object of `selector -> attributes`. In each file, insert the block immediately after the `"#searoutes"` block (preset JSONs are fetched with `?v=${VERSION}` so no extra cache-busting is needed). Keep the global-lane signature (`"stroke-dasharray": "3 2"`, `"stroke-linecap": "butt"`, `"opacity": 0.9`) and use these per-theme strokes, chosen to sit one step bolder/darker than each theme's searoutes:

| File | Block |
|---|---|
| ancient.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#6b3a17", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| atlas.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#005a8e", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| clean.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#2c5a96", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| cyberpunk.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#21d4cf", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| darkSeas.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#ffc966", "stroke-width": 1.25, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| gloom.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#9a86b8", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| light.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#333333", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| monochrome.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#000000", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| night.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#aebdf7", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| pale.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#5a6b8c", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |
| watercolor.json | `"#traderoutes": {"opacity": 0.9, "stroke": "#4a4a4a", "stroke-width": 1, "stroke-dasharray": "3 2", "stroke-linecap": "butt"}` |

Rationale per theme (for the reviewer, not the JSON): dark themes (darkSeas, night, gloom, cyberpunk) get light/bright lanes; parchment themes (ancient) sepia; print themes (atlas, clean) deep blue; light/monochrome/watercolor get dark ink.

- [ ] **Step 2: Remove the stale `#routes #major` block from all 12 presets**

Every preset (including `default.json`) carries a `"#routes #major"` key. Nothing emits route type `"major"` since the trunk tier was removed (commit `aabdad78`), so the selector matches nothing. Delete the whole key/value from each of the 12 files. Watch trailing commas — these are strict JSON files.

- [ ] **Step 3: Validate all preset JSONs parse**

Run: `for f in public/styles/*.json; do python3 -m json.tool "$f" > /dev/null || echo "BROKEN: $f"; done`
Expected: no output.

- [ ] **Step 4: Update style-presets.js**

(a) In the properties map, after the line:

```js
      "#airroutes": ["opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "filter", "mask"],
```

add:

```js
      "#traderoutes": ["opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "filter", "mask"],
```

(b) In the route-type loop (~line 371), remove `"major"`:

```js
    for (const type of ["royal", "main", "market", "town", "trail", "footpath", "local"]) {
```

(c) In `src/index.html` (~line 8580), bump the cache token:

```html
<script defer src="modules/ui/style-presets.js?v=1.122.12"></script>
```

- [ ] **Step 5: Commit**

```bash
git add public/styles/*.json public/modules/ui/style-presets.js src/index.html
git commit -m "style(trade): traderoutes styling across all presets, drop stale #routes #major"
```

---

### Task 4: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit-test and type-check run**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all tests pass, no type errors.

- [ ] **Step 2: Manual browser verification**

The dev server is the user's own session — do NOT start or stop it. If it is running (default vite port), verify with Playwright MCP or report the checklist for the user to run by hand:

1. Generate a map; confirm trade lanes (dashed charcoal on default style) render.
2. Open a **port** burg in the burg editor — the "Trade role" row is visible; non-port burgs hide it. The Auto option reads "Auto (hub)" / "Auto (waystation)" for burgs the generator assigned.
3. Set a non-hub port to **Hub** — trade lanes redraw immediately and now reach that burg.
4. Set an existing hub to **None** — its lanes drop from the network.
5. Set it back to **Auto** — the computed role and lanes return.
6. Cycle through all 12 style presets (Style tab > preset select) — trade lanes stay visible and theme-appropriate in each.
7. Style editor: select Routes > traderoutes group — stroke/width/dash controls populate and edits apply.

- [ ] **Step 3: Report results**

Report test output and any visual-check findings to the user before claiming completion (per verification-before-completion).
