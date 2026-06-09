# Editor Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page-by-page rendering (200 rows/page) to the States, Cultures, Religions, Rivers, and Routes list editors so they stay responsive on maps with 1,000+ entries.

**Architecture:** Add a small shared pagination/sort toolkit of global functions to `public/modules/ui/editors.js`. Each editor's `…AddLines` function builds its full filtered array, sorts the *whole* array via the toolkit (so sorting spans all pages), slices to the current page, renders only that slice, and draws `‹ Page n of N ›` controls in its footer. CSV exports and one DOM-walking helper are reworked to read the full dataset instead of the rendered (now-partial) DOM.

**Tech Stack:** Vanilla browser JS. `public/modules/ui/*.js` are global `<script>` files; `public/modules/dynamic/editors/*.js` are ES modules loaded via dynamic `import()`. Reference: the working pagination in `public/modules/ui/burgs-overview.js`.

**Spec:** `docs/superpowers/specs/2026-06-08-editor-pagination-design.md`

## Testing approach (read first)

This repo unit-tests only `src/**/*.ts` modules (vitest). The files changed here are
browser-global UI scripts in `public/modules/` — there is **no** precedent or harness for
unit-testing them, and `editors.js` is loaded as a non-module `<script>` so its helpers
cannot be ESM-imported. **Do not invent a test harness.** Per the spec, verification is:

1. **Syntax gate (per task):** `node --check <changed-file>` — must exit 0 with no output.
2. **Manual browser verification (per editor):** run `npm run dev`, open the editor, and
   walk the checklist in that task. (A large map with 1k+ states is needed to see
   multiple pages; on a small map the controls hide themselves — that is also a checklist
   item.)

`biome` lints only `src/**/*.ts`, so it will not touch these files; no formatting step is
needed for them.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `.gitignore` | repo hygiene | add `.claude/` so the pre-commit `biome` hook stops erroring on the nested worktree config |
| `public/modules/ui/editors.js` | shared editor utilities (already holds `applySorting`, `sortLines`, `fitContent`) | add 5 pagination/sort helpers + `EDITOR_PAGE_SIZE` |
| `public/modules/dynamic/editors/states-editor.js` | States editor | paginate `statesEditorAddLines`; accessors; page state; fix `downloadStatesCsv` + `randomizeStatesExpansion` |
| `public/modules/dynamic/editors/cultures-editor.js` | Cultures editor | paginate `culturesEditorAddLines`; accessors; page state; fix `downloadCulturesCsv` |
| `public/modules/dynamic/editors/religions-editor.js` | Religions editor | paginate `religionsEditorAddLines`; accessors; page state; fix `downloadReligionsCsv` |
| `public/modules/ui/rivers-overview.js` | Rivers overview | paginate `riversOverviewAddLines`; accessors; page state; search resets page; fix `downloadRiversData` |
| `public/modules/ui/routes-overview.js` | Routes overview | paginate `routesOverviewAddLines`; accessors; page state; search resets page; fix `downloadRoutesData` |

---

## Task 0: Unblock the pre-commit hook

The pre-commit hook runs `npm run lint` (`biome check --write`). Biome aborts because a
git worktree under `.claude/worktrees/json-importer/` contains a nested `biome.json`.
`.claude/` is not gitignored, and biome's `useIgnoreFile: true` only skips gitignored
paths. Ignoring `.claude/` fixes the hook and is correct hygiene (Claude worktrees are
never committed).

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Append `.claude/` to `.gitignore`**

Add this line to the end of `.gitignore`:

```
.claude/
```

- [ ] **Step 2: Verify the hook now passes**

Run: `npm run lint`
Expected: biome runs to completion (it checks only `src/**/*.ts`) with no "nested root configuration" error. It may report/auto-fix existing `src` issues; that is fine as long as it exits 0.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: gitignore .claude worktrees to unblock biome pre-commit hook"
```

If the commit is still blocked by an unrelated pre-existing `src` lint error, re-run with `SKIP_SIMPLE_GIT_HOOKS=1 git commit -m "…"` and note it, but prefer fixing Step 2 so the rest of the plan has a working hook.

---

## Task 1: Shared pagination/sort toolkit in `editors.js`

**Files:**
- Modify: `public/modules/ui/editors.js` (insert after `applySorting`, which ends at the closing brace near line 130)

- [ ] **Step 1: Add the helpers**

Insert this block immediately after the `applySorting` function (after its closing `}`):

```javascript
// ---- Shared editor pagination (used by states, cultures, religions, rivers, routes) ----
const EDITOR_PAGE_SIZE = 200;

// Read the active sort column from a header element, or null if none is active.
// Mirrors how applySorting reads the icon-sort-* class set by sortLines.
function getActiveSort(headers) {
  const header = headers.querySelector("div[class*='icon-sort']");
  if (!header) return null;
  return {
    sortby: header.dataset.sortby,
    name: header.classList.contains("alphabetically"),
    desc: header.className.includes("-down") ? -1 : 1
  };
}

// Sort `data` IN PLACE to match the header's active column.
// `accessors` maps a data-sortby key to a value getter, e.g. {name: s => s.name}.
function sortDataByActiveHeader(headers, data, accessors) {
  const sort = getActiveSort(headers);
  if (!sort) return data;
  const get = accessors[sort.sortby];
  if (!get) return data;
  return data.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (sort.name) {
      const as = String(av);
      const bs = String(bv);
      return (as > bs ? 1 : as < bs ? -1 : 0) * sort.desc;
    }
    return (av - bv) * sort.desc;
  });
}

// Clamp the page and return the slice for the current page.
// `pageRef` is a mutable {page} holder so the clamped value persists across calls.
function getEditorPage(data, pageRef, size = EDITOR_PAGE_SIZE) {
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  pageRef.page = Math.min(Math.max(1, pageRef.page || 1), totalPages);
  const start = (pageRef.page - 1) * size;
  return {items: data.slice(start, start + size), page: pageRef.page, totalPages, total};
}

// Inject/refresh pagination controls inside `footerEl`. Calls onGoto(page) on navigation.
// Hidden when there is a single page. Rebuilding innerHTML drops stale listeners.
function renderEditorPagination(footerEl, info, onGoto) {
  let nav = footerEl.querySelector(":scope > .editorPagination");
  if (!nav) {
    // margin-left:auto only right-aligns inside a flex row; .totalLine footers are not
    // guaranteed to be flex, so make the footer a flex row when we first inject.
    footerEl.style.display = "flex";
    footerEl.style.alignItems = "center";
    nav = document.createElement("div");
    nav.className = "editorPagination";
    nav.style.cssText = "margin-left: auto; display: inline-flex; gap: 0.3em; align-items: center;";
    footerEl.appendChild(nav);
  }
  if (info.totalPages <= 1) {
    nav.style.display = "none";
    nav.innerHTML = "";
    return;
  }
  nav.style.display = "inline-flex";
  nav.innerHTML = /* html */ `
    <button class="icon-left-open editorPagePrev" data-tip="Previous page" style="padding: 0 4px;" ${info.page <= 1 ? "disabled" : ""}></button>
    <span>Page&nbsp;<input class="editorPageInput" type="number" min="1" max="${info.totalPages}" value="${info.page}" style="width: 3.5em" data-tip="Jump to page" />&nbsp;of&nbsp;${info.totalPages}</span>
    <button class="icon-right-open editorPageNext" data-tip="Next page" style="padding: 0 4px;" ${info.page >= info.totalPages ? "disabled" : ""}></button>`;
  nav.querySelector(".editorPagePrev").on("click", () => onGoto(info.page - 1));
  nav.querySelector(".editorPageNext").on("click", () => onGoto(info.page + 1));
  nav.querySelector(".editorPageInput").on("change", e => onGoto(+e.target.value));
}

