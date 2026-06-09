# Editor Pagination — Design

**Date:** 2026-06-08
**Status:** Approved (pending spec review)

## Problem

The States Editor becomes unusable on maps with 1,000+ states. The dominant cost is
that `statesEditorAddLines()` renders every state in one pass, and each state row
triggers a coat-of-arms render (`COArenderer.trigger("stateCOA" + s.i, s.coa)`). At
1k+ states this is thousands of synchronous emblem renders per open, plus a large DOM
write. The same unbounded-render pattern exists in several other list editors.

The Burgs Overview already solved this with pagination (`public/modules/ui/burgs-overview.js`):
module-scoped page state, sort-the-full-set-then-slice, and `‹ Page n of N ›` controls.
This spec generalizes that approach into a small shared toolkit and applies it to the
five list editors most at risk on large maps.

## Scope

In scope — add pagination to:

| Editor | File | Module kind | Per-row weight |
|---|---|---|---|
| States | `public/modules/dynamic/editors/states-editor.js` | ES module | Heavy (COA render per row) |
| Cultures | `public/modules/dynamic/editors/cultures-editor.js` | ES module | Medium (fill-box + selects) |
| Religions | `public/modules/dynamic/editors/religions-editor.js` | ES module | Medium (fill-box + selects) |
| Rivers | `public/modules/ui/rivers-overview.js` | plain script | Light (text) |
| Routes | `public/modules/ui/routes-overview.js` | plain script | Light (text) |

Out of scope: provinces, markers, military, diplomacy, regiments overviews (smaller or
per-state datasets); the existing burgs implementation (left as-is); the pre-existing
"Cannot render custom emblem" console warnings (a separate `renderer.ts` concern, not
caused or fixed here — pagination merely reduces how often it fires).

## Page size

`200` rows per page, matching `BURGS_PAGE_SIZE`.

## Architecture: shared toolkit in `editors.js`

`public/modules/ui/editors.js` is a plain script whose functions (`applySorting`,
`sortLines`, `applySortingByHeader`, `fitContent`, …) are global. Adding the pagination
helpers here makes them reachable from both the plain-script overviews and the
ES-module editors (modules share `window`). New helpers:

```js
const EDITOR_PAGE_SIZE = 200;

// Read the active sort column from a header element, or null if none is active.
// Mirrors how applySorting / sortFilteredBurgs read the icon-sort-* class.
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
// `accessors` maps a data-sortby key to a value getter: {name: s => s.name, ...}.
function sortDataByActiveHeader(headers, data, accessors) {
  const sort = getActiveSort(headers);
  if (!sort) return data;
  const get = accessors[sort.sortby];
  if (!get) return data;
  return data.sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (sort.name) {
      const as = String(av), bs = String(bv);
      return (as > bs ? 1 : as < bs ? -1 : 0) * sort.desc;
    }
    return (av - bv) * sort.desc;
  });
}

// Clamp the page and return the slice for the current page.
// `pageRef` is a mutable {page} holder so the clamped value persists.
function getEditorPage(data, pageRef, size = EDITOR_PAGE_SIZE) {
  const total = data.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  pageRef.page = Math.min(Math.max(1, pageRef.page || 1), totalPages);
  const start = (pageRef.page - 1) * size;
  return {items: data.slice(start, start + size), page: pageRef.page, totalPages, total};
}

// Inject/refresh the pagination controls inside `footerEl`. Calls onGoto(page) on nav.
// Auto-hidden when there is only one page. Rebuilding innerHTML drops stale listeners.
function renderEditorPagination(footerEl, info, onGoto) {
  let nav = footerEl.querySelector(":scope > .editorPagination");
  if (!nav) {
    // margin-left:auto only right-aligns inside a flex row; the .totalLine footers are
    // not guaranteed to be flex, so make the footer a flex row when we first inject.
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
// Must be registered AFTER sortLines is bound so the icon-sort-* class is toggled first.
function bindEditorSortReset(headerEl, onSort) {
  headerEl.querySelectorAll(".sortable").forEach(el => el.on("click", () => onSort()));
}
```

