# Trade-route UI: burg-editor role control + preset styling

2026-06-11. Follow-up to the global trade hub network
(`docs/superpowers/specs/2026-06-04-global-trade-hub-network-design.md`), which
deferred its UI surface. This spec covers two of the deferred items:

1. Burg-editor control to manually set a burg's trade role (hub / waystation /
   none / auto) with immediate trade-network regeneration.
2. `#traderoutes` styling across all 12 style presets, plus style-editor
   properties wiring and stale-selector cleanup.

Out of scope (still deferred): standalone traderoutes layer toggle,
usage-weighted lane styling, burgs-overview trade-role column.

## Background

- `pack.routes` trade lanes use `group: "traderoutes"`; the SVG group exists in
  `public/main.js` and is cleared/redrawn by `drawRoutes()` in
  `public/modules/ui/layers.js`. The style editor's group dropdown picks the
  group up automatically (it iterates `<g>` children of `#routes`).
- The data model is already in place: `Burg.tradeRole?: "hub" | "waystation"`
  and `Burg.tradeRoleManual?: boolean` (`src/modules/burgs-generator.ts`).
  `assignTradeRoles` (`src/modules/trade-network-generator.ts`) resets only
  non-manual roles and skips manual burgs entirely — manual overrides survive
  regeneration by construction.
- `generateTradeNetwork` (`src/modules/routes-generator.ts`) only considers
  burgs with `port` set, calls `assignTradeRoles` itself, and needs only
  `buildNavigableComponents()` and (on wrap maps) `buildSeaAdjacency()` — both
  derivable standalone, so a partial rebuild is possible.
- `Routes.rebuildAirroutes()` is the precedent for a partial rebuild: remove
  the group's routes, regenerate, redraw if the layer is on.

## 1. Burg editor — trade-role select

**Markup** (`src/index.html`, `#burgEditor` dialog): a new row below the
Population row:

```html
<div id="burgTradeRoleRow" data-tip="Trade-network role: Auto lets generation decide; Hub/Waystation/None override it permanently">
  Trade role: <select id="burgTradeRole">
    <option value="auto">Auto</option>
    <option value="hub">Hub</option>
    <option value="waystation">Waystation</option>
    <option value="none">None</option>
  </select>
</div>
```

The row is hidden unless the burg is a port (same pattern as
`burgAltitudeRow` for flying burgs): trade roles only apply to ports.

**Wiring** (`public/modules/ui/burg-editor.js`):

- On editor open: show the row if `burg.port`; set the select to
  `burg.tradeRoleManual ? (burg.tradeRole ?? "none") : "auto"`. The Auto
  option's *label* reflects the computed role: "Auto (hub)",
  "Auto (waystation)", or plain "Auto" when generation assigned none.
- On change:
  - `auto` → `delete burg.tradeRoleManual` (leave `tradeRole`; the rebuild's
    `assignTradeRoles` recomputes it).
  - `hub` / `waystation` → `burg.tradeRole = value; burg.tradeRoleManual = true`.
  - `none` → `delete burg.tradeRole; burg.tradeRoleManual = true`.

  Then call `Routes.rebuildTradeRoutes()` and refresh the Auto option label
  (the computed role may have changed).
- Toggling port off hides the row but keeps the flags — non-ports are skipped
  at generation, so stale flags are harmless and reappear if port is restored.
- Port toggling does NOT trigger a trade rebuild; trade lanes for a new/removed
  port update on the next full route regeneration, as today.
- Remember the editor checkbox gotcha does not apply (this is a `<select>`),
  but the editor's `?v=` cache-bust token must be bumped if burg-editor.js is
  versioned in index.html.

## 2. `Routes.rebuildTradeRoutes()` (`src/modules/routes-generator.ts`)

Public method mirroring `rebuildAirroutes()`:

1. Remove every route with `group === "traderoutes"` via `this.remove()`.
2. `const components = this.buildNavigableComponents();`
   `const seaAdjacency = isWrapEnabled() ? this.buildSeaAdjacency() : undefined;`
3. `const tradeRoutes = this.generateTradeNetwork(components, seaAdjacency);`
   — re-runs `assignTradeRoles`, which respects `tradeRoleManual`.
4. Renumber with `getNextId()` and push onto `pack.routes`.
5. `if (layerIsOn("toggleRoutes")) drawRoutes();`

**Implementation check:** verify whether trade routes register their cells in
`pack.cells.routes` during normal generation. `this.remove()` unlinks routes
from `cells.routes`; removal and re-add must stay symmetric. If trade lanes do
register connections, the rebuild must do the same after pathfinding (as
`rebuildAirroutes` does manually).

**Tests** (`src/modules/routes-generator.test.ts`, following existing
patterns):

- A manual hub keeps its role and stays in the network after rebuild.
- A manual `none` on a would-be hub excludes it from the network.
- Rebuild is idempotent: two consecutive rebuilds with no role changes yield
  the same traderoutes count and no leftover/duplicate routes in
  `pack.routes` or `cells.routes`.

## 3. Styling across presets

- Add a `#traderoutes` block to the 11 presets that lack it (`ancient`,
  `atlas`, `clean`, `cyberpunk`, `darkSeas`, `gloom`, `light`, `monochrome`,
  `night`, `pale`, `watercolor`). Keep the "global lane" signature from
  `default.json` — `stroke-dasharray: "3 2"`, `stroke-linecap: "butt"`,
  `stroke-width` ~1, `opacity` 0.9 — with a per-theme stroke color derived
  from each preset's roads/searoutes palette (light ink on dark themes like
  night/darkSeas/gloom, neon accent for cyberpunk, sepia for ancient, etc.).
- Add `"#traderoutes": ["opacity", "stroke", "stroke-width",
  "stroke-dasharray", "stroke-linecap", "filter", "mask"]` to the properties
  map in `public/modules/ui/style-presets.js`, next to `#searoutes` /
  `#airroutes`.
- Cleanup of stale trunk-tier selectors (nothing emits route type `"major"`
  since the trunk tier was removed in `aabdad78`):
  - Remove the `#routes #major` block from all 12 presets (every preset
    carries it).
  - Remove `"major"` from the route-type list in `style-presets.js`
    (currently `["royal", "main", "market", "town", "trail", "footpath",
    "major", "local"]`).

## Verification

- `tsc --noEmit` clean; unit tests green.
- Manual: on a generated map, open a port burg, force Hub — trade lanes
  redraw immediately and connect the burg; force None on an existing hub —
  its lanes drop; switch back to Auto — original computed role returns.
  Cycle style presets and confirm trade lanes remain visible and themed.
