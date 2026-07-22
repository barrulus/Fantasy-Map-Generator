# Unified Label Planner — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the per-tier table, the style reader, and the sizing rule into shared pure modules, and make both the SVG and WebGL burg-label painters consume them — so capitals stop being culled by font size, `MIN_ZOOM` stops being triplicated, and the two renderers stop disagreeing about label size.

**Architecture:** Three new modules under `src/renderers/labeling/`. `tier-table.ts` holds every per-tier constant. `label-sizing.ts` implements `px = clamp(d·scale, floor, ceil)` and never culls. `label-style.ts` reads the group `<g>` shells into a `GroupStyle`. `label-visibility.ts` is rewritten to gate only on min-zoom and to work from em-relative extents. The WebGL painter and `public/main.js` both call into these.

**Tech Stack:** TypeScript, vitest (jsdom environment), WebGL2, d3-quadtree, plain-JS `public/main.js` consuming TS via `window` globals.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-22-label-icon-unified-planner-design.md`. Background: `docs/superpowers/specs/2026-07-21-label-icon-rendering-architecture.md` (referred to as "the brief").
- **Size never culls.** `min-zoom` is the only tier gate. A clamp bounds legibility. Never reintroduce a `px < MIN_PX → drop` test.
- Group `<g>` shells stay the style carrier. Do not change the Style editor, save/load, or the shell attribute names.
- `public/main.js` is a classic script, not a module. It reaches TS only through `window` globals.
- The authored per-group size is **`data-size`**, not `font-size`. When `rescaleLabels` is on, `font-size` is overwritten every zoom and is not the authored value.
- No AI attribution or `Co-Authored-By` lines in commit messages.
- The pre-commit hook runs `biome check --write`, which dirties the tree mid-commit. Every commit step therefore runs biome first, adds explicit paths, and commits with `--no-verify`. Never use `git add -A` or `git commit -am` — the working tree contains unrelated user WIP.
- Run tests with `npx vitest run <path>`. Typecheck with `npx tsc --noEmit`.

## File Structure

| Path | Responsibility |
|---|---|
| `src/renderers/labeling/tier-table.ts` | **Create.** Every per-tier constant: rank, min-zoom, size floor, size ceiling. |
| `src/renderers/labeling/tier-table.test.ts` | **Create.** |
| `src/renderers/labeling/label-sizing.ts` | **Create.** The clamp, the SVG attribute conversion, the ceiling invariant check, and the `window` bridge for `main.js`. |
| `src/renderers/labeling/label-sizing.test.ts` | **Create.** |
| `src/renderers/labeling/label-style.ts` | **Create.** Reads `#burgLabels > g` shells into `GroupStyle`. The only DOM-touching module here. |
| `src/renderers/labeling/label-style.test.ts` | **Create.** |
| `src/renderers/label-visibility.ts` | **Rewrite.** Min-zoom gate + collision only. Em-relative extents. Returns `{id, px}`. |
| `src/renderers/label-visibility.test.ts` | **Rewrite.** |
| `src/renderers/webgl-burg-labels.ts` | **Modify.** Delete `readGroupStyles`, consume the shared modules, lay out at the clamped size. |
| `src/renderers/webgl-burg-icons.ts:76-99` | **Modify.** Delete the local `MIN_ZOOM`; import from `tier-table`. |
| `public/main.js:664-712` | **Modify.** Delete `BURG_MIN_ZOOM`; use the clamp for burg labels. |
| `src/types/global.ts` | **Modify.** Declare the new `window` globals. |

Phase 1 deliberately leaves the GL shader in map-space: the painter converts the clamped px back to map units (`px / scale`) before calling `layoutLabel`. The move to screen-space quads is Phase 2, and doing it here would drag the shader, the instance packing, and the hit-test index into a task set that is already touching both renderers.

---

### Task 1: Tier table

Single source for every per-tier constant, replacing three duplicated `MIN_ZOOM` tables (brief §8.2).

**Files:**
- Create: `src/renderers/labeling/tier-table.ts`
- Test: `src/renderers/labeling/tier-table.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `groupRank(group: string): number`, `groupMinZoom(group: string): number`, `groupFloorPx(group: string): number`, `groupCeilPx(group: string): number`, and the raw records `GROUP_RANK`, `MIN_ZOOM`, `FLOOR_PX`, `CEIL_PX`.

- [ ] **Step 1: Write the failing test**

Create `src/renderers/labeling/tier-table.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupCeilPx, groupFloorPx, groupMinZoom, groupRank } from "./tier-table";

describe("groupRank", () => {
  it("ranks settlement tiers by importance (lower rank = higher priority)", () => {
    expect(groupRank("capital")).toBeLessThan(groupRank("city"));
    expect(groupRank("city")).toBeLessThan(groupRank("town"));
    expect(groupRank("town")).toBeLessThan(groupRank("village"));
    expect(groupRank("village")).toBeLessThan(groupRank("hamlet"));
  });

  it("ranks unknown groups below every known tier", () => {
    expect(groupRank("nonsense")).toBeGreaterThan(groupRank("hamlet"));
  });
});

describe("groupMinZoom", () => {
  it("matches the tier gates the SVG and GL paths used separately", () => {
    expect(groupMinZoom("capital")).toBe(1);
    expect(groupMinZoom("city")).toBe(4);
    expect(groupMinZoom("town")).toBe(6);
    expect(groupMinZoom("village")).toBe(10);
    expect(groupMinZoom("hamlet")).toBe(14);
  });

  it("lets unknown groups show at any zoom", () => {
    expect(groupMinZoom("nonsense")).toBe(0);
  });
});

