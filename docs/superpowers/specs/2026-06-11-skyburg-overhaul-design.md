# Skyburg overhaul: variable altitude, population floor, sky state, terrain-weighted placement

2026-06-11. Covers the skyburg improvements requested after investigating the
"skyburg altitudes below sea level" report, plus the elevation display/export
fixes from that investigation.

## Background / findings that drove this

- `burg.altitude` is a flat 500 everywhere (`src/modules/burgs-generator.ts:547`,
  `:1125`); it is never derived from terrain. The "below sea level" numbers come
  from elevation surfaces that read the terrain height of the cell under the
  burg and ignore `flying`: the burg editor's Elevation line
  (`burg-editor.js`, `getHeight(pack.cells.h[b.cell])` → negative for water
  cells), the burgs-overview CSV Elevation column, and
  `tools/geojson-exports/export-burgs.js` (`elevation: pack.cells.h[b.cell]`,
  no altitude property at all).
- Pipeline order (`public/main.js:731-746`): `Burgs.generate()` →
  `States.generate()` → `Burgs.specify()` (populations, emblems, groups) →
  `defineStateForms` → `Provinces.generate()` → `Military.generate()`.
  Consequence: the sky capital must be chosen at placement time (before
  populations exist), and altitude must be assigned in `specify()` (after).
- `expandStates()` ends with `b.state = cells.state[b.cell]` for ALL burgs
  (`states-generator.ts:255`) — skyburgs are currently absorbed into whatever
  ground state's territory they float over.
- `expandStates()` seeds every non-removed state with
  `cells.state[capitalCell] = state.i` (`states-generator.ts:138-147`) — a sky
  state must be skipped here or it claims ground/ocean cells.
- `definePopulation` for flying burgs: `gauss(0.6, 0.4, 0.2, 1.5)` units +
  index jitter, floored at 0.01 units — the intended 100-person minimum only
  holds at default `populationRate`/`urbanization`.
- Skyburg placement (`generateSkyBurgs`, `burgs-generator.ts:494-553`):
  uniform scatter in a disc (radius 10% of map min dimension) around one
  random coastal anchor — the "circular blob".

## 1. Variable altitude: 50–500 ft above the local surface

**Semantics change:** `burg.altitude` means feet above the surface directly
below the burg (ground level on land, sea surface over water) — no longer a
nominal absolute.

- New exported pure function in `burgs-generator.ts`:
  `skyburgAltitude(population: number): number` — linear interpolation from
  50 ft at ≤0.1 population units to 500 ft at ≥1.5 units, rounded to the
  nearest 10 ft. Monotonic; clamped to [50, 500].
- Assigned during `Burgs.specify()` for every flying burg right after
  `definePopulation` (population is the input). The sky capital's population
  exceeds 1.5 units so it clamps to 500 ft.
- Manual editing in the burg editor still works exactly as today (the change
  handler writes whatever the user types); regeneration overwrites it like
  any other generated property.
- `Burgs.add()` manual flying placement keeps its `altitude ?? 500` default
  (no population exists yet at add time; the editor input governs).

## 2. Population floor: skyburgs never below 100 people