// Bind sort-header clicks to reset to page 1 and re-render.
// Register AFTER sortLines is bound so the icon-sort-* class is toggled first.
function bindEditorSortReset(headerEl, onSort) {
  headerEl.querySelectorAll(".sortable").forEach(el => el.on("click", () => onSort()));
}
```

> Note: `.on(...)` is the project's jQuery-free alias for `addEventListener` (used throughout these files). `getActiveSort` is also used internally by `sortDataByActiveHeader`; keep both.

- [ ] **Step 2: Syntax check**

Run: `node --check public/modules/ui/editors.js`
Expected: exits 0, no output.

- [ ] **Step 3: Commit**

```bash
git add public/modules/ui/editors.js
git commit -m "feat(editors): add shared pagination + cross-page sort helpers"
```

---

## Task 2: Paginate the States editor

**Files:**
- Modify: `public/modules/dynamic/editors/states-editor.js`

States is an ES module. Row rendering triggers a COA render per row, so capping to 200
is the main win. The neutral row (`i=0`) is part of `pack.states` and flows through sort
and pagination as a normal item (per spec decision).

- [ ] **Step 1: Add page state and accessor map**

At the top of the file, after the existing `let statesManualHistory = [];` (line 3), add:

```javascript
const statesPage = {page: 1};
const STATES_SORT_ACCESSORS = {
  name: s => s.name,
  form: s => s.formName,
  capital: s => (s.i ? pack.burgs[s.capital].name : ""),
  culture: s => (s.i ? pack.cultures[s.culture].name : ""),
  burgs: s => s.burgs,
  area: s => s.area,
  population: s => s.rural * populationRate + s.urban * populationRate * urbanization,
  type: s => s.type || "",
  expansionism: s => s.expansionism || 0,
  cells: s => s.cells
};
```

- [ ] **Step 2: Reset to page 1 when the editor opens**

In `open()` (starts line 5), add a page reset right before the `refreshStatesEditor();` call:

```javascript
  statesPage.page = 1;
  refreshStatesEditor();
```

- [ ] **Step 3: Bind sort clicks to reset+re-render**

In `addListeners()` (starts line 97), immediately after the existing
`applySortingByHeader("statesHeader");` line, add:

```javascript
  bindEditorSortReset(ensureEl("statesHeader"), () => {
    statesPage.page = 1;
    statesEditorAddLines();
  });
