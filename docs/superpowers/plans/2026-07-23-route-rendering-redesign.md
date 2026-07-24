# Route Rendering Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make routes render at a constant on-screen size with a per-type solid→dashed→dotted hierarchy, so they read as a road network instead of fat dashed noise at town zoom.

**Architecture:** A new pure TS module (`route-styles.ts`) holds the default per-type / per-group line hierarchy and is the single source of truth, bridged to the classic-JS `layers.js` via `window` (the same pattern the label work used with `tier-table.ts`). A one-line CSS rule gives every route path `vector-effect: non-scaling-stroke` so stroke and dashes stop scaling with zoom. `applyRouteTypeStyle` falls back to the module defaults when a preset omits a type. The 12 style presets are updated to the screen-px hierarchy, preserving each preset's route colours.

**Tech Stack:** TypeScript, vitest (jsdom), classic-JS `public/modules/ui/layers.js` consuming TS via `window`, SVG `vector-effect`, JSON style presets.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-route-rendering-redesign-design.md`.
- Rendering only — do NOT change route generation, counts, or types.
- `public/modules/ui/layers.js` is a classic script; it reaches TS only through `window` globals.
- Run tests with `npx vitest run <path>`. Typecheck with `npx tsc --noEmit`.
- The pre-commit hook runs `biome check --write`, which dirties the tree; run `npx biome check --write <files>` first, then `git add <explicit paths>`, then `git commit --no-verify`. Never `git add -A` / `git commit -am` — the tree holds unrelated user WIP.
- No AI attribution or `Co-Authored-By` lines in commit messages.
- `vector-effect: non-scaling-stroke` means stroke width and dash pattern are evaluated in screen pixels, unaffected by the `#viewbox` zoom. All width/dash values below are therefore screen px.

## The hierarchy (verbatim, screen px)

Overland types (dash `null` = solid):

| type | width | dash | linecap |
|---|---|---|---|
| royal | 2.0 | null | butt |
| main | 1.4 | null | butt |
| market | 1.1 | `6 4` | butt |
| town | 0.9 | `4 3` | butt |
| local | 0.7 | `2.5 2.5` | butt |
| trail | 0.6 | `0.5 3` | round |
| footpath | 0.5 | `0.5 2` | round |

Groups (special + overland catch-alls for routes with no `type`):

| group | width | dash | linecap |
|---|---|---|---|
| roads | 1.4 | null | butt |
| trails | 0.6 | `0.5 3` | round |
| searoutes | 0.8 | `1 4` | round |
| airroutes | 0.9 | `6 4` | round |
| traderoutes | 1.3 | `6 2 1 2` | butt |

Colours are NOT set by the defaults module (presets own colour); the module sets only width / dash / linecap.

## File Structure

| Path | Responsibility |
|---|---|
| `src/renderers/route-styles.ts` | **Create.** `ROUTE_TYPE_DEFAULTS`, `ROUTE_GROUP_DEFAULTS`, `routeTypeStyle()`, `routeGroupStyle()`; `window` bridge. Single source of the hierarchy. |
| `src/renderers/route-styles.test.ts` | **Create.** |
| `src/renderers/index.ts` | **Modify.** Import `route-styles` so it bundles and attaches to `window`. |
| `public/index.css:268` | **Modify.** Add `#routes path { vector-effect: non-scaling-stroke; }`. |
| `public/modules/ui/layers.js:909` | **Modify.** `applyRouteTypeStyle` falls back to `window.routeTypeStyle`; group application uses `window.routeGroupStyle`. |
| `public/modules/ui/layers.js:861` | **Modify.** `drawRoutes` applies group defaults to each `#{group}` element. |
| `public/styles/*.json` (12) | **Modify.** Route type/group width+dash+linecap set to the hierarchy; stroke/opacity preserved. |
| `src/index.html` | **Modify.** Bump `main.js?v=` cache-bust token (last task). |

---

### Task 1: Route-styles module (the hierarchy, pure + tested)