### Why two sort handlers (the existing precedent)

`sortLines` (bound via the global `.sortable` handler for static HTML, or via
`applySortingByHeader` for dynamically-injected editors) toggles the `icon-sort-*`
class and does a DOM-only sort. Burgs adds a *second* handler that resets the page and
re-renders, and `sortFilteredBurgs` reads the freshly-toggled class to sort the full
set. We reproduce exactly this: keep the existing `sortLines` binding (it owns the
visual sort indicator), and add `bindEditorSortReset` to trigger the full re-render.
Listener fire order follows registration order, so `bindEditorSortReset` must be
registered after the `sortLines` binding.

The old per-editor `applySorting(headerEl)` call at the end of each `…AddLines` is
**removed** — `sortDataByActiveHeader` now sorts the data before slicing, which is what
makes sort span all pages instead of just the visible 200. Initial sort still works
because the initial `icon-sort-*` class is preset in the editor HTML and read by
`getActiveSort`.

## Per-editor changes

Each `…AddLines` function is restructured to:

1. Build the filtered data array (preserve existing filters — see per-editor notes).
2. `sortDataByActiveHeader(headerEl, data, ACCESSORS)`.
3. Compute footer totals over the **full filtered `data`** (not the page slice).
4. `const pageInfo = getEditorPage(data, pageRef)`.
5. Build row HTML by looping over `pageInfo.items` only.
6. Write the body, update the footer, then `renderEditorPagination(footerEl, pageInfo, gotoPage)`.
7. Attach row listeners (existing logic, now only over the page's rows).
8. Remove the trailing `applySorting(...)` call.

Page state holder per editor (module/file scope): `let <name>Page = {page: 1};`
`gotoPage(n)` sets `<name>Page.page = n` and calls the editor's `…AddLines`.

Page reset rules:
- **Reset to 1:** on `open()`; on sort (via `bindEditorSortReset`); on search input
  (rivers/routes); on the religions extinct-toggle.
- **Keep (clamped):** on data mutations that re-render via refresh/addLines
  (add/remove/recalculate/merge). `getEditorPage` clamps, so removing the last row on
  the last page lands the user on the new last page rather than an empty one.

### Sort-accessor maps

States (`statesHeader`):
```
name: s => s.name
form: s => s.formName
capital: s => s.i ? pack.burgs[s.capital].name : ""
culture: s => s.i ? pack.cultures[s.culture].name : ""
burgs: s => s.burgs
area: s => s.area
population: s => s.rural * populationRate + s.urban * populationRate * urbanization
type: s => s.type || ""
expansionism: s => s.expansionism || 0
cells: s => s.cells
```

Cultures (`culturesHeader`):
```
name: c => c.name
type: c => c.type || ""
base: c => c.base
cells: c => c.cells
expansionism: c => c.expansionism || 0
area: c => c.area
population: c => c.rural * populationRate + c.urban * populationRate * urbanization
emblems: c => c.shield
```

Religions (`religionsHeader`):
```
name: r => r.name
type: r => r.type || ""
form: r => r.form || ""
deity: r => r.deity || ""
area: r => r.area
population: r => r.rural * populationRate + r.urban * populationRate * urbanization
expansion: r => r.expansion || ""
expansionism: r => r.expansionism || 0
```

Rivers (`riversHeader`) — `riversById` already built in the function:
```
name: r => r.name || ""
type: r => r.type || ""
discharge: r => r.discharge
length: r => r.length
width: r => r.width
basin: r => riversById.get(r.basin)?.name || ""
```

Routes (`routesHeader`):
```
name: route => route.name || ""
group: route => route.group || ""
length: route => route.length
```

### Data arrays paginated

- States: `pack.states.filter(s => !s.removed)` (includes neutral `i=0`).
- Cultures: `pack.cultures.filter(c => !c.removed)` (includes neutral `i=0`).
- Religions: `pack.religions.filter(r => !r.removed && !(r.i && !r.cells && $body.dataset.extinct !== "show"))`
  (preserves the existing extinct-hiding rule).
- Rivers: `pack.rivers` then the existing search filter.
- Routes: `pack.routes` then the existing search filter; rows with `< 2` points are
  still skipped at render time (they are rare; they may occupy a slot in the slice but
  simply render nothing — acceptable, matches current skip behavior).

Neutral rows (`i=0`) flow through sort and pagination as ordinary items (per decision —
matches burgs; not pinned to the top).

## Regression fixes (page-independence)

These currently read the rendered DOM, which after pagination would reflect only the
current page. Each is reworked to be page-independent.

1. **CSV exports** (all five): `downloadStatesCsv`, `downloadCulturesCsv`,
   `downloadReligionsCsv`, `downloadRiversData`, `downloadRoutesData` iterate
   `$body.querySelectorAll(":scope > div")` today. Rework each to iterate the full
   logical set instead:
   - States/cultures/religions: iterate the same filtered `pack` set the editor shows
     (non-removed; religions also respects the extinct rule), recomputing the exported
     fields from `pack` (the values are simple derivations already computed in
     `…AddLines`). Existing `pack`-side lookups (e.g. `origins`, `fullName`,
     rural/urban populations) are unchanged.
   - Rivers/routes: re-apply the active search filter and iterate the full filtered
     set (today's DOM-based export already reflects the search filter; this preserves
     that, minus the page truncation).

   CSV row order is not significant and need not match the on-screen sort.

2. **`randomizeStatesExpansion`** (states): writes
   `$body.querySelector("div.states[data-id='<i>'] > input.statePower").value` for every
   state. Off-page states have no DOM row, so guard the assignment with `?.` (the
   authoritative value is still written to `s.expansionism`; the input update is a
   visual nicety for visible rows only).

## Behavior notes (accepted, by design)

- **Sort operates on the full array; percentage mode operates on visible rows.** Sort
  reorders the entire filtered set before slicing, so "sort by population descending"
  surfaces the global top rows on page 1. Percentage mode only rewrites the displayed
  text of rendered rows, but divides by footer totals computed over the full set, so
  each visible percentage is its true share; paging/sorting re-applies the transform on
  re-render. No incorrect value is ever shown.
- Percentage/absolute toggling keeps its existing per-render re-application
  (`if ($body.dataset.type === "percentage") { ...; togglePercentageMode(); }`).

## Testing

Manual verification (no automated UI test harness for these dialogs):

1. Load a large map (1k+ states). Open States Editor — confirm it opens quickly and
   shows page 1 of N with 200 rows.
2. Page next/prev and jump-to-page via the input; confirm clamping at bounds and
   disabled buttons at the ends.
3. Click each sortable column; confirm page resets to 1 and ordering reflects the full
   set (e.g. top of page 1 is the global max/min, not just the previously-visible max).
4. Toggle percentage mode on a non-first page; confirm visible rows show correct
   percentages of the full-set totals.
5. Export CSV from a non-first page; confirm the file contains all rows, not just 200.
6. Remove the only row on the last page; confirm the editor lands on the new last page.
7. Repeat opens for cultures, religions, rivers, routes; for rivers/routes confirm the
   search box resets to page 1 and filters across all pages; confirm their CSV exports
   honor the search filter and span all pages.
8. Confirm editors with `< 200` items show no pagination controls.

## Files touched

- `public/modules/ui/editors.js` — add the five shared helpers + `EDITOR_PAGE_SIZE`.
- `public/modules/dynamic/editors/states-editor.js` — paginate, accessors, page reset,
  fix `downloadStatesCsv` + `randomizeStatesExpansion`.
- `public/modules/dynamic/editors/cultures-editor.js` — paginate, accessors, page reset,
  fix `downloadCulturesCsv`.
- `public/modules/dynamic/editors/religions-editor.js` — paginate, accessors, page reset,
  fix `downloadReligionsCsv`.
- `public/modules/ui/rivers-overview.js` — paginate, accessors, search-resets-page,
  fix `downloadRiversData`.
- `public/modules/ui/routes-overview.js` — paginate, accessors, search-resets-page,
  fix `downloadRoutesData`.
