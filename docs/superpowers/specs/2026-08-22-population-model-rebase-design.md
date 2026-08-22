# Population model rebase (project A) — design

**Status:** approved in brainstorm 2026-08-22, not yet planned or implemented.
**Prompted by:** Discord bug report (Blackstar3098) — culture "Wildlands" 14.6B vs state
"Neutrals" 6.3B over the same 281,251 cells. Root cause in
[`2026-08-22-population-collectors-inconsistency.md`](2026-08-22-population-collectors-inconsistency.md).

## The problem, restated

The fork's population model is burg-centric: the burg tiers *are* the rural/urban spectrum.
A hamlet of 10-50 people is rural population that happens to have a name and a dot on the
map. Vanilla FMG answers the same question differently — dispersed peasants living in cells,
counted via `cells.pop`, with burgs layered on top as urban population.

Counting both is not a rounding error. It is the same peasants counted twice under two
incompatible theories.

The fork currently does both, inconsistently, in six places. `States.collectStatistics()`
speaks the fork's model (skips `cells.pop` on burg cells; burgs ≤100 people count as rural).
Cultures, religions, provinces, biomes and zones are vanilla holdovers. Hence 14.6B vs 6.3B.

**This project makes the burg-centric model canonical and gives it exactly one
implementation.** It adds no new tuning dials — it makes the accounting truthful so that
projects B and C have something coherent to move.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Counting model | Burgs are the source of truth; `cells.pop` is the residual | Matches the fork's actual design; double-counting becomes structurally impossible |
| Where the subtraction happens | Derived from `cells.s`, recomputed on demand | Idempotent, so it is safe to re-run anywhere |
| Carrying capacity | Unchanged from `rankCells()` — no wilderness factor | FMG compatibility wins; burg density eats the capacity on its own |
| Rural/urban boundary | Tier-based: `marketTown` and above urban, `largeVillage` and below rural | A market town has a market; absolute headcounts stop meaning anything under project B's per-culture size dials |
| Urban attribution | The burg's own `state`/`culture`, not its cell's | It is the field the editors expose and the field project C turns into a mix |
| Sky burgs | Counted everywhere | They are people; excluding them in provinces alone breaks province-to-state sums |
| Military recruitment | From burgs, split by the same tier boundary | The fork's rural population lives in villages, not in cells |

## Section 1 — One derivation, and it is idempotent

`cells.pop` stops being stored state that many places write, and becomes derived output with
exactly one producer:

```
capacity(i)   = cells.s[i] * cells.area[i] / meanArea      // as rankCells() already computes
urbanPts(i)   = Σ (burg.population * urbanization) for every burg on cell i
cells.pop[i]  = max(0, capacity(i) - urbanPts(i))
```

The derivation reads `cells.s`, **never the current value of `cells.pop`**. It is therefore
idempotent: running it a thousand times gives the same answer. This is what makes it safe to
call on load, after any burg edit, after a regen pass, with no "have I already done this?"
bookkeeping. A version that subtracted from the current `pop` would corrupt the map on the
second call, and given how many code paths add or remove burgs, that would be a matter of
time.

It also self-heals a vanilla map loaded into the fork: that map's `cells.pop` carries vanilla
semantics but its `cells.s` is intact, so one call converts it. **No save-format change and no
version gate** — `cells.s` and `cells.pop` are already persisted as separate fields
(`src/services/io/save.ts:178` and `:181`, data slots 21 and 24).

Interop runs both ways: a fork map opened in vanilla FMG shows `cells.pop` as rural people and
burgs as urban population, and gets a coherent world — arguably more coherent than today's,
because the peasants are no longer counted twice.

### Recompute triggers

- end of map generation, after `Burgs.specify()`
- on load
- after any burg add / remove / population change
- on `changeUrbanizationRate()` (`src/controllers/units-editor.ts:82`), which today is one
  line setting the global and recomputing nothing

The urbanization slider consequently shifts people between countryside and town instead of
inflating the world's total, which is what it always claimed to do.

### Consequences to handle

**Manual rural edits.** The states, provinces and religions editors let the user type a
population and scale `cells.pop` to match. Under a single-producer rule those edits are
transient — the next recompute erases them. They move to scaling `cells.s` instead, so the
edit survives and means "this land supports more people".

**Capacity consumers switch fields.** Code that means "how good is this land" reads `cells.s`:
`src/generators/markers-generator.ts` filters (`pop > 5`, `< 3`, `<= 2`, and similar) and the
populated-cell test at `src/generators/cultures-generator.ts:1353`. Their thresholds are
expressed in `pop` units and must be **converted, not just renamed** — `pop` is `s` scaled by
relative cell area.

## Section 2 — One collector, six callers

The six aggregators differ only in how they bucket cells. That is the only thing that stays
per-caller:

```
// src/generators/population-generator.ts — extends the existing Population module
collectPopulationBy(keyOf: (cell) => number, bucketCount)   // states, cultures, religions,
                                                            // provinces, biomes
collectPopulationOf(cellIds)                                // zones — a cell can be in
                                                            // several zones, so no key fn
```

Each returns `{cells, area, rural, urban, burgs}` per bucket.

- `States.collectStatistics()` (`src/generators/states-generator.ts:533`) keeps its name and
  signature and delegates.
- The five editor-local collectors are **deleted**: `culturesCollectStatistics`
  (`src/controllers/cultures-editor.ts:216`), `religionsCollectStatistics`
  (`src/controllers/religions-editor.ts:226`), provinces' `collectStatistics`
  (`src/controllers/provinces-editor.ts:245`), `collectBiomeStatistics`
  (via `src/controllers/biomes-editor.ts:221`), and the inline totals in
  `getZonesData` (`src/controllers/zones-editor.ts:207`).

