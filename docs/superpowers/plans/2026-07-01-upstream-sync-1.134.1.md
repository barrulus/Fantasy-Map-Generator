# Upstream Sync to v1.134.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully merge `upstream/master` (Azgaar FMG **v1.134.1**) into the fork, resolving all 32 conflicts, preserving every custom fork feature, landing the fork on upstream's new `src/generators/` + `src/controllers/` + `src/services/` layout.

**Architecture:** A single `git merge upstream/master` on an isolated branch. Git rename detection carries our `src/modules/` edits to the new layout automatically; 32 conflicts remain. Resolve mechanical conflicts first (`AU`/`AA`/`UD`), then content conflicts (`UU`), with the `Burg` interface + economy pipeline wiring last. A merge is a **single commit** — you cannot commit partway through, so resolution progress is tracked by `git add`-ing resolved files and grepping for leftover conflict markers. The build/test/browser gate runs once, after all conflicts are resolved, before the final merge commit.

**Tech Stack:** git merge, TypeScript (`tsc --noEmit` is the primary gate), vitest, vite (`npm run build`), system chromium / CDP for browser verification. Nix develop flake provides the toolchain.

## Global Constraints

- **Build gate:** `tsc --noEmit` must be green before the merge commit. Then `npx vitest run` green, then `npm run build` succeeds.
- **Never commit on `main` mid-merge.** All work happens on branch `sync/upstream-1.134.1` in an isolated worktree.
- **No `git commit -am` and no `git add -A`.** Biome's write-hook dirties the tree and `-A` sweeps unrelated WIP. Stage explicitly by path; commit with `--no-verify`.
- **No co-author / AI-attribution lines** in the merge commit or any PR body.
- **Resolve against the current fetched snapshot only.** Upstream force-pushes; do NOT `git fetch upstream` mid-merge. If a re-fetch becomes unavoidable, abort and re-run the trial-merge measurement.
- **`Burg.type` stays `string`** — reject upstream's `CultureType` narrowing.
- **`Burg.i` stays optional (`i?: number`)** — keep ours; do not adopt upstream's required `i`.
- **Custom `Burg` fields are non-negotiable:** `settlementType`, `isLargePort`, `isRegionalCenter`, `basePopulation`, `flying`, `skyPort`, `altitude`, `tradeRole`, `tradeRoleManual` all survive.
- **Sky-burgs are consumers only:** never host a market, never manufacture.
- Reference the design doc `docs/superpowers/specs/2026-07-01-upstream-sync-1.134.1-design.md` and the economy collision analysis in `docs/superpowers/plans/2026-06-06-economy-core-sim-cherrypick.md`.

---

## File Structure (conflict map)

The 32 conflicts, by resolution task:

- **Task 2 — `AU` keep-ours (6):** `src/generators/air-routes-generator.ts`, `air-routes-generator.test.ts`, `trade-network-generator.ts`, `trade-network-generator.test.ts`, `emblems/generator.diag.test.ts`, `heightmap-generator.diag.test.ts`
- **Task 3 — `AA` reconcile (6):** `src/generators/burgs-generator.test.ts`, `river-generator.test.ts`, `routes-generator.test.ts`, `states-generator.test.ts`, `src/utils/pathUtils.test.ts`, `vitest.config.ts`
- **Task 4 — `UD` port `.js`→`.ts` (5):** `public/modules/ui/burg-editor.js`, `burgs-overview.js`, `rivers-overview.js`, `route-group-editor.js`, `routes-overview.js`
- **Task 5 — `UU` non-critical (11):** `src/controllers/cultures-editor.ts`, `heightmap-selection.ts`, `religions-editor.ts`, `states-editor.ts`, `src/generators/ice-generator.ts`, `routes-generator.ts`, `src/renderers/draw-burg-icons.ts`, `renderers/index.ts`, `src/utils/index.ts`, `pathUtils.ts`, `public/modules/ui/editors.js`
- **Task 6 — `UU` critical: Burg interface:** `src/generators/burgs-generator.ts`
- **Task 7 — `UU` critical: pipeline/wiring:** `public/main.js`, `src/index.html`, `src/services/io/load.ts`