```

- [ ] **Step 4: Rewrite `statesEditorAddLines` to sort-all, total-all, render-page**

Replace the whole `statesEditorAddLines` function (lines 160-299) with the version below.
It (a) builds the full non-removed list, (b) sorts the full list, (c) accumulates footer
totals over the full list, (d) renders only the page slice, (e) draws pagination, and
(f) drops the trailing `applySorting(statesHeader)` call.

```javascript
// add line for each state (current page only; sort + totals span all states)
function statesEditorAddLines() {
  const unit = getAreaUnit();
  const hidden = ensureEl("statesRegenerateButtons").style.display === "block" ? "" : "hidden"; // toggle regenerate columns

  const allStates = pack.states.filter(s => !s.removed);
  sortDataByActiveHeader(ensureEl("statesHeader"), allStates, STATES_SORT_ACCESSORS);

  // footer totals over the full set
  let totalArea = 0;
  let totalPopulation = 0;
  let totalBurgs = 0;
  for (const s of allStates) {
    totalArea += getArea(s.area);
    totalPopulation += rn(s.rural * populationRate + s.urban * populationRate * urbanization);
    totalBurgs += s.burgs;
  }

  const pageInfo = getEditorPage(allStates, statesPage);
  let lines = "";

  for (const s of pageInfo.items) {
    const area = getArea(s.area);
    const rural = s.rural * populationRate;
    const urban = s.urban * populationRate * urbanization;
    const population = rn(rural + urban);
    const populationTip = `Total population: ${si(population)}; Rural population: ${si(rural)}; Urban population: ${si(
      urban
    )}. Click to change`;
    const focused = defs.select("#fog #focusState" + s.i).size();

    if (!s.i) {
      // Neutral line
      lines += /* html */ `<div
        class="states"
        data-id=${s.i}
        data-name="${s.name}"
        data-cells=${s.cells}
        data-area=${area}
        data-population=${population}
        data-burgs=${s.burgs}
        data-color=""
        data-form=""
        data-capital=""
        data-culture=""
        data-type=""
        data-expansionism=""
      >
        <svg width="1em" height="1em" class="placeholder"></svg>
        <input data-tip="Neutral lands name. Click to change" class="stateName name pointer italic" value="${
          s.name
        }" readonly />
        <svg class="coaIcon placeholder"></svg>
        <input class="stateForm placeholder" value="none" />
        <span class="icon-star-empty placeholder"></span>
        <input class="stateCapital placeholder" />
        <select class="stateCulture placeholder hide">${getCultureOptions(0)}</select>
        <span data-tip="Click to overview neutral burgs" class="icon-dot-circled pointer hide" style="padding-right: 1px"></span>
        <div data-tip="Burgs count" class="stateBurgs hide">${s.burgs}</div>
        <span data-tip="Neutral lands area" style="padding-right: 4px" class="icon-map-o hide"></span>
        <div data-tip="Neutral lands area" class="stateArea hide" style="width: 6em">${si(area)} ${unit}</div>
        <span data-tip="${populationTip}" class="icon-male hide"></span>
        <div data-tip="${populationTip}" class="statePopulation pointer hide" style="width: 5em">${si(population)}</div>
        <select class="cultureType ${hidden} placeholder show hide">${getTypeOptions(0)}</select>
        <span class="icon-resize-full ${hidden} placeholder show hide"></span>
        <input class="statePower ${hidden} placeholder show hide" type="number" value="0" />
        <span data-tip="Cells count" class="icon-check-empty ${hidden} show hide"></span>
        <div data-tip="Cells count" class="stateCells ${hidden} show hide">${s.cells}</div>
      </div>`;
      continue;
    }

    const capital = pack.burgs[s.capital].name;
    COArenderer.trigger("stateCOA" + s.i, s.coa);
    lines += /* html */ `<div
      class="states"
      data-id=${s.i}
      data-name="${s.name}"
      data-form="${s.formName}"
      data-capital="${capital}"
      data-color="${s.color}"
      data-cells=${s.cells}
      data-area=${area}
      data-population=${population}
      data-burgs=${s.burgs}
      data-culture=${pack.cultures[s.culture].name}
      data-type=${s.type}
      data-expansionism=${s.expansionism}
    >
      <fill-box fill="${s.color}"></fill-box>
      <input data-tip="State name. Click to change" class="stateName name pointer" value="${s.name}" readonly />
      <svg data-tip="Click to show and edit state emblem" class="coaIcon pointer" viewBox="0 0 200 200"><use href="#stateCOA${
        s.i
      }"></use></svg>
      <input data-tip="State form name. Click to change" class="stateForm name pointer" value="${
        s.formName
      }" readonly />
      <span data-tip="State capital. Click to zoom into view" class="icon-star-empty pointer"></span>
      <input data-tip="Capital name. Click and type to rename" class="stateCapital" value="${capital}" autocorrect="off" spellcheck="false" />
      <select data-tip="Dominant culture. Click to change" class="stateCulture hide">${getCultureOptions(
        s.culture
      )}</select>
      <span data-tip="Click to overview state burgs" style="padding-right: 1px" class="icon-dot-circled pointer hide"></span>
      <div data-tip="Burgs count" class="stateBurgs hide">${s.burgs}</div>
      <span data-tip="State area" style="padding-right: 4px" class="icon-map-o hide"></span>
      <div data-tip="State area" class="stateArea hide" style="width: 6em">${si(area)} ${unit}</div>
      <span data-tip="${populationTip}" class="icon-male hide"></span>
      <div data-tip="${populationTip}" class="statePopulation pointer hide" style="width: 5em">${si(population)}</div>
      <select data-tip="State type. Defines growth model. Click to change" class="cultureType ${hidden} show hide">${getTypeOptions(
        s.type
      )}</select>
      <span data-tip="State expansionism" class="icon-resize-full ${hidden} show hide"></span>
      <input data-tip="Expansionism (defines competitive size). Change to re-calculate states based on new value"
        class="statePower ${hidden} show hide" type="number" min="0" max="99" step=".1" value=${s.expansionism} />
      <span data-tip="Cells count" class="icon-check-empty ${hidden} show hide"></span>
      <div data-tip="Cells count" class="stateCells ${hidden} show hide">${s.cells}</div>
      <span data-tip="Locate the state" class="icon-target hide"></span>
      <span data-tip="Toggle state focus" class="icon-pin ${focused ? "" : " inactive"} hide"></span>
      <span data-tip="Lock the state to protect it from re-generation" class="icon-lock${
        s.lock ? "" : "-open"
      } hide"></span>
      <span data-tip="Remove the state" class="icon-trash-empty hide"></span>
    </div>`;
  }
  $body.innerHTML = lines;

  // update footer
  ensureEl("statesFooterStates").innerHTML = pack.states.filter(s => s.i && !s.removed).length;
  ensureEl("statesFooterCells").innerHTML = pack.cells.h.filter(h => h >= 20).length;
  ensureEl("statesFooterBurgs").innerHTML = totalBurgs;
  ensureEl("statesFooterArea").innerHTML = si(totalArea) + unit;
  ensureEl("statesFooterArea").dataset.area = totalArea;
  ensureEl("statesFooterPopulation").innerHTML = si(totalPopulation);
  ensureEl("statesFooterPopulation").dataset.population = totalPopulation;

  renderEditorPagination(ensureEl("statesFooter"), pageInfo, page => {
    statesPage.page = page;
    statesEditorAddLines();
  });

  // add listeners
  $body.querySelectorAll(":scope > div").forEach($line => {
    $line.on("mouseenter", stateHighlightOn);
    $line.on("mouseleave", stateHighlightOff);
    $line.on("click", selectStateOnLineClick);
  });

  if ($body.dataset.type === "percentage") {
    $body.dataset.type = "absolute";
    togglePercentageMode();
  }
  $("#statesEditor").dialog({ width: fitContent() });
}
```

- [ ] **Step 5: Make `randomizeStatesExpansion` page-safe**

In `randomizeStatesExpansion` (line ~871), the per-state DOM write throws for off-page
states. Guard it with optional chaining. Replace:

```javascript
    $body.querySelector("div.states[data-id='" + s.i + "'] > input.statePower").value = expansionism;
```

with:

```javascript
    const $power = $body.querySelector("div.states[data-id='" + s.i + "'] > input.statePower");
    if ($power) $power.value = expansionism;
```

- [ ] **Step 6: Make `downloadStatesCsv` export the full set, not the page**

Replace the body of `downloadStatesCsv` (line ~1491) so it iterates `pack.states`
directly instead of the rendered DOM rows:

```javascript
function downloadStatesCsv() {
  const unit = getAreaUnit("2");
  const headers = `Id,State,Full Name,Form,Color,Capital,Culture,Type,Expansionism,Cells,Burgs,Area ${unit},Total Population,Rural Population,Urban Population`;
  const data = pack.states
    .filter(s => !s.removed)
    .map(s => {
      const area = getArea(s.area);
      const ruralPopulation = Math.round(s.rural * populationRate);
      const urbanPopulation = Math.round(s.urban * populationRate * urbanization);
      const population = ruralPopulation + urbanPopulation;
      const capital = s.i ? pack.burgs[s.capital].name : "";
      const culture = s.i ? pack.cultures[s.culture].name : "";
      return [
        s.i,
        s.name,
        s.fullName || "",
        s.formName || "",
        s.color || "",
        capital,
        culture,
        s.type || "",
        s.expansionism ?? "",
        s.cells,
        s.burgs,
        area,
        population,
        ruralPopulation,
        urbanPopulation
      ].join(",");
    });
  const csvData = [headers].concat(data).join("\n");

  const name = getFileName("States") + ".csv";
  downloadFile(csvData, name);
}
```

- [ ] **Step 7: Syntax check**

Run: `node --check public/modules/dynamic/editors/states-editor.js`
Expected: exits 0, no output.

- [ ] **Step 8: Manual browser verification**

Run `npm run dev`, load a map with 1k+ states, open the States editor (Tools → States or the states layer editor). Confirm:
- Opens quickly; shows 200 rows and a `‹ Page 1 of N ›` control in the footer.
- Next/Prev navigate; the page input jumps; buttons disable at the first/last page; out-of-range input clamps.
- Click "Population" header: page resets to 1 and the top row is the **global** max/min (not just the previously-visible max). Toggle the same header to reverse order.
- Footer totals (states/cells/burgs/area/population) are unchanged by paging (full-set totals).
- Toggle percentage mode on page 2: visible rows show sensible percentages of the full totals.
- Export CSV from page 2: the file has every state, not 200.
- Open the regenerate menu and click "Randomize": no console error (off-page rows are skipped); apply works.
- Remove the last state on the last page: editor lands on the new last page, not an empty page.

- [ ] **Step 9: Commit**

```bash
git add public/modules/dynamic/editors/states-editor.js
git commit -m "feat(states-editor): paginate rows, sort across pages, fix CSV + randomize"
```

---

## Task 3: Paginate the Cultures editor

**Files:**
- Modify: `public/modules/dynamic/editors/cultures-editor.js`

ES module; rows have a fill-box + selects (no COA render). Neutral row `i=0` flows
through sort/pagination. The editor toggles the `emblems` sort column's visibility based
on `selectShape`; preserve that.

- [ ] **Step 1: Add page state and accessor map**

After `let culturesManualHistory = [];` (line 3) and the `cultureTypes` const (line 5),
add:

```javascript
const culturesPage = {page: 1};
const CULTURES_SORT_ACCESSORS = {
  name: c => c.name,
  type: c => c.type || "",
  base: c => c.base,
  cells: c => c.cells,
  expansionism: c => c.expansionism || 0,
  area: c => c.area,
  population: c => c.rural * populationRate + c.urban * populationRate * urbanization,
  emblems: c => c.shield
};
```

- [ ] **Step 2: Reset to page 1 on open**

In `open()` (line 7), add the reset right before `refreshCulturesEditor();`:

```javascript
  culturesPage.page = 1;
  refreshCulturesEditor();
