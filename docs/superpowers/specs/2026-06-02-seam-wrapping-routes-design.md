# Seam-Wrapping Sea & Air Routes

**Date:** 2026-06-02
**Status:** Design approved, pending implementation plan

## Problem

On an equirectangular FMG map, the east and west edges are a seam: a continent
hugging the west edge and one hugging the east edge are geographically close on a
globe but appear maximally far apart on the flat map. Routes cannot cross this
seam, so:

- Sea-farers cannot circumnavigate (cross the antimeridian).
- No trade/logistics routes can open between two continents that are close across
  the seam but far apart on the flat map.

We want sea routes and air routes to be able to wrap across the east/west seam,
treating the map as a cylinder — **but only when the map actually represents a
full globe.**

## Scope

**In scope:**
- Sea routes (local sea routes and major sea routes) crossing the seam.
- Air routes (sky-port to sky-port) crossing the seam.

**Out of scope:**
- Land routes (roads, trails, footpaths) — excluded by decision.
- North/south (pole) wrapping — only east/west.
- An explicit, guaranteed "great circumnavigation" route — behavior is **emergent**
  from seam-aware generation, not a dedicated generator.

## Key decisions

1. **Gate:** wrap is enabled only when `mapCoordinates.lonT === 360`. `lonT` is
   computed as `rn(Math.min((graphWidth / graphHeight) * latT, 360), 1)`
   (`public/main.js:995`), so it is clamped to exactly `360` on full-globe maps —
   making `=== 360` a reliable exact test. On any non-global map, **no code path
   changes** (strong safety property). Seam width is `graphWidth`.
2. **Sea crossing:** organic, terrain-aware path via a **seam-augmented adjacency
   graph used for sea pathfinding only**. The global `pack.cells.c` (states,
   biomes, provinces) is never modified.
3. **Circumnavigation is emergent:** make existing sea/air generators seam-aware;
   cross-seam routes appear wherever they are the shortest connection.
4. **Rendering:** split a route at each seam crossing and **extend each stub to the
   frame** (`x=0` / `x=graphWidth`) so stubs run cleanly off the edge.
5. **Persistence:** no new stored fields. Wrap is detected geometrically at render
   time. `.map` files remain backward/forward compatible.

## Architecture

All new logic lives in `src/modules/routes-generator.ts`, with one small,
inert-by-default change to `src/utils/pathUtils.ts` (`findPath` heuristic) and the
seam-split rendering inside `Routes.getPath()` (the single render chokepoint,
called from `public/modules/ui/layers.js:833`).

### Component 1 — Wrap gate (`isWrapEnabled`)

A helper returning `mapCoordinates.lonT === 360`. Every new branch is guarded by
it. `mapCoordinates` and `graphWidth` are globals.

```
function isWrapEnabled(): boolean {
  return typeof mapCoordinates !== "undefined" && mapCoordinates.lonT === 360;
}
```

### Component 2 — Seam-aware distance (`wrapDistanceSquared`)

A variant of `distanceSquared` where the x-gap wraps:

```
dx = |ax - bx|; if (wrap) dx = min(dx, graphWidth - dx)
return dx*dx + dy*dy
```

Used (only when wrap on) at:
- `generateMajorSeaRoutes` all-pairs MST edge weights.
- The `kmDistance > N` edge-length guards in the in-scope generators
  (local sea routes, major sea routes are not km-gated but local/Urquhart ones
  are) so a legitimate cross-seam pair is not rejected as "too far."

### Component 3 — Wrap-aware Urquhart (`calculateUrquhartEdges` variant)

Local sea routes and air routes pair points via Delaunay→Urquhart. Delaunay will
not connect `x≈0` to `x≈graphWidth` because they are geometrically far. Use the
standard **ghost-point** technique:

1. For each input point near an edge (within some margin of 0 or `graphWidth`),
   add a duplicate shifted by `+graphWidth` and/or `-graphWidth`.
2. Triangulate the augmented point set.
3. Map every edge back to its real (un-shifted) index; drop self-edges; dedupe.
4. Edges from a real west point to a ghost of an east point become real
   cross-seam pairings.

Point counts here (ports / sky-ports) are small, so the cost is negligible. Exposed
as a wrap-aware code path selected inside the burg-graph generators when wrap is on.

### Component 4 — Seam-augmented sea adjacency (isolated)

Built once per `generate()` when wrap is on:

1. Collect **west-edge water cells**: `x` within ~`grid.spacing` of `0` and
   `h < 20`. Collect **east-edge water cells**: `x` within ~`grid.spacing` of
   `graphWidth` and `h < 20`.
2. Pair each west cell with the east cell at nearest latitude (`y`); add
   **bidirectional** neighbor links.
3. Produce `seaAdjacency` = a shallow copy of `cells.c` with those links added.