**Files:**
- Create: `src/renderers/route-styles.ts`
- Test: `src/renderers/route-styles.test.ts`
- Modify: `src/renderers/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface RouteLineStyle { "stroke-width": number; "stroke-dasharray": string | null; "stroke-linecap": string }`, `ROUTE_TYPE_DEFAULTS: Record<string, RouteLineStyle>`, `ROUTE_GROUP_DEFAULTS: Record<string, RouteLineStyle>`, `routeTypeStyle(type: string): RouteLineStyle | undefined`, `routeGroupStyle(group: string): RouteLineStyle | undefined`. Also `window.routeTypeStyle`, `window.routeGroupStyle`.

- [ ] **Step 1: Write the failing test**

Create `src/renderers/route-styles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ROUTE_GROUP_DEFAULTS, ROUTE_TYPE_DEFAULTS, routeGroupStyle, routeTypeStyle } from "./route-styles";

// Every overland type the generator can emit (routes-generator.ts assigns these).
const EMITTED_TYPES = ["royal", "main", "market", "town", "local", "trail", "footpath"];
const GROUPS = ["roads", "trails", "searoutes", "airroutes", "traderoutes"];

describe("ROUTE_TYPE_DEFAULTS", () => {
  it("styles every type the generator can emit, so none renders unstyled", () => {
    for (const t of EMITTED_TYPES) {
      const s = routeTypeStyle(t);
      expect(s, t).toBeDefined();
      expect(s!["stroke-width"], t).toBeGreaterThan(0);
      expect(s!, t).toHaveProperty("stroke-dasharray");
    }
  });

  it("orders width by importance: royal > main > market > town > local > trail > footpath", () => {
    const w = EMITTED_TYPES.map(t => ROUTE_TYPE_DEFAULTS[t]["stroke-width"]);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThan(w[i - 1]);
  });

  it("keeps the trunk roads solid and the paths dotted with a round cap", () => {
    expect(ROUTE_TYPE_DEFAULTS.royal["stroke-dasharray"]).toBeNull();
    expect(ROUTE_TYPE_DEFAULTS.main["stroke-dasharray"]).toBeNull();
    for (const dotted of ["trail", "footpath"]) {
      expect(ROUTE_TYPE_DEFAULTS[dotted]["stroke-linecap"]).toBe("round");
      // a near-zero dash length renders as a dot only with a round cap
      expect(ROUTE_TYPE_DEFAULTS[dotted]["stroke-dasharray"]!.startsWith("0.5")).toBe(true);
    }
  });

  it("gives market/town/local distinct dashes, not one shared pattern", () => {
    const dashes = ["market", "town", "local"].map(t => ROUTE_TYPE_DEFAULTS[t]["stroke-dasharray"]);
    expect(new Set(dashes).size).toBe(3);
  });
});

describe("ROUTE_GROUP_DEFAULTS", () => {
  it("styles every route group, including the special sea/air/trade lanes", () => {
    for (const g of GROUPS) {
      const s = routeGroupStyle(g);
      expect(s, g).toBeDefined();
      expect(s!["stroke-width"], g).toBeGreaterThan(0);
    }
  });

  it("makes trade lanes bolder than an ordinary road", () => {
    expect(ROUTE_GROUP_DEFAULTS.traderoutes["stroke-width"]).toBeGreaterThan(
      ROUTE_TYPE_DEFAULTS.main["stroke-width"]
    );
  });
});

describe("accessors", () => {
  it("return undefined for an unknown type/group rather than throwing", () => {
    expect(routeTypeStyle("nonsense")).toBeUndefined();
    expect(routeGroupStyle("nonsense")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/route-styles.test.ts`
Expected: FAIL — `Failed to resolve import "./route-styles"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderers/route-styles.ts`:

