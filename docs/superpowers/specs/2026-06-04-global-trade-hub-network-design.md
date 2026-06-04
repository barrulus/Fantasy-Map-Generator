# Global Trade Hub Network — Design

**Date:** 2026-06-04
**Branch:** `feat/global-trade-hub-network` (off `feat/gravity-maritime-trade-network`)
**Status:** Design approved, pending spec review

## Summary

Replace the **trunk** tier of the gravity sea-trade network with a new, separate
**global trade hub network**: a two-tier port hierarchy (hubs + waystations) wired
together by **multi-hop** trade routes that hop between real ports to refuel/restock,
bending around coastlines. The existing **feeder + coastal** tiers stay as the
regional network. The new layer mirrors how airroutes are a separate route layer,
and is designed so a user can later shape it by manually promoting ports.

## Motivation

The trunk tier was a proximity/Urquhart inter-landmass backbone that pathed
straight across open water. We want a richer "global trade" model where:

- Trade prefers central ports as connectors; distant trade happens via **multi-hop**
  routes (a waystation = a real port where a vessel refuels/restocks or hands off).
- Two classes of major port exist, by role:
  - **Hubs** — route termini; one per state, anchored near the capital.
  - **Waystations** — relay-only intermediate stops; any large port.
- Users can manually designate ports to reshape their world's trade (data model in
  v1; editor UI a later iteration).

## Decisions (from brainstorming)

1. **Relationship to existing sea-trade:** *Replace the trunk tier.* Feeder + coastal
   remain as the regional network; the new hub network is the single global backbone.
2. **Lane geometry:** *Waypoint-routed* — the waypoints are real waystation ports.
3. **Hub selection:** *Closest to capital, min size* — one hub per state.
4. **Node hierarchy:** *Two tiers* — hubs (termini) + waystations (relay-only).
5. **Viability:** *Leg range R + hop cap H* — an edge exists between ports within one
   leg range R; a hub pair trades iff a path of ≤ H hops connects them, else it is
   not viable.
6. **Leg drawing:** *Straight, fall back to water path if it clips land.*
7. **v1 scope:** *Generation + data model only* — no editor UI this iteration; honor
   a manual-override flag if present.

## Architecture

Isolate the novel algorithm; keep `routes-generator.ts` as the glue.

- **`src/modules/trade-network-generator.ts`** (new) — pure trade-hub algorithm:
  node selection, leg-graph construction, multi-hop routing. Takes ports + params +
  a "can sail straight A→B?" predicate (and a same-component lookup); returns trade
  routes as **port-id sequences**. No `pack` access → unit-testable in isolation.
- **`src/modules/air-routes-generator.ts`** (new) — `generateAirRoutes` moved here
  (Urquhart over sky-port positions → direct point lines). Pulled out of
  `routes-generator.ts` to reduce its size; it's the sibling "separate route layer".
- **`routes-generator.ts`** keeps cell-based roads + feeder/coastal sea, plus shared
  assembly (`createRoutesData`, `mergeRoutes`, `getPoints`, `buildLinks`). It calls
  both new modules and turns trade port-sequences into drawable legs (incl. the
  water-path fallback).
- **`calculateUrquhartEdges`** is promoted from a private `RoutesModule` method to a
  shared util (both the old layers and `air-routes-generator` need it).

## Data model

New `Burg` fields (in `src/modules/burgs-generator.ts`):

- `tradeRole?: "hub" | "waystation"` — computed role (absent = neither).
- `tradeRoleManual?: boolean` — set when a user designates a role; auto-assignment
  never overrides a manual role. This is the v1 shaping hook (usable before UI exists).

Both persist in burg serialization. Older saves without the fields load fine (no
roles until regen).

## Selection (auto; re-run each generation, manual roles preserved)

Runs at routing time (state, capital, port, and population are all available by then).
"Size" throughout means `portImportance(burg)` (the existing importance score). All
distances are wrap-aware (`wrapDistanceSquared`).

- **Hubs:** for each state, among its ports (`burg.port`, `burg.state === s`, not
  `removed`/`flying`) with size ≥ `MIN_HUB_SIZE`, pick the one **nearest the state's
  capital** (wrap-aware distance) → `tradeRole = "hub"`. States with no qualifying
  port get no hub.
- **Waystations:** every large port (`isLargePort` or `settlementType === "largePort"`)
  not already a hub → `tradeRole = "waystation"`. ("Any large port" — no extra size
  floor beyond the large-port class itself.)
- A burg with `tradeRoleManual` keeps its role and is excluded from auto-reassignment.

## Leg graph + multi-hop routing (`trade-network-generator.ts`)

