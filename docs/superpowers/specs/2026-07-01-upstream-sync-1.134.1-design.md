# Upstream Sync to v1.134.1 — Design

**Date:** 2026-07-01
**Goal:** Align the fork to Azgaar's upstream FMG at **v1.134.1** via a single full merge, keeping all custom fork features and history. End state: fork is no longer behind upstream, sits on upstream's new `src/generators/` + `src/controllers/` + `src/services/` layout, and retains every custom feature.

---

## Context (why this is smaller than it looks)

- Fork last synced upstream on **2026-06-12** (commit `9ec9330b`, upstream **v1.123.2**). That commit is the merge-base `85fe613a`.
- "63 commits behind" = just the **19 days** of upstream work since June 12. The "2065 ahead" is a git artifact: **1604 of those are Azgaar's own commits re-hashed by upstream's force-pushes**; only **~202 are genuine fork commits**. There is no ancient divergence.
- At merge-base, both sides were on the **old `src/modules/` layout** (43 files; zero in `src/generators/`). Upstream's "Migrate modules" series (inside the 63 commits) renamed `src/modules/` → `src/generators/` + `src/controllers/` + `src/services/`. **Git rename detection applies these moves automatically during merge, carrying our edits to the new paths.** We inherit the migration for free rather than fighting it.

**Decisions locked with the user:**
- End state: *stay current, keep our fork* (merge, preserve custom features + history).
- Scope: *everything via one merge* (`git merge upstream/master`, resolve all conflicts in one pass — not a curated cherry-pick).

---

## Conflict surface (measured via trial merge, then aborted)

A throwaway-worktree trial merge of `upstream/master` into current `HEAD` produced **32 conflicts**:

| Kind | Count | What it is | Resolution policy |
|---|---|---|---|
| `UU` both-modified | 15 | Shared TS files both sides edited | Standard 3-way merge |
| `UD` we-edited / they-deleted | 5 | Old `public/modules/ui/*.js` upstream finished migrating to `.ts` | Port our local edits into the new `.ts`, drop the `.js` |
| `AA` both-added | 6 | Test files + `vitest.config.ts` added at same renamed paths | Reconcile both versions |
| `AU` added-by-us | 6 | Custom fork modules at relocated paths | Keep ours; verify path/wiring |

### `UU` (15) — both modified
```
public/main.js
public/modules/ui/editors.js
src/controllers/cultures-editor.ts
src/controllers/heightmap-selection.ts
src/controllers/religions-editor.ts
src/controllers/states-editor.ts
src/generators/burgs-generator.ts      ← CRITICAL: Burg interface (economy vs custom fields)
src/generators/ice-generator.ts
src/generators/routes-generator.ts
src/index.html                         ← UI wiring / layer toggles
src/renderers/draw-burg-icons.ts
src/renderers/index.ts
src/services/io/load.ts                ← serialization (economy collections)
src/utils/index.ts
src/utils/pathUtils.ts
```

### `UD` (5) — upstream migrated `.js` → `.ts` and deleted; we had local edits
```
public/modules/ui/burg-editor.js
public/modules/ui/burgs-overview.js
public/modules/ui/rivers-overview.js
public/modules/ui/route-group-editor.js
public/modules/ui/routes-overview.js
```
For each: diff our local edits against the old base, then re-apply the meaningful ones into the corresponding new `src/controllers/*.ts`. Delete the stale `.js`.

### `AA` (6) — both added same path
```
src/generators/burgs-generator.test.ts
src/generators/river-generator.test.ts
src/generators/routes-generator.test.ts
src/generators/states-generator.test.ts
src/utils/pathUtils.test.ts
vitest.config.ts
```
Reconcile: keep union of test cases where both meaningfully differ; take the superset config for `vitest.config.ts`.

### `AU` (6) — added by us, upstream touched the path
```
src/generators/air-routes-generator.ts
src/generators/air-routes-generator.test.ts
src/generators/trade-network-generator.ts
src/generators/trade-network-generator.test.ts
src/generators/emblems/generator.diag.test.ts
src/generators/heightmap-generator.diag.test.ts
```
These are custom fork modules relocated to the new layout. Default: **keep ours**; verify the relocated path is correct and imports resolve.

---

## The Economy feature (the main prize)

