# Unified burg label & icon planner — design

Written 2026-07-22. Supersedes the ad-hoc divergence documented in
`2026-07-21-label-icon-rendering-architecture.md` (referred to below as **the brief**), which stays
valid as the description of the *current* code.

## Problem

Burg labels and icons have two independent implementations — SVG and WebGL — that each invented
their own answer to "what is shown, at what size, where". They disagree on sizing, culling,
offsets, styling and collision (brief §5, §6). The divergence is structural: nothing in the code
forces the two to agree, so every fix has to be made twice and drifts.

The user-visible symptoms are the ones worth naming:

- Capitals are invisible until deep zoom on some presets, while hamlets render (brief §7).
- Dense areas produce an arbitrary set of surviving labels that jumps around as you zoom.
- Switching renderers (which happens automatically at 5000 burgs) changes what the map looks like.
- Port anchors silently vanish in GPU mode (brief §8.1).

## Goal

One renderer-agnostic planner owns every decision. SVG and WebGL become painters that consume its
output and differ only in *how* they draw. WebGL reaches full parity with SVG's styling surface,
which is treated as the specification.

Non-goal: changing the styling surface itself. The group `<g>` shells stay the style carrier, so
the Style editor, save/load and existing maps keep working untouched.

---

## 1. Architecture

New directory `src/renderers/labeling/`. Every module is pure except `label-style.ts`, which is the
single place allowed to touch the DOM.

| Module | Owns | Replaces |
|---|---|---|
| `label-style.ts` | reads group `<g>` shells → `GroupStyle` | `readGroupStyles()` (webgl-burg-labels.ts:137) + ad-hoc attribute reads in `draw-burg-labels.ts` and `main.js` |
| `tier-table.ts` | `GROUP_RANK`, `MIN_ZOOM`, size floors/ceilings | the three duplicated `MIN_ZOOM` tables (brief §8.2) |
| `label-sizing.ts` | `effectivePx(style, scale)` | SVG damping (`main.js:681`) and GL's raw `d·scale` |
| `label-placement.ts` | candidates, obstacles, budget, collision, hysteresis | the collision half of `selectVisibleLabels` |
| `label-planner.ts` | orchestrates the above; the public entry point | — |

### Contract

```ts
interface Placement {
  id: number;        // burg id
  group: string;
  screenX: number;   // px, includes the chosen candidate offset
  screenY: number;
  px: number;        // effective on-screen font size
}

function planLabels(
  inputs: LabelInput[],          // static per-burg data, rebuilt only on map change
  styles: Record<string, GroupStyle>,
  scale: number,
  viewport: MapViewport,
  opts: PlannerOptions,
  prev: PrevFrame | null         // hysteresis state in
): { placements: Placement[]; next: PrevFrame }
```

`PlannerOptions` carries `{ collision: boolean; budgetPerCell: number; hideLabels: boolean; candidates: boolean }`
so a painter can opt out of mechanisms it cannot afford (see §3.4).

### Why screen space

All planner maths is in screen pixels — sizes, offsets, collision boxes. The map-unit/px straddle is
precisely what produced the em-offset and damping divergences, because each renderer picked a
different unit to be authoritative in. Painters convert once at the boundary.

---

## 2. Sizing

```
px = clamp(d · scale, floor(tier), ceil(tier))
```

where `d` is the group's font-size in map units, read from the shell exactly as today.

### Size stops being a culling mechanism

This is the load-bearing decision. Today two mechanisms remove labels, and only one is intentional:

| | mechanism | tier-aware? |
|---|---|---|
| intended | `scale < minZoom` | yes — hand-authored per tier |
| accidental | `fontSize·scale < MIN_PX` | **no** — falls out of whatever font-size the preset happens to set |

The second overrules the first. Nomia sets the capital font to 2.49 map units, so capitals need
`scale ≥ 2.41` despite `minZoom: 1` declaring "show capitals immediately". The tier system says
show it; the font size vetoes it. That is the reported bug, and it is not fixable by tuning
thresholds because the two mechanisms are measuring different things.

So the three concerns are separated and each gets exactly one mechanism:

- **min-zoom** — when a tier joins. The only gate.
- **clamp** — how big it draws. Legibility only, never culls.
- **placement** — who wins contested space (§3).

`GROUP_MAX_PX` consequently changes meaning from *cull above* to *stop growing at*, and its current
values (capital 240) are wrong as real ceilings.

### Floors and ceilings

Natural size at each tier's entry zoom, on the default preset (`px = d · minZoom`):

