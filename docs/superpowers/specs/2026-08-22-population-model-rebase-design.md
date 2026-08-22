# Population model rebase (project A) — design

**Status:** approved in brainstorm 2026-08-22, not yet planned or implemented.
**Prompted by:** Discord bug report (Blackstar3098) — culture "Wildlands" 14.6B vs state
"Neutrals" 6.3B over the same 281,251 cells. Root cause in
[`2026-08-22-population-collectors-inconsistency.md`](2026-08-22-population-collectors-inconsistency.md).
**Reference map:** `Maroy 2026-07-08-12-12.map` (441,362 cells, 100,478 burgs) — all figures
below are measured from it.

## The problem, restated

The fork's population model is burg-centric: the burg tiers *are* the rural/urban spectrum.
A hamlet of 10-50 people is rural population that happens to have a name and a dot on the map.
Vanilla FMG answers the same question differently — dispersed peasants living in cells, counted
via `cells.pop`, with burgs layered on top as urban population.

Counting both is not a rounding error. It is the same peasants counted twice under two
incompatible theories. The fork currently does both, inconsistently, in six places.
`States.collectStatistics()` speaks the fork's model; cultures, religions, provinces, biomes and
zones are vanilla holdovers. Hence 14.6B vs 6.3B.

**This project makes the burg-centric model canonical and gives it exactly one
implementation.** It fixes the accounting. It deliberately does *not* fix the world's
population, for reasons the next section makes unavoidable.

## What the numbers say (measured, not assumed)

Maroy is 4,624 × 5,228 mi at `distanceScale: 4` — **62.6 M km², of which 37.2 M km² is
habitable: 3.5× the land area of Europe.**

| Model | Total | Density | Real-world equivalent |
|---|---|---|---|
| Burgs only | 69 M | 1.9 /km² | emptier than medieval Scandinavia |
| `cells.pop` capacity (today) | 2,558 M | 68.8 /km² | ~2× medieval England, applied uniformly |
| Medieval Europe average | 298 M | 8 /km² | |
| Medieval France / England core | 1,079 M / 1,413 M | 29-38 /km² | |

Medieval Europe held ~75-80 M at its 1300 peak over ~10.5 M km². **A plausible band for Maroy
is 300 M - 1 B.** The current capacity number is high by ~2-8×; the burgs-only number is low by
a factor of five or more. The truth is much nearer capacity than burgs.

### The resolution problem

Each cell is 142 km², ~12 km across — ten to fifteen medieval parishes. Medieval England ran
~13,000 settlements per 130,000 km², one per 10 km². **That pattern on Maroy would need 3.7 M
burgs.** There are 100,478, one per 370 km².

A burg per real settlement is not reachable at this map size. This is a resolution constraint,
not a tuning failure — and it means `cells.pop` has been doing necessary work all along: it
represents the settlements that cannot be drawn.

The consequence for the model: "nobody lives outside a burg" is only achievable if **a burg is
redefined as the named representative of its cell's entire settlement cluster** — the village
that named the parish group, not one village among fifteen. Its population is then a function
of its cell's carrying capacity (~1,400 people at Europe-average density, ~4,300 at
France-like density, against today's 688 mean), the residual falls to near zero honestly rather
than by decree, and the map lands in the plausible band.

**That redefinition is project B.** It is generation work, not accounting work, and project A
must not pre-empt it.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Counting model | Burgs are the source of truth; `cells.pop` is the residual | Matches the fork's design; double-counting becomes structurally impossible |
| Where the subtraction happens | Derived from `cells.s`, recomputed on demand | Idempotent, so it is safe to re-run anywhere |
| Carrying capacity | **Untouched in A. Deferred to B.** | B makes it moot: once burgs absorb their cell's capacity the residual is near zero with no factor at all. A wilderness factor now would be a constant we would immediately delete |
| Capacity is a **per-cell** budget | Shared by all ground burgs on the cell | Several burgs may share a cell; each cannot claim the cell's whole capacity |
| Flying burgs and capacity | Excluded from the budget and from the residual | A skyburg does not farm the ground beneath it; it feeds itself by trade |
| Rural/urban boundary | Tier-based: `marketTown`+ urban, `largeVillage`- rural | A market town has a market; absolute headcounts stop meaning anything under B's capacity anchoring |
| Urban attribution | The burg's own `state`/`culture`, not its cell's | It is the field the editors expose and the field project C turns into a mix |
| Sky burgs in totals | Counted everywhere | They are people; excluding them in provinces alone breaks province-to-state sums |
| Military recruitment | From burgs, split by the same tier boundary | The fork's rural population lives in villages, not in cells |

