# Gravity-Based Maritime Trade Network

**Date:** 2026-06-03
**Status:** Design approved, pending implementation plan

## Problem

The current sea-route generation produces a sparse, feature-siloed network that
does not read as a believable mercantile world:

- **Major sea routes** (`generateMajorSeaRoutes`) build a minimum spanning tree
  over only **capital ports** (`port && (capital || isLargePort)`), grouped per
  water feature. Capital ports are rare, so an ocean with two of them yields a
  single route — hence a typical map shows essentially one "major" sea line.
- **Local sea routes** (`generateSeaRoutes`) Urquhart-pair all ports per water
  feature but hard-reject any pair more than **50 km** apart, so the long
  open-water hauls that real medieval trade used (bigger ships skipping large
  stretches of coastline) are filtered out entirely.
- **Both** group ports by `burg.port` (the water-feature id). Two ports on
  different features are never paired. On a full-globe (360) map the west-edge
  ocean and east-edge ocean are different feature ids, so even with the
  seam-adjacency graph in place the generators never pair across the seam —
  cross-edge sea routes require faking land at both edges.

We want a richer, importance-aware sea-trade network with clear trunk routes and
feeders, long open-water hauls between significant ports, and working cross-seam
connections on 360 maps.

## Scope

**In scope:**
- Replace the two existing sea-route generators with a single gravity-based
  network builder that produces tiered routes (trunk / feeder / coastal).
- Importance-weighted hub-and-spoke topology.
- Cross-water pooling so seam-joined ocean features share one navigable pool on
  360 maps (this is also the cross-edge fix).
- Long open-water hauls between hubs (emergent from pairing distant hubs; A*'s
  existing water cost draws the line).

**Out of scope:**
- Land routes (roads, trails, footpaths) — unchanged.
- **Land portage / canals** between two genuinely separate seas (different
  navigable components). Different water features are separated by land and have
  no water path, so no sea route can connect them except via the seam.
- **Relaxing the `lonT === 360` gate.** Cross-edge wrapping stays gated on full
  360 maps by decision; this work only makes it *work* there (via cross-water
  pooling), it does not change the gate.
- **Great-circle air routes** — still straight wrapped lines (separate future
  feature, see the seam-wrapping spec).

## Key decisions

1. **Network model:** gravity hub-and-spoke. Edge desirability between two ports
   is `g(a,b) = imp(a)·imp(b) / wrapDistanceSquared(a,b)`. This produces trunk
   routes between important hubs plus feeders from smaller ports onto nearby
   hubs.
2. **Importance:** `imp(burg) = burg.population × roleMult(settlementType)`, with
   `roleMult`: capital 3.0, largePort 2.2, regionalCenter 1.6, marketTown 1.2,
   village (large/small) 1.0, hamlet 0.8, default 1.0. A `capital` flag is
   treated as the `capital` role regardless of `settlementType`.
3. **Cross-water = navigable components.** Ports are grouped by *navigable water
   component*, not raw feature id. Components are feature ids unioned by the
   seam links that `buildSeaAdjacency()` creates (360 maps only). On non-360
   maps no unions occur, so `component === featureId` and behavior is unchanged
   except for the new topology within each feature.
4. **Three tiers, two existing styles.** trunk → route `type:"major"`
   (existing `#routes #major`, width 0.63); feeder and coastal → `type:"local"`
   (existing `#routes #local`, width 0.36). No style-preset, `layers.js`, or
   persisted-type changes. Saved maps and the routes editor are unaffected.
5. **Long-haul realism is emergent.** No new pathfinding cost. Trunk hub pairs
   are far apart, and `getWaterPathCost` already returns the cheapest water path
   (roughly direct across open water), so trunk routes naturally skip coastline.
6. **Density preset "medium/balanced"**, expressed as named constants at the top
   of the module so they are trivially retunable:
   - `FEEDER_LINKS = 3` (top gravity partners each port connects to)
   - `TRUNK_HUB_FRACTION = 0.10` (fraction of a component's ports that are hubs,
     minimum 2)
   - `TRUNK_LINKS = 3` (top hub-to-hub gravity partners per hub)
   - `COASTAL_CAP_KM = 120` (raised from the current 50)
   - `TRUNK_SAFETY_CAP_KM = 600` (upper bound so two tiny lone hubs do not draw
     a map-spanning line; generous, rarely binding)