Sea-route pathfinding is given a shimmed graph
`{ ...pack, cells: { ...pack.cells, c: seaAdjacency } }`. Land routes continue to
use `pack` unchanged.

Two essential supporting changes so A\* actually uses the seam:

- **Cost:** `getWaterPathCost` must use `wrapDistanceSquared` (when wrap on).
  Otherwise a seam step (`x≈0` vs `x≈graphWidth`) costs astronomically and is
  never taken.
- **Heuristic:** `findPath` gains an optional `wrapWidth?: number` parameter. When
  provided, its straight-line heuristic uses wrapped `dx`
  (`min(|dx|, wrapWidth - |dx|)`). Inert (and land routes unaffected) when the
  param is omitted. Sea-route calls pass `graphWidth`; land-route calls do not.

### Component 5 — Seam-aware rendering (`getPath` + `getPoints` guard)

- **Crossing detection:** consecutive points with `|dx| > graphWidth / 2`.
- **Split & extend:** split the polyline into sub-polylines at each crossing. At a
  crossing between point P (near one edge) and Q (near the other), interpolate the
  edge-intersection y and append a point at `x=0` to one stub and `x=graphWidth`
  to the other, so each stub runs to the frame.
- **Curve independently:** apply the existing Catmull-Rom curve to each
  sub-polyline separately, then concatenate with `M` into one path string. Still
  one `<path>` element per route → `getLength`, hover, and selection unaffected.
- **Smoothing guard:** in `getPoints`, skip the sharp-angle smoothing for any
  vertex whose previous/next neighbor is across a seam (`|dx| > graphWidth / 2`),
  since the angle math is meaningless there.

### Component 6 — Data model & persistence

No changes to the `Route` interface or save format. Wrap is detected geometrically
at render time. Saved wrap routes re-render correctly; old maps are untouched.

## Data flow (sea route, wrap on)

```
generate()
  └─ build seaAdjacency (Component 4)
  └─ generateMajorSeaRoutes / generateSeaRoutes
       └─ pair ports: wrap-aware Urquhart / wrap distance (Components 2,3)
       └─ findPathSegments → findPath(start, isExit, getWaterPathCost,
                                       shimmedPack, exit, wrapWidth=graphWidth)
            └─ A* walks water cells, uses a seam link as a normal neighbor step,
               resumes normally on the far side
  └─ getPoints (smoothing guard, Component 5)
  └─ getPath at render: split at seam, extend to frame, curve per-stub (Component 5)
```

## Error handling & edge cases

- **Non-global map (`lonT !== 360`):** every new branch is skipped; identical to
  current behavior.
- **Frozen seam latitudes:** seam cells with `temp < MIN_PASSABLE_SEA_TEMP` are
  already `Infinity`-cost; crossings naturally avoid frozen poles. Desired.
- **No edge ports / no edge water:** seam adjacency / pairings are simply empty;
  no routes wrap. No special-casing needed.
- **Multiple seam crossings in one route:** rendering split handles N crossings
  (loop over all `|dx| > graphWidth/2` boundaries).
- **Heuristic admissibility:** wrapped heuristic is the true straight-line lower
  bound on the cylinder, so A\* stays admissible and optimal.

## Testing

Unit tests (Vitest, alongside `routes-generator.test.ts` / `pathUtils.test.ts`):

- `wrapDistanceSquared`: wrap vs non-wrap; symmetric; equals `distanceSquared` when
  wrap off.
- `isWrapEnabled`: `lonT === 360` true; `359.9` / regional false.
- Wrap-aware Urquhart: a west point and an east point at the same latitude produce
  a cross-seam edge when wrap on, and do not when wrap off.
- Seam adjacency: west-edge water cell gains the nearest east-edge water cell as a
  neighbor; land edge cells do not; global `pack.cells.c` unchanged.
- `findPath` with `wrapWidth`: on a small synthetic cylinder graph, the returned
  path uses the seam link when it is the cheaper route; without `wrapWidth` it does
  not.
- `getPath` seam split: a point list crossing the seam yields a multi-`M` path with
  stubs reaching `x=0` and `x=graphWidth`; a normal route is unchanged.

Manual verification: generate a full-globe map (`lonT === 360`) with continents
near both edges; confirm sea and air routes wrap and render as clean edge stubs;
confirm a regional map is visually unchanged.

## Files touched

- `src/modules/routes-generator.ts` — gate, wrap distance, wrap-aware Urquhart,
  seam adjacency, wrap-aware water cost, sea-route pathfinding shim, `getPath`
  seam split, `getPoints` smoothing guard.
- `src/utils/pathUtils.ts` — optional `wrapWidth?` param on `findPath` (heuristic
  only; inert by default).
- Tests as above.