| tier | d | minZoom | px at entry |
|---|---|---|---|
| capital | 4.98 | 1 | **4.98** |
| city | 4.15 | 4 | 16.6 |
| town | 3.32 | 6 | 19.9 |
| village | 2.49 | 10 | 24.9 |
| hamlet | 1.66 | 14 | 23.2 |

Capitals are the only tier that enters below legible size, because they are the only tier whose
`minZoom` is 1. The floor is therefore a capital/skyburg-capital fix in practice — a narrow blast
radius, which is the desired outcome for a change that touches every existing map.

| tier | floor px | ceil px |
|---|---|---|
| capital, skyburg-capital | 11 | 96 |
| city, skyburg | 10 | 80 |
| town, skyburg-mid | 9 | 72 |
| fort, monastery, caravanserai, trading_post, skyburg-small | 8 | 64 |
| village | 7 | 64 |
| hamlet | 6 | 56 |

**Invariant:** `ceil(tier) > d · minZoom(tier)`, otherwise a tier is born already clamped and never
scales at all. This is preset-dependent, so it is enforced as a unit test against the default preset
fixture and a dev-mode console warning at style-read time for presets that violate it. A preset with
unusually large fonts clamping early is the ceiling doing its job, not a defect.

### The clamp is cheap in SVG

The clamp is per-*tier*, not per-label, so the SVG painter writes one attribute per group:

```
font-size = px / scale
```

SVG `<text>` lives inside the zoom-transformed `#viewbox`, so rendered size is `attr · scale = px`.
Within the band the attribute is simply `d` (no rescale at all); below the floor it is `floor/scale`;
above the ceiling `ceil/scale`. This is exactly today's per-group update cost — the SVG path does not
get slower, which is what makes a shared model affordable at all.

### `rescaleLabels` and `hideLabels`

Both checkboxes get a real, renderer-independent definition:

- **`hideLabels`** = apply min-zoom tier gating. Honoured identically by both painters, which
  resolves brief §6.1(1) — today GL culls unconditionally and the checkbox is a lie in GPU mode.
- **`rescaleLabels`** = apply the clamp. Unchecked gives pure linear `d·scale` growth, preserving a
  meaningful toggle and an escape hatch for users who dislike the new behaviour.

---

## 3. Placement

Pipeline, in order:

1. **Gate** — `hideLabels && scale < minZoom(tier)` → drop.
2. **Size** — §2. Never drops.
3. **Viewport cull** — unchanged.
4. **Candidates** — group `data-dx`/`data-dy` first (the styled position), then NE, NW, SE, SW, N,
   S, E, W. First that fits wins.
5. **Obstacles** — state-label boxes (§3.3).
6. **Collision + budget** — greedy by `(rank asc, population desc)` into the existing 64px spatial
   hash (`GRID_PX` unchanged), with a per-cell cap of `budgetPerCell` (default 3, tunable). A cell at
   capacity rejects further labels even when they would not overlap, which is what makes dense areas
   thin out smoothly instead of packing to the collision limit.
7. **Hysteresis** — §3.2.

### 3.1 Candidate offsets

Offsets are in px and derived from `px`, not from map units, so a label sits the same visual
distance from its icon at every zoom. Group `data-dx`/`data-dy` are em values, converted as
`dx · px`. This closes brief §8.3 and doubles as the foundation for candidate placement — same
machinery, different offsets.

### 3.2 Hysteresis

The only non-pure element, so it is passed explicitly rather than held in module state: `prev`
carries last frame's surviving ids and their chosen candidate index. Survivors sort first *within
their own tier* and prefer their previous candidate.

Scoping the bonus within-tier matters: a global bonus would let an established hamlet permanently
block a newly-eligible city, which inverts the tier system the rest of the design exists to protect.
The per-cell budget is still enforced against survivors, so nothing is pinned forever.

### 3.3 State-label obstacles

`draw-state-labels.ts` places curved text along a path. It publishes an approximation — AABBs sampled
along that path — via `registerObstacles(boxes)` in map units; the planner converts per frame. The
relationship is deliberately one-way: state labels never move for a burg label. They are the more
important feature and their placement is expensive (raycast + angle search), so recomputing it inside
a per-frame planner is not viable.

### 3.4 Collision is opt-in per painter

`opts.collision` is `false` for the SVG painter. Collision is the only per-label cost in the entire
model; everything else is per-group. Keeping it off preserves SVG's performance characteristics and
avoids changing what long-styled small maps look like. The engine supports it, so this is a default,
not a limitation.