---

## Task 1: Isolate and start the merge

**Files:** none edited yet (git state only).

**Interfaces:**
- Produces: branch `sync/upstream-1.134.1` in an isolated worktree with an in-progress merge and exactly 32 conflicts.

- [ ] **Step 1: Park uncommitted WIP on `main`**

The session started with modified `src/modules/*.test.ts` and `trade-network-generator.ts` plus untracked files. Do NOT let them enter the merge.

Run:
```bash
cd /home/barrulus/dev/Fantasy-Map-Generator
git stash push -u -m "pre-upstream-sync WIP" -- src/modules/routes-generator.test.ts src/modules/trade-network-generator.test.ts src/modules/trade-network-generator.ts
git status --short
```
Expected: the three files no longer appear as modified. Untracked plan docs / images may remain — that is fine (merge won't touch them).

- [ ] **Step 2: Create the isolated worktree + branch**

REQUIRED SUB-SKILL: use `superpowers:using-git-worktrees` to create the workspace. Target branch name: `sync/upstream-1.134.1` off `main`.

Verify:
```bash
git worktree list
git -C <worktree-path> rev-parse --abbrev-ref HEAD
```
Expected: worktree exists; branch is `sync/upstream-1.134.1`.

- [ ] **Step 3: Confirm the fetched snapshot (do NOT re-fetch)**

Run:
```bash
git -C <worktree-path> log -1 --format='%h %s' upstream/master
```
Expected: `b222cefa chore: bump version to 1.134.1`. If it differs, STOP — upstream was re-fetched; re-measure conflicts before continuing.

- [ ] **Step 4: Start the merge**

Run:
```bash
cd <worktree-path>
git merge --no-ff --no-commit upstream/master
echo "exit=$?"
```
Expected: `exit=1` and "Automatic merge failed; fix conflicts…".

- [ ] **Step 5: Confirm exactly 32 conflicts in the expected categories**

Run:
```bash
git diff --name-only --diff-filter=U | wc -l
git status --porcelain | grep -E '^(UU|AU|AA|UD) ' | awk '{print $1}' | sort | uniq -c
```
Expected: `32`; breakdown `15 UU`, `6 AU`, `6 AA`, `5 UD`. If counts differ, STOP and reconcile against the design doc before proceeding.

---

## Task 2: Resolve `AU` — keep our custom modules (6 files)

**Files (all conflicted, keep ours):**
- `src/generators/air-routes-generator.ts`, `src/generators/air-routes-generator.test.ts`
- `src/generators/trade-network-generator.ts`, `src/generators/trade-network-generator.test.ts`
- `src/generators/emblems/generator.diag.test.ts`
- `src/generators/heightmap-generator.diag.test.ts`

**Interfaces:**
- Consumes: in-progress merge from Task 1.
- Produces: 6 files staged with our content at the new-layout paths.

- [ ] **Step 1: Inspect each `AU` file's conflict to confirm it is a relocation, not a semantic clash**

Run:
```bash
for f in src/generators/air-routes-generator.ts src/generators/air-routes-generator.test.ts \
         src/generators/trade-network-generator.ts src/generators/trade-network-generator.test.ts \
         src/generators/emblems/generator.diag.test.ts src/generators/heightmap-generator.diag.test.ts; do
  echo "=== $f ==="; git diff -- "$f" | head -30
done
```
Expected: conflicts are import-path / location differences on custom fork modules, not upstream reimplementations of the same feature. If upstream genuinely reimplemented `trade-network` differently, STOP and escalate — that needs a human decision.

- [ ] **Step 2: Take our version for all six**

Run:
```bash
git checkout --ours -- \
  src/generators/air-routes-generator.ts src/generators/air-routes-generator.test.ts \
  src/generators/trade-network-generator.ts src/generators/trade-network-generator.test.ts \
  src/generators/emblems/generator.diag.test.ts src/generators/heightmap-generator.diag.test.ts
git add -- \
  src/generators/air-routes-generator.ts src/generators/air-routes-generator.test.ts \
  src/generators/trade-network-generator.ts src/generators/trade-network-generator.test.ts \
  src/generators/emblems/generator.diag.test.ts src/generators/heightmap-generator.diag.test.ts
```

- [ ] **Step 3: Verify imports in these files point at the new layout**

Our modules may import siblings via `./` relative paths that now resolve under `src/generators/`. Run:
```bash
grep -nE "from ['\"]\.\.?/" src/generators/air-routes-generator.ts src/generators/trade-network-generator.ts
```
Expected: relative imports resolve to files that exist under the new layout. If any import points at a path that no longer exists (e.g. `../modules/…`), fix it to the new path now and re-`git add` the file.

- [ ] **Step 4: Confirm no conflict markers remain in these files**

Run:
```bash
grep -rlE '^(<<<<<<<|=======|>>>>>>>)' src/generators/air-routes-generator.ts src/generators/trade-network-generator.ts src/generators/*.test.ts src/generators/emblems/generator.diag.test.ts src/generators/heightmap-generator.diag.test.ts || echo "clean"
```
Expected: `clean`.

---

## Task 3: Resolve `AA` — reconcile tests + vitest config (6 files)

**Files:** `src/generators/burgs-generator.test.ts`, `river-generator.test.ts`, `routes-generator.test.ts`, `states-generator.test.ts`, `src/utils/pathUtils.test.ts`, `vitest.config.ts`

**Interfaces:**
- Produces: 6 reconciled files staged; union of test coverage preserved.

- [ ] **Step 1: Diff each to see whether the two sides are near-identical or genuinely different**

Run:
```bash
for f in src/generators/burgs-generator.test.ts src/generators/river-generator.test.ts \
         src/generators/routes-generator.test.ts src/generators/states-generator.test.ts \
         src/utils/pathUtils.test.ts vitest.config.ts; do
  echo "=== $f ==="; git diff -- "$f" | head -40
done
```

- [ ] **Step 2: For each test file, hand-merge to the union of test cases**

Open each conflicted test file and, for each `<<<<<<< / ======= / >>>>>>>` block, keep **both** sides' test cases (ours + upstream's) unless they assert contradictory behavior. Where they assert the same thing with different wording, keep upstream's. Remove all conflict markers.