```ts
/**
 * Single source of truth for the route line hierarchy: per-type and per-group defaults for the
 * road network's line character. Values are SCREEN pixels — route paths carry
 * `vector-effect: non-scaling-stroke` (see public/index.css), so stroke width and dash pattern are
 * evaluated in screen space and never balloon as you zoom in.
 *
 * These are DEFAULTS. A style preset may override any of them per type/group; this module is the
 * fallback so a stripped or custom preset still renders the hierarchy instead of one flat dash.
 * Colour and opacity are intentionally NOT set here — presets own those.
 *
 * `stroke-dasharray: null` means a solid line (the attribute is removed).
 */
export interface RouteLineStyle {
  "stroke-width": number;
  "stroke-dasharray": string | null;
  "stroke-linecap": string;
}

const solid = (width: number): RouteLineStyle => ({
  "stroke-width": width,
  "stroke-dasharray": null,
  "stroke-linecap": "butt"
});
const dashed = (width: number, dash: string): RouteLineStyle => ({
  "stroke-width": width,
  "stroke-dasharray": dash,
  "stroke-linecap": "butt"
});
const dotted = (width: number, dash: string): RouteLineStyle => ({
  "stroke-width": width,
  "stroke-dasharray": dash,
  "stroke-linecap": "round"
});

/** Overland route types, most-important first. Solid trunk roads → dashed secondary → dotted paths. */
export const ROUTE_TYPE_DEFAULTS: Record<string, RouteLineStyle> = {
  royal: solid(2.0),
  main: solid(1.4),
  market: dashed(1.1, "6 4"),
  town: dashed(0.9, "4 3"),
  local: dashed(0.7, "2.5 2.5"),
  trail: dotted(0.6, "0.5 3"),
  footpath: dotted(0.5, "0.5 2")
};

/** Route groups: overland catch-alls (for routes with no type) plus the special sea/air/trade lanes. */
export const ROUTE_GROUP_DEFAULTS: Record<string, RouteLineStyle> = {
  roads: solid(1.4),
  trails: dotted(0.6, "0.5 3"),
  searoutes: dotted(0.8, "1 4"),
  airroutes: dotted(0.9, "6 4"),
  traderoutes: dashed(1.3, "6 2 1 2")
};

export function routeTypeStyle(type: string): RouteLineStyle | undefined {
  return ROUTE_TYPE_DEFAULTS[type];
}
export function routeGroupStyle(group: string): RouteLineStyle | undefined {
  return ROUTE_GROUP_DEFAULTS[group];
}

// public/modules/ui/layers.js is a classic script and can only reach TS through globals.
if (typeof window !== "undefined") {
  Object.assign(window, { routeTypeStyle, routeGroupStyle });
}
```

- [ ] **Step 4: Wire it into the bundle**

In `src/renderers/index.ts`, add an import alongside the other renderer imports so the module executes and attaches to `window`:

```ts
import "./route-styles";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/renderers/route-styles.test.ts`
Expected: PASS — 7 tests.

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
npx biome check --write src/renderers/route-styles.ts src/renderers/route-styles.test.ts src/renderers/index.ts
git add src/renderers/route-styles.ts src/renderers/route-styles.test.ts src/renderers/index.ts
git commit --no-verify -m "feat(routes): add route line-style hierarchy module"
```

---

### Task 2: Non-scaling stroke + fallback wiring in layers.js

**Files:**
- Modify: `public/index.css:268`
- Modify: `public/modules/ui/layers.js` (`applyRouteTypeStyle` :909, `drawRoutes` :861)
- Modify: `src/types/global.ts`
- Test: `src/renderers/route-styles.test.ts` (add a DOM test of the fallback applier — see note)

**Interfaces:**
- Consumes: `window.routeTypeStyle`, `window.routeGroupStyle` from Task 1.
- Produces: no new exports; `applyRouteTypeStyle` and `drawRoutes` behaviourally apply defaults when the preset omits a type/group.

- [ ] **Step 1: Add the non-scaling-stroke CSS rule**

In `public/index.css`, extend the existing `#routes` block (line 268):

```css
#routes {
  fill: none;
  cursor: pointer;
}
/* Route stroke width and dashes are evaluated in screen px, not the #viewbox zoom space, so
   they stay crisp and never balloon into fat ticks as you zoom in. */
#routes path {
  vector-effect: non-scaling-stroke;
}
```

- [ ] **Step 2: Declare the new globals**

In `src/types/global.ts`, add alongside the other route/label globals:

```ts
  var routeTypeStyle: (type: string) => { "stroke-width": number; "stroke-dasharray": string | null; "stroke-linecap": string } | undefined;
  var routeGroupStyle: (group: string) => { "stroke-width": number; "stroke-dasharray": string | null; "stroke-linecap": string } | undefined;
```

- [ ] **Step 3: Write the failing DOM test for the fallback applier**

