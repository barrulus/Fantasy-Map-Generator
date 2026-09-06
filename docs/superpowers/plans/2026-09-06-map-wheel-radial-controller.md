# Map Wheel (spin-out radial controller) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a radial context controller to Fantasy Map Generator's map, opened on right-click, that carries both the actions for whatever was clicked and the five global menus — where drilling into a submenu fans a new ring outward instead of replacing the current one.

**Architecture:** A self-contained `src/components/map-wheel/` module registered by one import line. Pure geometry and pure menu data are separated from a single full-redraw SVG renderer; a side drawer hosts FMG's real option/style forms by reparenting them rather than rebuilding them. The subject resolver is ported from Azgaar's `map-wheel-concept` branch rather than written fresh.

**Tech Stack:** TypeScript, vanilla DOM + SVG (no framework), vitest + jsdom for unit/integration, Playwright for browser tests, Biome for formatting.

**Spec:** `docs/superpowers/specs/2026-09-06-map-wheel-radial-controller-design.md` — read it before Task 1. The plan argues from the spec; executors read both.

## Global Constraints

- **Additive only.** The only permitted edit to a pre-existing file is adding `import "./map-wheel";` to `src/components/index.ts`. Do not modify the top bar, `viewbox-events.ts`, `layers.ts`, or anything under `public/`.
- **No `public/` edits.** If one becomes unavoidable, `npm run stamp-assets` must run in the same commit (fork CI gate).
- **Commit messages carry no `Co-Authored-By` line and no Claude/AI attribution.**
- **Never `git commit -am` and never `git add -A`.** Always `git add <explicit paths>` then commit.
- **Format with Biome, never Prettier.** Run `npx biome check --write <changed files>` before every commit. CI runs Biome `latest` while the repo pins 2.4.x; if CI disagrees with local, reproduce with `npx @biomejs/biome@latest ci <file>` and restructure the code — never edit the workflow.
- **Element lookup is `findEl(id)` from `@/utils/nodeUtils`**, not `byId` (which does not exist in this fork).
- **`Controllers` is a lazy proxy registry** (`src/utils/registry.ts`). Every method returns a Promise, and an unregistered name reads back as `undefined` — which is what the menu-tree test uses to detect a bad binding.
- **Ring geometry constants are exact** and come from the spec: bands `[58,108] [112,158] [162,204] [208,246]`, `gap = 3px`, hover grow `+5px`, child span `clamp(n * 0.55, 1.4, π * 1.88)`, depth cap 4, item caps `[7, 11, 15, 19]`.
- **Typecheck gate:** `npx tsc --noEmit` must pass before each commit.
- Unit tests live beside their source as `*.test.ts` (this repo's convention, e.g. `src/components/layers.test.ts`) and run under `npm test`. Playwright specs live in `tests/e2e/`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/components/map-wheel/geometry.ts` | Pure ring math. No DOM, no menus. |
| `src/components/map-wheel/geometry.test.ts` | Tests for the above. |
| `src/components/map-wheel/types.ts` | `WheelNode`, `DrawerSpec`, `nodeKind`. No behaviour. |
| `src/components/map-wheel/wheel.ts` | Full-redraw renderer: rings, spines, HTML label layer, hub, breadcrumb. Only file that builds ring DOM. |
| `src/components/map-wheel/wheel.test.ts` | jsdom tests for the renderer. |
| `src/components/map-wheel/drawer.ts` | Side drawer: reparent, filter, restore. Only file that moves pre-existing app DOM. |
| `src/components/map-wheel/drawer.test.ts` | jsdom tests, focused on restore. |
| `src/components/map-wheel/menu-tree.ts` | The MENU channel data. Pure data + thunks. |
| `src/components/map-wheel/menu-tree.test.ts` | Caps, depth, partition and binding-resolution tests. |
| `src/components/map-wheel/context.ts` | Ported subject resolver (HERE channel). |
| `src/components/map-wheel/styles.ts` | All CSS: wheel tokens + scoped drawer skin. |
| `src/components/map-wheel/index.ts` | Lifecycle: contextmenu binding, open/close, dismissal, clamping. |
| `src/components/index.ts` | **Modify:** one added import line. |
| `tests/e2e/map-wheel.spec.ts` | Browser tests. |

---

### Task 1: Geometry primitives

Pure functions with no DOM. Everything downstream depends on these, so they are first and fully tested.

**Files:**
- Create: `src/components/map-wheel/geometry.ts`
- Test: `src/components/map-wheel/geometry.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BANDS`, `MAX_DEPTH`, `ITEM_CAPS`, `GAP_PX`, `HOVER_GROW`, `Sector`, `ringSpan(level, count)`, `sectors(level, count, parentMid)`, `arcPath(inner, outer, from, to)`, `labelPoint(mid, inner, outer)`, `spineLine(level, parentMid)`.

- [ ] **Step 1: Write the failing test**

Create `src/components/map-wheel/geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { arcPath, BANDS, GAP_PX, ITEM_CAPS, labelPoint, MAX_DEPTH, ringSpan, sectors, spineLine } from "./geometry";

const TAU = Math.PI * 2;

describe("bands", () => {
  it("has four bands matching the design spec", () => {
    expect(BANDS).toEqual([
      [58, 108],
      [112, 158],
      [162, 204],
      [208, 246]
    ]);
    expect(MAX_DEPTH).toBe(4);
    expect(ITEM_CAPS).toEqual([7, 11, 15, 19]);
  });
});

describe("ringSpan", () => {
  it("spans the full circle at the root", () => {
    expect(ringSpan(0, 5)).toBeCloseTo(TAU, 10);
    expect(ringSpan(0, 19)).toBeCloseTo(TAU, 10);
  });

  it("scales with item count at deeper levels", () => {
    expect(ringSpan(1, 10)).toBeCloseTo(5.5, 10);
  });

  it("clamps to a 1.4 rad floor so tiny rings stay readable", () => {
    expect(ringSpan(1, 1)).toBeCloseTo(1.4, 10);
    expect(ringSpan(2, 2)).toBeCloseTo(1.4, 10);
  });

  it("clamps to a pi*1.88 ceiling so a child ring never closes into a circle", () => {
    expect(ringSpan(1, 40)).toBeCloseTo(Math.PI * 1.88, 10);
    expect(ringSpan(3, 19)).toBeCloseTo(Math.PI * 1.88, 10);
  });
});

describe("sectors", () => {
  it("centres the first root item on 12 o'clock", () => {
    for (const count of [1, 2, 5, 7]) {
      expect(sectors(0, count, 0)[0].mid).toBeCloseTo(-Math.PI / 2, 10);
    }
  });

  it("centres a child ring on its parent's mid-angle", () => {
    const parentMid = 0.8;
    const ring = sectors(1, 4, parentMid);
    const centre = (ring[0].from + ring[ring.length - 1].to) / 2;
    expect(centre).toBeCloseTo(parentMid, 10);
  });

  it("trims gap/outerRadius radians from each end of every sector", () => {
    const gap = GAP_PX / BANDS[1][1];
    const ring = sectors(1, 4, 0);
    const step = ringSpan(1, 4) / 4;
    expect(ring[0].to - ring[0].from).toBeCloseTo(step - gap * 2, 10);
  });

  it("leaves sectors non-overlapping and in order", () => {
    const ring = sectors(2, 6, 0);
    for (let i = 1; i < ring.length; i++) expect(ring[i].from).toBeGreaterThan(ring[i - 1].to);
  });
});

describe("arcPath", () => {
  it("starts at the inner radius on the from-angle", () => {
    expect(arcPath(58, 108, 0, Math.PI / 2).startsWith("M 58.00 0.00")).toBe(true);
  });

  it("clears the large-arc flag for a sweep under pi", () => {
    expect(arcPath(58, 108, 0, Math.PI / 2)).toContain("A 108 108 0 0 1");
  });

  it("sets the large-arc flag for a sweep over pi", () => {
    expect(arcPath(58, 108, 0, Math.PI * 1.5)).toContain("A 108 108 0 1 1");
  });

  it("closes the path", () => {
    expect(arcPath(58, 108, 0, 1).endsWith("Z")).toBe(true);
  });
});

describe("labelPoint", () => {
  it("sits at the mid-radius of the band", () => {
    const [x, y] = labelPoint(0, 58, 108);
    expect(x).toBeCloseTo(83, 10);
    expect(y).toBeCloseTo(0, 10);
  });
});

describe("spineLine", () => {
  it("bridges the gap between the parent band's outer edge and the child band's inner edge", () => {
    const line = spineLine(1, 0);
    expect(line.x1).toBeCloseTo(BANDS[0][1], 10);
    expect(line.x2).toBeCloseTo(BANDS[1][0], 10);
    expect(line.y1).toBeCloseTo(0, 10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/geometry.test.ts`
Expected: FAIL — cannot resolve `./geometry`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/map-wheel/geometry.ts`:

```ts
// Pure ring math for the map wheel. No DOM, no menu knowledge.
// Every constant here is fixed by the design spec; see docs/superpowers/specs/2026-09-06-map-wheel-radial-controller-design.md

/** [innerRadius, outerRadius] per level, in SVG user units */
export const BANDS = [
  [58, 108],
  [112, 158],
  [162, 204],
  [208, 246]
] as const;

export const MAX_DEPTH = BANDS.length;

/** How many sectors a level can hold before labels collide: roughly arc-at-mid-radius / 70px */
export const ITEM_CAPS = [7, 11, 15, 19] as const;

export const GAP_PX = 3;
export const HOVER_GROW = 5;

const SPAN_PER_ITEM = 0.55;
const SPAN_MIN = 1.4;
const SPAN_MAX = Math.PI * 1.88;

export interface Sector {
  from: number;
  to: number;
  mid: number;
}

/** The root is a full circle; a child ring spans only the arc it needs, so depth reads as a fan */
export function ringSpan(level: number, count: number): number {
  if (level === 0) return Math.PI * 2;
  return Math.min(SPAN_MAX, Math.max(SPAN_MIN, count * SPAN_PER_ITEM));
}

export function sectors(level: number, count: number, parentMid: number): Sector[] {
  const span = ringSpan(level, count);
  const step = span / count;
  // the root starts half a sector before 12 o'clock so item 0 is centred at the top
  const start = level === 0 ? -Math.PI / 2 - step / 2 : parentMid - span / 2;
  const gap = GAP_PX / BANDS[level][1];

  return Array.from({ length: count }, (_, i) => {
    const from = start + i * step + gap;
    const to = from + step - gap * 2;
    return { from, to, mid: (from + to) / 2 };
  });
}

const point = (r: number, a: number): string => `${(Math.cos(a) * r).toFixed(2)} ${(Math.sin(a) * r).toFixed(2)}`;

/** An annulus wedge */
export function arcPath(inner: number, outer: number, from: number, to: number): string {
  const large = to - from > Math.PI ? 1 : 0;
  return (
    `M ${point(inner, from)} L ${point(outer, from)}` +
    ` A ${outer} ${outer} 0 ${large} 1 ${point(outer, to)}` +
    ` L ${point(inner, to)}` +
    ` A ${inner} ${inner} 0 ${large} 0 ${point(inner, from)} Z`
  );
}

export function labelPoint(mid: number, inner: number, outer: number): [number, number] {
  const r = (inner + outer) / 2;
  return [Math.cos(mid) * r, Math.sin(mid) * r];
}

/** The stub of line tying a child ring back to the sector that opened it */
export function spineLine(level: number, parentMid: number): { x1: number; y1: number; x2: number; y2: number } {
  const from = BANDS[level - 1][1];
  const to = BANDS[level][0];
  return {
    x1: Math.cos(parentMid) * from,
    y1: Math.sin(parentMid) * from,
    x2: Math.cos(parentMid) * to,
    y2: Math.sin(parentMid) * to
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/geometry.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Typecheck and format**

Run: `npx tsc --noEmit && npx biome check --write src/components/map-wheel/`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/map-wheel/geometry.ts src/components/map-wheel/geometry.test.ts
git commit -m "feat(map-wheel): add ring geometry primitives"
```

---

### Task 2: Node types

Tiny, but it locks the vocabulary every later task uses, and the "exactly one kind" invariant is what keeps the renderer's click handler a simple ordered branch.

**Files:**
- Create: `src/components/map-wheel/types.ts`
- Test: `src/components/map-wheel/types.test.ts`

**Interfaces:**
- Consumes: `LayerId` from `@/components/layers`.
- Produces: `DrawerSpec`, `WheelNode`, `NodeKind`, `nodeKind(node): NodeKind`, `childrenOf(node): WheelNode[]`.

- [ ] **Step 1: Write the failing test**

Create `src/components/map-wheel/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { childrenOf, nodeKind, type WheelNode } from "./types";

const node = (extra: Partial<WheelNode>): WheelNode => ({ label: "x", icon: "icon-star", ...extra });

describe("nodeKind", () => {
  it("ranks toggle first so a layer sector never falls through to another branch", () => {
    expect(nodeKind(node({ toggle: "borders", run: () => {} }))).toBe("toggle");
  });

  it("identifies each remaining kind", () => {
    expect(nodeKind(node({ pick: 2 }))).toBe("pick");
    expect(nodeKind(node({ panel: { host: "aboutContent", title: "About" } }))).toBe("panel");
    expect(nodeKind(node({ children: [] }))).toBe("children");
    expect(nodeKind(node({ run: () => {} }))).toBe("run");
  });

  it("treats a node with nothing to do as inert", () => {
    expect(nodeKind(node({}))).toBe("inert");
  });
});

describe("childrenOf", () => {
  it("returns a static child list", () => {
    const kid = node({ label: "kid" });
    expect(childrenOf(node({ children: [kid] }))).toEqual([kid]);
  });

  it("calls a thunk so live state is read at open time, not at definition time", () => {
    let calls = 0;
    const parent = node({
      children: () => {
        calls++;
        return [node({ label: `call ${calls}` })];
      }
    });
    expect(childrenOf(parent)[0].label).toBe("call 1");
    expect(childrenOf(parent)[0].label).toBe("call 2");
  });

  it("returns an empty list for a childless node", () => {
    expect(childrenOf(node({ run: () => {} }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/map-wheel/types.ts`:

```ts
import type { LayerId } from "@/components/layers";

/** A form-shaped corner of the app the wheel cannot express as sectors, hosted in the side drawer */
export interface DrawerSpec {
  /** id of the live element to host, e.g. "optionsContent" */
  host: string;
  title: string;
  /** control ids; rows in the host not containing one of these are hidden while the drawer is open */
  only?: string[];
}

export interface WheelNode {
  label: string;
  /** icon-* class from public/icons.css */
  icon: string;
  /** third label line; the renderer fills in "▸" when a node has children and no note of its own */
  note?: string;
  danger?: boolean;
  toggle?: LayerId;
  /** HERE channel: index into the resolved subject stack */
  pick?: number;
  children?: WheelNode[] | (() => WheelNode[]);
  panel?: DrawerSpec;
  run?: () => void;
}

export type NodeKind = "toggle" | "pick" | "panel" | "children" | "run" | "inert";

/**
 * Which branch a click takes. The order is the spec's click order and is load-bearing: a layer
 * toggle must win over everything else so the ring can double as the layer panel's status display.
 */
export function nodeKind(node: WheelNode): NodeKind {
  if (node.toggle) return "toggle";
  if (node.pick !== undefined) return "pick";
  if (node.panel) return "panel";
  if (node.children) return "children";
  if (node.run) return "run";
  return "inert";
}

export function childrenOf(node: WheelNode): WheelNode[] {
  if (!node.children) return [];
  return typeof node.children === "function" ? node.children() : node.children;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/types.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/types.ts src/components/map-wheel/types.test.ts
git commit -m "feat(map-wheel): add wheel node types"
```

---

### Task 3: Ring renderer

The renderer is a **full redraw from state** — no diffing. At most ~50 sectors, so simplicity wins, and it matches the spec's "rendering is a pure fold".

**Files:**
- Create: `src/components/map-wheel/wheel.ts`
- Test: `src/components/map-wheel/wheel.test.ts`

**Interfaces:**
- Consumes: Task 1 geometry, Task 2 types.
- Produces: `WheelState`, `WheelRoots`, `WheelCallbacks`, `renderWheel(container, roots, state, cb)`, `FILLS`, `INKS`, `resolveLevels(roots, state)`.

- [ ] **Step 1: Write the failing test**

Create `src/components/map-wheel/wheel.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWheel, resolveLevels, type WheelRoots, type WheelState } from "./wheel";
import type { WheelNode } from "./types";

const leaf = (label: string, extra: Partial<WheelNode> = {}): WheelNode => ({ label, icon: "icon-star", ...extra });

const TREE: WheelNode[] = [
  leaf("Layers", { children: [leaf("Terrain", { children: [leaf("Rivers", { toggle: "rivers" })] })] }),
  leaf("Style", { panel: { host: "styleContent", title: "Style" } }),
  leaf("About", { run: () => {} }),
  leaf("Tools", { children: [leaf("Edit", { run: () => {} })] })
];

const roots: WheelRoots = { menu: () => TREE, here: () => [leaf("Edit burg", { run: () => {} })] };
const state = (over: Partial<WheelState> = {}): WheelState => ({ mode: "menu", path: [], hot: null, ...over });

let container: HTMLElement;
const cb = () => ({
  onState: vi.fn(),
  onPanel: vi.fn(),
  onLeaf: vi.fn(),
  onPick: vi.fn(),
  onToggle: vi.fn()
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

describe("resolveLevels", () => {
  it("returns one level for an unopened root", () => {
    expect(resolveLevels(roots, state()).length).toBe(1);
  });

  it("returns one level per open path entry", () => {
    expect(resolveLevels(roots, state({ path: [0] })).length).toBe(2);
    expect(resolveLevels(roots, state({ path: [0, 0] })).length).toBe(3);
  });

  it("stops at the depth cap rather than overflowing the bands", () => {
    const deep = resolveLevels(roots, state({ path: [0, 0, 0, 0, 0] }));
    expect(deep.length).toBeLessThanOrEqual(4);
  });

  it("does not open a level for a node whose children are empty", () => {
    const empty: WheelRoots = { menu: () => [leaf("Empty", { children: [] })], here: () => [] };
    expect(resolveLevels(empty, state({ path: [0] })).length).toBe(1);
  });
});

describe("renderWheel", () => {
  it("draws one path per sector in the root ring", () => {
    renderWheel(container, roots, state(), cb());
    expect(container.querySelectorAll("path.mw-sector").length).toBe(4);
  });

  it("draws a spine for every level below the root", () => {
    renderWheel(container, roots, state({ path: [0] }), cb());
    expect(container.querySelectorAll("line.mw-spine").length).toBe(1);
  });

  it("puts labels in an HTML layer, not in SVG text, so they never intercept clicks", () => {
    renderWheel(container, roots, state(), cb());
    expect(container.querySelectorAll("svg text").length).toBe(0);
    expect(container.querySelectorAll(".mw-label").length).toBe(4);
  });

  it("paints the chosen ancestor dark and dims its siblings", () => {
    renderWheel(container, roots, state({ path: [0] }), cb());
    const [chosen, sibling] = [...container.querySelectorAll("path.mw-sector")];
    expect(chosen.getAttribute("fill")).toBe("#4a3a22");
    expect(sibling.getAttribute("fill")).toBe("rgba(251,247,236,.82)");
  });

  it("marks a node with children so the user can see there is more", () => {
    renderWheel(container, roots, state(), cb());
    expect(container.querySelector(".mw-label")!.textContent).toContain("▸");
  });

  it("opens a child ring when a parent sector is clicked", () => {
    const spies = cb();
    renderWheel(container, roots, state(), spies);
    container.querySelectorAll("path.mw-sector")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spies.onState).toHaveBeenCalledWith(expect.objectContaining({ path: [0] }));
  });

  it("collapses when the already-chosen sector is clicked again", () => {
    const spies = cb();
    renderWheel(container, roots, state({ path: [0] }), spies);
    container.querySelectorAll("path.mw-sector")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spies.onState).toHaveBeenCalledWith(expect.objectContaining({ path: [] }));
  });

  it("swaps branch without disturbing anything when a dimmed sibling is clicked", () => {
    const spies = cb();
    renderWheel(container, roots, state({ path: [0] }), spies);
    container.querySelectorAll("path.mw-sector")[3].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spies.onState).toHaveBeenCalledWith(expect.objectContaining({ path: [3] }));
  });

  it("reports a panel node instead of opening a ring", () => {
    const spies = cb();
    renderWheel(container, roots, state(), spies);
    container.querySelectorAll("path.mw-sector")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spies.onPanel).toHaveBeenCalledWith(
      expect.objectContaining({ host: "styleContent" }),
      expect.any(Number)
    );
    expect(spies.onState).toHaveBeenCalledWith(expect.objectContaining({ path: [1] }));
  });

  it("renders both hub tabs and marks the active one", () => {
    renderWheel(container, roots, state(), cb());
    const tabs = container.querySelectorAll(".mw-tab");
    expect(tabs.length).toBe(2);
    expect(tabs[1].classList.contains("is-active")).toBe(true);
  });

  it("renders a breadcrumb whose depth follows the path", () => {
    renderWheel(container, roots, state({ path: [0] }), cb());
    expect(container.querySelectorAll(".mw-crumb").length).toBe(2);
  });

  it("truncates the path when an earlier crumb is clicked", () => {
    const spies = cb();
    renderWheel(container, roots, state({ path: [0, 0] }), spies);
    container.querySelectorAll(".mw-crumb")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(spies.onState).toHaveBeenCalledWith(expect.objectContaining({ path: [] }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/wheel.test.ts`
Expected: FAIL — cannot resolve `./wheel`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/map-wheel/wheel.ts`:

```ts
// The spin-out renderer. Rendering is a pure fold: walk `path` from the root node list, emit one
// ring per level, carrying the parent's mid-angle forward as the next ring's centre.
//
// Redraws in full on every state change. At most ~50 sectors are on screen, so diffing would buy
// nothing and cost the clarity of "the DOM is a function of the state".
import { Layers } from "@/components/layers";
import { arcPath, BANDS, HOVER_GROW, labelPoint, MAX_DEPTH, type Sector, sectors, spineLine } from "./geometry";
import { childrenOf, type DrawerSpec, nodeKind, type WheelNode } from "./types";

const SVG = "http://www.w3.org/2000/svg";

export const FILLS = {
  chosen: "#4a3a22",
  hot: "#6b5535",
  hotDanger: "#a33a2e",
  layerOn: "#8a9c6c",
  dim: "rgba(251,247,236,.82)",
  base: "rgba(251,247,236,.97)"
} as const;

export const INKS = {
  light: "#fffdf7",
  layerOn: "#20261a",
  danger: "#8d2f24",
  dim: "rgba(59,50,38,.82)",
  base: "#3b3226"
} as const;

const EDGE = "rgba(90,74,48,.32)";
const EDGE_DIM = "rgba(90,74,48,.16)";

export interface WheelState {
  mode: "here" | "menu";
  path: number[];
  hot: { level: number; index: number } | null;
}

export interface WheelRoots {
  menu: () => WheelNode[];
  here: () => WheelNode[];
}

export interface WheelCallbacks {
  onState: (next: WheelState) => void;
  onPanel: (spec: DrawerSpec, sectorMid: number) => void;
  onLeaf: (node: WheelNode) => void;
  onPick: (index: number) => void;
  onToggle: (node: WheelNode) => void;
}

interface Level {
  items: WheelNode[];
  ring: Sector[];
  chosen: number | null;
  parentMid: number;
}

/** The fold: root list plus `path` in, one level per open ring out */
export function resolveLevels(roots: WheelRoots, state: WheelState): Level[] {
  const levels: Level[] = [];
  let items = roots[state.mode]();
  let parentMid = 0;

  for (let level = 0; level < MAX_DEPTH && items.length; level++) {
    const chosen = level < state.path.length ? state.path[level] : null;
    const ring = sectors(level, items.length, parentMid);
    levels.push({ items, ring, chosen, parentMid });

    if (chosen === null || !items[chosen]) break;
    const next = childrenOf(items[chosen]);
    if (!next.length) break;
    parentMid = ring[chosen].mid;
    items = next;
  }

  return levels;
}

function fillFor(node: WheelNode, isChosen: boolean, isHot: boolean, isDim: boolean): string {
  if (isChosen) return FILLS.chosen;
  if (isHot) return node.danger ? FILLS.hotDanger : FILLS.hot;
  if (node.toggle && Layers.isOn(node.toggle)) return FILLS.layerOn;
  if (isDim) return FILLS.dim;
  return FILLS.base;
}

function inkFor(node: WheelNode, isChosen: boolean, isHot: boolean, isDim: boolean): string {
  if (isChosen || isHot) return INKS.light;
  if (node.toggle && Layers.isOn(node.toggle)) return INKS.layerOn;
  if (isDim) return INKS.dim;
  if (node.danger) return INKS.danger;
  return INKS.base;
}

function noteFor(node: WheelNode): string | null {
  if (node.toggle) return Layers.isOn(node.toggle) ? "on" : "off";
  if (node.note) return node.note;
  return node.children ? "▸" : null;
}

export function renderWheel(
  container: HTMLElement,
  roots: WheelRoots,
  state: WheelState,
  cb: WheelCallbacks
): void {
  container.textContent = "";
  const levels = resolveLevels(roots, state);

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "-258 -258 516 516");
  svg.setAttribute("width", "516");
  svg.setAttribute("height", "516");
  svg.setAttribute("class", "mw-svg");
  container.append(svg);

  const labelLayer = document.createElement("div");
  labelLayer.className = "mw-labels";
  container.append(labelLayer);

  levels.forEach((level, L) => {
    if (L > 0) {
      const { x1, y1, x2, y2 } = spineLine(L, level.parentMid);
      const spine = document.createElementNS(SVG, "line");
      spine.setAttribute("class", "mw-spine");
      for (const [k, v] of Object.entries({ x1, y1, x2, y2 })) spine.setAttribute(k, v.toFixed(2));
      svg.append(spine);
    }

    const [inner, outer] = BANDS[L];
    const deeper = level.chosen !== null;

    level.items.forEach((node, i) => {
      const isChosen = level.chosen === i;
      const isHot = state.hot?.level === L && state.hot.index === i;
      const isDim = deeper && !isChosen;
      const { from, to, mid } = level.ring[i];
      const rOuter = isHot ? outer + HOVER_GROW : outer;

      const sector = document.createElementNS(SVG, "path");
      sector.setAttribute("class", "mw-sector");
      sector.setAttribute("d", arcPath(inner, rOuter, from, to));
      sector.setAttribute("fill", fillFor(node, isChosen, isHot, isDim));
      sector.setAttribute("stroke", isDim ? EDGE_DIM : EDGE);
      sector.addEventListener("mouseenter", () => cb.onState({ ...state, hot: { level: L, index: i } }));
      sector.addEventListener("mouseleave", () => cb.onState({ ...state, hot: null }));
      sector.addEventListener("click", () => pick(L, i, node, mid));
      svg.append(sector);

      const [x, y] = labelPoint(mid, inner, rOuter);
      const label = document.createElement("div");
      label.className = `mw-label ${L === 0 ? "mw-label--root" : ""}`;
      label.style.left = `calc(50% + ${x.toFixed(2)}px)`;
      label.style.top = `calc(50% + ${y.toFixed(2)}px)`;
      label.style.color = inkFor(node, isChosen, isHot, isDim);

      const icon = document.createElement("i");
      icon.className = node.toggle && !Layers.isOn(node.toggle) ? "icon-eye-off" : node.icon;
      const text = document.createElement("span");
      text.textContent = node.label;
      label.append(icon, text);

      const note = noteFor(node);
      if (note) {
        const noteEl = document.createElement("span");
        noteEl.className = "mw-note";
        noteEl.textContent = note;
        label.append(noteEl);
      }
      labelLayer.append(label);
    });
  });

  renderHub(container, state, cb);
  renderCrumbs(container, roots, state, cb);

  // The spec's click order. A layer toggle wins over everything so the ring doubles as the
  // layer panel's status display: it flips in place and the ring neither changes nor closes.
  function pick(level: number, index: number, node: WheelNode, mid: number): void {
    const kind = nodeKind(node);
    if (kind === "toggle") return cb.onToggle(node);
    if (kind === "pick") return cb.onPick(node.pick!);

    const isChosen = levels[level].chosen === index;
    const truncated = state.path.slice(0, level);

    if (kind === "panel") {
      if (isChosen) return cb.onState({ ...state, path: truncated, hot: null });
      cb.onState({ ...state, path: [...truncated, index], hot: null });
      return cb.onPanel(node.panel!, mid);
    }

    if (kind === "children") {
      return cb.onState({ ...state, path: isChosen ? truncated : [...truncated, index], hot: null });
    }

    if (kind === "run") return cb.onLeaf(node);
  }
}

function renderHub(container: HTMLElement, state: WheelState, cb: WheelCallbacks): void {
  const hub = document.createElement("div");
  hub.className = "mw-hub";

  for (const mode of ["here", "menu"] as const) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `mw-tab ${state.mode === mode ? "is-active" : ""}`;
    tab.textContent = mode;
    tab.addEventListener("click", () => cb.onState({ mode, path: [], hot: null }));
    hub.append(tab);
  }

  container.append(hub);
}

function renderCrumbs(
  container: HTMLElement,
  roots: WheelRoots,
  state: WheelState,
  cb: WheelCallbacks
): void {
  const bar = document.createElement("div");
  bar.className = "mw-crumbs";

  const labels = [state.mode === "menu" ? "Menu" : "Here"];
  let items = roots[state.mode]();
  for (const index of state.path) {
    const node = items[index];
    if (!node) break;
    labels.push(node.label);
    items = childrenOf(node);
  }

  labels.forEach((text, depth) => {
    if (depth > 0) {
      const sep = document.createElement("span");
      sep.className = "mw-crumb-sep";
      sep.textContent = "›";
      bar.append(sep);
    }
    const crumb = document.createElement("span");
    crumb.className = `mw-crumb ${depth === labels.length - 1 ? "is-last" : ""}`;
    crumb.textContent = text;
    crumb.addEventListener("click", () => cb.onState({ ...state, path: state.path.slice(0, depth), hot: null }));
    bar.append(crumb);
  });

  container.append(bar);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/wheel.test.ts`
Expected: PASS, 17 tests. The renderer redraws in full, so `querySelectorAll` order is always level-then-index.

If `Layers.isOn` throws because the registry is not initialised under jsdom, add to the top of the test file:

```ts
vi.mock("@/components/layers", () => ({ Layers: { isOn: () => false } }));
```

- [ ] **Step 5: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/wheel.ts src/components/map-wheel/wheel.test.ts
git commit -m "feat(map-wheel): add spin-out ring renderer"
```

---

### Task 4: Styles and overlay lifecycle

First user-visible milestone: right-click the map and a wheel appears with a placeholder tree, dismisses correctly, and stays on screen near an edge. The real tree arrives in Tasks 6-9.

**Files:**
- Create: `src/components/map-wheel/styles.ts`
- Create: `src/components/map-wheel/index.ts`
- Modify: `src/components/index.ts` (add one import line, after `import "./layers-tab";`)
- Test: `src/components/map-wheel/index.test.ts`

**Interfaces:**
- Consumes: Task 3 `renderWheel`, `WheelState`, `WheelRoots`.
- Produces: `openMapWheel(event, roots)`, `closeMapWheel()`, `clampCentre(x, y, width, height, drawerSide)`, `WHEEL_CSS`.

- [ ] **Step 1: Write the failing test**

Create `src/components/map-wheel/index.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampCentre, closeMapWheel, openMapWheel } from "./index";
import type { WheelRoots } from "./wheel";

vi.mock("@/components/layers", () => ({ Layers: { isOn: () => false } }));

const roots: WheelRoots = {
  menu: () => [{ label: "Layers", icon: "icon-eye", run: () => {} }],
  here: () => [{ label: "Edit burg", icon: "icon-star", run: () => {} }]
};

const rightClick = (x = 400, y = 300) =>
  new MouseEvent("contextmenu", { clientX: x, clientY: y, bubbles: true, cancelable: true });

afterEach(() => closeMapWheel());

describe("clampCentre", () => {
  it("leaves a centred wheel alone", () => {
    expect(clampCentre(600, 400, 1280, 720)).toEqual([600, 400]);
  });

  it("pushes a wheel opened at the top-left corner fully into view", () => {
    const [x, y] = clampCentre(5, 5, 1280, 720);
    expect(x).toBeGreaterThanOrEqual(258);
    expect(y).toBeGreaterThanOrEqual(258);
  });

  it("pushes a wheel opened at the bottom-right corner fully into view", () => {
    const [x, y] = clampCentre(1275, 715, 1280, 720);
    expect(x).toBeLessThanOrEqual(1280 - 258);
    expect(y).toBeLessThanOrEqual(720 - 258);
  });

  it("reserves room for an open drawer on the side it opens", () => {
    const [x] = clampCentre(1000, 400, 1280, 720, "right");
    expect(x).toBeLessThanOrEqual(1280 - 258 - 354);
  });
});

describe("openMapWheel", () => {
  it("mounts a single host and centres it on the pointer", () => {
    openMapWheel(rightClick(400, 300), roots);
    const host = document.getElementById("mapWheel")!;
    expect(host).toBeTruthy();
    expect(host.querySelectorAll("path.mw-sector").length).toBe(1);
  });

  it("replaces an existing wheel rather than stacking a second one", () => {
    openMapWheel(rightClick(), roots);
    openMapWheel(rightClick(), roots);
    expect(document.querySelectorAll("#mapWheel").length).toBe(1);
  });

  it("closes on Escape", () => {
    openMapWheel(rightClick(), roots);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("mapWheel")).toBeNull();
  });

  it("closes on an outside pointerdown", () => {
    openMapWheel(rightClick(), roots);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(document.getElementById("mapWheel")).toBeNull();
  });

  it("stays open for a pointerdown inside itself", () => {
    openMapWheel(rightClick(), roots);
    document
      .querySelector("path.mw-sector")!
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(document.getElementById("mapWheel")).toBeTruthy();
  });

  it("removes its window listeners on close so a stale wheel cannot swallow Escape", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    openMapWheel(rightClick(), roots);
    closeMapWheel();
    expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true);
    remove.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/index.test.ts`
Expected: FAIL — cannot resolve `./index`.

- [ ] **Step 3: Write the styles**

Create `src/components/map-wheel/styles.ts`. Colours are copied verbatim from the spec's token table; the drawer skin block is filled in during Task 5.

```ts
export const WHEEL_CSS = `
#mapWheel {
  position: fixed;
  inset: 0;
  z-index: 1000;
  font-family: "IBM Plex Sans", system-ui, sans-serif;
}

#mapWheel .mw-origin {
  position: absolute;
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: #4a3a22;
  opacity: .5;
}

#mapWheel .mw-wheel {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 516px;
  height: 516px;
}

#mapWheel .mw-svg {
  display: block;
  overflow: visible;
  filter: drop-shadow(0 10px 26px rgba(38,28,12,.35));
}

#mapWheel .mw-sector {
  cursor: pointer;
  stroke-width: 1;
  transition: fill 120ms;
}

#mapWheel .mw-spine {
  stroke: #4a3a22;
  stroke-width: 3;
  stroke-linecap: round;
}

#mapWheel .mw-labels { position: absolute; inset: 0; pointer-events: none; }

#mapWheel .mw-label {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 66px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  font-size: 9.5px;
  line-height: 1.15;
  text-align: center;
  pointer-events: none;
}

#mapWheel .mw-label--root { width: 74px; font-size: 10.5px; }
#mapWheel .mw-label i { font-size: 16px; line-height: 1; }
#mapWheel .mw-label--root i { font-size: 19px; }
#mapWheel .mw-note { font-size: 8.5px; opacity: .68; letter-spacing: .05em; }

#mapWheel .mw-hub {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 104px;
  height: 104px;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  box-shadow: 0 0 0 1px rgba(90,74,48,.4), 0 6px 16px rgba(20,14,4,.35);
}

#mapWheel .mw-tab {
  flex: 1;
  border: 0;
  cursor: pointer;
  pointer-events: auto;
  font: 600 10px "IBM Plex Sans", system-ui, sans-serif;
  letter-spacing: .1em;
  text-transform: uppercase;
  background: rgba(251,247,236,.94);
  color: #6b5535;
  transition: background 120ms;
}

#mapWheel .mw-tab.is-active { background: #6b5535; color: #fffdf7; }

#mapWheel .mw-crumbs {
  position: absolute;
  left: 18px;
  top: 16px;
  display: flex;
  align-items: center;
  font-size: 11px;
  letter-spacing: .04em;
  color: #6b5535;
  background: rgba(251,247,236,.86);
  padding: 6px 11px;
  border-radius: 3px;
  border: 1px solid rgba(90,74,48,.25);
}

#mapWheel .mw-crumb { cursor: pointer; pointer-events: auto; color: #8a7248; }
#mapWheel .mw-crumb.is-last { color: #3b3226; font-weight: 600; }
#mapWheel .mw-crumb-sep { opacity: .45; margin: 0 5px; }
`;
```

- [ ] **Step 4: Write the lifecycle**

Create `src/components/map-wheel/index.ts`:

```ts
// Map Wheel: a radial context controller on right-click. Additive — the top bar and left-click
// editing are untouched; this is a second route in.
import { WHEEL_CSS } from "./styles";
import { renderWheel, type WheelRoots, type WheelState } from "./wheel";

const HOST_ID = "mapWheel";
const RADIUS = 258; // half the 516px box
const MARGIN = 8;
const DRAWER_RESERVE = 354; // drawer width 340 + 14 clear of the ring

let host: HTMLElement | null = null;

/** Offset the centre so the wheel (and its drawer, if any) stays fully on screen. Never rotates. */
export function clampCentre(
  x: number,
  y: number,
  width: number,
  height: number,
  drawerSide: "left" | "right" | null = null
): [number, number] {
  const left = RADIUS + MARGIN + (drawerSide === "left" ? DRAWER_RESERVE : 0);
  const right = width - RADIUS - MARGIN - (drawerSide === "right" ? DRAWER_RESERVE : 0);
  const top = RADIUS + MARGIN;
  const bottom = height - RADIUS - MARGIN;

  return [
    Math.min(Math.max(x, left), Math.max(left, right)),
    Math.min(Math.max(y, top), Math.max(top, bottom))
  ];
}

export function closeMapWheel(): void {
  if (!host) return;
  host.remove();
  host = null;
  window.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("wheel", closeMapWheel, true);
  window.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("blur", closeMapWheel);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeMapWheel();
}

function onPointerDown(event: Event): void {
  if (!host) return;
  if ((event.target as Element | null)?.closest(`#${HOST_ID}`)) return;
  closeMapWheel();
}

export function openMapWheel(event: MouseEvent, roots: WheelRoots): void {
  closeMapWheel();

  host = document.createElement("div");
  host.id = HOST_ID;
  host.addEventListener("contextmenu", e => e.preventDefault());
  document.body.append(host);

  const origin = document.createElement("div");
  origin.className = "mw-origin";
  origin.style.left = `${event.clientX}px`;
  origin.style.top = `${event.clientY}px`;
  host.append(origin);

  const wheel = document.createElement("div");
  wheel.className = "mw-wheel";
  host.append(wheel);

  const [cx, cy] = clampCentre(event.clientX, event.clientY, window.innerWidth, window.innerHeight);
  wheel.style.left = `${cx}px`;
  wheel.style.top = `${cy}px`;

  let state: WheelState = { mode: "here", path: [], hot: null };
  const draw = (): void =>
    renderWheel(wheel, roots, state, {
      onState: next => {
        state = next;
        draw();
      },
      onPanel: () => {},
      onLeaf: node => {
        closeMapWheel();
        try {
          node.run?.();
        } catch (error) {
          console.error("map wheel action failed", error);
        }
      },
      onPick: () => {},
      onToggle: () => {}
    });
  draw();

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("wheel", closeMapWheel, true);
  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("blur", closeMapWheel);
}

function onContextMenu(event: MouseEvent): void {
  // stay out of modes that already claim right-click (heightmap customization, journey drawing)
  if (window.customization) return;
  if (!(event.target as Element | null)?.closest("#map")) return;

  event.preventDefault();
  event.stopPropagation();
  openMapWheel(event, { menu: () => [], here: () => [] });
}

function mount(): void {
  const style = document.createElement("style");
  style.id = "mapWheelStyle";
  style.textContent = WHEEL_CSS;
  document.head.append(style);
  document.addEventListener("contextmenu", onContextMenu, true);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
```

- [ ] **Step 5: Register the module**

In `src/components/index.ts`, add after the `import "./layers-tab";` line:

```ts
import "./map-wheel";
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/`
Expected: PASS, all files.

- [ ] **Step 7: Verify in the browser**

Run `npm run dev` on a port that is not 5173 (5173 belongs to the user's own session): `npx vite --port 5199`.
Open `http://localhost:5199/?seed=test-seed`, wait for the map, right-click it.
Expected: a wheel appears centred on the pointer with no sectors (the tree is still a stub), Escape dismisses it, right-clicking near a corner keeps the whole 516px box on screen.

- [ ] **Step 8: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/ src/components/index.ts
git add src/components/map-wheel/styles.ts src/components/map-wheel/index.ts src/components/map-wheel/index.test.ts src/components/index.ts
git commit -m "feat(map-wheel): mount overlay on right-click with dismissal and clamping"
```

---

### Task 5: Side drawer

The riskiest component: it relocates pre-existing app DOM. Restore correctness is what the tests are for.

**Files:**
- Create: `src/components/map-wheel/drawer.ts`
- Modify: `src/components/map-wheel/styles.ts` (append the drawer CSS)
- Test: `src/components/map-wheel/drawer.test.ts`

**Interfaces:**
- Consumes: `DrawerSpec` from Task 2.
- Produces: `openDrawer(host, spec, side, onClose): HTMLElement`, `closeDrawer(): void`, `isDrawerOpen(): boolean`, `pickSide(sectorMid, centreX, viewportWidth): "left" | "right"`, `DRAWER_CSS`.

- [ ] **Step 1: Write the failing test**

Create `src/components/map-wheel/drawer.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDrawer, connectorLine, isDrawerOpen, openDrawer, pickSide } from "./drawer";

let overlay: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="options">
      <div id="before"></div>
      <div id="optionsContent" class="tabcontent">
        <p>Map generation settings</p>
        <table><tbody>
          <tr><td><input id="alpha"></td></tr>
          <tr><td><input id="beta"></td></tr>
          <tr><td><input id="gamma"></td></tr>
        </tbody></table>
      </div>
      <div id="after"></div>
    </div>`;
  overlay = document.createElement("div");
  document.body.append(overlay);
});

afterEach(() => closeDrawer());

describe("pickSide", () => {
  it("opens on the side the sector points into", () => {
    expect(pickSide(0, 640, 1280)).toBe("right");
    expect(pickSide(Math.PI, 640, 1280)).toBe("left");
  });

  it("overrides to the other side when the preferred one lacks room", () => {
    expect(pickSide(0, 1200, 1280)).toBe("left");
  });

  it("decides by viewport room when the sector points near-vertically", () => {
    expect(pickSide(-Math.PI / 2, 300, 1280)).toBe("right");
    expect(pickSide(-Math.PI / 2, 1000, 1280)).toBe("left");
  });
});

describe("openDrawer", () => {
  it("reparents the live host element into the drawer", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Options" }, "right", () => {});
    expect(document.getElementById("optionsContent")!.closest("#mapWheelDrawer")).toBeTruthy();
    expect(isDrawerOpen()).toBe(true);
  });

  it("shows the title", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Realms" }, "right", () => {});
    expect(overlay.querySelector(".mw-drawer-title")!.textContent).toBe("Realms");
  });

  it("hides exactly the rows outside the filter", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Options", only: ["beta"] }, "right", () => {});
    const rows = [...document.querySelectorAll("#optionsContent tr")] as HTMLElement[];
    expect(rows.map(r => r.hidden)).toEqual([true, false, true]);
  });

  it("does nothing when the host id does not exist", () => {
    openDrawer(overlay, { host: "nope", title: "Nope" }, "right", () => {});
    expect(isDrawerOpen()).toBe(false);
  });
});

describe("closeDrawer", () => {
  it("puts the host back exactly where it was", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Options" }, "right", () => {});
    closeDrawer();
    const host = document.getElementById("optionsContent")!;
    expect(host.parentElement!.id).toBe("options");
    expect(host.previousElementSibling!.id).toBe("before");
    expect(host.nextElementSibling!.id).toBe("after");
  });

  it("clears every hidden flag it set", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Options", only: ["beta"] }, "right", () => {});
    closeDrawer();
    const rows = [...document.querySelectorAll("#optionsContent tr")] as HTMLElement[];
    expect(rows.every(r => !r.hidden)).toBe(true);
  });

  it("leaves a row alone that was already hidden before the drawer opened", () => {
    const pre = document.querySelector("#optionsContent tr") as HTMLElement;
    pre.hidden = true;
    openDrawer(overlay, { host: "optionsContent", title: "Options", only: ["beta"] }, "right", () => {});
    closeDrawer();
    expect(pre.hidden).toBe(true);
  });

  it("is idempotent", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Options" }, "right", () => {});
    closeDrawer();
    expect(() => closeDrawer()).not.toThrow();
    expect(document.getElementById("optionsContent")!.parentElement!.id).toBe("options");
  });

  it("still restores when the recorded next sibling was removed while the drawer was open", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Options" }, "right", () => {});
    document.getElementById("after")!.remove();
    closeDrawer();
    expect(document.getElementById("optionsContent")!.parentElement!.id).toBe("options");
  });

  it("restores the first host before hosting a second", () => {
    openDrawer(overlay, { host: "optionsContent", title: "Options" }, "right", () => {});
    openDrawer(overlay, { host: "before", title: "Other" }, "right", () => {});
    expect(document.getElementById("optionsContent")!.parentElement!.id).toBe("options");
    expect(document.getElementById("before")!.closest("#mapWheelDrawer")).toBeTruthy();
  });

  it("aims the connector at the drawer's near edge, not along the sector angle", () => {
    const line = connectorLine(-Math.PI / 2, "right");
    expect(line.x1).toBeCloseTo(0, 6);
    expect(line.x2).toBeGreaterThan(0);
    expect(line.y2).toBeCloseTo(line.y1, 6);
  });

  it("keeps the connector inside the drawer's height for a sector pointing far off it", () => {
    const line = connectorLine(-Math.PI / 2, "right");
    expect(Math.abs(line.y2)).toBeLessThanOrEqual(Math.min(560, window.innerHeight - 32) / 2);
  });

  it("notifies the caller when the close button is used", () => {
    const onClose = vi.fn();
    openDrawer(overlay, { host: "optionsContent", title: "Options" }, "right", onClose);
    (overlay.querySelector(".mw-drawer-close") as HTMLElement).click();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/drawer.test.ts`
Expected: FAIL — cannot resolve `./drawer`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/map-wheel/drawer.ts`:

```ts
// The side drawer. Some of FMG is not a menu — the Style tab is a live form, Options is 26 setting
// rows, About is prose — so the drawer hosts the REAL elements rather than rebuilding them.
//
// FMG's wiring is getElementById lookups with listeners bound at init, so a clone would be dead DOM
// and a rebuild would drift. We move the live element in and put it back on close. That makes
// restore the load-bearing part of this file: while a drawer is open the element is out of
// #options, and every exit path has to return it.
import { findEl } from "@/utils/nodeUtils";
import type { DrawerSpec } from "./types";

const DRAWER_ID = "mapWheelDrawer";
const WIDTH = 340;
const CLEAR = 14; // gap between the ring's outer edge and the drawer
const RADIUS = 246;

interface Borrowed {
  element: HTMLElement;
  parent: HTMLElement;
  nextSibling: ChildNode | null;
  hidden: HTMLElement[];
}

let borrowed: Borrowed | null = null;
let drawerEl: HTMLElement | null = null;

export const isDrawerOpen = (): boolean => borrowed !== null;

/**
 * Which side to fan out on. Prefer the half the sector points into so the drawer follows the
 * gesture; fall back to viewport room when that side has none, or when the sector points
 * near-vertically and has no meaningful horizontal intent.
 */
export function pickSide(sectorMid: number, centreX: number, viewportWidth: number): "left" | "right" {
  const roomRight = viewportWidth - centreX - RADIUS - CLEAR >= WIDTH;
  const roomLeft = centreX - RADIUS - CLEAR >= WIDTH;
  const horizontal = Math.cos(sectorMid);

  if (Math.abs(horizontal) >= 0.2) {
    const preferred = horizontal >= 0 ? "right" : "left";
    if (preferred === "right" && roomRight) return "right";
    if (preferred === "left" && roomLeft) return "left";
    return preferred === "right" ? "left" : "right";
  }

  if (roomRight) return "right";
  if (roomLeft) return "left";
  return "right";
}

export function closeDrawer(): void {
  if (borrowed) {
    for (const row of borrowed.hidden) row.hidden = false;
    const { element, parent, nextSibling } = borrowed;
    // the recorded sibling can have been removed while we held the element
    if (nextSibling?.parentNode === parent) parent.insertBefore(element, nextSibling);
    else parent.append(element);
    borrowed = null;
  }

  drawerEl?.remove();
  drawerEl = null;
}

export function openDrawer(
  overlay: HTMLElement,
  spec: DrawerSpec,
  side: "left" | "right",
  onClose: () => void
): void {
  closeDrawer();

  const element = findEl(spec.host);
  if (!element?.parentElement) return;

  drawerEl = document.createElement("div");
  drawerEl.id = DRAWER_ID;
  drawerEl.dataset.side = side;

  const header = document.createElement("div");
  header.className = "mw-drawer-head";
  const title = document.createElement("span");
  title.className = "mw-drawer-title";
  title.textContent = spec.title;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "mw-drawer-close";
  close.textContent = "✕";
  close.addEventListener("click", onClose);
  header.append(title, close);

  const body = document.createElement("div");
  body.className = "mw-drawer-body";

  drawerEl.append(header, body);
  overlay.append(drawerEl);

  borrowed = { element, parent: element.parentElement, nextSibling: element.nextSibling, hidden: [] };
  body.append(element);

  if (spec.only) filterRows(element, spec.only, borrowed);
}

/**
 * Tie the drawer back to the sector that opened it, in the same visual language as a ring spine.
 * The line cannot simply follow the sector's mid-angle: the drawer is a rectangle on one side, so
 * a sector at 10 o'clock with the drawer on the right would point away from it. Run it to the
 * nearest point on the drawer's near edge instead, which reads correctly from any sector.
 */
export function connectorLine(
  sectorMid: number,
  side: "left" | "right"
): { x1: number; y1: number; x2: number; y2: number } {
  const x1 = Math.cos(sectorMid) * RADIUS;
  const y1 = Math.sin(sectorMid) * RADIUS;
  const x2 = side === "right" ? RADIUS + CLEAR : -(RADIUS + CLEAR);
  // clamp to the drawer's own height so the line always lands on its near edge
  const half = Math.min(560, window.innerHeight - 32) / 2;
  return { x1, y1, x2, y2: Math.min(Math.max(y1, -half), half) };
}

/** Hide every row that does not hold one of the named controls, remembering only what we changed */
function filterRows(host: HTMLElement, only: string[], record: Borrowed): void {
  const keep = new Set<Element>();
  for (const id of only) {
    const row = findEl(id)?.closest("tr");
    if (row) keep.add(row);
  }

  for (const row of host.querySelectorAll<HTMLElement>("tr")) {
    if (keep.has(row) || row.hidden) continue;
    row.hidden = true;
    record.hidden.push(row);
  }

  // a heading whose whole table is now hidden is noise
  for (const table of host.querySelectorAll<HTMLElement>("table")) {
    const rows = [...table.querySelectorAll<HTMLElement>("tr")];
    if (!rows.length || rows.some(row => !row.hidden)) continue;
    for (const el of [table, table.previousElementSibling].filter(Boolean) as HTMLElement[]) {
      if (el.hidden) continue;
      el.hidden = true;
      record.hidden.push(el);
    }
  }
}
```

- [ ] **Step 4: Append the drawer CSS**

Append to the template literal in `src/components/map-wheel/styles.ts`, before the closing backtick:

```css
#mapWheelDrawer {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 340px;
  max-height: min(560px, calc(100vh - 32px));
  display: flex;
  flex-direction: column;
  background: rgba(251,247,236,.97);
  border: 1px solid rgba(90,74,48,.32);
  border-radius: 4px;
  box-shadow: 0 10px 26px rgba(38,28,12,.35);
  overflow: hidden;
}

#mapWheelDrawer[data-side="right"] { left: calc(50% + 260px); }
#mapWheelDrawer[data-side="left"] { right: calc(50% + 260px); }

#mapWheelDrawer .mw-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  background: rgba(251,247,236,.86);
  border-bottom: 1px solid rgba(90,74,48,.16);
}

#mapWheelDrawer .mw-drawer-title {
  font: 600 12px "IBM Plex Sans", system-ui, sans-serif;
  letter-spacing: .09em;
  text-transform: uppercase;
  color: #6b5535;
}

#mapWheelDrawer .mw-drawer-close {
  border: 0;
  background: none;
  cursor: pointer;
  color: #6b5535;
  font-size: 13px;
  line-height: 1;
}

#mapWheelDrawer .mw-drawer-body { overflow-y: auto; scrollbar-width: thin; padding: 4px 14px 14px; }

/* --- the skin: FMG's real controls, restyled in place ------------------------------------- */
#mapWheelDrawer .tabcontent { display: block; }
#mapWheelDrawer table, #mapWheelDrawer tbody, #mapWheelDrawer tr, #mapWheelDrawer td {
  display: block;
  width: 100%;
}
#mapWheelDrawer tr {
  padding: 9px 0;
  border-bottom: 1px solid rgba(90,74,48,.16);
}
#mapWheelDrawer tr:last-child { border-bottom: 0; }
#mapWheelDrawer td { padding: 0; }
#mapWheelDrawer > .mw-drawer-body p {
  font: 600 11px "IBM Plex Sans", system-ui, sans-serif;
  letter-spacing: .09em;
  text-transform: uppercase;
  color: #8a7248;
  margin: 14px 0 4px;
}
#mapWheelDrawer tr::after {
  content: attr(data-tip);
  display: block;
  font-size: 10.5px;
  line-height: 1.35;
  opacity: .68;
  color: #3b3226;
  margin-top: 3px;
}
#mapWheelDrawer input[type="range"] {
  width: 100%;
  appearance: none;
  height: 3px;
  border-radius: 2px;
  background: rgba(90,74,48,.22);
}
#mapWheelDrawer input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #6b5535;
  cursor: pointer;
}
#mapWheelDrawer input[type="range"]::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border: 0;
  border-radius: 50%;
  background: #6b5535;
  cursor: pointer;
}
#mapWheelDrawer select,
#mapWheelDrawer input[type="number"],
#mapWheelDrawer input[type="text"] {
  width: 100%;
  font-size: 12px;
  padding: 4px 6px;
  color: #3b3226;
  background: rgba(251,247,236,.97);
  border: 1px solid rgba(90,74,48,.32);
  border-radius: 3px;
}
#mapWheelDrawer input[type="color"] {
  width: 26px;
  height: 26px;
  padding: 0;
  border: 1px solid rgba(90,74,48,.32);
  border-radius: 3px;
}
/* FMG hides raw checkboxes app-wide and styles the label instead - do not un-hide them here */
#mapWheelDrawer .checkbox-label { font-size: 12px; color: #3b3226; cursor: pointer; }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/drawer.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/drawer.ts src/components/map-wheel/drawer.test.ts src/components/map-wheel/styles.ts
git commit -m "feat(map-wheel): add side drawer hosting live option forms"
```

---

### Task 6: Menu tree — Layers branch

**Files:**
- Create: `src/components/map-wheel/menu-tree.ts`
- Test: `src/components/map-wheel/menu-tree.test.ts`

**Interfaces:**
- Consumes: Task 2 types, `Layers` and `LayerId` from `@/components/layers`, `findEl`.
- Produces: `menuRoot(): WheelNode[]`, `LAYER_GROUPS`, `LAYER_PRESETS`, `click(id)`.

- [ ] **Step 1: Write the failing test**

Create `src/components/map-wheel/menu-tree.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Layers } from "@/components/layers";
import { ITEM_CAPS, MAX_DEPTH } from "./geometry";
import { LAYER_GROUPS, menuRoot } from "./menu-tree";
import { childrenOf, nodeKind, type WheelNode } from "./types";