### 3.5 Hit-testing follows placement

The label quadtree is currently built from map-unit boxes at rebuild time
(`webgl-burg-labels.ts:223`), so once labels can be clamped and candidate-offset it would describe
positions that are not what is on screen. The planner's `Placement[]` becomes the hit-test index
directly — built per frame from visible labels only, so it is cheap, and correct by construction.

---

## 4. WebGL parity work

SVG's styling surface is the specification. Gaps from brief §5.1/§5.2, all in scope:

| Item | Approach |
|---|---|
| Per-group font-family | One texture, cells keyed `` `${fontKey}\|${ch}` `` rather than an atlas per family. Real name sets are ~60–80 distinct glyphs and presets use 1–3 families, so ~240 cells fit 1024×1024. Preserves one draw call per group. |
| letter-spacing | `layoutLabel` gains a spacing term applied to `penX` and `totalAdvance`. |
| text-shadow | Second offset draw pass per group, before the main pass. |
| opacity | New `uOpacity` uniform, multiplies `a` in FRAG. |
| `display:none` | Skip the group in `buildGroupRanges`. |
| `data-min-zoom` override | Field on `GroupStyle`, consumed by the planner's gate — so both painters get it at once. |
| Port anchors | Extra tile in the icon atlas plus a second instance for `b.port`. Closes brief §8.1. |
| Icon `fill-opacity`, `stroke-linejoin`, `stroke-dasharray`, `stroke-linecap` | Pass through to `symbolSVG()` (`webgl-burg-atlas.ts:18`) — plain SVG attributes, they work once forwarded. |

Icon colours remain baked into the atlas, so icon style changes still require `rebuildBurgGL()`.
Label colours remain uniforms and stay nearly free.

---

## 5. Testing

`label-sizing`, `label-placement`, `tier-table` and `label-planner` are pure, so the interesting
cases are plain unit tests:

- Nomia's 2.49px capital is visible at scale 1 and drawn at 11px.
- Every tier's ceiling exceeds its entry size on the default preset (§2 invariant).
- A dense cluster degrades monotonically as zoom decreases — no tier inversion.
- Hysteresis does not let a lower tier block a higher one.
- Candidate fallback order is deterministic.

**Parity suite.** The structural payoff: shared fixtures asserting the SVG and GL painters receive
identical `Placement[]` for the same inputs. Divergence becomes a failing test rather than a bug
report years later — the guarantee the current architecture cannot make.

Existing tests to extend: `label-visibility.test.ts`, `webgl-burg-labels.test.ts`,
`label-layout.test.ts`, `label-instances.test.ts`, `burg-instances.test.ts`, `sdf-glyph-atlas.test.ts`.

Browser verification per the brief §12 recipes: headless chromium with swiftshader, forcing
`window.webglBurgs`/`webglBurgLabels`, checking a burg's SVG position against the shader's.

---

## 6. Phasing

Each phase is independently shippable and leaves the tree working.

1. **Extract and unify.** `label-style.ts`, `tier-table.ts`, `label-sizing.ts`; both painters consume
   them. Fixes brief §7 (capitals), §8.2 (triplicated `MIN_ZOOM`), and the sizing divergence.
2. **Placement.** Candidates, per-cell budget, hysteresis, screen-space boxes, placement-driven
   hit-testing. GL gets all of it; SVG gets offsets only.
3. **GL style parity.** opacity, `display:none`, letter-spacing, `data-min-zoom`, icon SVG attributes.
4. **Multi-font atlas.** Per-group font-family.
5. **Port anchors in GPU mode.** Closes the functional regression.
6. **State-label obstacles.**

---

## 7. Decisions and open items

Decided during design:

1. Size never culls; `min-zoom` is the sole tier gate (§2).
2. SVG keeps collision off by default (§3.4).
3. State labels are one-way obstacles (§3.3).
4. All planner maths is in screen pixels (§1).
5. `hideLabels` and `rescaleLabels` get renderer-independent definitions (§2).

Deliberately **not** in scope:

- **Icons and port anchors do not reserve collision space.** Brief §8.7 (a label can shadow a
  different burg's icon in hit-testing) therefore stays open. Cheap to add once anchors exist in GPU
  mode — the planner's obstacle mechanism already accepts arbitrary boxes.
- Burg labels do not influence state-label placement (§3.3).
- The styling surface itself is unchanged; this design makes WebGL implement it, not extend it.
