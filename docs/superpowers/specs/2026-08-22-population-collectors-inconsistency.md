# Population collectors inconsistency (culture pop ≠ state pop)

**Reported:** Discord, 2026-08-22 — user Blackstar3098: culture "Wildlands" shows 14.6B while
state "Neutrals" shows 6.3B over the identical 281,251 cells (custom Wilbur heightmap,
100,001 burgs from enhanced population placement).

## Root cause

All four editors display `rural × populationRate + urban × populationRate × urbanization`,
but the four **statistics collectors** that fill `rural`/`urban` use three different semantics:

| Collector | Burg-cell handling | Multi-burg aware | Flying burgs |
|---|---|---|---|
| `States.collectStatistics()` (`src/generators/states-generator.ts:533`) | counts **only** burg pop; the cell's `cells.pop` is skipped. Burgs ≤100 people count as *rural*, larger as *urban* | no — primary burg only | counted if primary |
| `culturesCollectStatistics()` (`src/controllers/cultures-editor.ts:216`) | counts `cells.pop` as rural **and** burg pop as urban (vanilla semantics) | no — primary burg only | counted if primary |
| `religionsCollectStatistics()` (`src/controllers/religions-editor.ts:226`) | same as cultures (vanilla semantics) | no | counted if primary |
| provinces `collectStatistics()` (`src/controllers/provinces-editor.ts:245`) | `cells.pop` rural on all cells + separate burg-driven urban loop | **yes** — iterates `pack.burgs` | excluded (`b.flying`) |

Vanilla upstream (`upstream/master` states-generator) uses the cultures/religions semantics
everywhere: `rural += cells.pop[i]` on every land cell, plus burg pop as urban. On stock
Azgaar the two editors agree; **the discrepancy is fork-specific.**

The states collector was changed in `bd7be32f` ("feat: enhanced population, sky burgs, air
routes, geojson exports"), which treats a burg as *absorbing* its host cell's population —
but that model change was never propagated to cultures/religions, and provinces got a third
variant during multi-burg work.

## Why the gap is so large on this map

Cultures pop = states pop + Σ `cells.pop` over burg cells (× rate), plus urbanization-factor
differences on ≤100-person burgs. With 100k of 281k cells holding burgs — and burgs seeded
in the most populous cells — the double-counted cell population dominates: 14.6B vs 6.3B.

## Secondary defects noted in passing

- States and cultures/religions collectors only see the **primary** burg per cell
  (`cells.burg`), so co-located burgs (multi-burg feature) are invisible to their urban
  totals; only provinces handles this.
- Sky burgs are excluded from provinces urban pop but not from the others.

## Status

Root cause only — no fix chosen. This seeds the population-overhaul brainstorm; the model
decision (does burg population subsume the host cell's pop, or is `cells.pop` strictly
rural?) determines which collectors change.