```

- [ ] **Step 3: Bind sort clicks to reset+re-render**

In `addListeners()` (line 78), right after `applySortingByHeader("culturesHeader");`, add:

```javascript
  bindEditorSortReset(ensureEl("culturesHeader"), () => {
    culturesPage.page = 1;
    culturesEditorAddLines();
  });
```

- [ ] **Step 4: Rewrite `culturesEditorAddLines` to sort-all, total-all, render-page**

Replace the whole `culturesEditorAddLines` function (lines 121-263) with:

```javascript
function culturesEditorAddLines() {
  const unit = getAreaUnit();

  const emblemShapeGroup = ensureEl("emblemShape").selectedOptions[0]?.parentNode?.label;
  const selectShape = emblemShapeGroup === "Diversiform";

  const allCultures = pack.cultures.filter(c => !c.removed);
  sortDataByActiveHeader(ensureEl("culturesHeader"), allCultures, CULTURES_SORT_ACCESSORS);

  // footer totals over the full set
  let totalArea = 0;
  let totalPopulation = 0;
  for (const c of allCultures) {
    totalArea += getArea(c.area);
    totalPopulation += rn(c.rural * populationRate + c.urban * populationRate * urbanization);
  }

  const pageInfo = getEditorPage(allCultures, culturesPage);
  let lines = "";

  for (const c of pageInfo.items) {
    const area = getArea(c.area);
    const rural = c.rural * populationRate;
    const urban = c.urban * populationRate * urbanization;
    const population = rn(rural + urban);
    const populationTip = `Total population: ${si(population)}. Rural population: ${si(rural)}. Urban population: ${si(
      urban
    )}. Click to edit`;

    if (!c.i) {
      // Uncultured (neutral) line
      lines += /* html */ `<div
          class="states"
          data-id="${c.i}"
          data-name="${c.name}"
          data-color=""
          data-cells="${c.cells}"
          data-area="${area}"
          data-population="${population}"
          data-base="${c.base}"
          data-type=""
          data-expansionism=""
          data-emblems="${c.shield}"
        >
          <svg width="11" height="11" class="placeholder"></svg>
          <input data-tip="Neutral culture name. Click and type to change" class="cultureName italic" style="width: 7em"
            value="${c.name}" autocorrect="off" spellcheck="false" />
          <span class="icon-cw placeholder"></span>
          <select class="cultureType placeholder">${getTypeOptions(c.type)}</select>
          <span data-tip="Click to re-generate names for burgs with this culture assigned" class="icon-arrows-cw hide"></span>
          <select data-tip="Culture namesbase. Click to change. Click on arrows to re-generate names"
            class="cultureBase">${getBaseOptions(c.base)}</select>
          <span data-tip="Cells count" class="icon-check-empty hide"></span>
          <div data-tip="Cells count" class="cultureCells hide" style="width: 4em">${c.cells}</div>
          <span class="icon-resize-full placeholder hide"></span>
          <input class="cultureExpan placeholder hide" type="number" />
          <span data-tip="Culture area" style="padding-right: 4px" class="icon-map-o hide"></span>
          <div data-tip="Culture area" class="cultureArea hide" style="width: 6em">${si(area)} ${unit}</div>
          <span data-tip="${populationTip}" class="icon-male hide"></span>
          <div data-tip="${populationTip}" class="culturePopulation hide pointer"
            style="width: 4em">${si(population)}</div>
          ${getShapeOptions(selectShape, c.shield)}
        </div>`;
      continue;
    }

    lines += /* html */ `<div
        class="states"
        data-id="${c.i}"
        data-name="${c.name}"
        data-color="${c.color}"
        data-cells="${c.cells}"
        data-area="${area}"
        data-population="${population}"
        data-base="${c.base}"
        data-type="${c.type}"
        data-expansionism="${c.expansionism}"
        data-emblems="${c.shield}"
      >
        <fill-box fill="${c.color}"></fill-box>
        <input data-tip="Culture name. Click and type to change" class="cultureName" style="width: 7em"
          value="${c.name}" autocorrect="off" spellcheck="false" />
        <span data-tip="Regenerate culture name" class="icon-cw hiddenIcon" style="visibility: hidden"></span>
        <select data-tip="Culture type. Defines growth model. Click to change"
          class="cultureType">${getTypeOptions(c.type)}</select>
        <span data-tip="Click to re-generate names for burgs with this culture assigned" class="icon-arrows-cw hide"></span>
        <select data-tip="Culture namesbase. Click to change. Click on arrows to re-generate names"
          class="cultureBase">${getBaseOptions(c.base)}</select>
        <span data-tip="Cells count" class="icon-check-empty hide"></span>
        <div data-tip="Cells count" class="cultureCells hide" style="width: 4em">${c.cells}</div>
        <span data-tip="Culture expansionism. Defines competitive size" class="icon-resize-full hide"></span>
        <input
          data-tip="Culture expansionism. Defines competitive size. Click to change, then click Recalculate to apply change"
          class="cultureExpan hide"
          type="number"
          min="0"
          max="99"
          step=".1"
          value=${c.expansionism}
        />
        <span data-tip="Culture area" style="padding-right: 4px" class="icon-map-o hide"></span>
        <div data-tip="Culture area" class="cultureArea hide" style="width: 6em">${si(area)} ${unit}</div>
        <span data-tip="${populationTip}" class="icon-male hide"></span>
        <div data-tip="${populationTip}" class="culturePopulation hide pointer"
          style="width: 4em">${si(population)}</div>
        ${getShapeOptions(selectShape, c.shield)}
        <span data-tip="Locate the culture" class="icon-target hide"></span>
        <span data-tip="Lock culture" class="icon-lock${c.lock ? "" : "-open"} hide"></span>
        <span data-tip="Remove culture" class="icon-trash-empty hide"></span>
      </div>`;
  }
  $body.innerHTML = lines;

  // update footer
  ensureEl("culturesFooterCultures").innerHTML = pack.cultures.filter(c => c.i && !c.removed).length;
  ensureEl("culturesFooterCells").innerHTML = pack.cells.h.filter(h => h >= 20).length;
  ensureEl("culturesFooterArea").innerHTML = `${si(totalArea)} ${unit}`;
  ensureEl("culturesFooterPopulation").innerHTML = si(totalPopulation);
  ensureEl("culturesFooterArea").dataset.area = totalArea;
  ensureEl("culturesFooterPopulation").dataset.population = totalPopulation;

  renderEditorPagination(ensureEl("culturesFooter"), pageInfo, page => {
    culturesPage.page = page;
    culturesEditorAddLines();
  });

  // add listeners
  $body.querySelectorAll(":scope > div").forEach($line => {
    $line.on("mouseenter", cultureHighlightOn);
    $line.on("mouseleave", cultureHighlightOff);
    $line.on("click", selectCultureOnLineClick);
  });
  $body.querySelectorAll("fill-box").forEach($el => $el.on("click", cultureChangeColor));
  $body.querySelectorAll("div > input.cultureName").forEach($el => $el.on("input", cultureChangeName));
  $body.querySelectorAll("div > span.icon-cw").forEach($el => $el.on("click", cultureRegenerateName));
  $body.querySelectorAll("div > input.cultureExpan").forEach($el => $el.on("change", cultureChangeExpansionism));
  $body.querySelectorAll("div > select.cultureType").forEach($el => $el.on("change", cultureChangeType));
  $body.querySelectorAll("div > select.cultureBase").forEach($el => $el.on("change", cultureChangeBase));
  $body.querySelectorAll("div > select.cultureEmblems").forEach($el => $el.on("change", cultureChangeEmblemsShape));
  $body.querySelectorAll("div > div.culturePopulation").forEach($el => $el.on("click", changePopulation));
  $body.querySelectorAll("div > span.icon-arrows-cw").forEach($el => $el.on("click", cultureRegenerateBurgs));
  $body.querySelectorAll("div > span.icon-target").forEach($el => $el.on("click", cultureHighlightElement));
  $body.querySelectorAll("div > span.icon-trash-empty").forEach($el => $el.on("click", cultureRemovePrompt));
  $body.querySelectorAll("div > span.icon-lock").forEach($el => $el.on("click", updateLockStatus));
  $body.querySelectorAll("div > span.icon-lock-open").forEach($el => $el.on("click", updateLockStatus));

  const $culturesHeader = ensureEl("culturesHeader");
  $culturesHeader.querySelector("div[data-sortby='emblems']").style.display = selectShape ? "inline-block" : "none";

  if ($body.dataset.type === "percentage") {
    $body.dataset.type = "absolute";
    togglePercentageMode();
  }
  $("#culturesEditor").dialog({ width: fitContent() });
}
```

- [ ] **Step 5: Make `downloadCulturesCsv` export the full set**

Replace `downloadCulturesCsv` (line ~858) so it iterates `pack.cultures` instead of DOM
rows. Read the surrounding original to preserve the exact column set; the rewrite:

```javascript
function downloadCulturesCsv() {
  const unit = getAreaUnit("2");
  const headers = `Id,Name,Color,Cells,Expansionism,Type,Area ${unit},Population,Namesbase,Emblems Shape,Origins`;
  const data = pack.cultures
    .filter(c => !c.removed)
    .map(c => {
      const area = getArea(c.area);
      const population = rn(c.rural * populationRate + c.urban * populationRate * urbanization);
      const namesbase = nameBases[c.base].name;
      const origins = (c.origins || []).join("-");
      return [
        c.i,
        c.name,
        c.color || "",
        c.cells,
        c.expansionism ?? "",
        c.type || "",
        area,
        population,
        namesbase,
        c.shield,
        origins
      ].join(",");
    });
  const csvData = [headers].concat(data).join("\n");

  const name = getFileName("Cultures") + ".csv";
  downloadFile(csvData, name);
}
```

> Before applying, open the original `downloadCulturesCsv` and confirm the exact column
> order and how `origins` was serialized; match it. If the original wrapped a field in
> quotes, keep that. Adjust the array above to match the original header string verbatim.

- [ ] **Step 6: Syntax check**

Run: `node --check public/modules/dynamic/editors/cultures-editor.js`
Expected: exits 0, no output.

- [ ] **Step 7: Manual browser verification**

`npm run dev`, open Cultures editor on a map with many cultures. Confirm: paginates at
200; sort spans all pages and resets to page 1; footer totals stable across pages; the
`emblems` column still shows/hides with Diversiform emblem shapes; percentage mode on a
later page shows correct shares; CSV export contains all cultures. With < 200 cultures,
no pagination control appears.

- [ ] **Step 8: Commit**

```bash
git add public/modules/dynamic/editors/cultures-editor.js
git commit -m "feat(cultures-editor): paginate rows, sort across pages, fix CSV export"
```

---

## Task 4: Paginate the Religions editor

**Files:**
- Modify: `public/modules/dynamic/editors/religions-editor.js`

ES module; preserves the existing "extinct" hide rule and `getExpansionColumns(r)`
trailing markup. Neutral row `i=0` flows through sort/pagination.

- [ ] **Step 1: Add page state and accessor map**

After `addListeners();` (line 2) at the top of the file, add:

```javascript
const religionsPage = {page: 1};
const RELIGIONS_SORT_ACCESSORS = {
  name: r => r.name,
  type: r => r.type || "",
  form: r => r.form || "",
  deity: r => r.deity || "",
  area: r => r.area,
  population: r => r.rural * populationRate + r.urban * populationRate * urbanization,
  expansion: r => r.expansion || "",
  expansionism: r => r.expansionism || 0
};
```

- [ ] **Step 2: Reset to page 1 on open**

In `open()` (line 4), add the reset right before `refreshReligionsEditor();`:

```javascript
  religionsPage.page = 1;
  refreshReligionsEditor();