- [ ] **Step 3: For `vitest.config.ts`, take the superset**

Merge both configs: keep every `include`/`exclude`/`setupFiles`/plugin entry from both sides. Remove conflict markers. If both define the same key with different values, prefer upstream's default unless ours encodes a fork-specific path (then keep ours).

- [ ] **Step 4: Stage and verify clean**

Run:
```bash
git add -- src/generators/burgs-generator.test.ts src/generators/river-generator.test.ts \
  src/generators/routes-generator.test.ts src/generators/states-generator.test.ts \
  src/utils/pathUtils.test.ts vitest.config.ts
grep -rlE '^(<<<<<<<|=======|>>>>>>>)' src/generators/*.test.ts src/utils/pathUtils.test.ts vitest.config.ts || echo "clean"
```
Expected: `clean`.

---

## Task 4: Resolve `UD` — port 5 migrated editors' local edits into new `.ts` (5 files)

**Files (upstream deleted these `.js`, we still had edits):**
- `public/modules/ui/burg-editor.js` → new `src/controllers/burg-editor.ts`
- `public/modules/ui/burgs-overview.js` → new `src/controllers/burgs-overview.ts`
- `public/modules/ui/rivers-overview.js` → new `src/controllers/rivers-overview.ts`
- `public/modules/ui/route-group-editor.js` → new `src/controllers/route-group-editor.ts`
- `public/modules/ui/routes-overview.js` → new `src/controllers/routes-overview.ts`