## Section 1 — One derivation, and it is idempotent

`cells.pop` stops being stored state that many places write, and becomes derived output with
exactly one producer:

```
capacity(i)    = cells.s[i] * cells.area[i] / meanArea      // as rankCells() already computes
groundPts(i)   = Σ (burg.population * urbanization)
                 for every NON-FLYING burg on cell i        // per-cell, multi-burg aware
cells.pop[i]   = max(0, capacity(i) - groundPts(i))
```

The derivation reads `cells.s`, **never the current value of `cells.pop`**. It is therefore
idempotent: running it a thousand times gives the same answer. That is what makes it safe to
call on load, after any burg edit, after a regen pass, with no "have I already done this?"
bookkeeping. A version subtracting from the current `pop` would corrupt the map on the second
call, and given how many code paths add or remove burgs, that would be a matter of time.

It also self-heals a vanilla map loaded into the fork: that map's `cells.pop` carries vanilla
semantics but its `cells.s` is intact, so one call converts it. **No save-format change and no
version gate** — `cells.s` and `cells.pop` are already persisted as separate fields
(`src/services/io/save.ts:178` and `:181`, data slots 21 and 24).

Interop runs both ways: a fork map opened in vanilla FMG shows `cells.pop` as rural people and
burgs as urban population, and gets a coherent world.

### Multiple burgs per cell

`groundPts(i)` sums **all** ground burgs on the cell, so a cell hosting two burgs has both
subtracted once. On Maroy this affects 53 cells (max 2 burgs each) — small today, but the
multi-burg feature and megalopolis grouping exist precisely to grow that number, and project B
makes it structural: the cell's capacity becomes a **budget shared** by its burgs rather than a
figure each of them draws on independently.

Every consumer therefore indexes burgs by cell (`Map<cell, Burg[]>`), never via `cells.burg`,
which holds only the *primary* ground burg. Reading `cells.burg` is the root of the existing
undercount in the states, cultures and religions collectors.

### Flying burgs

Sky burgs (477 on Maroy, 307 K people) are **excluded from `groundPts`** — they do not consume
the carrying capacity of the ground they float over. They are still counted in every population
total. This keeps the residual honest for a cell that has a skyburg overhead and nothing on the
ground.

### Recompute triggers

- end of map generation, after `Burgs.specify()`
- on load
- after any burg add / remove / population change
- on `changeUrbanizationRate()` (`src/controllers/units-editor.ts:82`), which today is one line
  setting the global and recomputing nothing

The urbanization slider consequently shifts people between countryside and town instead of
inflating the world's total, which is what it always claimed to do.

### Consequences to handle

**Manual rural edits.** The states, provinces and religions editors let the user type a
population and scale `cells.pop` to match. Under a single-producer rule those edits are
transient — the next recompute erases them. They move to scaling `cells.s` instead, so the edit
survives and means "this land supports more people".

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
  (`src/controllers/provinces-editor.ts:245`), `collectBiomeStatistics` (via
  `src/controllers/biomes-editor.ts:221`), and the inline totals in `getZonesData`
  (`src/controllers/zones-editor.ts:207`).

After this, one function decides what rural and urban mean. That is the actual fix: the
reported bug was not three semantics, it was three implementations.

The shared cell→burgs index means **multi-burg cells are counted everywhere** rather than only
in provinces and zones.

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
therefore land in a different bucket than the ground it stands on — correct for an enclave, and
the seam project C widens.

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