```

- [ ] **Step 3: Bind sort clicks; reset page when toggling extinct**

In `addListeners()` (line 93), right after `applySortingByHeader("religionsHeader");`, add:

```javascript
  bindEditorSortReset(ensureEl("religionsHeader"), () => {
    religionsPage.page = 1;
    religionsEditorAddLines();
  });
```

Then find `toggleExtinct` (the handler bound to `religionsExtinct`) and add
`religionsPage.page = 1;` as its first statement so toggling extinct visibility restarts
at page 1. (If `toggleExtinct` re-renders via `religionsEditorAddLines`, the reset just
needs to precede that call.)

- [ ] **Step 4: Rewrite `religionsEditorAddLines` to sort-all, total-all, render-page**

Replace the whole `religionsEditorAddLines` function (lines 133-263) with:

```javascript
// add line for each religion (current page only; sort + totals span all religions)
function religionsEditorAddLines() {
  const unit = " " + getAreaUnit();

  const allReligions = pack.religions.filter(
    r => !r.removed && !(r.i && !r.cells && $body.dataset.extinct !== "show")
  );
  sortDataByActiveHeader(ensureEl("religionsHeader"), allReligions, RELIGIONS_SORT_ACCESSORS);

  // footer totals over the full (visible) set
  let totalArea = 0;
  let totalPopulation = 0;
  for (const r of allReligions) {
    totalArea += getArea(r.area);
    totalPopulation += rn(r.rural * populationRate + r.urban * populationRate * urbanization);
  }

  const pageInfo = getEditorPage(allReligions, religionsPage);
  let lines = "";

  for (const r of pageInfo.items) {
    const area = getArea(r.area);
    const rural = r.rural * populationRate;
    const urban = r.urban * populationRate * urbanization;
    const population = rn(rural + urban);
    const populationTip = `Believers: ${si(population)}; Rural areas: ${si(rural)}; Urban areas: ${si(
      urban
    )}. Click to change`;

    if (!r.i) {
      // No religion (neutral) line
      lines += /* html */ `<div
        class="states"
        data-id="${r.i}"
        data-name="${r.name}"
        data-color=""
        data-area="${area}"
        data-population="${population}"
        data-type=""
        data-form=""
        data-deity=""
        data-expansion=""
        data-expansionism=""
      >
        <svg width="9" height="9" class="placeholder"></svg>
        <input data-tip="Religion name. Click and type to change" class="religionName italic" style="width: 11em"
          value="${r.name}" autocorrect="off" spellcheck="false" />
        <select data-tip="Religion type" class="religionType placeholder" style="width: 5em">
          ${getTypeOptions(r.type)}
        </select>
        <input data-tip="Religion form" class="religionForm placeholder" style="width: 6em" value="" autocorrect="off" spellcheck="false" />
        <span data-tip="Click to re-generate supreme deity" class="icon-arrows-cw placeholder hide"></span>
        <input data-tip="Religion supreme deity" class="religionDeity placeholder hide" style="width: 17em" value="" autocorrect="off" spellcheck="false" />
        <span data-tip="Religion area" style="padding-right: 4px" class="icon-map-o hide"></span>
        <div data-tip="Religion area" class="religionArea hide" style="width: 6em">${si(area) + unit}</div>
        <span data-tip="${populationTip}" class="icon-male hide"></span>
        <div data-tip="${populationTip}" class="religionPopulation hide pointer" style="width: 5em">${si(
          population
        )}</div>
      </div>`;
      continue;
    }

    lines += /* html */ `<div
      class="states"
      data-id=${r.i}
      data-name="${r.name}"
      data-color="${r.color}"
      data-area=${area}
      data-population=${population}
      data-type="${r.type}"
      data-form="${r.form}"
      data-deity="${r.deity || ""}"
      data-expansion="${r.expansion}"
      data-expansionism="${r.expansionism}"
    >
      <fill-box fill="${r.color}"></fill-box>
      <input data-tip="Religion name. Click and type to change" class="religionName" style="width: 11em"
        value="${r.name}" autocorrect="off" spellcheck="false" />
      <select data-tip="Religion type" class="religionType" style="width: 5em">
        ${getTypeOptions(r.type)}
      </select>
      <input data-tip="Religion form" class="religionForm" style="width: 6em"
        value="${r.form}" autocorrect="off" spellcheck="false" />
      <span data-tip="Click to re-generate supreme deity" class="icon-arrows-cw hide"></span>
      <input data-tip="Religion supreme deity" class="religionDeity hide" style="width: 17em"
        value="${r.deity || ""}" autocorrect="off" spellcheck="false" />
      <span data-tip="Religion area" style="padding-right: 4px" class="icon-map-o hide"></span>
      <div data-tip="Religion area" class="religionArea hide" style="width: 6em">${si(area) + unit}</div>
      <span data-tip="${populationTip}" class="icon-male hide"></span>
      <div data-tip="${populationTip}" class="religionPopulation hide pointer" style="width: 5em">${si(
        population
      )}</div>
      ${getExpansionColumns(r)}
      <span data-tip="Locate the religion" class="icon-target hide"></span>
      <span data-tip="Lock this religion" class="icon-lock${r.lock ? "" : "-open"} hide"></span>
      <span data-tip="Remove religion" class="icon-trash-empty hide"></span>
    </div>`;
  }
  $body.innerHTML = lines;

  // update footer
  const validReligions = pack.religions.filter(r => r.i && !r.removed);
  ensureEl("religionsOrganized").innerHTML = validReligions.filter(r => r.type === "Organized").length;
  ensureEl("religionsHeresies").innerHTML = validReligions.filter(r => r.type === "Heresy").length;
  ensureEl("religionsCults").innerHTML = validReligions.filter(r => r.type === "Cult").length;
  ensureEl("religionsFolk").innerHTML = validReligions.filter(r => r.type === "Folk").length;
  ensureEl("religionsFooterArea").innerHTML = si(totalArea) + unit;
  ensureEl("religionsFooterPopulation").innerHTML = si(totalPopulation);
  ensureEl("religionsFooterArea").dataset.area = totalArea;
  ensureEl("religionsFooterPopulation").dataset.population = totalPopulation;

  renderEditorPagination(ensureEl("religionsFooter"), pageInfo, page => {
    religionsPage.page = page;
    religionsEditorAddLines();
  });

  // add listeners
  $body.querySelectorAll(":scope > div").forEach($line => {
    $line.on("mouseenter", religionHighlightOn);
    $line.on("mouseleave", religionHighlightOff);
    $line.on("click", selectReligionOnLineClick);
  });
  $body.querySelectorAll("fill-box").forEach(el => el.on("click", religionChangeColor));
  $body.querySelectorAll("div > input.religionName").forEach(el => el.on("input", religionChangeName));
  $body.querySelectorAll("div > select.religionType").forEach(el => el.on("change", religionChangeType));
  $body.querySelectorAll("div > input.religionForm").forEach(el => el.on("input", religionChangeForm));
  $body.querySelectorAll("div > input.religionDeity").forEach(el => el.on("input", religionChangeDeity));
  $body.querySelectorAll("div > span.icon-arrows-cw").forEach(el => el.on("click", regenerateDeity));
  $body.querySelectorAll("div > div.religionPopulation").forEach(el => el.on("click", changePopulation));
  $body.querySelectorAll("div > select.religionExtent").forEach(el => el.on("change", religionChangeExtent));
  $body.querySelectorAll("div > input.religionExpantion").forEach(el => el.on("change", religionChangeExpansionism));
  $body.querySelectorAll("div > span.icon-trash-empty").forEach(el => el.on("click", religionRemovePrompt));
  $body.querySelectorAll("div > span.icon-target").forEach($el => $el.on("click", highlightReligion));
  $body.querySelectorAll("div > span.icon-lock").forEach($el => $el.on("click", updateLockStatus));
  $body.querySelectorAll("div > span.icon-lock-open").forEach($el => $el.on("click", updateLockStatus));

  if ($body.dataset.type === "percentage") {
    $body.dataset.type = "absolute";
    togglePercentageMode();
  }

  $("#religionsEditor").dialog({ width: fitContent() });
}
```

- [ ] **Step 5: Make `downloadReligionsCsv` export the full set**

Replace `downloadReligionsCsv` (line ~809) so it iterates `pack.religions` instead of DOM
rows. Open the original first to copy the exact header string and `origins`/`deity`
quoting, then mirror it:

```javascript
function downloadReligionsCsv() {
  const unit = getAreaUnit("2");
  const headers = `Id,Name,Color,Type,Form,Supreme Deity,Area ${unit},Believers,Origins,Potential,Expansionism`;
  const data = pack.religions
    .filter(r => !r.removed && !(r.i && !r.cells && $body.dataset.extinct !== "show"))
    .map(r => {
      const area = getArea(r.area);
      const believers = rn(r.rural * populationRate + r.urban * populationRate * urbanization);
      const deityText = '"' + (r.deity || "") + '"';
      const origins = (r.origins || []).join("-");
      return [
        r.i,
        r.name,
        r.color || "",
        r.type || "",
        r.form || "",
        deityText,
        area,
        believers,
        origins,
        r.expansion || "",
        r.expansionism ?? ""
      ].join(",");
    });
  const csvData = [headers].concat(data).join("\n");

  const name = getFileName("Religions") + ".csv";
  downloadFile(csvData, name);
}
```

> Confirm against the original: column order, the `deity` quoting, and how `origins` was
> joined. Match the original header verbatim.

- [ ] **Step 6: Syntax check**

Run: `node --check public/modules/dynamic/editors/religions-editor.js`
Expected: exits 0, no output.

- [ ] **Step 7: Manual browser verification**

`npm run dev`, open Religions editor on a map with many religions. Confirm: paginates at
200; sort spans all pages and resets to page 1; toggling "show extinct" resets to page 1
and changes the set; footer Organized/Heresies/Cults/Folk + area + believers correct;
percentage mode on a later page correct; CSV export contains all religions (respecting
the extinct toggle).

- [ ] **Step 8: Commit**

```bash
git add public/modules/dynamic/editors/religions-editor.js
git commit -m "feat(religions-editor): paginate rows, sort across pages, fix CSV export"
```

---

## Task 5: Paginate the Rivers overview

**Files:**
- Modify: `public/modules/ui/rivers-overview.js`

Plain global script. `riversOverviewAddLines` is a closure inside `overviewRivers`. The
search input already re-renders; make it reset to page 1. The `riversHeader` `.sortable`
elements are bound to `sortLines` at load via the global `editors.js` handler, so only
add `bindEditorSortReset` (once, in the guarded init block).

- [ ] **Step 1: Add a file-level page state**

At the very top of the file, after `"use strict";` (line 1), add:

```javascript
const riversPage = {page: 1};
const RIVERS_SORT_ACCESSORS = {
  name: r => r.name || "",
  type: r => r.type || "",
  discharge: r => r.discharge,
  length: r => r.length,
  width: r => r.width
};
```

> `basin` sorting needs the `riversById` map built inside the function; it is added to the
> accessor map at call time in Step 3.

- [ ] **Step 2: Reset page when (re)opening and bind sort reset**

In `overviewRivers`, the page should reset each time the dialog opens. Add
`riversPage.page = 1;` immediately before the existing `riversOverviewAddLines();` call
near line 9.

Then, inside the `if (modules.overviewRivers) return;`-guarded init block (after line 13,
alongside the other `ensureEl(...).on(...)` listeners), add the sort-reset binding and
make search reset the page. Replace the existing search line:

```javascript
  ensureEl("riversSearch").on("input", riversOverviewAddLines);