7. **No data-model or save-format change.** Route shape is unchanged; tiers map
   to the existing `type` values.

## Architecture

All changes live in `src/modules/routes-generator.ts`. No `pathUtils.ts` change.

### Component 1 — `portImportance(burg): number`

Pure function. `population × roleMult`. Used for hub selection and gravity
weights. `roleMult` is a module-level constant map keyed by `settlementType`,
with the `capital` flag overriding to the capital multiplier.

### Component 2 — `buildNavigableComponents(): Map<number, number>`

Returns `featureId → componentId`.

1. Union-find over the set of water-feature ids that have at least one
   non-flying port.
2. When `isWrapEnabled()`, the seam pairs from `buildSeaAdjacency()` (see
   Component 3) are `union()`-ed: each seam link between a west-edge water cell
   `w` and an east-edge water cell `e` unions `cells.f[w]` with `cells.f[e]`.
3. `componentId` = union-find root of the feature.

On non-360 maps step 2 contributes nothing, so each feature is its own
component (identity mapping over port-bearing features).

### Component 3 — `buildSeaAdjacency()` extension

`buildSeaAdjacency()` already builds the seam-augmented neighbor array. Extend it
to also expose the feature pairs it links, so `buildNavigableComponents()` can
union them without re-deriving the matching. Two acceptable shapes (implementer's
choice in the plan):

- return `{ adjacency: number[][], seamFeaturePairs: Array<[number, number]> }`, or
- keep the return type and collect pairs via an out-parameter / sibling method
  that shares the west/east edge-matching logic.

The existing seam-adjacency behavior (bidirectional links, copy-on-write inner
arrays, `pack.cells.c` never mutated, empty-edge early return) is preserved.

### Component 4 — `selectSeaTradeEdges(ports): Edge[]`

Given the ports of one navigable component (length ≥ 2), produce a deduped set of
edges, each tagged `tier: "trunk" | "feeder" | "coastal"`. `Edge` carries the two
port indices and the tier.

- **feeder:** for each port, rank the others by `g` descending and take the top
  `FEEDER_LINKS`. Guarantees every port has ≥ 1 link (de-silos small ports onto
  nearby hubs).
- **trunk:** `hubs` = the top `ceil(TRUNK_HUB_FRACTION × ports.length)` ports by
  `imp` (minimum 2). For each hub, take its top `TRUNK_LINKS` gravity partners
  *among the hubs*. Reject a trunk edge only if its wrapped km distance exceeds
  `TRUNK_SAFETY_CAP_KM`.
- **coastal:** existing Urquhart pairing (wrap-aware on 360 via
  `calculateUrquhartEdges(points, wrap, graphWidth)`), keeping pairs with wrapped
  km distance ≤ `COASTAL_CAP_KM`.

Dedup by unordered index pair; on collision keep the **highest** tier
(trunk > feeder > coastal). Distances use
`wrapDistanceSquared(a, b, isWrapEnabled(), graphWidth)`; km uses the existing
`mapScale = sqrt(graphWidth·graphHeight / 1e6)` divisor.

### Component 5 — `generateSeaTradeNetwork(...) → { trunkRoutes, localRoutes }`

Replaces both `generateMajorSeaRoutes` and `generateSeaRoutes`. Signature mirrors
them: `(connections, burgIndex, seaAdjacency?, components)`.

```
group ports by componentOf(burg.port)         // Component 2
for each component with ≥ 2 ports:
  edges = selectSeaTradeEdges(ports)           // Component 4
  for (a, b, tier) of edges:
    segments = findPathSegments({              // unchanged
      isWater: true, connections,
      start: a.cell, exit: b.cell, seaAdjacency
    })
    for segment of segments:
      addConnections(segment, connections)
      (tier === "trunk" ? trunkRoutes : localRoutes).push({
        feature: a.port,   // originating port's real feature id (valid for legacy consumers)
        cells: segment,
        type: tier === "trunk" ? "major" : "local"
      })
return { trunkRoutes, localRoutes }
```

`addConnections` is called as edges are realized so later edges reuse shared
water lanes (the existing `connectionModifier = 0.5` reward), exactly as today.

### Component 6 — `createRoutesData` wiring

