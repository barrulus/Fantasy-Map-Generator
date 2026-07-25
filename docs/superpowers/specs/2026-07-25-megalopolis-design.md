# Megalopolis (Same-Cell Burg Grouping) — Design

**Status:** implemented (main, 2026-07-25); amended after first in-map verification
**Depends on:** multi-burg-per-cell (merged to main 2026-07-25, commits `ccc5a6ba..b72629a8`)

> **Amendments (2026-07-25, post-verification):**
> 1. **Skyburgs never join megalopolises.** Membership is ≥2 *ground* burgs in a cell. Auto-enrolling flying burgs turned the whole skyburg archipelago into "Greater X" groups. Skyburgs keep their existing stacking and consumers-only economy. (Supersedes "skyburg members" below.)
> 2. **Composites follow the capital tier zoom gate.** Composite icons/labels appear from `groupMinZoom("capital")` (like capitals), not from zoom 0, and still swap out for members at the split zoom.

## Purpose

When a cell hosts several burgs (now possible via multi-burg editing), present and simulate them as one large composite city — a *megalopolis* — instead of N overlapping small towns: one icon and label at low zoom, one economic actor in the market/production/trade simulation, with per-member detail preserved on zoom-in and in overviews.

## Concept: derived entity, anchor-burg model

A megalopolis is **never stored**. It is derived at runtime:

> The set of all non-removed burgs sharing one cell (ground **and** flying), whenever that set has **≥2 members including ≥1 ground burg**.

- **Identity** = the cell id. No `pack.megalopolises` array, no new save-format fields, no migration; old maps just work and the entity can never go stale.
- **Anchor** = the cell's primary ground burg, i.e. `pack.cells.burg[cell]`. The multi-burg invariant (a cell with ground burgs always has a non-zero slot; removal promotes a successor) guarantees an anchor always exists while the megalopolis exists.
- **Name** derives from the anchor: `"Greater {anchor.name}"` by default, with a per-culture prefix table as a follow-up nicety (e.g. `-polis`, `Grand …`). Renaming the anchor renames the group. No separate name storage.
- **Pooled treasury** lives on the anchor burg's existing `treasury` field (persistent sim state needs a home; the anchor's field is already serialized). Member burgs' `treasury` stays `0` while grouped.
- A skyburg floating alone over an empty cell is NOT a megalopolis (no ground member → no anchor).

### Lifecycle edge cases (all fall out of derivation — no event handling)

| Event | Result |
|---|---|
| Second burg added to a cell | Megalopolis exists on next read |
| Member relocated away / removed, one burg left | Megalopolis dissolves on next read |
| Anchor removed | Slot promotion (`cellSlotAfterRemoval`) names the successor; it becomes anchor and treasury holder — spec: on anchor removal, `Burgs.remove` transfers `treasury` to the promoted successor |
| Regenerate burgs | Generation stays one-per-cell, so no megalopolises appear procedurally (editing-only feature, matching multi-burg) |
| Save/load | Nothing to do; membership re-derives from `burg.cell` |

## Module: `src/generators/megalopolis.ts`

Pure, unit-testable, single source of truth for membership rules. No DOM, no globals beyond `pack` passed in.

```ts
interface Megalopolis {
  cell: number;            // identity
  anchor: Burg;            // primary ground burg (slot owner)
  members: Burg[];         // all co-located non-removed burgs, anchor first
  population: number;      // Σ member populations (skyburgs included)
}

findMegalopolises(burgs: Burg[], cellsBurg: ArrayLike<number>): Map<number, Megalopolis>
megalopolisAt(cell: number, ...): Megalopolis | null
isGroupedMember(burg: Burg, ...): boolean      // true for NON-anchor members of a group
megalopolisName(anchor: Burg): string
```

Consumers (renderers, economy passes, overviews, tooltips) only use this module — membership logic appears exactly once.

## Rendering: zoom-dependent swap

Below a zoom threshold (constant, same magnitude as the existing burg-label cull thresholds):

- The anchor renders as a **composite icon**: its normal icon enlarged with a distinguishing ring, plus one label = `megalopolisName(anchor)`.
- Non-anchor members' icons and labels are **suppressed**.

At or past the threshold: all members render individually (each already has its own x/y from click placement) and the megalopolis label/ring is not drawn.

Implementation surfaces:
- **GPU path** (`webgl-burg-icons.ts`, `webgl-burg-labels.ts`): filter the instance list through `isGroupedMember` when below threshold; rebuild instances on threshold crossing (same mechanism as the existing zoom-based label culling; resync rules from the GPU-transform lessons apply).
- **SVG path** (`draw-burg-icons.ts`, `draw-burg-labels.ts`, layers.js redraw): same predicate at draw time.
- Hit-testing quadtree keeps all members (clicking the composite selects the anchor; zoomed in, each member is clickable as today).

## Economy: node collapsing

Economy generation passes iterate **economic nodes** instead of raw burgs. A node is either a lone burg (unchanged behavior) or a megalopolis collapsed into its anchor:

- **Node population / production capacity** = Σ over members, **skyburg members included** (inside a megalopolis, flying burgs graduate from "consumers only" to contributing members).
- **Market seeding** (`markets-generator.ts`): only the anchor can host the market center; members never seed their own (they share the cell, hence the territory, already).
- **Production runs** (`production-generator.ts`): capacity computed per node; output records stay **tagged per member** (existing `burg.production` record shapes) so the Production Overview can show the breakdown.
- **Trade gravity / trade network** (`trade-network-generator.ts`, routes): the node enters with combined population/production, so a megalopolis pulls routes as one large city; non-anchor members are skipped as origins/destinations.
- **Treasury**: all node income/expense accrues to `anchor.treasury`; member `treasury` remains 0 while grouped. On anchor removal, treasury transfers to the promoted successor (see lifecycle table).

## Overviews & UI

- **Markets / Production / Trade overviews**: one combined row per megalopolis (name, Σ population, Σ production, pooled treasury), expandable to member rows. Lone burgs unchanged.
- **Cell tooltip** (`general.js`): already sums co-located burgs (multi-burg work); additionally show the megalopolis name when ≥2 burgs share the cell.
- **Burg editor**: when the edited burg is a grouped member, show a small "part of Greater X (n burgs)" line linking to the anchor.
- No new editor dialog — formation is automatic; users control membership by adding/relocating/removing burgs in the cell.

## Testing

- `megalopolis.test.ts`: membership derivation (ground+sky mix, removed burgs excluded, single-burg cell → none, sky-only cell → none), anchor = slot owner, name derivation, population sum.
- Economy: unit test node collapsing (two co-located burgs → one trade node with summed population; lone burg node unchanged). Reuse existing generator test harness patterns.
- `Burgs.remove` treasury-transfer test (anchor removal moves pool to successor).
- Rendering verified manually in-browser (GPU + SVG), per project norms.

## Out of scope (explicitly)

- Procedural generation of megalopolises (generation stays one burg per cell).
- Adjacent-cell clustering (same-cell only; revisit later if wanted).
- Political city-states (grouping does not change state/province membership — the user chose rendering + economy, not politics).
- Custom megalopolis names stored separately from the anchor.