describe("size floors and ceilings", () => {
  it("gives more important tiers a higher legibility floor", () => {
    expect(groupFloorPx("capital")).toBeGreaterThan(groupFloorPx("city"));
    expect(groupFloorPx("city")).toBeGreaterThan(groupFloorPx("town"));
    expect(groupFloorPx("village")).toBeGreaterThan(groupFloorPx("hamlet"));
  });

  it("gives more important tiers a higher ceiling", () => {
    expect(groupCeilPx("capital")).toBeGreaterThan(groupCeilPx("city"));
    expect(groupCeilPx("city")).toBeGreaterThan(groupCeilPx("hamlet"));
  });

  it("always leaves room to grow between floor and ceiling", () => {
    for (const g of ["capital", "city", "town", "village", "hamlet", "fort", "nonsense"])
      expect(groupCeilPx(g)).toBeGreaterThan(groupFloorPx(g));
  });

  it("falls back to the smallest tier's bounds for unknown groups", () => {
    expect(groupFloorPx("nonsense")).toBe(6);
    expect(groupCeilPx("nonsense")).toBe(56);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/labeling/tier-table.test.ts`
Expected: FAIL — `Failed to resolve import "./tier-table"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderers/labeling/tier-table.ts`:

```ts
/**
 * Single source of truth for per-tier burg label/icon behaviour.
 *
 * Before this module the min-zoom table existed in three places (public/main.js BURG_MIN_ZOOM,
 * webgl-burg-labels.ts, webgl-burg-icons.ts) which had to be hand-synced. Everything per-tier
 * lives here now; nothing else may declare a tier constant.
 */

/**
 * Collision priority per burg group, lower = placed first = wins overlaps.
 *
 * This must NOT be derived from the label groups' DOM order: that order is SVG *paint* order
 * (least important first, so capitals paint on top), i.e. the exact inverse of priority.
 */
export const GROUP_RANK: Record<string, number> = {
  capital: 0,
  "skyburg-capital": 1,
  city: 2,
  skyburg: 3,
  town: 4,
  "skyburg-mid": 5,
  fort: 6,
  monastery: 7,
  caravanserai: 8,
  trading_post: 9,
  "skyburg-small": 10,
  village: 11,
  hamlet: 12
};
const UNKNOWN_RANK = 99; // unknown/legacy groups rank below every known tier

export function groupRank(group: string): number {
  return GROUP_RANK[group] ?? UNKNOWN_RANK;
}

/**
 * Zoom at which a tier becomes eligible. This is the ONLY mechanism that removes a label for
 * being unimportant — size never culls (see label-sizing.ts).
 */
export const MIN_ZOOM: Record<string, number> = {
  capital: 1,
  "skyburg-capital": 2,
  skyburg: 4,
  "skyburg-mid": 6,
  "skyburg-small": 8,
  city: 4,
  town: 6,
  fort: 7,
  monastery: 7,
  caravanserai: 7,
  trading_post: 7,
  village: 10,
  hamlet: 14
};

export function groupMinZoom(group: string): number {
  return MIN_ZOOM[group] ?? 0;
}

const DEFAULT_FLOOR_PX = 6;
const DEFAULT_CEIL_PX = 56;

/**
 * Legibility floor: a label of this tier is never drawn smaller than this on screen.
 *
 * In practice this only bites for capitals, the one tier whose min-zoom is 1 and which therefore
 * enters at its natural size rather than several times it. That narrow blast radius is deliberate.
 */
export const FLOOR_PX: Record<string, number> = {
  capital: 11,
  "skyburg-capital": 11,
  city: 10,
  skyburg: 10,
  town: 9,
  "skyburg-mid": 9,
  fort: 8,
  monastery: 8,
  caravanserai: 8,
  trading_post: 8,
  "skyburg-small": 8,
  village: 7,
  hamlet: 6
};

export function groupFloorPx(group: string): number {
  return FLOOR_PX[group] ?? DEFAULT_FLOOR_PX;
}

/**
 * Growth ceiling: a label stops growing here rather than being culled. The old GROUP_MAX_PX
 * values (capital 240) were cull thresholds with headroom, not real ceilings, so they are retuned.
 * Each must stay above the tier's natural size at its own min-zoom or the tier is born clamped —
 * see entryPxExceedsCeiling in label-sizing.ts.
 */
export const CEIL_PX: Record<string, number> = {
  capital: 96,
  "skyburg-capital": 96,
  city: 80,
  skyburg: 80,
  town: 72,
  "skyburg-mid": 72,
  fort: 64,
  monastery: 64,
  caravanserai: 64,
  trading_post: 64,
  "skyburg-small": 64,
  village: 64,
  hamlet: 56
};

export function groupCeilPx(group: string): number {
  return CEIL_PX[group] ?? DEFAULT_CEIL_PX;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/labeling/tier-table.test.ts`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/renderers/labeling/tier-table.ts src/renderers/labeling/tier-table.test.ts
git add src/renderers/labeling/tier-table.ts src/renderers/labeling/tier-table.test.ts
git commit --no-verify -m "feat(labels): add shared tier table for rank, min-zoom and size bounds"
```

---

### Task 2: Sizing clamp

Implements `px = clamp(d·scale, floor, ceil)` and the SVG attribute conversion. Also exposes both to `public/main.js` via `window`.

**Files:**
- Create: `src/renderers/labeling/label-sizing.ts`
- Test: `src/renderers/labeling/label-sizing.test.ts`

**Interfaces:**
- Consumes: `groupCeilPx`, `groupFloorPx`, `groupMinZoom` from `./tier-table`.
- Produces: `effectiveLabelPx(d, scale, floorPx, ceilPx): number`, `effectiveLabelPxForGroup(group, d, scale): number`, `svgLabelFontSize(px, scale): number`, `entryPxExceedsCeiling(group, d): boolean`. Also sets `window.effectiveLabelPx`, `window.svgLabelFontSize`, and `window.labelTiers = {groupRank, groupMinZoom, groupFloorPx, groupCeilPx}`.

- [ ] **Step 1: Write the failing test**

Create `src/renderers/labeling/label-sizing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  effectiveLabelPx,
  effectiveLabelPxForGroup,
  entryPxExceedsCeiling,
  svgLabelFontSize
} from "./label-sizing";
import { CEIL_PX, MIN_ZOOM } from "./tier-table";

describe("effectiveLabelPx", () => {
  it("grows with the map between the floor and the ceiling", () => {
    expect(effectiveLabelPx(4, 5, 6, 60)).toBe(20);
  });

  it("raises a label to the floor instead of dropping it", () => {
    expect(effectiveLabelPx(4, 1, 6, 60)).toBe(6);
  });

  it("stops growing at the ceiling instead of dropping it", () => {
    expect(effectiveLabelPx(4, 100, 6, 60)).toBe(60);
  });

  it("never returns a size that signals a cull", () => {
    for (const scale of [0.1, 1, 10, 1000]) expect(effectiveLabelPx(2.49, scale, 11, 96)).toBeGreaterThan(0);
  });
});

describe("effectiveLabelPxForGroup", () => {
  // Regression: Nomia's preset sets the capital font to 2.49 map units. Under the old
  // `px = d*scale < 6 -> cull` rule capitals were invisible below scale 2.41 even though
  // MIN_ZOOM.capital is 1. See the brief section 7.
  it("keeps a small-font capital legible at scale 1", () => {
    expect(effectiveLabelPxForGroup("capital", 2.49, 1)).toBe(11);
  });

  it("hands back to natural growth once the capital outgrows its floor", () => {
    expect(effectiveLabelPxForGroup("capital", 2.49, 10)).toBeCloseTo(24.9, 5);
  });

  it("leaves the default preset's capital unclamped once zoomed in", () => {
    expect(effectiveLabelPxForGroup("capital", 4.98, 5)).toBeCloseTo(24.9, 5);
  });
});

describe("svgLabelFontSize", () => {
  // SVG <text> lives inside the zoom-transformed #viewbox, so rendered size is attr * scale.
  it("returns the attribute that renders at the requested on-screen size", () => {
    const px = 24;
    const scale = 3;
    expect(svgLabelFontSize(px, scale) * scale).toBeCloseTo(px, 10);
  });

  it("is the authored size when the label is inside its band", () => {
    const d = 4;
    const scale = 5;
    expect(svgLabelFontSize(effectiveLabelPx(d, scale, 6, 60), scale)).toBeCloseTo(d, 10);
  });

  it("survives a zero scale without dividing by zero", () => {
    expect(Number.isFinite(svgLabelFontSize(12, 0))).toBe(true);
  });
});

describe("entryPxExceedsCeiling", () => {
  it("flags a tier whose ceiling is below its own entry size", () => {
    // hamlet enters at scale 14; a 5 map-unit font enters at 70px, above the 56px ceiling
    expect(entryPxExceedsCeiling("hamlet", 5)).toBe(true);
  });

  // Spec invariant: ceil(tier) > d * minZoom(tier), else the tier is born clamped and never scales.
  it("holds for every tier on the default preset's font sizes", () => {
    const defaultPreset: Record<string, number> = {
      capital: 4.98,
      city: 4.15,
      town: 3.32,
      village: 2.49,
      hamlet: 1.66
    };
    for (const [group, d] of Object.entries(defaultPreset)) {
      expect(entryPxExceedsCeiling(group, d)).toBe(false);
      expect(CEIL_PX[group]).toBeGreaterThan(d * MIN_ZOOM[group]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/labeling/label-sizing.test.ts`
Expected: FAIL — `Failed to resolve import "./label-sizing"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderers/labeling/label-sizing.ts`:

```ts
import { groupCeilPx, groupFloorPx, groupMinZoom, groupRank } from "./tier-table";

/**
 * On-screen font size for a label, in CSS px: map-space growth bounded by the tier's legibility
 * floor and growth ceiling.
 *
 * This function NEVER signals "cull". Size used to be a second, tier-blind culling mechanism that
 * overruled min-zoom: a capital with a small preset font died to the 6px band before it ever
 * reached the collision pass it would have won. Min-zoom decides whether a label shows; this
 * decides only how big it is.
 */
export function effectiveLabelPx(d: number, scale: number, floorPx: number, ceilPx: number): number {
  const natural = d * scale;
  if (!(natural > floorPx)) return floorPx; // also catches NaN
  if (natural > ceilPx) return ceilPx;
  return natural;
}

export function effectiveLabelPxForGroup(group: string, d: number, scale: number): number {
  return effectiveLabelPx(d, scale, groupFloorPx(group), groupCeilPx(group));
}

/**
 * The `font-size` attribute that renders at `px` on screen. SVG <text> sits inside the
 * zoom-transformed #viewbox, so rendered size is attribute * scale.
 */
export function svgLabelFontSize(px: number, scale: number): number {
  return scale > 0 ? px / scale : px;
}

/**
 * True when a tier's ceiling is below its natural size at its own min-zoom, i.e. the tier is born
 * already clamped and never scales at all. Preset-dependent, so it is a runtime check rather than
 * a static guarantee.
 */
export function entryPxExceedsCeiling(group: string, d: number): boolean {
  return d * groupMinZoom(group) > groupCeilPx(group);
}

// public/main.js is a classic script and can only reach TS through globals.
if (typeof window !== "undefined") {
  Object.assign(window, {
    effectiveLabelPx,
    svgLabelFontSize,
    labelTiers: { groupRank, groupMinZoom, groupFloorPx, groupCeilPx }
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/labeling/label-sizing.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/renderers/labeling/label-sizing.ts src/renderers/labeling/label-sizing.test.ts
git add src/renderers/labeling/label-sizing.ts src/renderers/labeling/label-sizing.test.ts
git commit --no-verify -m "feat(labels): add per-tier size clamp that never culls"
```

---

### Task 3: Shared style reader

Moves `readGroupStyles` out of the GL renderer so both painters read the shells the same way, and honours the `data-min-zoom` override for both at once (brief §8.4).

**Files:**
- Create: `src/renderers/labeling/label-style.ts`
- Test: `src/renderers/labeling/label-style.test.ts`

**Interfaces:**
- Consumes: `groupCeilPx`, `groupFloorPx`, `groupMinZoom`, `groupRank` from `./tier-table`.
- Produces: `interface GroupStyle`, `readBurgLabelStyles(root?: ParentNode): Record<string, GroupStyle>`.

- [ ] **Step 1: Write the failing test**

Create `src/renderers/labeling/label-style.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { readBurgLabelStyles } from "./label-style";

function shell(id: string, attrs: Record<string, string>): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<g id="${id}" ${a}></g>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

function mount(inner: string): void {
  document.body.innerHTML = `<svg><g id="burgLabels">${inner}</g></svg>`;
}

describe("readBurgLabelStyles", () => {
  it("reads the authored size from data-size, not the live font-size", () => {
    // font-size is overwritten on every zoom when rescaleLabels is on; data-size is the authored value
    mount(shell("capital", { "data-size": "4.98", "font-size": "1.2" }));
    expect(readBurgLabelStyles().capital.fontSize).toBeCloseTo(4.98, 5);
  });

  it("falls back to the font-size attribute when data-size is absent", () => {
    mount(shell("capital", { "font-size": "3.5" }));
    expect(readBurgLabelStyles().capital.fontSize).toBeCloseTo(3.5, 5);
  });

  it("takes rank, min-zoom and size bounds from the tier table", () => {
    mount(shell("capital", { "data-size": "4" }) + shell("hamlet", { "data-size": "1" }));
    const s = readBurgLabelStyles();
    expect(s.capital.rank).toBeLessThan(s.hamlet.rank);
    expect(s.capital.minZoom).toBe(1);
    expect(s.hamlet.minZoom).toBe(14);
    expect(s.capital.floorPx).toBeGreaterThan(s.hamlet.floorPx);
  });

  it("honours a data-min-zoom override", () => {
    mount(shell("capital", { "data-size": "4", "data-min-zoom": "7" }));
    expect(readBurgLabelStyles().capital.minZoom).toBe(7);
  });

  it("reads fill and halo, and disables the halo when no stroke is set", () => {
    mount(
      shell("capital", { "data-size": "4", fill: "#112233", stroke: "#ffffff", "stroke-width": "2" }) +
        shell("hamlet", { "data-size": "1", fill: "#445566" })
    );
    const s = readBurgLabelStyles();
    expect(s.capital.fill).toBe("#112233");
    expect(s.capital.halo).toBe("#ffffff");
    expect(s.capital.haloWidth).toBe(2);
    expect(s.hamlet.haloWidth).toBe(0);
  });

  it("records a display:none group as hidden", () => {
    mount(shell("capital", { "data-size": "4", style: "display:none" }) + shell("hamlet", { "data-size": "1" }));
    const s = readBurgLabelStyles();
    expect(s.capital.hidden).toBe(true);
    expect(s.hamlet.hidden).toBe(false);
  });

  it("returns an empty map when there are no shells", () => {
    mount("");
    expect(readBurgLabelStyles()).toEqual({});
  });

  // Moved from webgl-burg-labels.test.ts, which tested this against the now-deleted
  // readGroupStyles. Regression: shells are appended in SVG paint order (least important first,
  // so capitals paint on top), which is the exact inverse of collision priority. Deriving rank
  // from DOM index once let hamlets outrank capitals and monopolise the screen.
  it("ranks groups by importance, not by DOM order", () => {
    mount(
      ["hamlet", "village", "city", "capital"].map(id => shell(id, { "data-size": "2" })).join("")
    );
    const s = readBurgLabelStyles();
    expect(s.capital.rank).toBeLessThan(s.city.rank);
    expect(s.city.rank).toBeLessThan(s.village.rank);
    expect(s.village.rank).toBeLessThan(s.hamlet.rank);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/labeling/label-style.test.ts`
Expected: FAIL — `Failed to resolve import "./label-style"`.

- [ ] **Step 3: Write the implementation**

Create `src/renderers/labeling/label-style.ts`:

```ts
import { groupCeilPx, groupFloorPx, groupMinZoom, groupRank } from "./tier-table";

export interface GroupStyle {
  group: string;
  rank: number; // collision priority, lower wins
  fontSize: number; // d — authored map units per em
  minZoom: number; // tier gate, incl. any data-min-zoom override
  floorPx: number;
  ceilPx: number;
  fill: string;
  halo: string;
  haloWidth: number;
  hidden: boolean; // display:none — read here, consumed by the GL painter in phase 3
}

const DEFAULT_FONT_SIZE = 4;

/**
 * Read the authored per-group size.
 *
 * Order matters: `data-size` is what the user styled, while the `font-size` attribute is
 * overwritten on every zoom whenever rescaleLabels is on, so it holds the *current* size rather
 * than the authored one. Reading font-size first would make the size drift with the zoom level.
 */
function readAuthoredSize(el: SVGGElement): number {
  const data = parseFloat(el.getAttribute("data-size") || "");
  if (Number.isFinite(data) && data > 0) return data;
  const attr = parseFloat(el.getAttribute("font-size") || "");
  if (Number.isFinite(attr) && attr > 0) return attr;
  const computed = parseFloat(getComputedStyle(el).fontSize || "");
  return Number.isFinite(computed) && computed > 0 ? computed : DEFAULT_FONT_SIZE;
}

/**
 * Read the live #burgLabels group shells into per-group style. The shells stay the style carrier
 * for both renderers, so this is the one place that turns DOM into a decision input.
 */
export function readBurgLabelStyles(root: ParentNode = document): Record<string, GroupStyle> {
  const out: Record<string, GroupStyle> = {};
  const shells = Array.from(root.querySelectorAll<SVGGElement>("#burgLabels > g"));
  for (const el of shells) {
    const stroke = el.getAttribute("stroke");
    const override = parseFloat(el.getAttribute("data-min-zoom") || "");
    out[el.id] = {
      group: el.id,
      rank: groupRank(el.id),
      fontSize: readAuthoredSize(el),
      minZoom: Number.isFinite(override) ? override : groupMinZoom(el.id),
      floorPx: groupFloorPx(el.id),
      ceilPx: groupCeilPx(el.id),
      fill: el.getAttribute("fill") || "#3e3e4b",
      halo: stroke || "#ffffff",
      // only halo when the group actually has a stroke; 0 width disables the halo ring in the shader
      haloWidth: stroke ? +(el.getAttribute("stroke-width") || 0.5) : 0,
      hidden: (el.getAttribute("style") || "").includes("display:none") || getComputedStyle(el).display === "none"
    };
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/labeling/label-style.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/renderers/labeling/label-style.ts src/renderers/labeling/label-style.test.ts
git add src/renderers/labeling/label-style.ts src/renderers/labeling/label-style.test.ts
git commit --no-verify -m "feat(labels): add shared group-shell style reader with data-min-zoom support"
```

---

### Task 4: Rewrite label-visibility on the new model

Removes the size cull, gates only on min-zoom, works from em-relative extents so collision boxes match the clamped render size, and returns the computed size alongside each id.

**Files:**
- Rewrite: `src/renderers/label-visibility.ts`
- Rewrite: `src/renderers/label-visibility.test.ts`

**Interfaces:**
- Consumes: `effectiveLabelPx` from `./labeling/label-sizing`.
- Produces: `interface LabelBox {id, x, y, order, population, halfWEm, halfHEm, d, minZoom, floorPx, ceilPx}`, `interface VisibleLabel {id: number; px: number}`, `interface MapViewport`, `selectVisibleLabels(boxes, scale, vp, opts?: {hideLabels?: boolean}): VisibleLabel[]`.
- `groupRank` and `groupMaxPx` are no longer exported from this module — importers must use `./labeling/tier-table`.

- [ ] **Step 1: Write the failing test**

Replace the whole contents of `src/renderers/label-visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupCeilPx, groupFloorPx, groupMinZoom, groupRank } from "./labeling/tier-table";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";

const VP: MapViewport = { x0: 0, y0: 0, x1: 1000, y1: 1000 };

function box(p: Partial<LabelBox> & { id: number }): LabelBox {
  return {
    x: 100,
    y: 100,
    order: 0,
    population: 1,
    halfWEm: 1.25,
    halfHEm: 0.5,
    d: 4,
    minZoom: 0,
    floorPx: 6,
    ceilPx: 60,
    ...p
  };
}

const ids = (out: { id: number }[]) => out.map(v => v.id);

describe("selectVisibleLabels — tier gating", () => {
  it("culls labels below their min-zoom", () => {
    expect(selectVisibleLabels([box({ id: 1, minZoom: 8 })], 4, VP, { hideLabels: true })).toEqual([]);
  });

  it("ignores min-zoom when hideLabels is off", () => {
    expect(ids(selectVisibleLabels([box({ id: 1, minZoom: 8 })], 4, VP, { hideLabels: false }))).toEqual([1]);
  });

  it("culls labels whose box is outside the viewport", () => {
    expect(selectVisibleLabels([box({ id: 1, x: 5000, y: 5000 })], 4, VP, { hideLabels: true })).toEqual([]);
  });
});

describe("selectVisibleLabels — size never culls", () => {
  // Regression: this is the whole point of the phase. A tiny label is clamped up, not dropped.
  it("keeps a label that is smaller than the floor and reports the floor size", () => {
    const out = selectVisibleLabels([box({ id: 1, d: 1 })], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(6);
  });

  it("keeps a label that is larger than the ceiling and reports the ceiling size", () => {
    const out = selectVisibleLabels([box({ id: 1 })], 1000, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(60);
  });

  it("reports natural size inside the band", () => {
    expect(selectVisibleLabels([box({ id: 1 })], 5, VP, { hideLabels: true })[0].px).toBe(20);
  });

  // Regression: Nomia's capital (d=2.49, minZoom 1) was invisible below scale 2.41.
  it("shows a small-font capital at scale 1", () => {
    const capital = box({
      id: 1,
      d: 2.49,
      minZoom: groupMinZoom("capital"),
      order: groupRank("capital"),
      floorPx: groupFloorPx("capital"),
      ceilPx: groupCeilPx("capital")
    });
    const out = selectVisibleLabels([capital], 1, VP, { hideLabels: true });
    expect(ids(out)).toEqual([1]);
    expect(out[0].px).toBe(11);
  });
});

describe("selectVisibleLabels — collision", () => {
  it("drops a lower-priority label that overlaps a higher-priority one", () => {
    const a = box({ id: 1, order: 0, x: 100, y: 100 });
    const b = box({ id: 2, order: 5, x: 101, y: 100 });
    expect(ids(selectVisibleLabels([b, a], 4, VP, { hideLabels: true }))).toEqual([1]);
  });

  it("keeps two labels that do not overlap", () => {
    const a = box({ id: 1, x: 100, y: 100 });
    const b = box({ id: 2, x: 900, y: 900 });
    expect(ids(selectVisibleLabels([a, b], 4, VP, { hideLabels: true })).sort()).toEqual([1, 2]);
  });

  it("breaks priority ties by population (higher wins)", () => {
    const a = box({ id: 1, order: 0, population: 10, x: 100, y: 100 });
    const b = box({ id: 2, order: 0, population: 99, x: 101, y: 100 });
    expect(ids(selectVisibleLabels([a, b], 4, VP, { hideLabels: true }))).toEqual([2]);
  });

  it("lets a capital win a collision against an overlapping hamlet", () => {
    const capital = box({ id: 1, order: groupRank("capital"), x: 100, y: 100 });
    const hamlet = box({ id: 2, order: groupRank("hamlet"), x: 101, y: 100 });
    expect(ids(selectVisibleLabels([hamlet, capital], 4, VP, { hideLabels: true }))).toEqual([1]);
  });

  // Collision must use the size actually drawn: a clamped-up label occupies more room than its
  // natural extents, so two labels that look separate at natural size can genuinely overlap.
  it("collides using the clamped size, not the natural size", () => {
    // d=1 at scale 1 is clamped 6x up to the 6px floor, so these two now overlap
    const a = box({ id: 1, d: 1, order: 0, x: 100, y: 100 });
    const b = box({ id: 2, d: 1, order: 5, x: 103, y: 100 });
    expect(ids(selectVisibleLabels([a, b], 1, VP, { hideLabels: true }))).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/label-visibility.test.ts`
Expected: FAIL — `groupMinZoom` etc. not exported from `./labeling/tier-table` is resolved, but `selectVisibleLabels` rejects the 4th argument and `LabelBox` has no `halfWEm`, so this fails to typecheck/run.

- [ ] **Step 3: Write the implementation**

Replace the whole contents of `src/renderers/label-visibility.ts`:

```ts
import { effectiveLabelPx } from "./labeling/label-sizing";

export interface LabelBox {
  id: number;
  x: number;
  y: number; // anchor (map units), already includes any drag override
  order: number; // group priority (lower = higher priority)
  population: number; // tiebreak (higher = higher priority)
  halfWEm: number;
  halfHEm: number; // half-extents in em, so they track the size actually drawn
  d: number; // authored map units per em
  minZoom: number;
  floorPx: number;
  ceilPx: number;
}

export interface MapViewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface VisibleLabel {
  id: number;
  px: number; // on-screen size the painter must draw at
}

export interface VisibilityOptions {
  hideLabels?: boolean; // apply min-zoom tier gating (the hideLabels checkbox)
}

const GRID_PX = 64; // collision spatial-hash cell, screen px

/**
 * Per-frame visibility: gate on min-zoom, size every survivor, cull to the viewport, sort by
 * priority, then greedy collision-place in screen space. Returns survivors with their size. Pure.
 *
 * Size does NOT cull. It used to (`px < 6 -> drop`), which silently overruled the tier system:
 * a capital with a small preset font was dropped before it reached the collision pass it would
 * have won, while hamlets with larger fonts rendered. min-zoom is now the only tier gate.
 */
export function selectVisibleLabels(
  boxes: LabelBox[],
  scale: number,
  vp: MapViewport,
  opts: VisibilityOptions = {}
): VisibleLabel[] {
  const gate = opts.hideLabels !== false;

  // 1. gate + size + viewport cull
  const candidates: { b: LabelBox; px: number; hwMap: number; hhMap: number }[] = [];
  for (const b of boxes) {
    if (gate && scale < b.minZoom) continue;
    const px = effectiveLabelPx(b.d, scale, b.floorPx, b.ceilPx);
    // extents follow the drawn size, converted back to map units for the viewport test
    const hwMap = (b.halfWEm * px) / scale;
    const hhMap = (b.halfHEm * px) / scale;
    if (b.x + hwMap < vp.x0 || b.x - hwMap > vp.x1) continue;
    if (b.y + hhMap < vp.y0 || b.y - hhMap > vp.y1) continue;
    candidates.push({ b, px, hwMap, hhMap });
  }

  // 2. priority sort: lower order first, then higher population
  candidates.sort((p, q) => p.b.order - q.b.order || q.b.population - p.b.population);

  // 3. greedy collision in screen space using a spatial hash
  const grid = new Map<string, { l: number; t: number; r: number; bo: number }[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const kept: VisibleLabel[] = [];

  for (const c of candidates) {
    const l = (c.b.x - c.hwMap) * scale;
    const t = (c.b.y - c.hhMap) * scale;
    const r = (c.b.x + c.hwMap) * scale;
    const bo = (c.b.y + c.hhMap) * scale;
    const cx0 = Math.floor(l / GRID_PX);
    const cy0 = Math.floor(t / GRID_PX);
    const cx1 = Math.floor(r / GRID_PX);
    const cy1 = Math.floor(bo / GRID_PX);

    let collides = false;
    outer: for (let cx = cx0; cx <= cx1 && !collides; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = grid.get(key(cx, cy));
        if (!bucket) continue;
        for (const p of bucket) {
          if (l < p.r && r > p.l && t < p.bo && bo > p.t) {
            collides = true;
            break outer;
          }
        }
      }
    }
    if (collides) continue;

    kept.push({ id: c.b.id, px: c.px });
    const placed = { l, t, r, bo };
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(placed);
        else grid.set(k, [placed]);
      }
    }
  }
  return kept;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/renderers/label-visibility.test.ts`
Expected: PASS — 12 tests. `npx tsc --noEmit` will still fail at this point because `webgl-burg-labels.ts` has not been updated yet; that is Task 5.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/renderers/label-visibility.ts src/renderers/label-visibility.test.ts
git add src/renderers/label-visibility.ts src/renderers/label-visibility.test.ts
git commit --no-verify -m "refactor(labels): gate visibility on min-zoom only, size never culls"
```

---

### Task 5: Wire the WebGL painter to the shared modules

Deletes `readGroupStyles` and the duplicated tier tables from the GL renderer, builds em-relative boxes, and lays out each label at its clamped size.

**Files:**
- Modify: `src/renderers/webgl-burg-labels.ts`
- Test: `src/renderers/webgl-burg-labels.test.ts`

**Interfaces:**
- Consumes: `readBurgLabelStyles`, `GroupStyle` from `./labeling/label-style`; `selectVisibleLabels`, `LabelBox`, `VisibleLabel` from `./label-visibility`.
- Produces: `buildLabelBoxes(burgs, styles: Record<string, GroupStyle>, metrics, geom)` now returns boxes carrying `halfWEm`/`halfHEm`/`d`/`floorPx`/`ceilPx`. `LabelGroupStyle` and `readGroupStyles` are removed; importers use `GroupStyle` and `readBurgLabelStyles`.

- [ ] **Step 1: Write the failing test**

Replace the whole contents of `src/renderers/webgl-burg-labels.test.ts`. The existing `hexToRgb`
block is preserved verbatim; the `buildLabelBoxes` block is rewritten for em-relative extents; the
`readGroupStyles` block is **deleted** — that function no longer exists, and its DOM-paint-order
regression guard was moved into `label-style.test.ts` in Task 3.

```ts
import { describe, expect, it } from "vitest";
import type { GroupStyle } from "./labeling/label-style";
import type { FontGeometry, GlyphMetric } from "./label-layout";
import { buildLabelBoxes, hexToRgb } from "./webgl-burg-labels";

const GEOM: FontGeometry = { cellEm: 1.333, originXEm: 0.167, baselineYEm: 0.967 };
const METRICS: Record<string, GlyphMetric> = {
  A: { advance: 0.6, u0: 0, v0: 0, u1: 64, v1: 64 },
  b: { advance: 0.5, u0: 64, v0: 0, u1: 128, v1: 64 }
};

function style(p: Partial<GroupStyle> = {}): GroupStyle {
  return {
    group: "capital",
    rank: 0,
    fontSize: 4,
    minZoom: 1,
    floorPx: 11,
    ceilPx: 96,
    fill: "#000000",
    halo: "#ffffff",
    haloWidth: 1,
    hidden: false,
    ...p
  };
}

describe("hexToRgb", () => {
  it("parses 6-digit hex", () => {
    expect(hexToRgb("#ff8000")).toEqual([1, 128 / 255, 0]);
  });
  it("parses 3-digit shorthand hex", () => {
    expect(hexToRgb("#fff")).toEqual([1, 1, 1]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#f80")).toEqual([1, 136 / 255, 0]);
  });
  it("parses rgb() form", () => {
    expect(hexToRgb("rgb(255, 128, 0)")).toEqual([1, 128 / 255, 0]);
  });
  it("falls back to black on unparseable input", () => {
    expect(hexToRgb("nonsense")).toEqual([0, 0, 0]);
  });
});

describe("buildLabelBoxes", () => {
  const burgs = [{}, { i: 1, name: "Ab", group: "capital", x: 100, y: 200, population: 5 }] as any;

  it("emits em-relative half extents that are independent of the authored size", () => {
    const small = buildLabelBoxes(burgs, { capital: style({ fontSize: 2 }) }, METRICS, GEOM)[0];
    const large = buildLabelBoxes(burgs, { capital: style({ fontSize: 8 }) }, METRICS, GEOM)[0];
    expect(small.halfWEm).toBeCloseTo(large.halfWEm, 10);
    expect(small.halfHEm).toBeCloseTo(large.halfHEm, 10);
    // (0.6 + 0.5)/2 + 0.167
    expect(small.halfWEm).toBeCloseTo(0.717, 3);
    expect(small.halfHEm).toBeCloseTo(0.6665, 4);
  });

  it("carries the tier bounds and authored size through from the style", () => {
    const b = buildLabelBoxes(burgs, { capital: style({ fontSize: 2.49 }) }, METRICS, GEOM)[0];
    expect(b.d).toBeCloseTo(2.49, 5);
    expect(b.floorPx).toBe(11);
    expect(b.ceilPx).toBe(96);
    expect(b.minZoom).toBe(1);
    expect(b.order).toBe(0);
  });

  it("applies the per-burg label override to the anchor", () => {
    const moved = [{}, { ...burgs[1], labelDx: 5, labelDy: -3 }] as any;
    const b = buildLabelBoxes(moved, { capital: style() }, METRICS, GEOM)[0];
    expect(b.x).toBe(105);
    expect(b.y).toBe(197);
  });

  it("skips burgs whose group has no style shell", () => {
    expect(buildLabelBoxes(burgs, { hamlet: style({ group: "hamlet" }) }, METRICS, GEOM)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/renderers/webgl-burg-labels.test.ts`
Expected: FAIL — `halfWEm` is undefined (boxes still carry map-unit `halfW`).

- [ ] **Step 3: Write the implementation**

In `src/renderers/webgl-burg-labels.ts`:

Replace the imports and the `LabelGroupStyle` interface and `buildLabelBoxes` (lines 1–51) with:

```ts
import { type Quadtree, quadtree } from "d3-quadtree";
import type { Burg } from "../generators/burgs-generator";
import { type GroupStyle, readBurgLabelStyles } from "./labeling/label-style";
import { GLYPH_STRIDE, packGlyphQuads } from "./label-instances";
import { type FontGeometry, type GlyphMetric, layoutLabel } from "./label-layout";
import { type LabelBox, type MapViewport, selectVisibleLabels } from "./label-visibility";
import { registerLayer } from "./layer-host";
import { buildGlyphAtlas, collectGlyphs, type GlyphAtlas } from "./sdf-glyph-atlas";

/**
 * Per-burg label box (pure): anchor incl. override, plus half-extents in em.
 *
 * Extents are em-relative rather than map units because the drawn size is clamped per tier, so a
 * label's on-screen box is not simply its authored size times the zoom.
 */
export function buildLabelBoxes(
  burgs: Burg[],
  styles: Record<string, GroupStyle>,
  metrics: Record<string, GlyphMetric>,
  geom: FontGeometry
): (LabelBox & { name: string; group: string })[] {
  const out: (LabelBox & { name: string; group: string })[] = [];
  for (const b of burgs) {
    if (!b || !b.i || b.removed || !b.name) continue;
    const s = styles[b.group as string];
    if (!s) continue;
    let adv = 0;
    for (const ch of b.name) if (metrics[ch]) adv += metrics[ch].advance;
    out.push({
      id: b.i,
      x: b.x! + (b.labelDx || 0),
      y: b.y! + (b.labelDy || 0),
      order: s.rank,
      population: b.population || 0,
      halfWEm: adv / 2 + geom.originXEm,
      halfHEm: geom.cellEm / 2,
      d: s.fontSize,
      minZoom: s.minZoom,
      floorPx: s.floorPx,
      ceilPx: s.ceilPx,
      name: b.name,
      group: b.group as string
    });
  }
  return out;
}
```

Change the module-level `styles` declaration (line 99) to:

```ts
let styles: Record<string, GroupStyle> = {};
```

Delete `readGroupStyles` entirely (lines 129–172) and, in `rebuildBurgLabelGL`, replace `styles = readGroupStyles();` with:

```ts
  styles = readBurgLabelStyles();
```

In `drawBurgLabelGL`, replace the transform-gated visibility block:

```ts
  if (key !== lastKey) {
    lastKey = key;
    const visible = selectVisibleLabels(boxes, t.scale, vp, {
      hideLabels: (window as any).hideLabels?.checked !== false
    });
    (drawBurgLabelGL as any)._ranges = buildGroupRanges(new Map(visible.map(v => [v.id, v.px])), t.scale);
  }
```

Replace `buildGroupRanges` with:

```ts
/**
 * Lay out the surviving labels into per-group glyph quads.
 *
 * The shader still works in map units in this phase, so the clamped on-screen size is converted
 * back with px/scale. Moving the quads into screen space is phase 2.
 */
function buildGroupRanges(visible: Map<number, number>, scale: number): { group: string; data: Float32Array }[] {
  if (!atlas) return [];
  const byGroup: Record<string, number[]> = {};
  for (const b of boxes) {
    const px = visible.get(b.id);
    if (px === undefined) continue;
    if (styles[b.group]?.hidden) continue;
    const mapUnits = scale > 0 ? px / scale : b.d;
    const laid = layoutLabel(b.name, atlas.metrics, atlas.geom, mapUnits, b.x, b.y);
    const packed = packGlyphQuads(laid.quads);
    const acc = (byGroup[b.group] ||= []) as unknown as number[];
    for (let i = 0; i < packed.length; i++) acc.push(packed[i]);
  }
  return Object.entries(byGroup).map(([group, arr]) => ({ group, data: Float32Array.from(arr) }));
}
```

In the `registerLayer` `hitTest` callback, replace the box test with em-derived extents:

```ts
    const hw = found.halfWEm * found.d;
    const hh = found.halfHEm * found.d;
    if (mapX >= found.x - hw && mapX <= found.x + hw && mapY >= found.y - hh && mapY <= found.y + hh)
      return found.id;
    return null;
```

Finally, in `drawBurgLabelGL`'s per-group uniform loop, the style field names are unchanged (`fill`, `halo`, `haloWidth`) so that block needs no edit.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/renderers/`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no output (exit 0).

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/renderers/webgl-burg-labels.ts src/renderers/webgl-burg-labels.test.ts
git add src/renderers/webgl-burg-labels.ts src/renderers/webgl-burg-labels.test.ts
git commit --no-verify -m "refactor(webgl): consume shared label style, tier and sizing modules"
```

---

### Task 6: Remove the third MIN_ZOOM copy from the icon renderer

**Files:**
- Modify: `src/renderers/webgl-burg-icons.ts:75-99`

**Interfaces:**
- Consumes: `groupMinZoom` from `./labeling/tier-table`.
- Produces: no signature change — `groupRenders()` keeps returning `Record<string, GroupRender>`.

This task adds no test. It is a pure deletion: the behaviour it preserves is already covered by
`tier-table.test.ts` (Task 1), and the thing it must guarantee — that no second copy of the table
survives — is proved by the grep and typecheck in step 2. A unit test asserting
`MIN_ZOOM[g] === groupMinZoom(g)` would assert only that an accessor is still a record lookup.

- [ ] **Step 1: Delete the duplicate**

In `src/renderers/webgl-burg-icons.ts`, delete lines 75–90 (the comment `// BURG_MIN_ZOOM lives in public/main.js as a literal; mirror the needed keys here.` and the whole local `MIN_ZOOM` record), add the import at the top of the file:

```ts
import { groupMinZoom } from "./labeling/tier-table";
```

and change `groupRenders` to use it:

```ts
function groupRenders(): Record<string, GroupRender> {
  const out: Record<string, GroupRender> = {};
  if (!atlas) return out;
  for (const [name, t] of Object.entries(atlas.tiles)) {
    out[name] = { tileIndex: t.tileIndex, size: t.size, minZoom: groupMinZoom(name) };
  }
  return out;
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no output.

Run: `grep -n "MIN_ZOOM" src/renderers/webgl-burg-icons.ts src/renderers/webgl-burg-labels.ts`
Expected: no matches.

Run: `npx vitest run src/renderers/`
Expected: PASS — no regression from the deletion.

- [ ] **Step 3: Commit**

```bash
npx biome check --write src/renderers/webgl-burg-icons.ts
git add src/renderers/webgl-burg-icons.ts
git commit --no-verify -m "refactor(webgl): read icon min-zoom from the shared tier table"
```

---

### Task 7: Make the SVG painter use the same model

Replaces the damping formula and the last `BURG_MIN_ZOOM` copy in `public/main.js`, so both renderers now size and gate burg labels identically.

**Files:**
- Modify: `public/main.js:664-712`
- Modify: `src/types/global.ts`

**Interfaces:**
- Consumes: `window.effectiveLabelPx`, `window.svgLabelFontSize`, `window.labelTiers` (set by Task 2).
- Produces: no new exports.

- [ ] **Step 1: Declare the new globals**

In `src/types/global.ts`, add alongside the existing `var hideLabels` / `var rescaleLabels` declarations:

```ts
  var effectiveLabelPx: (d: number, scale: number, floorPx: number, ceilPx: number) => number;
  var svgLabelFontSize: (px: number, scale: number) => number;
  var labelTiers: {
    groupRank: (group: string) => number;
    groupMinZoom: (group: string) => number;
    groupFloorPx: (group: string) => number;
    groupCeilPx: (group: string) => number;
  };
```

- [ ] **Step 2: Replace the burg-label sizing block**

In `public/main.js`, delete the `BURG_MIN_ZOOM` literal (the `const BURG_MIN_ZOOM = {...}` block that begins with the `// rescale labels on zoom` comment's table) and replace the `if (layerIsOn("toggleLabels"))` body's `#burgLabels` branch with:

```js
  if (layerIsOn("toggleLabels")) {
    const tiers = window.labelTiers;
    labels.selectAll("g").each(function () {
      if (this.id === "burgLabels") {
        if (window.burgLabelsWebglActive && window.burgLabelsWebglActive()) return; // GPU owns burg labels
        if (!tiers) return; // TS bundle not loaded yet; leave the shells alone
        for (const sub of this.children) {
          const d = +sub.dataset.size;
          // Size is clamped per tier for legibility and never culls. Only min-zoom hides a tier,
          // so a capital with a small preset font shows from its min-zoom like the tier promises.
          const px = rescaleLabels.checked
            ? window.effectiveLabelPx(d, scale, tiers.groupFloorPx(sub.id), tiers.groupCeilPx(sub.id))
            : d * scale;
          sub.setAttribute("font-size", rn(window.svgLabelFontSize(px, scale), 2));
          const minZoomSub = +sub.dataset.minZoom || tiers.groupMinZoom(sub.id);
          if (hideLabels.checked && scale < minZoomSub) sub.classList.add("hidden");
          else sub.classList.remove("hidden");
        }
        return;
      }
      const desired = +this.dataset.size;
      const relative = Math.max(rn((desired + desired / scale) / 2, 2), 1);
      if (rescaleLabels.checked) this.setAttribute("font-size", relative);

      const minZoom = +this.dataset.minZoom || (tiers ? tiers.groupMinZoom(this.id) : 0);
      const hidden = hideLabels.checked && (scale < minZoom || relative * scale < 6 || relative * scale > 60);
      if (hidden) this.classList.add("hidden");
      else this.classList.remove("hidden");
    });
  }
```

The non-burg branch (state labels) keeps its damping and size band untouched — those move in phase 6.

- [ ] **Step 3: Update the icon-culling block**

Immediately below, the burg icon/anchor culling block reads `BURG_MIN_ZOOM` too. Replace its lookup:

```js
  if (hideLabels.checked && window.labelTiers) {
    const burgIconsOn = layerIsOn("toggleBurgIcons");
    for (const group of [burgIcons.node(), anchors.node()]) {
      if (!group || !burgIconsOn) continue;
      for (const sub of group.children) {
        const minZoom = +sub.dataset.minZoom || window.labelTiers.groupMinZoom(sub.id);
        if (scale < minZoom) sub.classList.add("hidden");
        else sub.classList.remove("hidden");
      }
```

- [ ] **Step 4: Verify no copies remain**

Run: `grep -rn "BURG_MIN_ZOOM" public/ src/`
Expected: no matches.

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
npx biome check --write src/types/global.ts
git add public/main.js src/types/global.ts
git commit --no-verify -m "refactor(labels): size SVG burg labels with the shared clamp and tier table"
```

---

### Task 8: Full verification

**Files:**
- No source changes. Browser verification per the brief §12.

- [ ] **Step 1: Full test suite**

Run: `npx vitest run`
Expected: PASS. Note: `src/generators/routes-generator.test.ts` and `trade-network-generator.test.ts` are modified in the working tree by unrelated user WIP and may already fail — compare against `git stash`-free baseline rather than assuming this phase broke them.

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed.

- [ ] **Step 3: Browser check — default preset, SVG path**

Start the dev server on a spare port (the user's own session may already be running one — do not stop it):

Run: `npx vite --port 5174`

In headless chromium with CDP per the brief §12, generate a default map, force the SVG path with `window.webglBurgLabels = false; drawBurgLabels();` and confirm at scale 1, 2 and 5:
- capital labels are present at every scale (min-zoom 1),
- hamlet labels are absent below scale 14,
- `document.querySelector("#burgLabels > #capital").getAttribute("font-size") * scale` equals the clamp: `max(4.98 * scale, 11)`.

- [ ] **Step 4: Browser check — GPU path parity**

Force GPU with `window.webglBurgLabels = true; scheduleRebuildBurgLabelGL();` and confirm the same set of tiers is visible at the same scales as step 3. Any tier that appears in one renderer and not the other at the same zoom is a phase-1 failure.

- [ ] **Step 5: Browser check — the reported bug**

Load the Nomia map per the brief §12 (copy the `.map` into `public/`, `fetch()` it, call `window.Services.Load.uploadMap(blob)`, delete the copy afterwards). Confirm the capital "Zri" label is visible at scale 1 in GPU mode, where it previously required scale ≥ 2.41.

- [ ] **Step 6: Commit any fixes and update the spec**

If the browser checks required changes, commit them, then mark phase 1 complete in the spec's §6 phasing list:

```bash
npx biome check --write docs/superpowers/specs/2026-07-22-label-icon-unified-planner-design.md
git add docs/superpowers/specs/2026-07-22-label-icon-unified-planner-design.md
git commit --no-verify -m "docs: mark label planner phase 1 complete"
```

---

## What phase 1 deliberately leaves alone

- **Group `data-dx`/`data-dy` offsets** — GL labels still render centred on the icon (brief §8.3). Phase 2, because the offset machinery is the same machinery as candidate placement.
- **Screen-space quads** — the GL shader still works in map units; the painter converts with `px / scale`.
- **Candidate positions, per-cell budget, hysteresis** — phase 2.
- **`display:none`** is read into `GroupStyle` but NOT acted on. Honouring it belongs to phase 3 with the rest of the GL style parity work, alongside opacity, letter-spacing, text-shadow and per-group font-family.

### Corrections made during execution

Two items in this plan were wrong and were changed after Task 5's review. Do not restore the
original text.

1. **Hit-test extents must use the clamped size, not the authored size.** This plan originally
   specified `halfWEm * d` for the hit-test and deferred the mismatch to phase 2, describing the
   clickable box as "slightly smaller" than the drawn box. That was wrong by a factor of ~2.75 at
   scale 1 for a capital with a typical authored size (`FLOOR_PX.capital = 11`, `d ≈ 4`), and ~9× at
   scale 0.3 — so the labels this phase makes visible would be exactly the ones that cannot be
   clicked or dragged, and `qt.find` could return a different, nearer burg. Task 5 now computes
   extents via `effectiveLabelPx` and the live scale, through an exported pure `labelHitExtents`
   so the maths is unit-testable.
2. **The `display:none` filter was removed from phase 1.** This plan had Task 5 skip hidden groups
   inside `buildGroupRanges`, which runs *after* the collision pass — so hidden groups still won
   their slots and blanked out visible labels underneath. `public/modules/ui/layers.js:855` hides
   the four skyburg shells that way and `skyburg-capital` ranks second only to `capital`. The
   filter was also inert, since `styles` refreshes only in `rebuildBurgLabelGL` and
   `toggleSkyburgs` never triggers a rebuild. It was scope creep from phase 3 in the first place.