- **Nodes** = all ports with a `tradeRole` (hubs ∪ waystations).
- **Leg graph:** edge `a–b` iff *same navigable component* **and** wrap-aware
  straight-line distance ≤ R (`TRADE_LEG_RANGE_KM`). A node's component is that of
  its water feature `burg.port`, mapped through `buildNavigableComponents` (the same
  pooling `generateSeaTradeNetwork` uses, so seam-joined oceans on 360 maps share a
  component). Node count is small; O(n²) build is acceptable (quadtree only if
  measured slow).
- **Routing:** for each unordered hub pair in the same component, BFS (fewest hops,
  tie-broken by distance) bounded to ≤ H hops (`TRADE_MAX_HOPS`). Reachable → a
  viable trade route (port-id sequence). Unreachable within H → skipped.
  - Intermediates may be waystations *or* other hubs (a vessel may refuel at a hub in
    passing); only hub **endpoints** are termini.
- **Output:** list of viable trade routes as port-id sequences. Pure function.

## Leg drawing + assembly (`routes-generator.ts` glue)

- **Leg union:** collect every distinct consecutive-port pair across all viable
  routes; draw each physical leg **once**, tracking a per-leg **usage count** (how
  many routes traverse it) for future "busier = bolder" styling. v1 may render
  uniformly.
- **Draw a leg:** straight `[a, b]` points if the segment stays over water (sampled
  water check); else fall back to `findPath` for that one leg → cells → points.
  Wrap-aware; seam-crossing straight legs render via the existing `getPath`
  seam-split.
- Emit as a new route group **`"traderoutes"`**.

**Constants** (in `trade-network-generator.ts`): `MIN_HUB_SIZE`,
`TRADE_LEG_RANGE_KM` (R), `TRADE_MAX_HOPS` (H). Initial values start from the
existing sea-trade scale (e.g. R near `SEA_FEEDER_CAP_KM`) and are tuned empirically
via the TIME diag — same approach as the `SEA_*` constants.

## Trunk removal

- Strip the trunk tier from `selectSeaTradeEdges` / `generateSeaTradeNetwork`:
  gateways, `considerCrossing`, cross-seam trunk pairing, and the trunk routing
  branch. `generateSeaTradeNetwork` returns only feeder+coastal.
- Retire the `SEA_TRUNK_*` constants and the already-dead `capitalPortsByFeature`
  field.
- Seam crossings stay covered: feeder/coastal via `seaAdjacency`; the global layer
  via wrap-aware straight legs + `getPath` seam-split (fallback water-path legs use
  `seaAdjacency` on 360 maps).

## Rendering / layer wiring (mirror airroutes)

- New `traderoutes` `<g>` under `#routes` (set up in `main.js`). `drawRoutes()` is
  generic (iterates `pack.routes` by group), so it renders the group automatically
  once styled.
- Add `traderoutes` styling — distinct "global lane" look (bold amber, likely
  dashed) — to `default.json` first; other presets a follow-up.
- Add a `traderoutes` layer toggle so it shows/hides independently.

## Save / load

- `tradeRole` + `tradeRoleManual` persist in burg serialization.
- `traderoutes` persists with other route groups.
- Backward compatible: older maps lack the fields/group; they regen cleanly.

## Performance

- Selection O(burgs); leg graph O(n²) over the small trade-node set; routing
  ≤ (#hubs choose 2) bounded BFS. Straight legs are free; water-path fallback is
  rare. Net likely a small **speedup** vs today, since the trunk A* is removed.
- TIME diag logs: #hubs / #waystations / #viable routes / #legs / #fallback legs / ms.

## Testing (TDD)

Fixtures use **land** port cells reached across water (per
`fmg_sea_route_pathfinding_lessons`: water-port fixtures hide land-target bugs).

- **Unit** (pure `trade-network-generator`):
  - hub selection: nearest-capital, min size, one per state, landlocked → none,
    manual override preserved.
  - waystation selection: large ports, not hubs.
  - leg graph: edge iff same component + ≤ R; cross-component excluded; wrap-aware.
  - routing: ≤ H hops viable, > H skipped; fewest-hop path; hub-as-intermediate
    allowed; waystation never a terminus.
  - leg-union dedup + usage count.
- **Integration** (`routes-generator`): trade routes produced with land ports; hubs
  are termini, waystations intermediate-only; straight vs fallback leg drawing; no
  trunk routes emitted.

## Out of scope (later iterations)

- Burg-editor UI to toggle hub/waystation and re-run the network.
- `traderoutes` styling across all 12 presets.
- Trade-volume / usage-weighted styling (the per-leg usage count is stored to enable
  this later).
- Downstream "useful ideas" (piracy, chokepoints, tolls) the network enables.