```

with:

```javascript
  ensureEl("riversSearch").on("input", () => {
    riversPage.page = 1;
    riversOverviewAddLines();
  });
  bindEditorSortReset(ensureEl("riversHeader"), () => {
    riversPage.page = 1;
    riversOverviewAddLines();
  });
```

- [ ] **Step 3: Paginate `riversOverviewAddLines`**

In `riversOverviewAddLines` (line 32): after `filteredRivers` is computed (the block
ending at line 50) and before the `for (const r of filteredRivers)` loop, insert sorting
+ pagination, and change the loop to iterate the page slice. Concretely:

Replace:

```javascript
    for (const r of filteredRivers) {
```

with:

```javascript
    sortDataByActiveHeader(ensureEl("riversHeader"), filteredRivers, {
      ...RIVERS_SORT_ACCESSORS,
      basin: r => riversById.get(r.basin)?.name || ""
    });
    const pageInfo = getEditorPage(filteredRivers, riversPage);

    for (const r of pageInfo.items) {
```

- [ ] **Step 4: Draw pagination controls and drop the DOM sort**

Still in `riversOverviewAddLines`, after the footer update block (the four
`riversFooter*` assignments ending ~line 88) and the row-listener block, replace the
trailing:

```javascript
    applySorting(riversHeader);
```

with:

```javascript
    renderEditorPagination(ensureEl("riversFooter"), pageInfo, page => {
      riversPage.page = page;
      riversOverviewAddLines();
    });
```

> The footer averages (`riversFooterNumber`, discharge/length/width) are already computed
> from `filteredRivers` (full set), so they stay correct across pages — no change needed
> there.

- [ ] **Step 5: Make `downloadRiversData` export the full filtered set**

Replace `downloadRiversData` (line 154) so it iterates the search-filtered `pack.rivers`
instead of DOM rows:

```javascript
  function downloadRiversData() {
    let data = "Id,River,Type,Discharge,Length,Width,Basin\n"; // headers

    const riversById = new Map(pack.rivers.map(river => [river.i, river]));
    const searchText = ensureEl("riversSearch").value.toLowerCase().trim();
    const exported = pack.rivers.filter(r => {
      if (!searchText) return true;
      const name = (r.name || "").toLowerCase();
      const type = (r.type || "").toLowerCase();
      const basinName = (riversById.get(r.basin)?.name || "").toLowerCase();
      return name.includes(searchText) || type.includes(searchText) || basinName.includes(searchText);
    });

    exported.forEach(function (r) {
      const discharge = r.discharge + " m³/s";
      const length = rn(r.length * distanceScale) + " " + distanceUnitInput.value;
      const width = rn(r.width * distanceScale, 3) + " " + distanceUnitInput.value;
      const basin = riversById.get(r.basin)?.name || "";
      data += [r.i, r.name, r.type, discharge, length, width, basin].join(",") + "\n";
    });

    const name = getFileName("Rivers") + ".csv";
    downloadFile(data, name);
  }
```

- [ ] **Step 6: Syntax check**

Run: `node --check public/modules/ui/rivers-overview.js`
Expected: exits 0, no output.

- [ ] **Step 7: Manual browser verification**

`npm run dev`, open Rivers overview on a map with many rivers (1k+ for multiple pages).
Confirm: paginates at 200; sort (incl. Basin) spans all pages and resets to page 1;
typing in search resets to page 1 and filters across all pages; footer averages reflect
the filtered set; CSV export honors the search filter and contains all matching rivers.

- [ ] **Step 8: Commit**

```bash
git add public/modules/ui/rivers-overview.js
git commit -m "feat(rivers-overview): paginate rows, sort across pages, fix CSV export"
```

---

## Task 6: Paginate the Routes overview

**Files:**
- Modify: `public/modules/ui/routes-overview.js`

Plain global script, same closure shape as rivers. Note: rows with `< 2` points are
skipped at render time; they may occupy a slot in the page slice and simply render
nothing (rare, acceptable — matches current skip behavior).

- [ ] **Step 1: Add a file-level page state and accessors**

At the top, after `"use strict";` (line 1), add:

```javascript
const routesPage = {page: 1};
const ROUTES_SORT_ACCESSORS = {
  name: route => route.name || "",
  group: route => route.group || "",
  length: route => route.length
};
```

- [ ] **Step 2: Reset page on open; bind sort reset; search resets page**

Add `routesPage.page = 1;` immediately before the `routesOverviewAddLines();` call near
line 9.

Inside the `if (modules.overviewRoutes) return;`-guarded init block, replace the existing
search line:

```javascript
  ensureEl("routesSearch").on("input", routesOverviewAddLines);
```

with:

```javascript
  ensureEl("routesSearch").on("input", () => {
    routesPage.page = 1;
    routesOverviewAddLines();
  });
  bindEditorSortReset(ensureEl("routesHeader"), () => {
    routesPage.page = 1;
    routesOverviewAddLines();
  });
```

- [ ] **Step 3: Paginate `routesOverviewAddLines`**

In `routesOverviewAddLines` (line 31): after the `filteredRoutes` search block (ending
line 44), before the `for (const route of filteredRoutes)` loop, insert sort + pagination
and iterate the slice. Replace:

```javascript
    for (const route of filteredRoutes) {
```

with:

```javascript
    sortDataByActiveHeader(ensureEl("routesHeader"), filteredRoutes, ROUTES_SORT_ACCESSORS);
    const pageInfo = getEditorPage(filteredRoutes, routesPage);

    for (const route of pageInfo.items) {
```

- [ ] **Step 4: Draw pagination controls and drop the DOM sort**

After the footer update (lines 73-75) and the row-listener block, replace the trailing:

```javascript
    applySorting(routesHeader);
```

with:

```javascript
    renderEditorPagination(ensureEl("routesFooter"), pageInfo, page => {
      routesPage.page = page;
      routesOverviewAddLines();
    });
```

> `routesFooterNumber` and the average length are computed from `filteredRoutes` (full
> set), so they remain correct across pages.

- [ ] **Step 5: Make `downloadRoutesData` export the full filtered set**

Replace `downloadRoutesData` (line 113) so it iterates the search-filtered `pack.routes`
instead of DOM rows:

```javascript
  function downloadRoutesData() {
    let data = "Id,Route,Group,Length\n"; // headers

    const searchText = ensureEl("routesSearch").value.toLowerCase().trim();
    const exported = pack.routes.filter(route => {
      if (!searchText) return true;
      const name = (route.name || "").toLowerCase();
      const group = (route.group || "").toLowerCase();
      return name.includes(searchText) || group.includes(searchText);
    });

    exported.forEach(function (route) {
      const length = rn(route.length * distanceScale) + " " + distanceUnitInput.value;
      data += [route.i, route.name, route.group, length].join(",") + "\n";
    });

    const name = getFileName("Routes") + ".csv";
    downloadFile(data, name);
  }
```

- [ ] **Step 6: Syntax check**

Run: `node --check public/modules/ui/routes-overview.js`
Expected: exits 0, no output.

- [ ] **Step 7: Manual browser verification**

`npm run dev`, open Routes overview on a map with many routes. Confirm: paginates at 200;
sort spans all pages and resets to page 1; search resets to page 1 and filters across all
pages; footer count + average length reflect the filtered set; lock-all + remove-all
still re-render correctly and stay on a valid page; CSV export honors the search filter
and contains all matching routes.

- [ ] **Step 8: Commit**

```bash
git add public/modules/ui/routes-overview.js
git commit -m "feat(routes-overview): paginate rows, sort across pages, fix CSV export"
```

---

## Task 7: Cache-bust the changed scripts and final verification

The app pins script versions with `?v=` query strings in `src/index.html` (e.g.
`modules/ui/editors.js?v=1.122.11`) and in the dynamic `import()` calls inside
`editors.js` (e.g. `../dynamic/editors/states-editor.js?v=1.122.11`). Deployed builds
serve cached files unless these are bumped. In dev (vite) this is irrelevant, but bump
them so production picks up the changes. The current `package.json` version is `1.122.12`.

**Files:**
- Modify: `src/index.html` (script tag for `modules/ui/editors.js`)
- Modify: `public/modules/ui/editors.js` (the three `import("../dynamic/editors/…")` lines)

- [ ] **Step 1: Find the current version strings**

Run:
```bash
grep -n "editors.js?v=" src/index.html
grep -n "dynamic/editors/.*?v=" public/modules/ui/editors.js
```
Expected: shows `editors.js?v=1.122.11` in index.html and `states-editor.js?v=1.122.11`,
`cultures-editor.js?v=1.122.11`, `religions-editor.js?v=1.122.11` in editors.js.

- [ ] **Step 2: Bump the changed files' versions to `1.122.12`**

In `src/index.html`, change `modules/ui/editors.js?v=1.122.11` → `…?v=1.122.12`.

In `public/modules/ui/editors.js`, change the `?v=1.122.11` to `?v=1.122.12` on the three
dynamic imports for `states-editor.js`, `cultures-editor.js`, and `religions-editor.js`.

> `rivers-overview.js` and `routes-overview.js` script tags in `src/index.html` should
> also be bumped if they carry a `?v=` string — check with
> `grep -n "rivers-overview.js?v=\|routes-overview.js?v=" src/index.html` and bump any
> matches to `1.122.12`.

- [ ] **Step 3: Syntax check the edited script**

Run: `node --check public/modules/ui/editors.js`
Expected: exits 0, no output.

- [ ] **Step 4: Build to confirm nothing is broken**

Run: `npm run build`
Expected: `tsc` then `vite build` complete with no errors (build output goes to `../dist/`).

- [ ] **Step 5: Full cross-editor smoke test**

`npm run dev`, on a large map open each of the five editors in turn and confirm no console
errors on open, pagination present where > 200 rows, and absent where ≤ 200 rows.

- [ ] **Step 6: Commit**

```bash
git add src/index.html public/modules/ui/editors.js
git commit -m "chore(editors): bump cache-bust versions for paginated editor scripts"
```

---

## Self-review notes (already reconciled against the spec)

- **Spec coverage:** toolkit (Task 1) ✓; states/cultures/religions/rivers/routes pagination (Tasks 2-6) ✓; full-set sort via `sortDataByActiveHeader` replacing `applySorting` ✓; full-set footer totals ✓; page-reset rules (open/sort/search/extinct) ✓; CSV page-independence for all five ✓; `randomizeStatesExpansion` guard ✓; neutral rows flow with sort (no pinning) ✓; percentage mode unchanged ✓.
- **Naming consistency:** helpers `getActiveSort`, `sortDataByActiveHeader`, `getEditorPage`, `renderEditorPagination`, `bindEditorSortReset`, constant `EDITOR_PAGE_SIZE`; per-editor state holders `statesPage`/`culturesPage`/`religionsPage`/`riversPage`/`routesPage`; accessor maps `*_SORT_ACCESSORS` — used identically across all tasks.
- **CSV caveat:** Tasks 3 & 4 instruct confirming the *original* header string / field quoting before applying the rewrite, because the exact column formatting was not fully captured in this plan. This is the one place to read the existing code first.