Replace the two calls (lines 1099–1100) with a single
`generateSeaTradeNetwork(...)` call after computing
`components = buildNavigableComponents()`. Feed `trunkRoutes` into the existing
major `mergeRoutes → searoutes` loop and `localRoutes` into the existing local
loop. Everything downstream (`getPoints`, `getPath`, `getLength`, links) is
untouched.

## Data flow

```
createRoutesData()
  └─ seaAdjacency = isWrapEnabled() ? buildSeaAdjacency() : undefined
  └─ components   = buildNavigableComponents()      // unions seam features on 360
  └─ generateSeaTradeNetwork(connections, burgIndex, seaAdjacency, components)
       └─ group ports by navigable component
       └─ selectSeaTradeEdges → trunk/feeder/coastal edges (gravity)
       └─ findPathSegments per edge (A* over water, seam-aware on 360)
       └─ { trunkRoutes: type "major", localRoutes: type "local" }
  └─ mergeRoutes(trunkRoutes) → searoutes
  └─ mergeRoutes(localRoutes) → searoutes
```

## Error handling & edge cases

- **Component with < 2 ports:** skipped (no routes), same as today's
  `length < 2` guards.
- **No water path between a paired pair:** within one navigable component a water
  path normally exists; if A* still returns none (e.g. frozen seam latitudes at
  `temp < MIN_PASSABLE_SEA_TEMP`), `findPathSegments` returns `[]` and the edge is
  silently dropped.
- **Non-360 map:** `buildNavigableComponents` is identity over features; no seam
  pooling; trunk/feeder/coastal still apply within each feature, so the network
  is richer but stays within real water bodies.
- **All ports same importance / population:** gravity degenerates to a
  distance-only graph; feeders still connect nearest neighbors, hubs fall back to
  the highest-population ties. No division by zero (distinct port coordinates →
  nonzero `wrapDistanceSquared`).
- **Dense port maps:** edge count stays O(ports) (bounded by `FEEDER_LINKS`,
  `TRUNK_LINKS`, and Urquhart's planar edge count), so A* call volume is
  comparable to the current per-feature Urquhart + MST.

## Performance

- Importance and gravity are cheap arithmetic.
- Hub all-pairs gravity scoring is O(hubs²) arithmetic per component; hubs are a
  small fraction of ports, so this is negligible.
- A* calls ≈ total selected edges = O(ports), comparable to today. No new
  per-edge work inside the A* hot loop (the wrap gate is already hoisted in
  `createCostEvaluator`).

## Testing

Unit tests (Vitest, alongside `routes-generator.test.ts`):

- `portImportance`: capital > largePort > regionalCenter > marketTown > village >
  hamlet at equal population; population scales monotonically within a role.
- `buildNavigableComponents`: non-360 map → identity (each port-feature its own
  component); 360 map with seam pairs → seam-joined features share a component.
- `selectSeaTradeEdges`: every port gets ≥ 1 feeder edge; the top-importance
  ports appear as trunk endpoints; no coastal edge exceeds `COASTAL_CAP_KM`; no
  trunk edge exceeds `TRUNK_SAFETY_CAP_KM`; duplicate index pairs collapse to a
  single edge with the highest tier.
- Two-component synthetic case: ports in different components are never paired
  off-seam; with a seam union they become one component and a cross-seam edge is
  selected.

Manual verification: regenerate routes on a normal map — confirm a visibly
richer sea network with bold trunk lines and thinner feeders, no hairball; on a
full-360 map with ports near both edges, confirm trunk/feeder routes wrap across
the seam as clean edge stubs.

## Files touched

- `src/modules/routes-generator.ts` — `portImportance`, `roleMult` constant,
  `buildNavigableComponents`, `buildSeaAdjacency` extension (expose seam feature
  pairs), `selectSeaTradeEdges`, `generateSeaTradeNetwork` (replacing
  `generateMajorSeaRoutes` + `generateSeaRoutes`), `createRoutesData` wiring,
  density constants.
- `src/modules/routes-generator.test.ts` — tests above.

## Future enhancements (out of scope)

- Land portage / canal hops between separate seas.
- Trade-volume-weighted stroke width (continuous, beyond the two-tier styling).
- Great-circle air routes (tracked in the seam-wrapping spec).