After this, one function decides what rural and urban mean. That is the actual fix: the
reported bug was not three semantics, it was three implementations.

A cell→burgs index is built once per collection pass, so **multi-burg cells are counted
everywhere** rather than only in provinces and zones.

### Rural/urban classification

| Tier | Typical people | Class |
|---|---|---|
| capital | 10k-200k | urban |
| largePort | 5k-50k | urban |
| regionalCenter | 1k-10k | urban |
| marketTown | 1k-10k | urban |
| largeVillage | 200-1k | rural |
| smallVillage | 50-500 | rural |
| hamlet | 10-50 | rural |

Burgs with no `settlementType` (vanilla maps, hand-placed burgs) fall back to the existing
100-person threshold.

### Urban attribution

Rural population is cell-keyed. Urban population is keyed by the **burg's own** `state` /
`culture` where the burg carries that field, falling back to the cell's. A burg's people can
therefore land in a different bucket than the ground it stands on — which is correct for an
enclave, and is the seam project C widens.

### Sky burgs

Counted in every bucket. Provinces excludes them today (`b.flying`); nothing else does, so
province totals do not sum to state totals. The exclusion appears to have been about province
*membership* rather than about population. If a "ground population" figure is wanted later,
that is a display concern.

## Section 3 — Military

Recruitment moves off cells and onto burgs, using the same tier boundary:

- rural levies ← burgs at `largeVillage` and below
- urban levies ← burgs at `marketTown` and above
- residual `cells.pop` still contributes to rural levies

The residual term is FMG compatibility again, and it costs nothing: on a burg-dense fork map
the residual is ~zero by design and contributes ~zero, while on a vanilla map or a nomadic
region with no burgs it is the only thing keeping those people recruitable. The vanilla path
stays live and goes quiet when the fork's model is in force.

The rural loop keeps all its existing context (biome, state, culture, religion, landmass,
naval-needs-haven, cell type modifier), read via `burg.cell` instead of by iterating cells.
Naval rural units use the burg's `port` flag plus `cells.haven[burg.cell]`.

This also removes an existing double-count: `src/generators/military-generator.ts:266` levies
rural troops from `cells.pop` while `:324` levies urban troops from `burg.population`, so a
burg cell currently raises troops twice. The burg loop's inline `* urbanization` (`:324`) goes
through the shared rule so recruitment matches what the editors display.

### Calibration is part of the work

`unit.rural` percentages were tuned by vanilla against cell populations, not against village
populations, so the same percentage now applies to a much smaller base. **Armies will shrink on
burg-dense maps.** That is correct — today's rural levies are drawn from a phantom peasantry
the fork's model says does not exist — but the absolute numbers need rebalancing.

The rebalance must be **measured** on a real burg-heavy map, before and after, and recorded in
the plan as an explicit calibration step. It is not a constant to guess at. Propping up army
sizes by preserving the double-count would mean keeping every other number on the map wrong to
make one number look right.

Regiments will also cluster at settlements instead of smearing across empty countryside. This
is a visible change, and it shortens the path to project D.

## Also on the fix list

- `src/controllers/charts-overview.ts:979` and `src/controllers/elevation-profile.ts:269`
  perform their own population arithmetic; both go through the shared rule.

## Testing

The property that matters is **conservation**, and it is cheap to assert:

```
Σ state pop == Σ culture pop == Σ religion pop == Σ province pop == Σ biome pop
            == Σ burg people + Σ cells.pop        (within rounding)
```

This one test would have caught the reported bug the day it was introduced, and it catches
every future collector anyone adds.

Also:

- **idempotency** — recompute twice, `cells.pop` is unchanged
- **vanilla fixture** — a vanilla-semantics map converges to fork semantics on load
- **multi-burg cell** — counted exactly once, in every bucket type
- **non-negative residual** — a cell crowded with burgs floors at 0, never below
- **sky burgs** — present in province totals and province totals sum to state totals
- **military** — a burg-only map raises troops from every tier; a burg-less nomadic region
  still raises rural troops from the residual

The existing suite already has multi-burg and skyburg fixtures.

## Out of scope

- **Project B — per-culture knobs and scoped regeneration.** Per-culture-*instance* dials
  (city density separate from village/hamlet density) and a regen pass that touches only one
  culture's burgs and cells. A deliberately adds no dial.
- **Project C — multi-culture burgs.** `burg.culture` becomes a mix, with enclaves,
  border-town effects, and hooks into goods and trade. `collectPopulationBy` will split a
  burg's urban population across cultures by share instead of assigning it whole; nothing else
  in the collector changes. That is the payoff for centralising it now.
- **Project D — garrisons as settlements.** A standing regiment is a real population centre,
  but its people must **transfer** out of their home burgs rather than be created, or the map
  re-inflates. Burg-based recruitment makes this a much shorter step.
- **The ~69-site `urbanization` refactor** (26 files). Not needed here. Per-culture
  urbanization in project B may force it, and the shared collector reduces it from a
  cross-codebase sweep to a one-function change.

## Risk

**Every population number on every map, existing and new, changes when this lands.** Not by a
rounding error: Blackstar's map resolves to a single figure *below* both 14.6B and 6.3B, since
the double-count disappears and the residual shrinks. There is no way to fix a double-count
without the total dropping. To anyone who does not know why, it will read as "the update broke
my world" — it needs a clear note in the changelog and release announcement.