Upstream's `Economics (#1401)` + follow-ups (goods/production/markets/trade, charts, regeneration) arrive **mostly as new files with no conflict**: `src/generators/goods-generator.ts`, `production-generator.ts`, `markets-generator.ts`, and their controllers. Real merge friction concentrates in a few `UU` files:

- **`src/generators/burgs-generator.ts`** — the `Burg` interface. Upstream adds economy fields (`market`, `produced`, `treasury`, `product`, `production`); the fork adds `flying`, `skyPort`, `altitude`, `tradeRole`, `tradeRoleManual`, `settlementType`, `isLargePort`, `isRegionalCenter`, `basePopulation`. **Resolution: additive union.** Keep `Burg.type` as `string` (reject upstream's `CultureType` narrowing). This is exactly the collision analysis already written in `docs/superpowers/plans/2026-06-06-economy-core-sim-cherrypick.md` — reuse it.
- **`public/main.js` / `src/index.html`** — pipeline hooks and layer/UI wiring for the economy generators and the goods layer.
- **`src/services/io/load.ts`** — deserialization of new economy collections (`goods`, `markets`, `deals`, `cells.good`, `cells.market`).

**Sky-burg guard (preserve fork behavior):** sky-burgs must remain *consumers only* — never host a market, never manufacture. The 3-edit mechanism from the economy cherry-pick plan applies (guards in `Markets.createMarkets`, `Markets.expandMarkets`, `Production.produce`).

---

## Approach: isolated branch, resolve by category, gate on the build

1. **Isolate.** Create branch `sync/upstream-1.134.1` off `main` in a dedicated git worktree. `main` is never touched mid-merge; existing WIP in `src/modules/*.test.ts` and untracked plan docs stay untouched. Stash/park uncommitted WIP first.
2. **Merge.** `git merge upstream/master` — let rename detection perform the structural `src/modules/` → new-layout move; land the 32 conflicts.
3. **Resolve in dependency order:**
   - **(a) `AU` + `AA`** — mechanical: keep-ours / reconcile tests + config. Fastest, unblocks compile.
   - **(b) `UD`** — port 5 `.js` edits into the new `.ts` controllers; delete stale `.js`.
   - **(c) `UU`** — 3-way merge; do `burgs-generator.ts`, `main.js`, `index.html`, `load.ts` **last**, applying the economy collision analysis and sky-burg guards.
4. **Gate (all must pass before commit):**
   - `tsc --noEmit` green.
   - `vitest` green (fork's existing suites + reconciled upstream tests).
   - `npm run build` succeeds.
   - **Manual browser verification** (per fork convention, system chromium / CDP): a generated map renders; economy/goods layer toggles and renders; **sky-burgs still generate and behave as consumers only**; trade routes intact; burg-icon WebGL layer intact.
5. **Custom-feature preservation is an explicit gate.** Before commit, confirm every fork field on `Burg` survives and the custom features (enhanced population, sky-burgs & air-routes, trade-role UI, WebGL burg-icon layer, GPU labels if merged) still function.
6. **Land.** Commit the merge, then integrate `sync/upstream-1.134.1` back to `main` per the fork's normal flow (`superpowers:finishing-a-development-branch`).

---

## Constraints & risks

- **Upstream force-pushes.** Resolve against *this* fetched snapshot and finish before re-fetching; a mid-effort `git fetch upstream` can rewrite target hashes. If a re-fetch is unavoidable, re-run the trial merge to re-measure.
- **The migration is still thrashing upstream** (multiple Migrate→Revert→re-Migrate cycles in these 19 days). We take the state at v1.134.1 as-is; we do not try to track intermediate reverts.
- **No co-author / AI-attribution lines** in the merge commit or any PR body (fork convention).
- **Do not run `git commit -am` / `git add -A`** — biome's write-hook dirties the tree and `-A` sweeps unrelated WIP. Stage explicitly, commit with `--no-verify` per fork convention.
- **Biggest correctness risk:** silently losing a custom `Burg` field or a sky-burg guard during the `burgs-generator.ts` / economy resolution. Mitigated by the additive-union policy and the explicit preservation gate.

---

## Out of scope

- Chasing upstream's intermediate migration reverts or version thrash.
- Refactoring beyond what the merge requires.
- New economy UI/editor work beyond wiring what the merge brings in (the 11 economy editor controllers land as-is; deeper customization is future work).