**Interfaces:**
- Produces: our meaningful local edits re-applied into the upstream `.ts` controllers; the stale `.js` files removed.

- [ ] **Step 1: Extract what WE changed in each `.js` relative to the merge-base**

For each file, our edits are the delta from merge-base to our HEAD. Run (example for one file; repeat for all five):
```bash
git diff 85fe613a...HEAD -- public/modules/ui/burg-editor.js
```
Expected: a small diff = our fork-specific changes (e.g. sky-burg / trade-role UI hooks, population fields). Record each hunk's intent.

- [ ] **Step 2: Confirm the upstream `.ts` replacement exists and read it**

Run (repeat per file):
```bash
git show upstream/master:src/controllers/burg-editor.ts | head -60
ls src/controllers/burg-editor.ts
```
Expected: the `.ts` file is present in the merged tree (upstream added it). Read the region our edit touches.

- [ ] **Step 3: Re-apply each recorded edit into the corresponding `.ts` controller**

Port each hunk from Step 1 into the new `.ts` file, translating JS→TS idiom as needed (types, `window.` globals stay as-is). If an edit is obsolete because upstream already implemented equivalent behavior, skip it and note "obsolete: covered by upstream" in the commit body later.

Sky-burg / trade-role edits that MUST survive if present in the `.js` delta:
- `burg-editor`: any trade-role selector wiring and sky-burg (`flying`/`skyPort`/`altitude`) fields.
- `burgs-overview`: any custom columns for population tiers / trade role.

- [ ] **Step 4: Remove the stale `.js` files (resolve the delete side)**

Run:
```bash
git rm -- public/modules/ui/burg-editor.js public/modules/ui/burgs-overview.js \
  public/modules/ui/rivers-overview.js public/modules/ui/route-group-editor.js \
  public/modules/ui/routes-overview.js
```

- [ ] **Step 5: Stage the ported `.ts` files and verify clean**

Run:
```bash
git add -- src/controllers/burg-editor.ts src/controllers/burgs-overview.ts \
  src/controllers/rivers-overview.ts src/controllers/route-group-editor.ts src/controllers/routes-overview.ts
grep -rlE '^(<<<<<<<|=======|>>>>>>>)' src/controllers/*.ts || echo "clean"
```
Expected: `clean` (these `.ts` files were not themselves conflicted; you are editing, not conflict-resolving — just confirm no stray markers were introduced).

---

## Task 5: Resolve `UU` non-critical content conflicts (11 files)

**Files:** `src/controllers/cultures-editor.ts`, `heightmap-selection.ts`, `religions-editor.ts`, `states-editor.ts`, `src/generators/ice-generator.ts`, `src/generators/routes-generator.ts`, `src/renderers/draw-burg-icons.ts`, `src/renderers/index.ts`, `src/utils/index.ts`, `src/utils/pathUtils.ts`, `public/modules/ui/editors.js`

**Interfaces:**
- Consumes: merged tree with Tasks 2–4 resolved.
- Produces: 10 (+editors.js) files 3-way merged, custom behavior preserved.

- [ ] **Step 1: Resolve each with a standard 3-way merge, guided by "keep upstream's refactor, re-apply our behavior"**

For each file, open it and resolve every conflict hunk on this policy:
- **Adopt upstream's structural/API changes** (renames, signature changes, the migration's import rewrites).
- **Re-apply our fork behavior** layered on top (custom fields, sky-burg handling, trade-role, WebGL burg-icon layer, population tiers).