Add to `src/renderers/route-styles.test.ts`. This tests a small pure helper that Task 2 factors out
of `applyRouteTypeStyle` so the fallback logic is unit-testable without loading all of layers.js:

```ts
import { applyRouteLineStyle } from "./route-styles";

describe("applyRouteLineStyle (preset wins, defaults fill gaps)", () => {
  it("applies the default hierarchy when the preset supplies nothing", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    applyRouteLineStyle(el, ROUTE_TYPE_DEFAULTS.market, undefined);
    expect(el.getAttribute("stroke-width")).toBe("1.1");
    expect(el.getAttribute("stroke-dasharray")).toBe("6 4");
    expect(el.getAttribute("stroke-linecap")).toBe("butt");
  });

  it("lets a preset value override the default", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    applyRouteLineStyle(el, ROUTE_TYPE_DEFAULTS.market, { "stroke-width": 3, stroke: "#abcdef" });
    expect(el.getAttribute("stroke-width")).toBe("3"); // preset wins
    expect(el.getAttribute("stroke")).toBe("#abcdef"); // preset-only attr passes through
    expect(el.getAttribute("stroke-dasharray")).toBe("6 4"); // default fills the gap
  });

  it("removes stroke-dasharray for a solid default (null)", () => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("stroke-dasharray", "2"); // stale value from a prior render
    applyRouteLineStyle(el, ROUTE_TYPE_DEFAULTS.royal, undefined);
    expect(el.hasAttribute("stroke-dasharray")).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run src/renderers/route-styles.test.ts`
Expected: FAIL — `applyRouteLineStyle` is not exported.

- [ ] **Step 5: Implement `applyRouteLineStyle` in route-styles.ts**

Add to `src/renderers/route-styles.ts` (and to the `window` assign):

```ts
/**
 * Apply a route line style to an element: the default hierarchy for this type/group, with any
 * preset attributes layered on top (preset wins). A `null` value removes the attribute (solid line
 * / cleared stale dash). `presetStyle` is the preset's own attribute map for this type/group, or
 * undefined when the preset defines nothing.
 */
export function applyRouteLineStyle(
  el: Element,
  fallback: RouteLineStyle | undefined,
  presetStyle: Record<string, unknown> | undefined
): void {
  const merged: Record<string, unknown> = { ...(fallback || {}), ...(presetStyle || {}) };
  for (const attr in merged) {
    const value = merged[attr];
    if (value === null || value === "null" || value === undefined) el.removeAttribute(attr);
    else el.setAttribute(attr, String(value));
  }
}
```

Update the `window` bridge:

```ts
  Object.assign(window, { routeTypeStyle, routeGroupStyle, applyRouteLineStyle });
```

And declare it in `src/types/global.ts`:

```ts
  var applyRouteLineStyle: (el: Element, fallback: unknown, presetStyle: unknown) => void;
```

- [ ] **Step 6: Rewire `applyRouteTypeStyle` and group application in layers.js**

Replace `applyRouteTypeStyle` (`public/modules/ui/layers.js:909`) so it uses the shared applier with
the default fallback:

```js
function applyRouteTypeStyle(el, type) {
  // preset value (may be undefined) layered over the shared default hierarchy
  window.applyRouteLineStyle(el, window.routeTypeStyle(type), style.routes[type]);
}
```

In `drawRoutes` (`:861`), after selecting each group element and before appending paths, apply the
group default so routes with no `type` (appended directly to the group) still get the hierarchy.
Change the group branch:

```js
  for (const key in typedPaths) {
    const {group, type, paths} = typedPaths[key];
    const groupEl = routes.select("#" + group);
    if (groupEl.empty()) continue;
    // ensure the group carries the default line style (preset group style still applies on load;
    // this fills gaps for presets that omit it, and for routes rendered directly on the group)
    window.applyRouteLineStyle(groupEl.node(), window.routeGroupStyle(group), undefined);
    if (type) {
      const subGroup = groupEl.append("g").attr("id", type);
      applyRouteTypeStyle(subGroup.node(), type);
      subGroup.html(paths.join(""));
    } else {
      groupEl.html(groupEl.html() + paths.join(""));
    }
  }
```

- [ ] **Step 7: Run tests + typecheck + build**

Run: `npx vitest run src/renderers/route-styles.test.ts`
Expected: PASS (10 tests total now).

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 8: Commit**