const walk = (nodes: WheelNode[], level = 0, out: Array<{ node: WheelNode; level: number }> = []) => {
  for (const node of nodes) {
    out.push({ node, level });
    walk(childrenOf(node), level + 1, out);
  }
  return out;
};

describe("menu root", () => {
  it("is the five global menus", () => {
    expect(menuRoot().map(n => n.label)).toEqual(["Layers", "Style", "Options", "Tools", "About"]);
  });
});

describe("geometry budget", () => {
  it("keeps every ring inside its level's item cap", () => {
    const check = (nodes: WheelNode[], level: number): void => {
      expect(nodes.length, `level ${level} ring of ${nodes.length}`).toBeLessThanOrEqual(ITEM_CAPS[level]);
      for (const node of nodes) {
        const kids = childrenOf(node);
        if (kids.length) check(kids, level + 1);
      }
    };
    check(menuRoot(), 0);
  });

  it("never nests deeper than the four rings the wheel has", () => {
    for (const { level } of walk(menuRoot())) expect(level).toBeLessThan(MAX_DEPTH);
  });
});

describe("node shape", () => {
  it("gives every node exactly one thing to do", () => {
    for (const { node } of walk(menuRoot())) {
      expect(nodeKind(node), `"${node.label}" does nothing`).not.toBe("inert");
    }
  });

  it("gives every node an icon", () => {
    for (const { node } of walk(menuRoot())) expect(node.icon).toMatch(/^icon-/);
  });
});