Known fork touchpoints to watch:
- `src/renderers/draw-burg-icons.ts` — the WebGL burg-icon layer is fork-custom; keep our GL draw path, adopt any upstream signature changes to the renderer registry.
- `src/generators/routes-generator.ts` — fork has custom sea/air route + seam-wrapping logic; keep it, adopt upstream refactors around it.
- `src/controllers/states-editor.ts` — fork has custom pagination + merge-down-to-provinces; keep those, adopt upstream edits.
- `src/utils/index.ts`, `src/utils/pathUtils.ts` — take upstream additions; keep any fork-only helpers.

- [ ] **Step 2: After each file, stage it and confirm no markers**

Run (per file):
```bash
git add -- <file>
grep -lE '^(<<<<<<<|=======|>>>>>>>)' <file> && echo "STILL CONFLICTED" || echo "clean"
```
Expected: `clean` for each.

- [ ] **Step 3: Confirm all 10 (+editors.js) are staged**

Run:
```bash
git diff --name-only --diff-filter=U | grep -Ev 'burgs-generator.ts|public/main.js|src/index.html|services/io/load.ts' || echo "non-critical UU all resolved"
```
Expected: `non-critical UU all resolved`.

---

## Task 6: Resolve the `Burg` interface (`src/generators/burgs-generator.ts`)

**Files:** `src/generators/burgs-generator.ts`

**Interfaces:**
- Produces: a `Burg` interface that is the **additive union** of upstream economy fields and all custom fork fields, with `type?: string` and `i?: number` preserved.

- [ ] **Step 1: Replace the conflicted `interface Burg` block with this exact merged version**

Resolve the `interface Burg` conflict to exactly:
```ts
export interface Burg {
  cell: number;
  x: number;
  y: number;
  i?: number;
  state?: number;
  culture?: number;
  name?: string;
  feature?: number;
  capital?: number;
  lock?: boolean;
  port?: number;
  removed?: boolean;
  population?: number;
  type?: string;
  coa?: any;
  citadel?: number;
  plaza?: number;
  walls?: number;
  shanty?: number;
  temple?: number;
  group?: string;
  link?: string;
  MFCG?: string;
  // custom fork fields (population system + sky-burgs + trade role)
  settlementType?: string;
  isLargePort?: boolean;
  isRegionalCenter?: boolean;
  basePopulation?: number;
  flying?: number;
  skyPort?: number;
  altitude?: number;
  tradeRole?: "hub" | "waystation";
  tradeRoleManual?: boolean;
  // upstream economy fields (v1.134.1)
  production?: ProductionRecord[]; // per-burg production/trade records from the last production run
  product?: number; // gross product from the last production run
  treasury?: number; // accumulated cash balance
  market?: number;
}
```

- [ ] **Step 2: Ensure the `ProductionRecord` import is present**

Upstream references `ProductionRecord` from the new economy module. At the top of the file, confirm/keep this import (add it if the conflict dropped it):
```ts
import type { ProductionRecord } from "./production-generator";
```
Run:
```bash
grep -n "ProductionRecord" src/generators/burgs-generator.ts
ls src/generators/production-generator.ts
```
Expected: import present; `production-generator.ts` exists (upstream added it as a new file).

- [ ] **Step 3: Resolve any remaining hunks in this file**

Resolve non-interface conflict blocks in the same file with the Task 5 policy (adopt upstream refactor, keep fork behavior). Do NOT adopt upstream's `CultureType` narrowing of `burg.type` anywhere in the file body — keep `string`.

- [ ] **Step 4: Stage and verify clean**

Run:
```bash
git add -- src/generators/burgs-generator.ts
grep -lE '^(<<<<<<<|=======|>>>>>>>)' src/generators/burgs-generator.ts && echo "STILL CONFLICTED" || echo "clean"
```
Expected: `clean`.

---

## Task 7: Resolve pipeline + serialization + sky-burg guards (`main.js`, `index.html`, `load.ts`)

**Files:** `public/main.js`, `src/index.html`, `src/services/io/load.ts`