The residual term is FMG compatibility, and it costs nothing: on a burg-dense fork map it goes
quiet on its own, while on a vanilla map or a nomadic region with no burgs it is the only thing
keeping those people recruitable.

The rural loop keeps all its existing context (biome, state, culture, religion, landmass,
naval-needs-haven, cell type modifier), read via `burg.cell` instead of by iterating cells.
Naval rural units use the burg's `port` flag plus `cells.haven[burg.cell]`.

This also removes an existing double-count: `src/generators/military-generator.ts:266` levies
rural troops from `cells.pop` while `:324` levies urban troops from `burg.population`, so a burg
cell currently raises troops twice. The burg loop's inline `* urbanization` (`:324`) goes
through the shared rule so recruitment matches what the editors display.

### Calibration is part of the work

`unit.rural` percentages were tuned by vanilla against cell populations, not against village
populations, so the same percentage now applies to a much smaller base. **Armies will shrink on
burg-dense maps**, and will shift again when project B raises burg populations. The rebalance
must be **measured** on Maroy, before and after, and recorded in the plan as an explicit
calibration step against a recorded baseline troop count. It is not a constant to guess at.

Because B will move the base a second time, A's calibration target is "no worse than today's
total troop count", with the real tuning pass deferred to B.

Regiments will also cluster at settlements instead of smearing across empty countryside, which
shortens the path to project D.

## Testing

The property that matters is **conservation**:

```
Σ state pop == Σ culture pop == Σ religion pop == Σ province pop == Σ biome pop
            == Σ burg people + Σ cells.pop        (within rounding)
```

This one test would have caught the reported bug the day it was introduced, and it catches every
future collector anyone adds.

Also:

- **idempotency** — recompute twice, `cells.pop` is unchanged
- **vanilla fixture** — a vanilla-semantics map converges to fork semantics on load
- **multi-burg cell** — two burgs on one cell are both subtracted from that cell's capacity
  exactly once, and both counted in every bucket type
- **flying burg** — excluded from the residual subtraction, included in every total
- **non-negative residual** — a cell crowded with burgs floors at 0, never below
- **sky burgs** — present in province totals, and province totals sum to state totals
- **military** — a burg-only map raises troops from every tier; a burg-less nomadic region still
  raises rural troops from the residual

The existing suite already has multi-burg and skyburg fixtures.

## Out of scope

- **Project B — capacity-anchored burg populations, per-culture.** Burg population stops being
  an independent gauss roll per tier and becomes a function of its cell's carrying capacity,
  shared as a **per-cell budget** across the burgs on that cell. Per-culture density then means
  *what share of its land's capacity a culture concentrates into named settlements, and how it
  distributes that across tiers* — a farm culture spreading capacity thinly across many small
  burgs, a mercantile culture concentrating it into few large ones. Same land, same capacity,
  different settlement geography. B also decides the wilderness factor A deferred, and includes
  scoped regeneration (re-run one culture's burgs and cells without touching the rest).
- **Project C — multi-culture burgs.** `burg.culture` becomes a mix, with enclaves, border-town
  effects, and hooks into goods and trade. `collectPopulationBy` will split a burg's urban
  population across cultures by share instead of assigning it whole; nothing else in the
  collector changes. That is the payoff for centralising it now.
- **Project D — garrisons as settlements.** A standing regiment is a real population centre, but
  its people must **transfer** out of their home burgs, not be created, or the map re-inflates.
  Burg-based recruitment makes this a much shorter step.
- **The ~69-site `urbanization` refactor** (26 files). Not needed here. Per-culture urbanization
  in B may force it, and the shared collector reduces it from a cross-codebase sweep to a
  one-function change.

## Risk

**A fixes the accounting, not the world.** Until B lands, Maroy's total stays capacity-dominated:
2.627 B today becomes 2.562 B, a 2.5% drop, with 97% of people still living outside burgs. That
is the honest interim state and it must be said plainly in the changelog — A is not the fix for
"my world's population is wrong", it is the fix for "my editors disagree about it".

Every population figure on every map changes when A lands, and changes again when B lands. To
anyone who does not know why, that reads as "the update broke my world". Both releases need a
clear note.