describe("layers branch", () => {
  const layers = () => menuRoot().find(n => n.label === "Layers")!;

  it("offers an escape hatch to the list UI, since order cannot be expressed radially", () => {
    expect(childrenOf(layers()).some(n => n.label.startsWith("Reorder"))).toBe(true);
  });

  it("covers every toggleable layer exactly once", () => {
    const toggles = walk(menuRoot())
      .map(({ node }) => node.toggle)
      .filter(Boolean);
    const expected = Layers.all.filter(l => !l.params.permanent).map(l => l.id);

    expect([...toggles].sort()).toEqual([...expected].sort());
  });

  it("never offers a permanent layer, which has no off state", () => {
    const permanent = new Set(Layers.all.filter(l => l.params.permanent).map(l => l.id));
    for (const group of LAYER_GROUPS) {
      for (const id of group.layers) expect(permanent.has(id)).toBe(false);
    }
  });

  it("names only registered layers", () => {
    for (const group of LAYER_GROUPS) {
      for (const id of group.layers) expect(Layers.has(id)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/menu-tree.test.ts`
Expected: FAIL — cannot resolve `./menu-tree`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/map-wheel/menu-tree.ts`. Style, Options and Tools are stubbed here and filled in by Tasks 7 and 8; the root must already list all five so the cap test is meaningful.

```ts
// The MENU channel. Pure data plus thunks — no geometry, no DOM building.
//
// Every leaf routes to something that already exists: a Controllers entry where there is one, and
// a click on the real top-bar button where there is not. The wheel is a second route in, never a
// second implementation.
import { type LayerId, Layers } from "@/components/layers";
import { findEl } from "@/utils/nodeUtils";
import type { WheelNode } from "./types";

/** Fire the app's own button. Optional chaining, so a build without it is a no-op, not a crash. */
export const click = (id: string) => () => findEl<HTMLButtonElement>(id)?.click();

const node = (label: string, icon: string, extra: Partial<WheelNode> = {}): WheelNode => ({
  label,
  icon,
  ...extra
});

// -- layers ------------------------------------------------------------------------------------
// 34 toggleable layers, grouped so no ring exceeds its cap. Order inside a group follows the
// registry's z-order, which is the order the Layers list shows.

export interface LayerGroup {
  label: string;
  icon: string;
  layers: LayerId[];
}

export const LAYER_GROUPS: LayerGroup[] = [
  { label: "Terrain", icon: "icon-mountain", layers: ["heightmap", "relief", "biomes", "rivers", "lakes", "coastline", "ice", "texture"] },
  { label: "Political", icon: "icon-flag", layers: ["states", "provinces", "borders", "burgIcons", "emblems", "military", "zones"] },
  { label: "Cultural", icon: "icon-users", layers: ["cultures", "religions", "labels", "markers"] },
  { label: "Economy", icon: "icon-exchange", layers: ["routes", "goods", "markets", "trade", "population", "journeys"] },
  { label: "Climate", icon: "icon-temperature-high", layers: ["temperature", "precipitation"] },
  { label: "Overlay", icon: "icon-sitemap", layers: ["grid", "coordinates", "compass", "scaleBar", "vignette", "cells", "rulers"] }
];

export const LAYER_PRESETS: Array<[string, string]> = [
  ["political", "Political"],
  ["cultural", "Cultural"],
  ["religions", "Religions"],
  ["provinces", "Provinces"],
  ["biomes", "Biomes"],
  ["heightmap", "Heightmap"],
  ["physical", "Physical"],
  ["poi", "Places"],
  ["goods", "Goods"],
  ["trade", "Trade"],
  ["military", "Military"],
  ["emblems", "Emblems"],
  ["landmass", "Landmass"]
];

const applyLayerPreset = (value: string) => () => {
  const select = findEl<HTMLSelectElement>("layersPreset");
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

/** "burgIcons" -> "Burg Icons", "scaleBar" -> "Scale Bar" */
const layerLabel = (id: string): string =>
  id.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

const layerToggle = (id: LayerId): WheelNode => node(layerLabel(id), "icon-eye", { toggle: id });

const openTab = (tabId: string) => () => {
  findEl("optionsTrigger")?.click();
  findEl(tabId)?.click();
};

const layersBranch = (): WheelNode =>
  node("Layers", "icon-layer-group", {
    children: [
      node("Presets", "icon-sliders", {
        children: LAYER_PRESETS.map(([value, label]) => node(label, "icon-map-o", { run: applyLayerPreset(value) }))
      }),
      ...LAYER_GROUPS.map(group =>
        node(group.label, group.icon, { children: () => group.layers.map(layerToggle) })
      ),
      // ordering is a drag position in #mapLayers - a linear gesture with no radial equivalent,
      // so hand off to the list rather than invent a worse one
      node("Reorder layers…", "icon-sort-alt-down", { run: openTab("layersTab") })
    ]
  });

export function menuRoot(): WheelNode[] {
  return [
    layersBranch(),
    node("Style", "icon-brush", { run: openTab("styleTab") }),
    node("Options", "icon-cog", { run: openTab("optionsTab") }),
    node("Tools", "icon-wrench", { run: openTab("toolsTab") }),
    node("About", "icon-info-circled", { run: openTab("aboutTab") })
  ];
}
```

- [ ] **Step 4: Verify every icon actually ships**

The `menu-tree.test.ts` assertion only checks the `icon-` prefix, so a typo would render a blank glyph rather than fail. Check the real font:

```bash
grep -oP '"\Kicon-[a-z0-9-]+' src/components/map-wheel/menu-tree.ts | sort -u |
  while read -r i; do grep -q "\.$i\b" public/icons.css || echo "MISSING $i"; done
```

Expected: no output. This fork ships 255 icons and does **not** have `icon-th`, `icon-water`, `icon-route`, `icon-list`, `icon-shield` or `icon-handshake-o`; substitute from what the command reports present.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/menu-tree.test.ts`
Expected: PASS. If "covers every toggleable layer exactly once" fails, the failure message lists the diff — add the missing id to the right group or remove the stray one. Do not relax the test.

- [ ] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/menu-tree.ts src/components/map-wheel/menu-tree.test.ts
git commit -m "feat(map-wheel): add layers branch of the menu tree"
```

---

### Task 7: Menu tree — Style, Options and About (drawer branches)

**Files:**
- Modify: `src/components/map-wheel/menu-tree.ts`
- Modify: `src/components/map-wheel/menu-tree.test.ts`

**Interfaces:**
- Consumes: Task 6 `menuRoot`, Task 2 `DrawerSpec`.
- Produces: `OPTION_GROUPS: Array<{label, icon, rows: string[]}>`, `STYLE_PRESETS: string[]`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/map-wheel/menu-tree.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { BOUND_BUTTON_IDS, OPTION_GROUPS, STYLE_PRESETS } from "./menu-tree";

const INDEX_HTML = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const hasId = (id: string) => INDEX_HTML.includes(`id="${id}"`);

describe("options branch", () => {
  const options = () => menuRoot().find(n => n.label === "Options")!;

  it("offers six themed drawers plus the non-form entries", () => {
    expect(childrenOf(options()).map(n => n.label)).toEqual([
      "World",
      "Realms",
      "Peoples",
      "Identity",
      "Interface",
      "Behaviour",
      "Units",
      "World configuration",
      "File",
      "Reset options"
    ]);
  });

  it("assigns all 26 setting rows exactly once across the six themes", () => {
    const rows = OPTION_GROUPS.flatMap(g => g.rows);
    expect(rows.length).toBe(26);
    expect(new Set(rows).size).toBe(26);
  });

  it("anchors every theme on controls that exist in index.html", () => {
    for (const group of OPTION_GROUPS) {
      for (const id of group.rows) expect(hasId(id), `${group.label} -> #${id}`).toBe(true);
    }
  });

  it("routes each theme to the options form rather than duplicating it", () => {
    for (const child of childrenOf(options()).slice(0, 6)) {
      expect(child.panel?.host).toBe("optionsContent");
      expect(child.panel?.only?.length).toBeGreaterThan(0);
    }
  });

  it("marks resetting options as destructive", () => {
    expect(childrenOf(options()).find(n => n.label === "Reset options")!.danger).toBe(true);
  });
});

describe("style branch", () => {
  const style = () => menuRoot().find(n => n.label === "Style")!;

  it("lists the style presets that actually ship", () => {
    expect(STYLE_PRESETS).toEqual([
      "ancient", "atlas", "clean", "cyberpunk", "darkSeas", "gloom",
      "light", "monochrome", "night", "pale", "watercolor"
    ]);
  });

  it("opens the real style form in the drawer", () => {
    expect(childrenOf(style()).find(n => n.label === "Style editor")!.panel?.host).toBe("styleContent");
  });
});

describe("about", () => {
  it("opens in the drawer rather than the tab", () => {
    expect(menuRoot().find(n => n.label === "About")!.panel?.host).toBe("aboutContent");
  });
});

describe("bindings", () => {
  it("resolves every button-backed leaf to an id present in index.html", () => {
    for (const id of BOUND_BUTTON_IDS) expect(hasId(id), `#${id}`).toBe(true);
  });
});
```

`BOUND_BUTTON_IDS` is exported by `menu-tree.ts` in Step 3 below; the test fails to import it until then, which is the point.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/menu-tree.test.ts`
Expected: FAIL — `OPTION_GROUPS` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/components/map-wheel/menu-tree.ts`, and replace the Style/Options/About stubs in `menuRoot()`:

```ts
// -- options -----------------------------------------------------------------------------------
// #optionsContent is flat: two headings over two tables of one-setting rows, with no section
// containers. So a theme is just a set of control ids; the drawer hides the rows outside it.
// Every row is claimed exactly once - a test enforces the partition, so it cannot silently rot.

export const OPTION_GROUPS = [
  { label: "World", icon: "icon-globe", rows: ["mapWidthInput", "pointsInput", "templateInput", "optionsSeed"] },
  { label: "Realms", icon: "icon-flag", rows: ["statesNumber", "provincesRatio", "sizeVariety", "growthRate", "manorsInput"] },
  { label: "Peoples", icon: "icon-users", rows: ["culturesInput", "culturesSet", "religionsNumber"] },
  { label: "Identity", icon: "icon-tag", rows: ["mapName", "yearInput", "emblemShape"] },
  { label: "Interface", icon: "icon-sliders", rows: ["uiSize", "tooltipSize", "themeHueInput", "transparencyInput", "azgaarAssistant"] },
  {
    label: "Behaviour",
    icon: "icon-cog-alt",
    rows: ["autosaveIntervalInput", "onloadBehavior", "speakerVoice", "zoomExtentMin", "shapeRendering", "resetLanguage"]
  }
] as const;

const FILE_ACTIONS: Array<[string, string, string]> = [
  ["New map", "icon-cw", "newMapButton"],
  ["Save", "icon-download", "saveButton"],
  ["Load", "icon-upload", "loadButton"],
  ["Export", "icon-export", "exportButton"]
];

/** Every top-bar button this tree clicks. Exported so a test can prove they all still exist. */
export const BOUND_BUTTON_IDS: string[] = [
  "layersPreset", "layersTab", "styleTab", "optionsTab", "toolsTab", "aboutTab", "optionsTrigger",
  "addStyleButton", "removeStyleButton", "stylePreset",
  "editUnitsButton", "configureWorld", "optionsReset",
  ...FILE_ACTIONS.map(([, , id]) => id)
];

const optionsBranch = (): WheelNode =>
  node("Options", "icon-cog", {
    children: [
      ...OPTION_GROUPS.map(group =>
        node(group.label, group.icon, {
          panel: { host: "optionsContent", title: group.label, only: [...group.rows] }
        })
      ),
      node("Units", "icon-ruler", { run: click("editUnitsButton") }),
      node("World configuration", "icon-globe-africa", { run: click("configureWorld") }),
      node("File", "icon-doc", {
        children: FILE_ACTIONS.map(([label, icon, id]) => node(label, icon, { run: click(id) }))
      }),
      node("Reset options", "icon-ccw", { danger: true, run: click("optionsReset") })
    ]
  });

// -- style -------------------------------------------------------------------------------------
// The prototype's Fonts / Colours / Filters do not exist as menus here: the Style tab is a live
// form over #styleElementSelect. So the form goes in the drawer and only the presets are sectors.

export const STYLE_PRESETS = [
  "ancient", "atlas", "clean", "cyberpunk", "darkSeas", "gloom",
  "light", "monochrome", "night", "pale", "watercolor"
];

const applyStylePreset = (value: string) => () => {
  const select = findEl<HTMLSelectElement>("stylePreset");
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
};

const title = (value: string): string => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());

const styleBranch = (): WheelNode =>
  node("Style", "icon-brush", {
    children: [
      node("Presets", "icon-paint-roller", {
        children: STYLE_PRESETS.map(preset => node(title(preset), "icon-adjust", { run: applyStylePreset(preset) }))
      }),
      node("Style editor", "icon-sliders", { panel: { host: "styleContent", title: "Style" } }),
      node("Save as preset", "icon-plus", { run: click("addStyleButton") }),
      node("Remove preset", "icon-trash-empty", { danger: true, run: click("removeStyleButton") })
    ]
  });
```

Then update `menuRoot()`:

```ts
export function menuRoot(): WheelNode[] {
  return [
    layersBranch(),
    styleBranch(),
    optionsBranch(),
    node("Tools", "icon-wrench", { run: openTab("toolsTab") }),
    node("About", "icon-info-circled", { panel: { host: "aboutContent", title: "About" } })
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/menu-tree.test.ts`
Expected: PASS. The 26-row partition test is the one to trust: if it fails, a row is claimed twice or not at all.

- [ ] **Step 5: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/menu-tree.ts src/components/map-wheel/menu-tree.test.ts
git commit -m "feat(map-wheel): add style, options and about drawer branches"
```

---

### Task 8: Menu tree — Tools branch

**Files:**
- Modify: `src/components/map-wheel/menu-tree.ts`
- Modify: `src/components/map-wheel/menu-tree.test.ts`

**Interfaces:**
- Consumes: Task 7 `BOUND_BUTTON_IDS`, `click`.
- Produces: `TOOL_EDITORS`, `TOOL_OVERVIEWS`, `TOOL_REGENERATE`, `TOOL_ADD`, `TOOL_MORE`.

- [ ] **Step 1: Write the failing test**

Append to `src/components/map-wheel/menu-tree.test.ts`:

```ts
import { TOOL_EDITORS, TOOL_OVERVIEWS, TOOL_REGENERATE } from "./menu-tree";

describe("tools branch", () => {
  const tools = () => menuRoot().find(n => n.label === "Tools")!;

  it("splits into five branches", () => {
    expect(childrenOf(tools()).map(n => n.label)).toEqual(["Edit", "Overview", "Add", "Regenerate", "More"]);
  });

  it("keeps the editor ring at the level-2 cap, not over it", () => {
    expect(TOOL_EDITORS.length).toBe(15);
    expect(TOOL_EDITORS.length).toBeLessThanOrEqual(ITEM_CAPS[2]);
  });

  it("keeps the heightmap editor under Edit, where the heightmap is actually edited", () => {
    expect(TOOL_EDITORS.some(([label]) => label === "Heightmap")).toBe(true);
  });

  it("holds all 19 regenerate commands, grouped so no single ring overflows", () => {
    expect(TOOL_REGENERATE.flatMap(g => g.items).length).toBe(19);
    for (const group of TOOL_REGENERATE) expect(group.items.length).toBeLessThanOrEqual(ITEM_CAPS[3]);
  });

  it("marks every regenerate command destructive", () => {
    const regenerate = childrenOf(tools()).find(n => n.label === "Regenerate")!;
    for (const group of childrenOf(regenerate)) {
      for (const item of childrenOf(group)) expect(item.danger, item.label).toBe(true);
    }
  });

  it("does not list Units, which now lives under Options", () => {
    expect(TOOL_EDITORS.some(([label]) => label === "Units")).toBe(false);
  });

  it("binds every tool to a button that exists", () => {
    for (const [, , id] of [...TOOL_EDITORS, ...TOOL_OVERVIEWS]) expect(hasId(id), `#${id}`).toBe(true);
    for (const group of TOOL_REGENERATE) {
      for (const [, , id] of group.items) expect(hasId(id), `#${id}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/menu-tree.test.ts`
Expected: FAIL — `TOOL_EDITORS` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `src/components/map-wheel/menu-tree.ts`:

```ts
// -- tools -------------------------------------------------------------------------------------
// [label, icon, button id]. Only Units moves out of the flat Tools grid (to Options), which puts
// Edit at exactly the 15-item cap for level 2.

type Tool = [string, string, string];

export const TOOL_EDITORS: Tool[] = [
  ["Biomes", "icon-tree", "editBiomesButton"],
  ["Coastlines", "icon-anchor", "editCoastlineSettings"],
  ["Cultures", "icon-users", "editCulturesButton"],
  ["Diplomacy", "icon-user-friends", "editDiplomacyButton"],
  ["Emblems", "icon-coa", "editEmblemButton"],
  ["Goods", "icon-store", "editGoods"],
  ["Heightmap", "icon-mountain", "editHeightmapButton"],
  ["Measurers", "icon-drafting-compass", "editMeasurersButton"],
  ["Namesbase", "icon-font", "editNamesBaseButton"],
  ["Notes", "icon-doc", "editNotesButton"],
  ["Provinces", "icon-map-o", "editProvincesButton"],
  ["Religions", "icon-book", "editReligions"],
  ["States", "icon-flag", "editStatesButton"],
  ["Trade", "icon-exchange", "editTradeAnimationButton"],
  ["Zones", "icon-map-signs", "editZonesButton"]
];

export const TOOL_OVERVIEWS: Tool[] = [
  ["Burgs", "icon-star", "overviewBurgsButton"],
  ["Markers", "icon-map-pin", "overviewMarkersButton"],
  ["Markets", "icon-store", "overviewMarketsButton"],
  ["Labels", "icon-font", "overviewLabelsButton"],
  ["Military", "icon-shield-alt", "overviewMilitaryButton"],
  ["Rivers", "icon-bezier-curve", "overviewRiversButton"],
  ["Routes", "icon-map-signs", "overviewRoutesButton"],
  ["Journeys", "icon-drafting-compass", "overviewJourneysButton"],
  ["Cells", "icon-target", "overviewCellsButton"],
  ["Charts", "icon-chart-pie", "overviewChartsButton"]
];

export const TOOL_ADD: Tool[] = [
  ["Burg", "icon-star", "addBurgTool"],
  ["Label", "icon-font", "addLabel"],
  ["Marker", "icon-map-pin", "addMarker"],
  ["River", "icon-bezier-curve", "addRiver"],
  ["Route", "icon-map-signs", "addRoute"]
];

export const TOOL_MORE: Tool[] = [
  ["Minimap", "icon-map", "openMinimapButton"],
  ["AI Chat", "icon-robot", "openAiChatButton"],
  ["Submap", "icon-resize-small", "openSubmapTool"],
  ["Transform", "icon-move", "openTransformTool"],
  ["Reset zoom", "icon-search", "zoomReset"]
];

// Regenerate sits a level deeper than its siblings. That is geometrically necessary at 19 items,
// and right on its own terms: these are the destructive commands, and depth is the cost.
export const TOOL_REGENERATE: Array<{ label: string; icon: string; items: Tool[] }> = [
  {
    label: "Terrain",
    icon: "icon-mountain",
    items: [
      ["Rivers", "icon-bezier-curve", "regenerateRivers"],
      ["Relief", "icon-tree", "regenerateReliefIcons"],
      ["Ice", "icon-temperature-low", "regenerateIce"],
      ["Zones", "icon-map-signs", "regenerateZones"]
    ]
  },
  {
    label: "Society",
    icon: "icon-users",
    items: [
      ["Cultures", "icon-users", "regenerateCultures"],
      ["Religions", "icon-book", "regenerateReligions"],
      ["States", "icon-flag", "regenerateStates"],
      ["Provinces", "icon-map-o", "regenerateProvinces"],
      ["Burgs", "icon-star", "regenerateBurgs"],
      ["State labels", "icon-font", "regenerateStateLabels"],
      ["Population", "icon-user-friends", "regeneratePopulation"],
      ["Military", "icon-shield-alt", "regenerateMilitary"],
      ["Emblems", "icon-coa", "regenerateEmblems"]
    ]
  },
  {
    label: "Economy",
    icon: "icon-exchange",
    items: [
      ["Economy", "icon-exchange", "regenerateEconomy"],
      ["Goods", "icon-store", "regenerateGoods"],
      ["Markets", "icon-bank", "regenerateMarkets"],
      ["Production", "icon-hammer", "regenerateProduction"],
      ["Routes", "icon-map-signs", "regenerateRoutes"],
      ["Markers", "icon-map-pin", "regenerateMarkers"]
    ]
  }
];

const toolNodes = (tools: Tool[], danger = false): WheelNode[] =>
  tools.map(([label, icon, id]) => node(label, icon, { danger: danger || undefined, run: click(id) }));

const toolsBranch = (): WheelNode =>
  node("Tools", "icon-wrench", {
    children: [
      node("Edit", "icon-edit", { children: toolNodes(TOOL_EDITORS) }),
      node("Overview", "icon-docs", { children: toolNodes(TOOL_OVERVIEWS) }),
      node("Add", "icon-plus", { children: toolNodes(TOOL_ADD) }),
      node("Regenerate", "icon-ccw", {
        danger: true,
        children: TOOL_REGENERATE.map(group =>
          node(group.label, group.icon, { danger: true, children: toolNodes(group.items, true) })
        )
      }),
      node("More", "icon-asterisk", { children: toolNodes(TOOL_MORE) })
    ]
  });
```

Add every tool id to `BOUND_BUTTON_IDS`:

```ts
export const BOUND_BUTTON_IDS: string[] = [
  // …existing entries…
  ...[...TOOL_EDITORS, ...TOOL_OVERVIEWS, ...TOOL_ADD, ...TOOL_MORE].map(([, , id]) => id),
  ...TOOL_REGENERATE.flatMap(group => group.items.map(([, , id]) => id))
];
```

Replace the Tools stub in `menuRoot()` with `toolsBranch()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/map-wheel/menu-tree.test.ts`
Expected: PASS. If "binds every tool to a button that exists" fails, the message names the id — correct the id, do not delete the assertion.

- [ ] **Step 5: Verify in the browser**

Wire the real tree in `src/components/map-wheel/index.ts` by replacing the stub in `onContextMenu`:

```ts
import { menuRoot } from "./menu-tree";
// …
openMapWheel(event, { menu: menuRoot, here: () => [] });
```

Restart `npx vite --port 5199`, right-click the map, drill `Layers → Political → Borders`.
Expected: the sector turns green, its note reads `on`/`off`, borders appear and disappear on the map, and the ring stays open.

- [ ] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/menu-tree.ts src/components/map-wheel/menu-tree.test.ts src/components/map-wheel/index.ts
git commit -m "feat(map-wheel): add tools branch and wire the menu channel"
```

---

### Task 9: Port the subject resolver and wire the HERE channel

**Files:**
- Create: `src/components/map-wheel/context.ts` (ported)
- Create: `src/components/map-wheel/here.ts`
- Modify: `src/components/map-wheel/index.ts`
- Test: `src/components/map-wheel/here.test.ts`

**Interfaces:**
- Consumes: `WheelSubject`/`WheelContext` from the port; Task 2 types.
- Produces: `hereRoot(ctx, subject): WheelNode[]`, `ICON_SUBSTITUTIONS`.

- [ ] **Step 1: Port the file**

```bash
git show upstream/map-wheel-concept:src/components/map-wheel/context.ts > src/components/map-wheel/context.ts
```

Five of the 29 icons it names do not exist in this fork's `public/icons.css`. Apply this substitution table — verified by `comm` against the shipped icon list:

| Upstream | This fork | Why |
| --- | --- | --- |
| `icon-list` | `icon-list-bullet` | the fork's own convention (`diplomacy-editor.ts`, `rivers-overview.ts`) |
| `icon-route` | `icon-map-signs` | already used for routes in `index.html` |
| `icon-water` | `icon-bezier-curve` | a winding line; the fork ships no water glyph |
| `icon-shield` | `icon-shield-alt` | the fork's shield |
| `icon-handshake-o` | `icon-user-friends` | diplomacy between parties |

```bash
sed -i 's/"icon-list"/"icon-list-bullet"/g; s/"icon-route"/"icon-map-signs"/g; s/"icon-water"/"icon-bezier-curve"/g; s/"icon-shield"/"icon-shield-alt"/g; s/"icon-handshake-o"/"icon-user-friends"/g' src/components/map-wheel/context.ts
```

- [ ] **Step 2: Make it compile**

Run: `npx tsc --noEmit`
Expected: errors, if any, are controller argument-shape mismatches. Fix each by reading the controller's actual `open()` signature in `src/controllers/`. Do not silence with `as any` — a wrong argument is a runtime failure the type system just caught.

Add the missing `icon-tree`/`icon-target` style checks by running:
`grep -oP 'icon: "\K[a-z0-9-]+' src/components/map-wheel/context.ts | sort -u | while read i; do grep -q "\.$i\b" public/icons.css || echo "MISSING $i"; done`
Expected: no output.

- [ ] **Step 3: Write the failing test**

Create `src/components/map-wheel/here.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { hereRoot } from "./here";
import { childrenOf } from "./types";
import type { WheelContext, WheelSubject } from "./context";

const action = (label: string) => ({ label, icon: "icon-star", verb: "open" as const, run: vi.fn() });

const subject = (name: string, count: number): WheelSubject => ({
  kind: "Burg",
  name,
  detail: "d",
  icon: "icon-star",
  rank: 1,
  actions: Array.from({ length: count }, (_, i) => action(`a${i}`))
});

const ctx = (subjects: WheelSubject[]): WheelContext => ({
  screen: [0, 0],
  map: [0, 0],
  cellId: 1,
  subjects
});

describe("hereRoot", () => {
  it("lists the subject's actions and a What's here sector", () => {
    const root = hereRoot(ctx([subject("Ashvale", 4)]), 0);
    expect(root.map(n => n.label)).toEqual(["a0", "a1", "a2", "a3", "What's here"]);
  });

  it("fills the root exactly when the subject has six actions", () => {
    const root = hereRoot(ctx([subject("Ashvale", 6)]), 0);
    expect(root.length).toBe(7);
    expect(root.at(-1)!.label).toBe("What's here");
  });

  it("folds the tail into More… rather than overflowing the seven-slot root", () => {
    const root = hereRoot(ctx([subject("Ashvale", 9)]), 0);
    expect(root.length).toBe(7);
    expect(root.map(n => n.label).slice(0, 5)).toEqual(["a0", "a1", "a2", "a3", "a4"]);
    expect(root[5].label).toBe("More…");
    expect(childrenOf(root[5]).map(n => n.label)).toEqual(["a5", "a6", "a7", "a8"]);
  });

  it("puts the whole subject stack behind What's here, each pickable", () => {
    const root = hereRoot(ctx([subject("Ashvale", 2), subject("Aldmere", 2)]), 0);
    const stack = childrenOf(root.at(-1)!);
    expect(stack.map(n => n.label)).toEqual(["Ashvale", "Aldmere"]);
    expect(stack.map(n => n.pick)).toEqual([0, 1]);
    expect(stack[0].note).toBe("Burg");
  });

  it("counts the stack in the What's here note", () => {
    const root = hereRoot(ctx([subject("A", 1), subject("B", 1), subject("C", 1)]), 0);
    expect(root.at(-1)!.note).toBe("3 here");
  });

  it("reads actions from the active subject, not always the first", () => {
    const first = subject("Ashvale", 2);
    const second = subject("Aldmere", 2);
    second.actions = [action("edit province")];
    expect(hereRoot(ctx([first, second]), 1)[0].label).toBe("edit province");
  });

  it("survives an empty subject stack", () => {
    expect(() => hereRoot(ctx([]), 0)).not.toThrow();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/here.test.ts`
Expected: FAIL — cannot resolve `./here`.

- [ ] **Step 5: Write minimal implementation**

Create `src/components/map-wheel/here.ts`:

```ts
// The HERE channel: the active subject's actions, plus a way back to everything else the click
// could have been about.
import { ITEM_CAPS } from "./geometry";
import type { WheelContext } from "./context";
import type { WheelNode } from "./types";

// one root slot is always the "What's here" sector, so the actions get the rest
const ACTION_SLOTS = ITEM_CAPS[0] - 1;

export function hereRoot(ctx: WheelContext, subject: number): WheelNode[] {
  const active = ctx.subjects[subject];
  const actions = active?.actions ?? [];

  const toNode = (action: (typeof actions)[number]): WheelNode => ({
    label: action.label,
    icon: action.icon,
    danger: /remove|delete/i.test(action.label) || undefined,
    run: action.run
  });

  // overflow folds into More… rather than squeezing the root past what its arc can hold
  const shown =
    actions.length > ACTION_SLOTS
      ? [
          ...actions.slice(0, ACTION_SLOTS - 1).map(toNode),
          { label: "More…", icon: "icon-asterisk", children: actions.slice(ACTION_SLOTS - 1).map(toNode) }
        ]
      : actions.map(toNode);

  return [
    ...shown,
    {
      label: "What's here",
      icon: "icon-target",
      note: `${ctx.subjects.length} here`,
      children: ctx.subjects.map((candidate, index) => ({
        label: candidate.name,
        icon: candidate.icon,
        note: candidate.kind,
        pick: index
      }))
    }
  ];
}
```

- [ ] **Step 6: Wire both channels in `index.ts`**

Replace `onContextMenu` and the callback stubs in `src/components/map-wheel/index.ts`:

```ts
import { closeDrawer, connectorLine, openDrawer, pickSide } from "./drawer";
import { resolveContext } from "./context";
import { hereRoot } from "./here";
import { menuRoot } from "./menu-tree";
import { Layers } from "@/components/layers";
```

`openMapWheel(event, roots)` keeps its signature — Task 4's tests call it with two arguments and must keep passing. The subject lives in the caller's closure, and a third optional argument reports a pick back to it:

```ts
export function openMapWheel(
  event: MouseEvent,
  roots: WheelRoots,
  onPickSubject?: (index: number) => void
): void {
  // …existing host/wheel setup, then:
  let state: WheelState = { mode: "here", path: [], hot: null };

  const draw = (): void =>
    renderWheel(wheel, roots, state, {
      onState: next => {
        if (next.path.length <= state.path.length) closeDrawer();
        state = next;
        draw();
      },
      onPanel: (spec, mid) => {
        const side = pickSide(mid, cx, window.innerWidth);
        openDrawer(host!, spec, side, () => {
          closeDrawer();
          state = { ...state, path: state.path.slice(0, -1) };
          draw();
        });
        drawConnector(wheel, mid, side);
      },
      onLeaf: node => {
        closeMapWheel();
        try {
          node.run?.();
        } catch (error) {
          console.error("map wheel action failed", error);
        }
      },
      onPick: index => {
        onPickSubject?.(index);
        state = { mode: "here", path: [], hot: null };
        draw();
      },
      onToggle: node => {
        Layers.toggle(node.toggle!);
        draw();
      }
    });
  draw();
}

function onContextMenu(event: MouseEvent): void {
  if (window.customization) return;
  if (!(event.target as Element | null)?.closest("#map")) return;

  const ctx = resolveContext(event);
  if (!ctx) return; // no map loaded, or the point is off it: let the browser menu through

  event.preventDefault();
  event.stopPropagation();

  let subject = 0;
  const roots: WheelRoots = { menu: menuRoot, here: () => hereRoot(ctx, subject) };
  openMapWheel(event, roots, index => {
    subject = index;
  });
}
```

Add the connector, which ties the drawer to the sector that opened it in the same language as a ring spine:

```ts
function drawConnector(wheel: HTMLElement, sectorMid: number, side: "left" | "right"): void {
  const svg = wheel.querySelector("svg.mw-svg");
  if (!svg) return;
  const { x1, y1, x2, y2 } = connectorLine(sectorMid, side);
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("class", "mw-spine mw-connector");
  for (const [key, value] of Object.entries({ x1, y1, x2, y2 })) line.setAttribute(key, value.toFixed(2));
  svg.append(line);
}
```

Import `connectorLine` alongside the other drawer exports. The renderer clears the SVG on every redraw, so `draw()` must re-add the connector while a drawer is open — track the open `{spec, mid, side}` in a `drawer` variable and call `drawConnector` at the end of `draw()` when it is set.

Add `closeDrawer()` to the top of `closeMapWheel()`, before `host.remove()`, so the borrowed element is always returned first. Also add:

```ts
document.addEventListener("visibilitychange", () => closeMapWheel());
```

inside `mount()` — a hidden tab must not leave app DOM stranded in the drawer.

- [ ] **Step 7: Run all tests**

Run: `npx vitest run src/components/map-wheel/`
Expected: PASS across all files.

- [ ] **Step 8: Verify in the browser**

`npx vite --port 5199`, right-click a burg.
Expected: the wheel opens on HERE with that burg's actions; `What's here` lists the stack (burg, province, state, culture, religion, biome, cell); picking Province reloads the ring with province actions; `MENU → Options → Realms` opens the drawer with exactly five rows; closing the wheel leaves the Options tab working normally.

- [ ] **Step 9: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/context.ts src/components/map-wheel/here.ts src/components/map-wheel/here.test.ts src/components/map-wheel/index.ts
git commit -m "feat(map-wheel): port subject resolver and wire the here channel"
```

---

### Task 10: Open animation and keyboard traversal

**Files:**
- Modify: `src/components/map-wheel/styles.ts`
- Modify: `src/components/map-wheel/wheel.ts`
- Test: `src/components/map-wheel/keyboard.test.ts`

**Interfaces:**
- Consumes: Task 3 `renderWheel`, `WheelState`.
- Produces: `handleKey(event, roots, state, cb): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/components/map-wheel/keyboard.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { handleKey } from "./wheel";
import type { WheelRoots, WheelState } from "./wheel";
import type { WheelNode } from "./types";

vi.mock("@/components/layers", () => ({ Layers: { isOn: () => false } }));

const leaf = (label: string, extra: Partial<WheelNode> = {}): WheelNode => ({ label, icon: "icon-star", ...extra });
const roots: WheelRoots = {
  menu: () => [leaf("A", { children: [leaf("A1", { run: () => {} })] }), leaf("B", { run: () => {} }), leaf("C", { run: () => {} })],
  here: () => []
};
const state = (over: Partial<WheelState> = {}): WheelState => ({ mode: "menu", path: [], hot: null, ...over });
const key = (k: string) => new KeyboardEvent("keydown", { key: k });

const spies = () => ({ onState: vi.fn(), onPanel: vi.fn(), onLeaf: vi.fn(), onPick: vi.fn(), onToggle: vi.fn() });

describe("handleKey", () => {
  it("starts at the first sector when nothing is hot", () => {
    const cb = spies();
    handleKey(key("ArrowRight"), roots, state(), cb);
    expect(cb.onState).toHaveBeenCalledWith(expect.objectContaining({ hot: { level: 0, index: 0 } }));
  });

  it("steps around the ring and wraps", () => {
    const cb = spies();
    handleKey(key("ArrowRight"), roots, state({ hot: { level: 0, index: 2 } }), cb);
    expect(cb.onState).toHaveBeenCalledWith(expect.objectContaining({ hot: { level: 0, index: 0 } }));

    const back = spies();
    handleKey(key("ArrowLeft"), roots, state({ hot: { level: 0, index: 0 } }), back);
    expect(back.onState).toHaveBeenCalledWith(expect.objectContaining({ hot: { level: 0, index: 2 } }));
  });

  it("drills outward into an open child ring", () => {
    const cb = spies();
    handleKey(key("ArrowDown"), roots, state({ path: [0], hot: { level: 0, index: 0 } }), cb);
    expect(cb.onState).toHaveBeenCalledWith(expect.objectContaining({ hot: { level: 1, index: 0 } }));
  });

  it("moves back inward toward the hub", () => {
    const cb = spies();
    handleKey(key("ArrowUp"), roots, state({ path: [0], hot: { level: 1, index: 0 } }), cb);
    expect(cb.onState).toHaveBeenCalledWith(expect.objectContaining({ hot: { level: 0, index: 0 } }));
  });

  it("commits the hot sector on Enter", () => {
    const cb = spies();
    handleKey(key("Enter"), roots, state({ hot: { level: 0, index: 1 } }), cb);
    expect(cb.onLeaf).toHaveBeenCalled();
  });

  it("reports whether it consumed the key so the caller knows to preventDefault", () => {
    expect(handleKey(key("ArrowRight"), roots, state(), spies())).toBe(true);
    expect(handleKey(key("q"), roots, state(), spies())).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/map-wheel/keyboard.test.ts`
Expected: FAIL — `handleKey` is not exported.

- [ ] **Step 3: Add keyboard traversal to `wheel.ts`**

Export the click dispatcher so keyboard and mouse share one path, then append:

```ts
/** Arrow keys walk the rings; the wheel is a set of nested lists. Returns true if the key was ours. */
export function handleKey(
  event: KeyboardEvent,
  roots: WheelRoots,
  state: WheelState,
  cb: WheelCallbacks
): boolean {
  const levels = resolveLevels(roots, state);
  const level = state.hot?.level ?? 0;
  const ring = levels[level];
  if (!ring) return false;

  const move = (index: number) => cb.onState({ ...state, hot: { level, index } });
  const current = state.hot?.index ?? -1;

  switch (event.key) {
    case "ArrowRight": {
      move(current < 0 ? 0 : (current + 1) % ring.items.length);
      return true;
    }
    case "ArrowLeft": {
      move(current < 0 ? 0 : (current - 1 + ring.items.length) % ring.items.length);
      return true;
    }
    case "ArrowDown": {
      const next = levels[level + 1];
      if (!next) return false;
      cb.onState({ ...state, hot: { level: level + 1, index: 0 } });
      return true;
    }
    case "ArrowUp": {
      if (level === 0) return false;
      cb.onState({ ...state, hot: { level: level - 1, index: state.path[level - 1] ?? 0 } });
      return true;
    }
    case "Enter": {
      if (current < 0) return false;
      const node = ring.items[current];
      if (nodeKind(node) === "run") cb.onLeaf(node);
      else if (nodeKind(node) === "toggle") cb.onToggle(node);
      else cb.onState({ ...state, path: [...state.path.slice(0, level), current], hot: null });
      return true;
    }
    default:
      return false;
  }
}
```

Wire it in `index.ts`. `onKeyDown` is a module-level listener but the state lives in `openMapWheel`'s closure, so expose one handler slot rather than three separate variables:

```ts
// set by openMapWheel, cleared by closeMapWheel; a stale wheel must never keep answering keys
let keyHandler: ((event: KeyboardEvent) => boolean) | null = null;

function onKeyDown(event: KeyboardEvent): void {
  if (keyHandler?.(event)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (event.key !== "Escape") return;
  event.stopPropagation();
  closeMapWheel();
}
```

At the end of `openMapWheel`, after `draw()`:

```ts
keyHandler = event => handleKey(event, roots, state, callbacks);
```

which means the callbacks object must be hoisted out of the `renderWheel` call into a `const callbacks: WheelCallbacks = {…}` that `draw()` passes in. In `closeMapWheel`, add `keyHandler = null;` next to the listener removals.

- [ ] **Step 4: Add the open animation**

Append to `WHEEL_CSS` in `styles.ts`:

```css
@keyframes mw-fan {
  from { opacity: 0; transform: scale(.86); }
  to   { opacity: 1; transform: none; }
}

#mapWheel .mw-svg { animation: mw-fan 140ms ease-out both; transform-origin: center; }

@keyframes mw-slide-right {
  from { opacity: 0; transform: translateY(-50%) translateX(-16px); }
  to   { opacity: 1; transform: translateY(-50%); }
}
@keyframes mw-slide-left {
  from { opacity: 0; transform: translateY(-50%) translateX(16px); }
  to   { opacity: 1; transform: translateY(-50%); }
}
#mapWheelDrawer[data-side="right"] { animation: mw-slide-right 140ms ease-out both; }
#mapWheelDrawer[data-side="left"] { animation: mw-slide-left 140ms ease-out both; }

@media (prefers-reduced-motion: reduce) {
  #mapWheel .mw-svg,
  #mapWheelDrawer { animation: none; }
}
```

- [ ] **Step 5: Run all tests**

Run: `npx vitest run src/components/map-wheel/`
Expected: PASS.

- [ ] **Step 6: Typecheck, format, commit**

```bash
npx tsc --noEmit && npx biome check --write src/components/map-wheel/
git add src/components/map-wheel/wheel.ts src/components/map-wheel/keyboard.test.ts src/components/map-wheel/styles.ts src/components/map-wheel/index.ts
git commit -m "feat(map-wheel): add keyboard traversal and open animation"
```

---

### Task 11: Browser tests

Unit tests prove the parts; only a browser proves the wheel actually toggles a layer and gives the Options form back.

**Files:**
- Create: `tests/e2e/map-wheel.spec.ts`

**Interfaces:**
- Consumes: the whole module.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec**

Create `tests/e2e/map-wheel.spec.ts`:

```ts
import { Browser, BrowserContext, expect, Page, test } from "@playwright/test";

let context: BrowserContext;
let page: Page;

const openWheel = async (x = 640, y = 380) => {
  await page.mouse.click(x, y, { button: "right" });
  await expect(page.locator("#mapWheel")).toBeAttached();
};

const sector = (label: string) =>
  page.locator("#mapWheel .mw-label", { hasText: new RegExp(`^${label}`) });

// clicking a sector means clicking its path, not its label - labels are pointer-events: none
const clickSector = async (label: string) => {
  const index = await sector(label).evaluate(el => [...el.parentElement!.children].indexOf(el));
  await page.locator("#mapWheel path.mw-sector").nth(index).click();
};

test.describe("map wheel", () => {
  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await page.goto("/?seed=test-seed&width=1280&height=720");
    await page.waitForFunction(() => (window as any).mapId !== undefined, { timeout: 60000 });
    await page.waitForTimeout(500);
  });

  test.afterAll(async () => {
    await page.close();
    await context.close();
  });

  test.afterEach(async () => {
    await page.keyboard.press("Escape");
  });

  test("opens on right-click and closes on Escape", async () => {
    await openWheel();
    await page.keyboard.press("Escape");
    await expect(page.locator("#mapWheel")).toHaveCount(0);
  });

  test("closes on an outside click", async () => {
    await openWheel();
    await page.mouse.click(20, 20);
    await expect(page.locator("#mapWheel")).toHaveCount(0);
  });

  test("renders every label with a resolved icon glyph", async () => {
    await openWheel();
    await clickSector("MENU");
    const blank = await page.locator("#mapWheel .mw-label i").evaluateAll(nodes =>
      nodes.filter(n => getComputedStyle(n, "::before").content === "none").length
    );
    expect(blank).toBe(0);
  });

  test("toggles a real layer in place without closing the ring", async () => {
    await openWheel();
    await page.locator("#mapWheel .mw-tab", { hasText: "menu" }).click();
    await clickSector("Layers");
    await clickSector("Political");

    const before = await page.evaluate(() => (window as any).Layers.isOn("borders"));
    await clickSector("Borders");
    const after = await page.evaluate(() => (window as any).Layers.isOn("borders"));

    expect(after).toBe(!before);
    await expect(page.locator("#mapWheel")).toBeAttached();
  });

  test("fans a ring per level with a spine between each", async () => {
    await openWheel();
    await page.locator("#mapWheel .mw-tab", { hasText: "menu" }).click();
    await clickSector("Tools");
    await clickSector("Regenerate");
    await clickSector("Society");
    await expect(page.locator("#mapWheel line.mw-spine")).toHaveCount(3);
  });

  test("opens the options form in the drawer and gives it back on close", async () => {
    await openWheel();
    await page.locator("#mapWheel .mw-tab", { hasText: "menu" }).click();
    await clickSector("Options");
    await clickSector("Realms");

    await expect(page.locator("#mapWheelDrawer #optionsContent")).toBeAttached();
    const visible = await page
      .locator("#optionsContent tr")
      .evaluateAll(rows => rows.filter(r => !(r as HTMLElement).hidden).length);
    expect(visible).toBe(5);

    await page.keyboard.press("Escape");
    await expect(page.locator("#options > #optionsContent")).toBeAttached();
    const restored = await page
      .locator("#optionsContent tr")
      .evaluateAll(rows => rows.filter(r => (r as HTMLElement).hidden).length);
    expect(restored).toBe(0);
  });

  test("keeps the whole wheel on screen when opened in a corner", async () => {
    await page.mouse.click(6, 6, { button: "right" });
    const box = await page.locator("#mapWheel .mw-wheel").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
  });

  test("stays out of the way during heightmap customization", async () => {
    await page.evaluate(() => ((window as any).customization = 1));
    await page.mouse.click(640, 380, { button: "right" });
    await expect(page.locator("#mapWheel")).toHaveCount(0);
    await page.evaluate(() => ((window as any).customization = 0));
  });
});
```

- [ ] **Step 2: Run the spec**

The Playwright config reuses an existing dev server on 5173, which belongs to the user's own session. Start your own and point at it:

```bash
npx vite --port 5199 &
CHROMIUM_PATH=$(which chromium) npx playwright test tests/e2e/map-wheel.spec.ts --config=<(sed 's/5173/5199/g' playwright.config.ts)
```

If the inline config substitution is awkward, instead run `PLAYWRIGHT_BASE_URL` style by temporarily exporting `CI=` and using the existing 5173 server **only if the user confirms it is free** — check first with `ss -ltnp | grep 5173` and `pgrep -af vite`.

Expected: 8 passing tests.

- [ ] **Step 3: Kill the probe server**

```bash
pkill -f "vite --port 5199"
ss -ltnp | grep 5199 || echo "port clear"
```

- [ ] **Step 4: Full suite and commit**

```bash
npx vitest run && npx tsc --noEmit && npx biome check --write src/components/map-wheel/ tests/e2e/map-wheel.spec.ts
git add tests/e2e/map-wheel.spec.ts
git commit -m "test(map-wheel): add browser coverage for wheel, layers and drawer"
```

---

## Done criteria

- `npx vitest run` passes with no new failures against the pre-existing baseline.
- `npx tsc --noEmit` is clean.
- `npx biome check` is clean, and `npx @biomejs/biome@latest ci src/components/map-wheel/` agrees.
- `git diff --stat origin/main` shows one changed pre-existing file (`src/components/index.ts`, one line) and the new `src/components/map-wheel/` directory plus one e2e spec.
- Right-clicking the map opens the wheel; the top bar, left-click editing and the Options tab all behave exactly as before.