**Interfaces:**
- Consumes: resolved `Burg` interface + economy generators (new files) from prior tasks.
- Produces: economy generators wired into the pipeline, economy collections (de)serialized, sky-burg consumer-only guards in place.

- [ ] **Step 1: `public/main.js` — adopt upstream pipeline hooks, keep fork pipeline steps**

Resolve conflicts to keep BOTH: upstream's economy generation calls (goods → production → markets) AND the fork's custom pipeline (enhanced population, sky-burgs, air-routes, trade-network, WebGL burg layer). Keep any fork `#goods` SVG group / `regenerate*` helpers. Remove markers, `git add public/main.js`.

- [ ] **Step 2: `src/index.html` — union of UI wiring**

Keep both upstream's economy UI (goods/markets/charts layer toggles, editors) and all fork UI (sky-burg controls, trade-role editor, WebGL layer toggle). Resolve on additive-union. Remove markers, `git add src/index.html`.

- [ ] **Step 3: `src/services/io/load.ts` — deserialize economy collections + preserve fork fields**

Keep upstream's deserialization of new collections (`goods`, `markets`, `deals`, `cells.good`, `cells.market`) AND the fork's handling of custom Burg fields / air-routes / sky-burg state. Do not drop either side. Remove markers, `git add src/services/io/load.ts`.

- [ ] **Step 4: Apply the sky-burg consumer-only guards (3 edits)**

Sky-burgs must never host a market or manufacture. In the merged economy modules apply:
1. `src/generators/markets-generator.ts` — in the market-creation loop, `if (burg.flying) continue;` so a sky-burg never hosts a market.
2. `src/generators/markets-generator.ts` — in market expansion, resolve a flying burg's `burg.market` from its `skyPort` ground burg (fallback: ground market under its cell) so sky-burgs still appear as buyers.
3. `src/generators/production-generator.ts` — in the manufacturing loop, `if (burg.flying) continue;` so sky-burgs don't manufacture/sell.

Read the current loop shapes first:
```bash
grep -nE "createMarkets|expandMarkets|function produce|for .*burg" src/generators/markets-generator.ts src/generators/production-generator.ts | head
```
Apply the three guards at those sites, matching the exact loop variable names. `git add` both files.

- [ ] **Step 5: Confirm every conflict is resolved**

Run:
```bash
git diff --name-only --diff-filter=U | wc -l
grep -rlE '^(<<<<<<<|=======|>>>>>>>)' src public 2>/dev/null || echo "no markers anywhere"
```
Expected: `0` unmerged paths; `no markers anywhere`.

---

## Task 8: Build + test gate

**Files:** none (verification only).

- [ ] **Step 1: Type-check**

Run:
```bash
cd <worktree-path>
tsc --noEmit
```
Expected: exit 0, no errors. **Likely failure point:** upstream economy code keying multiplier maps by `CultureType` while `burg.type` is `string`. If tsc reports such an error, widen the map key type to `string` (or cast at the call site) — do NOT change `burg.type` back to `CultureType`. Re-run until green.

- [ ] **Step 2: Run the test suite**

Run:
```bash
npx vitest run
```
Expected: all pass. If a reconciled test (Task 3) fails because behavior genuinely changed upstream, update the assertion to match real merged behavior — never delete a fork test to make it pass. Fork custom-feature tests (air-routes, trade-network, sky-burgs) MUST pass.

- [ ] **Step 3: Full build**

Run:
```bash
npm run build
```
Expected: build succeeds, output to `../dist/`.

---

## Task 9: Browser verification + custom-feature preservation gate

**Files:** none (manual verification).

REQUIRED context: the dev server is the user's own session — do not start/stop it. Use system chromium / CDP per the fork's browser-verification convention.

- [ ] **Step 1: Generate a map and confirm core render**

Load the built app, generate a default map. Expected: map renders; no console errors from the economy modules or the merged renderers.

- [ ] **Step 2: Verify the economy feature works**