```bash
npx biome check --write src/renderers/route-styles.ts src/renderers/route-styles.test.ts src/types/global.ts
git add public/index.css public/modules/ui/layers.js src/renderers/route-styles.ts src/renderers/route-styles.test.ts src/types/global.ts
git commit --no-verify -m "feat(routes): non-scaling stroke + per-type/group default line styles"
```

---

### Task 3: Update the style presets to the screen-px hierarchy

**Files:**
- Modify: `public/styles/*.json` (all 12)
- Test: `src/renderers/route-styles.test.ts` (add a preset-consistency test)

**Interfaces:**
- Consumes: `ROUTE_TYPE_DEFAULTS`, `ROUTE_GROUP_DEFAULTS` from Task 1.
- Produces: presets whose route widths/dashes/caps match the hierarchy; route colours untouched.

- [ ] **Step 1: Write the failing consistency test**

Add to `src/renderers/route-styles.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Read via fs rather than importing the JSON: the preset lives under public/, outside the TS
// rootDir, so an ESM json import would fight tsc's include config. fs is robust in vitest.
const defaultPreset = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../public/styles/default.json", import.meta.url)), "utf8")
) as Record<string, any>;

describe("default preset matches the hierarchy (width/dash/cap, not colour)", () => {
  it("sets each overland type to its default width and dash", () => {
    for (const type of ["royal", "main", "market", "town", "local", "trail", "footpath"]) {
      const sel = `#routes #${type}`;
      const preset = defaultPreset[sel];
      expect(preset, sel).toBeDefined();
      expect(preset["stroke-width"], sel).toBe(ROUTE_TYPE_DEFAULTS[type]["stroke-width"]);
      const dash = ROUTE_TYPE_DEFAULTS[type]["stroke-dasharray"];
      // solid types carry no dasharray (or null); dashed/dotted carry the exact pattern
      if (dash === null) expect(preset["stroke-dasharray"] ?? null, sel).toBeNull();
      else expect(String(preset["stroke-dasharray"]), sel).toBe(dash);
    }
  });

  it("sets the special groups to their default width", () => {
    for (const group of ["searoutes", "airroutes", "traderoutes"]) {
      const preset = defaultPreset[`#${group}`];
      expect(preset, group).toBeDefined();
      expect(preset["stroke-width"], group).toBe(ROUTE_GROUP_DEFAULTS[group]["stroke-width"]);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/renderers/route-styles.test.ts`
Expected: FAIL — `default.json` still has the old widths (e.g. royal 0.98, not 2.0).

- [ ] **Step 3: Update the presets with a script**

Write and run this one-off script (place it at the repo root as `scripts/update-route-styles.mjs`,
run with `node`, then delete it — it is not part of the deliverable):

```js
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const TYPE = {
  royal: { "stroke-width": 2.0, "stroke-dasharray": null, "stroke-linecap": "butt" },
  main: { "stroke-width": 1.4, "stroke-dasharray": null, "stroke-linecap": "butt" },
  market: { "stroke-width": 1.1, "stroke-dasharray": "6 4", "stroke-linecap": "butt" },
  town: { "stroke-width": 0.9, "stroke-dasharray": "4 3", "stroke-linecap": "butt" },
  local: { "stroke-width": 0.7, "stroke-dasharray": "2.5 2.5", "stroke-linecap": "butt" },
  trail: { "stroke-width": 0.6, "stroke-dasharray": "0.5 3", "stroke-linecap": "round" },
  footpath: { "stroke-width": 0.5, "stroke-dasharray": "0.5 2", "stroke-linecap": "round" }
};
const GROUP = {
  roads: { "stroke-width": 1.4, "stroke-dasharray": null, "stroke-linecap": "butt" },
  trails: { "stroke-width": 0.6, "stroke-dasharray": "0.5 3", "stroke-linecap": "round" },
  searoutes: { "stroke-width": 0.8, "stroke-dasharray": "1 4", "stroke-linecap": "round" },
  airroutes: { "stroke-width": 0.9, "stroke-dasharray": "6 4", "stroke-linecap": "round" },
  traderoutes: { "stroke-width": 1.3, "stroke-dasharray": "6 2 1 2", "stroke-linecap": "butt" }
};

// Apply only width/dash/linecap; preserve every other key (colour, opacity, filter, mask).
function patch(target, patchVals) {
  if (!target) return;
  target["stroke-width"] = patchVals["stroke-width"];
  target["stroke-linecap"] = patchVals["stroke-linecap"];
  if (patchVals["stroke-dasharray"] === null) delete target["stroke-dasharray"];
  else target["stroke-dasharray"] = patchVals["stroke-dasharray"];
}

for (const file of readdirSync("public/styles").filter(f => f.endsWith(".json"))) {
  const path = `public/styles/${file}`;
  const json = JSON.parse(readFileSync(path, "utf8"));
  for (const [type, vals] of Object.entries(TYPE)) patch(json[`#routes #${type}`], vals);
  for (const [group, vals] of Object.entries(GROUP)) patch(json[`#${group}`], vals);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log("patched", file);
}
```

Run: `node scripts/update-route-styles.mjs && rm scripts/update-route-styles.mjs`
Expected: prints `patched <file>` for each of the 12 presets.

Inspect one diff to confirm colours/opacity survived and only width/dash/cap changed:
Run: `git diff public/styles/default.json`
Expected: `#routes #royal` width 0.98→2.0, dasharray removed; `stroke`/`opacity` unchanged.

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run src/renderers/route-styles.test.ts`
Expected: PASS (12 tests total).

Run: `npm run build`
Expected: succeeds (presets are copied from `public/`; a malformed JSON would break the build).

- [ ] **Step 5: Commit**

```bash
git add public/styles/*.json src/renderers/route-styles.test.ts
git commit --no-verify -m "feat(routes): retune style presets to the screen-px line hierarchy"
```

---

### Task 4: Browser verification + cache-bust

**Files:**
- Modify: `src/index.html` (bump `main.js?v=` token)
- No test files; browser verification.

- [ ] **Step 1: Full suite + typecheck + build**

Run: `npx vitest run`
Expected: PASS except the 3 known pre-existing failures (`routes-generator.test.ts` ×2, `burg-cell-index-width.test.ts` ×1) which are unrelated user WIP. Report counts.

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 2: Browser check**

Start a dev server on a spare port (do NOT touch a server already on 5174):
Run: `npx vite --port 5176 --strictPort` (background)

Headless chromium (NixOS): `/run/current-system/sw/bin/chromium --headless=new --remote-debugging-port=9224 --use-gl=angle --use-angle=swiftshader --no-sandbox --window-size=1900,1000 "http://localhost:5176/Fantasy-Map-Generator/"`. Generate a fresh map, ensure routes layer is on (`layerIsOn("toggleRoutes")`), zoom to ~scale 5 (town level). Confirm and screenshot to the scratchpad:
- Routes render as thin crisp lines, NOT fat orange/dark ticks.
- The hierarchy reads: solid trunk roads vs dashed secondary vs dotted trails/footpaths.
- A route path resolves `getComputedStyle(path).vectorEffect === "non-scaling-stroke"`.
- Zoom from 5 to 10: a road's on-screen thickness does NOT change (measure `getBoundingClientRect().height` of a near-horizontal path segment, or read the rendered stroke — it should be constant).

Save `routes-town-zoom.png`. Kill the dev server afterwards.

- [ ] **Step 3: Bump the cache-bust token**

`public/modules/ui/layers.js` changed, so returning users must refetch it. In `src/index.html`, bump the `main.js?v=` token to the next patch (e.g. `1.137.10` → `1.137.11`; check the current value first with `grep 'main.js?v=' src/index.html`).

- [ ] **Step 4: Commit**

```bash
git add src/index.html
git commit --no-verify -m "chore: bump cache-bust token for route rendering redesign"
```

---

## What this plan deliberately leaves alone

- Route generation, counts, and the set of types — untouched (rendering only).
- Colours per preset — preserved; only width/dash/cap change. Retinting routes is a separate future call.
- The Style editor already edits these attributes; no editor change is needed. The screen-px values are a first calibration, tuned there afterwards.
- A per-group visibility toggle (the original "hide routes by type" idea) is intentionally NOT built — the redesign makes routes legible instead, which the user preferred.