In `definePopulation`, flying branch: after the gauss + jitter, clamp to
`minUnits = 100 / (populationRate * urbanization)` (the globals used by the
editor's population display), replacing the current `Math.max(population,
0.01)`. If either global is unavailable (unit tests), fall back to 0.1 units.
The ordinary flying range stays 100–1500 people at default rates.

## 3. Sky capital and sky state

**Capital selection** (in `generateSkyBurgs`, placement time): the placed
skyburg nearest the anchor point gets `capital: 1` and
`settlementType: "capital"`. All other skyburg fields unchanged.

**Population:** `definePopulation` branches on `flying && capital`:
`gauss(3, 1.5, 2, 6)` units (≈2k–6k people at default rates) — the largest
settlement in the sky cluster, but far below ground capitals.

**State creation:** no new creation code — `createStates()` already builds a
state for every `capital: 1` burg (name from culture, COA, color, type,
diplomacy). The sky state needs three guards in `states-generator.ts`:

1. **Expansion seeding:** in the seed loop of `expandStates()`, `continue`
   when `burgs[state.capital].flying` — the sky state claims no cells, so
   `cells.state` is never written with its id.
2. **Burg-state assignment:** the post-expansion loop becomes
   `b.state = b.flying ? skyStateId : cells.state[b.cell]`, where
   `skyStateId` is the id of the state whose capital burg is flying (0 if
   none exists, preserving today's neutral fallback when skyburgs are
   disabled).
3. **Label pole:** after `getPoles()`, set the sky state's `pole` to
   `[capital.x, capital.y]` so its label renders over the cluster instead of
   defaulting to `[0, 0]`.

**Zero-cell side effects** (accepted, verified during implementation, guarded
only where code would otherwise throw): `cells/area/rural/urban = 0` in
statistics, no provinces, no military forces, empty `neighbors` →
no campaigns and default diplomacy entries. State forms naming stays generic.

**New burg group `skyburg-capital`:** added to the default groups list in
`burgs-generator.ts` (next to the three existing skyburg groups:
`{ name: "skyburg-capital", active: true, order: 10, features: { flying:
true } }`) and to the `BURG_MIN_ZOOM` label map in `public/main.js:551`
(`"skyburg-capital": 2` — label visible from low zoom, like ground
capitals). `defineGroup`: flying && capital → `"skyburg-capital"`, otherwise
the existing `skyburgGroupFromPopulation`. Styling falls back to the dynamic
per-group preset handling (explicit preset blocks are an optional
follow-up).

## 4. Terrain-weighted disc placement

Keep the coastal anchor and disc radius. For each candidate point, look up
the underlying cell's distance-to-coast field `cells.t` and accept with
probability:

| `|cells.t|` | meaning | acceptance |
|---|---|---|
| 1 | coastal land / coastal water | 1.0 |
| 2 | one ring further | 0.5 |
| ≥3 or 0 | deep ocean / far inland / lakes | 0.15 |

(`if (Math.random() > weight) continue;` before the quadtree spacing check.)
The attempt budget doubles (`skyburgCount * 60`) to compensate for
rejections. Density then traces coastlines and islands inside the disc;
open-ocean and deep-inland placements become rare but possible.

The weight lookup is an exported pure helper
(`skyburgPlacementWeight(t: number): number`) for testability.

## 5. Elevation display/export fixes

- **Burg editor** (`public/modules/ui/burg-editor.js`): when `b.flying`, the
  Elevation line shows `${b.altitude} ft above ${cells.h[b.cell] < 20 ? "the
  sea" : "ground level"}` (the static "above sea level" suffix is folded into
  the dynamic string); ground burgs keep `getHeight(...)` exactly as today.
  The Altitude row tooltip becomes "Altitude above the local surface (ground
  or sea) in feet". Bump the burg-editor `?v=` cache token.
- **Burgs overview CSV** (`public/modules/ui/burgs-overview.js`): new
  "Altitude (ft)" column after Elevation — `b.altitude` for flying burgs,
  empty for ground burgs. Elevation column unchanged (terrain).
- **GeoJSON** (`tools/geojson-exports/export-burgs.js`): add
  `altitude: b.altitude || 0` to properties; `elevation` stays raw terrain
  `h` as today.

## Testing

- `burgs-generator.test.ts`: `skyburgAltitude` (monotonic, clamps at 50/500,
  rounds to 10), `skyburgPlacementWeight` (three tiers),
  `skyburgGroupFromPopulation` capital behavior if touched.
- `definePopulation` flying floor: with mocked `populationRate`/
  `urbanization` globals, population never below the 100-person equivalent;
  flying capital lands in 2–6 units.
- States: minimal-pack test that `expandStates` (a) does not write
  `cells.state` for the flying-capital state, (b) assigns all flying burgs to
  the sky state id, (c) leaves ground burgs on `cells.state[b.cell]`.
- Manual: generate a map — skyburg cluster hugs the coast, capital label and
  distinct icon present, sky state listed in the states editor with 0 cells,
  editor shows "N ft above the sea/ground level" for skyburgs, CSV and
  GeoJSON contain altitude.

## Out of scope

- Temperature lapse for flying burgs (editor/exports still show the
  underlying cell's sea-level temperature).
- Sky-state military (zero forces is fine), provinces, or custom state form
  names ("Sky Dominion" etc.).
- Re-deriving altitude when a burg's population is edited manually.