Toggle the goods/markets layer. Expected: it renders; markets/goods editors open without error.

- [ ] **Step 3: Verify every custom fork feature survived**

Confirm each still works:
- Sky-burgs generate; they appear as market **buyers only** (never host a market, never manufacture).
- Air-routes render.
- Trade-network / trade-role editor works.
- WebGL burg-icon layer renders (auto-on for >5000 burgs); click/hover/relocate work.
- Enhanced population tiers present on burgs.

Expected: all pass. If any custom feature is broken, return to the relevant task — do NOT commit a merge that regresses a fork feature.

- [ ] **Step 4: Preservation gate — grep the merged `Burg` for every custom field**

Run:
```bash
for fld in settlementType isLargePort isRegionalCenter basePopulation flying skyPort altitude tradeRole tradeRoleManual; do
  grep -q "$fld" src/generators/burgs-generator.ts && echo "OK $fld" || echo "MISSING $fld";
done
```
Expected: `OK` for all nine. Any `MISSING` → stop and fix Task 6.

---

## Task 10: Commit the merge and land to `main`

**Files:** none (git finalize).

- [ ] **Step 1: Final pre-commit sanity**

Run:
```bash
git diff --name-only --diff-filter=U | wc -l   # -> 0
git status --short | head
```
Expected: no unmerged paths.

- [ ] **Step 2: Commit the merge (no `-am`, no `-A`, no co-author line)**

Run:
```bash
git commit --no-verify -F - <<'MSG'
merge: upstream/master (v1.134.1) into fork

Full merge to align with Azgaar FMG v1.134.1. Adopts upstream's
src/generators/ + src/controllers/ + src/services/ layout via rename
detection. Brings in the economy simulation (goods/production/markets/
trade + charts), 3D view options, and targeted fixes.

All 32 conflicts resolved preserving custom fork features:
- Burg interface is the additive union of economy + custom fields
  (type stays string; sky-burg/trade-role/population fields kept)
- Sky-burgs wired as economy consumers only (3 guards)
- WebGL burg-icon layer, air-routes, trade-network, seam-wrapping
  routes, enhanced population, editor pagination all preserved
MSG
```
Expected: merge commit created on `sync/upstream-1.134.1`.

- [ ] **Step 3: Restore the parked WIP onto `main` (not the sync branch)**

The Task 1 stash belongs to pre-sync `main` work. Do NOT apply it inside the merge. After the branch lands (Step 4), from the main worktree:
```bash
git stash list   # confirm "pre-upstream-sync WIP" is present
# after landing, in the main worktree:
git stash pop
```
Note: those files were at `src/modules/` paths that the merge relocated to `src/generators/`. The stash pop may conflict; re-apply the WIP by hand into the new paths if so.

- [ ] **Step 4: Land the branch**

REQUIRED SUB-SKILL: use `superpowers:finishing-a-development-branch` to integrate `sync/upstream-1.134.1` into `main` per the fork's normal flow (direct merge-back vs PR — confirm with the user, per the design doc's open question). Then clean up the worktree.

---

## Notes for the implementer

- **This is a merge, not a feature build.** There is no "write failing test first" per conflict — the gate is `tsc --noEmit` + `vitest` + `npm run build` + browser verification, run once after all conflicts resolve (Tasks 8–9). Progress within the merge is tracked by `git add` + conflict-marker greps.
- **You cannot commit partway through a merge.** If you need to pause, the in-progress merge state persists in the worktree; resume by continuing to resolve. To bail out entirely: `git merge --abort`.
- **If the conflict count in Task 1 Step 5 is not 32**, upstream was re-fetched or the base moved — stop and re-measure before resolving anything.
- **When unsure whether an upstream change replaces a fork feature or is orthogonal**, treat it as orthogonal and keep both, then let `tsc` + tests + browser verification catch real incompatibilities. Never silently drop a fork feature to simplify a conflict.
