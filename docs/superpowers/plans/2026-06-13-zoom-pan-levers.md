# Zoom/Pan Quick-Win Levers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make pan and zoom responsive on large maps by (a) deferring the per-frame `invokeActiveZooming()` DOM work to gesture-end, (b) removing its forced-reflow reads, (c) culling burg labels by zoom, and (d) dropping render quality (anti-aliasing/filters) only while a gesture is in flight.

**Architecture:** All changes are in the d3-zoom hot path in `public/main.js`. A single "interaction bracket" (entered on the first zoom/pan event of a burst, exited ~120ms after the last) lowers render quality during the gesture and runs the expensive rescale once on settle. Inside `invokeActiveZooming()` every computed-style read is swapped for the non-flushing `layerIsOn()`, and burg labels get the same min-zoom cull burg icons already get.

**Tech Stack:** Vanilla JS (legacy `public/main.js`), d3-zoom, the existing `perfdata/profile-zoom.mjs` CDP harness for verification.

**Verification reality:** This is browser-global render-path code with no unit-test seam. The test for each task is the in-browser perf harness (`node perfdata/profile-zoom.mjs`) plus explicit visual/interaction checks against the live map at `localhost:5173`. There are no vitest tests for these tasks; do not fabricate them.

**Baseline (measured 2026-06-13, ~82K burgs / 115K cells):** pan ≈ 3.9s main-thread (~100% Paint); zoom ≈ 12.4s (Paint ~5.2s + Layout 5.2s + Style 1.7s). These are the numbers to beat.

---

## Outcome (2026-06-14) — implemented as commit `0ae9ce82`

Tasks 1–3 landed; **Task 4 was dropped** after measurement. Deterministic A/B
(`perfdata/ab-levers.mjs`, seed 987654321, density 9 = 19.6K burgs / 26.8K cells):

| metric | baseline | after (Tasks 1–3) |
|---|---|---|
| PAN | 640ms (script9 style4 layout4) | 631ms — neutral |
| ZOOM | 2821ms (script38 style404 layout1356) | 2075ms (script9 style73 layout1321) — **−26%** |

- **Task 1 (defer invokeActiveZooming → `scheduleActiveZooming`)** and **Task 2
  (`layerIsOn` instead of forced-reflow style reads)** — implemented. Task 2 is the
  visible light-map win (style 404→73); both scale much larger on heavy maps where
  per-frame `invokeActiveZooming` was the ~5s/gesture Layout cost.
- **Task 3 (cull burg labels)** — implemented.
- **Task 4 (optimizeSpeed + drop filters during the gesture) — DROPPED.** Measured: it
  *regressed* pan +58% on light/moderate maps (640→1012ms) because dropping AA/filters
  forces a full-map re-raster at gesture start **and** end, a fixed cost that exceeds the
  per-frame savings; and on the 95K-burg map pan stayed ~17.8s of paint *with*
  optimizeSpeed active, so it barely helped where it was supposed to. Correctness was
  fine; the issue is net cost. **Revisit as a map-size-gated option** (engage only above
  ~70K cells) alongside the WebGL burg-icon work, where the paint wall is the real target.

Correctness verified in-browser: after a wheel-zoom settle, `#map` shape-rendering and
the coastline filter are restored; burg labels cull at low zoom and reappear at high zoom.

---

## File Structure

- Modify only: `public/main.js`
  - `zoomRaf()` (lines ~180–237): add the interaction bracket; stop calling `invokeActiveZooming()` every frame.
  - `invokeActiveZooming()` (lines ~539–638): swap computed-style reads for `layerIsOn()`; add burg-label cull.
  - New module-scope helpers near `zoomRaf`: `onInteraction()`, `enterInteractionQuality()`, `exitInteractionQuality()`.

No new files. No save-format changes.

---

## Task 0: Branch

- [ ] **Step 1: Create a feature branch off main**

Run:
```bash
cd /home/barrulus/dev/Fantasy-Map-Generator
git checkout -b perf/zoom-pan-levers
```
Expected: "Switched to a new branch 'perf/zoom-pan-levers'". (main has unrelated uncommitted changes; leave them — they are not part of this work and should not be committed here.)

- [ ] **Step 2: Commit the approved spec on this branch**

Run:
```bash
git add docs/superpowers/specs/2026-06-13-webgl-burg-icons-design.md docs/superpowers/plans/2026-06-13-zoom-pan-levers.md
git commit -m "docs: zoom/pan perf spec + levers plan"
```
Expected: one commit created. (No Co-Authored-By / AI attribution lines — per project convention.)

---

## Task 1: Defer `invokeActiveZooming` to gesture-settle (interaction bracket)

**Files:**
- Modify: `public/main.js` — add helpers above `function zoomRaf()` (before line 180); edit the `didScaleChange` block (lines 227–231).

- [ ] **Step 1: Add the interaction-bracket helpers**

Insert immediately above `function zoomRaf() {` (currently line 180):

```js
// Interaction bracket: while the user is actively zooming/panning we do only the
// cheap per-frame work (the viewbox transform + scale bar). The expensive label/
// emblem/marker rescale in invokeActiveZooming() — and the render-quality restore —
// run ONCE, ~120ms after the last zoom/pan event. Every gesture (wheel, drag, pinch,
// programmatic transition) funnels through zoomRaf, so this one funnel covers them all.
let interactionSettleTimer = null;
let isInteracting = false;
let scaleChangedDuringBurst = false;
function onInteraction(didScaleChange) {
  scaleChangedDuringBurst = scaleChangedDuringBurst || didScaleChange;
  if (!isInteracting) {
    isInteracting = true;
    enterInteractionQuality();
  }
  clearTimeout(interactionSettleTimer);
  interactionSettleTimer = setTimeout(() => {
    isInteracting = false;
    exitInteractionQuality();
    if (scaleChangedDuringBurst) invokeActiveZooming();
    scaleChangedDuringBurst = false;
  }, 120);
}

// Stubs filled in Task 4. Until then they are no-ops so the bracket is exercised
// without changing rendering quality.
function enterInteractionQuality() {}
function exitInteractionQuality() {}
```

- [ ] **Step 2: Stop calling `invokeActiveZooming()` every frame; route through the bracket**

Replace the `didScaleChange` block (lines 227–231):

```js
    if (didScaleChange) {
      invokeActiveZooming();
      drawScaleBar(scaleBar, scale);
      fitScaleBar(scaleBar, svgWidth, svgHeight);
    }
```

with:

```js
    if (didScaleChange) {
      // Scale bar is cheap — keep it live so the gesture feels responsive.
      drawScaleBar(scaleBar, scale);
      fitScaleBar(scaleBar, svgWidth, svgHeight);
    }

    // Bracket the gesture; the heavy rescale runs once on settle (see onInteraction).
    if (didPositionChange || didScaleChange) {
      onInteraction(didScaleChange);
    }
```

Note: direct callers of `invokeActiveZooming()` elsewhere (e.g. `generate()`, `findBurgForMFCG`) are unchanged — they still run it immediately. Only the zoomRaf hot path defers.

- [ ] **Step 3: Type-check**

Run:
```bash
cd /home/barrulus/dev/Fantasy-Map-Generator && npx tsc --noEmit
```
Expected: no new errors (public/*.js is not type-checked; this just confirms nothing else broke).

- [ ] **Step 4: Measure zoom in-browser**

Make sure the dev server (`localhost:5173`) and Chromium (CDP `:9222`) are up with a large map loaded, then run:
```bash
cd /home/barrulus/dev/Fantasy-Map-Generator && node perfdata/profile-zoom.mjs
```
Expected: the **ZOOM** line's `Layout` and `Style` deltas drop dramatically vs the ~5248ms / ~1729ms baseline (the per-frame `invokeActiveZooming` reflows are gone). `invokeActiveZooming() alone` unchanged. Record the numbers.

- [ ] **Step 5: Visual check**

In the live map: wheel-zoom in and out. Confirm labels/icons rescale and cull correctly when zooming stops (they may lag during the gesture — that is intended). No labels stuck at the wrong size after settling.

- [ ] **Step 6: Commit**

```bash
git add public/main.js
git commit -m "perf(zoom): defer invokeActiveZooming to gesture-settle via interaction bracket"
```

---

## Task 2: Remove forced-reflow reads inside `invokeActiveZooming`

**Files:**
- Modify: `public/main.js` — `invokeActiveZooming()` (lines ~557, ~574, ~584, ~601).

`d3 .style("display")` and `getComputedStyle().display` force a synchronous style+layout
flush. `layerIsOn(id)` (`public/modules/ui/layers.js:1027`) only reads a button's
`.buttonoff` class — no flush. Swap them.

- [ ] **Step 1: labels visibility check**

Replace (line ~557):
```js
  if (labels.style("display") !== "none") {
```
with:
```js
  if (layerIsOn("toggleLabels")) {
```

- [ ] **Step 2: burg-icon/anchor cull visibility check**

Replace (the loop body around line 574):
```js
    for (const group of [burgIcons.node(), anchors.node()]) {
      if (!group || getComputedStyle(group).display === "none") continue;
```
with:
```js
    const burgIconsOn = layerIsOn("toggleBurgIcons");
    for (const group of [burgIcons.node(), anchors.node()]) {
      if (!group || !burgIconsOn) continue;
```
(Both `#burgIcons` and `#anchors` are controlled by the burg-icons toggle / the `#icons` parent; `toggleBurgIcons` is the correct gate and avoids the per-iteration computed-style read.)

- [ ] **Step 3: routes visibility check**

Replace (line ~584):
```js
  if (routes.style("display") !== "none") {
```
with:
```js
  if (layerIsOn("toggleRoutes")) {
```

- [ ] **Step 4: emblems visibility check**

Replace (line ~601):
```js
  if (emblems.style("display") !== "none") {
```
with:
```js
  if (layerIsOn("toggleEmblems")) {
```

- [ ] **Step 5: Visual check — toggle each layer off then zoom**

In the live map, turn OFF Labels, then Routes, then Emblems (one at a time) via the Layers menu, and zoom. Confirm `invokeActiveZooming` correctly skips the off layer (no errors in console, hidden layers stay hidden). Turn them back on; confirm rescale resumes.

- [ ] **Step 6: Measure**

Run:
```bash
node perfdata/profile-zoom.mjs
```
Expected: on a forced `invokeActiveZooming()`-heavy path the Style/Layout is lower than Task 1; `invokeActiveZooming() alone` ms/call is similar or lower. Record numbers.

- [ ] **Step 7: Commit**

```bash
git add public/main.js
git commit -m "perf(zoom): replace forced-reflow style reads with layerIsOn in invokeActiveZooming"
```

---

## Task 3: Cull burg labels by min-zoom

**Files:**
- Modify: `public/main.js` — the label rescale loop in `invokeActiveZooming()` (line ~559).

Burg labels are never culled (`if (this.id === "burgLabels") return;`). burgLabels has the
same subgroup structure as burgIcons (hamlet…capital, each `<g>` carries `data-size`), so the
same `BURG_MIN_ZOOM` cull + font-size rescale applies to its subgroups.

- [ ] **Step 1: Replace the early-return with a burgLabels subgroup pass**

Replace (line ~559):
```js
      if (this.id === "burgLabels") return;
```
with:
```js
      if (this.id === "burgLabels") {
        if (!hideLabels.checked) return;
        for (const sub of this.children) {
          const desiredSub = +sub.dataset.size;
          const relativeSub = Math.max(rn((desiredSub + desiredSub / scale) / 2, 2), 1);
          if (rescaleLabels.checked) sub.setAttribute("font-size", relativeSub);
          const minZoomSub = +sub.dataset.minZoom || BURG_MIN_ZOOM[sub.id] || 0;
          const hiddenSub = scale < minZoomSub || relativeSub * scale < 6 || relativeSub * scale > 60;
          if (hiddenSub) sub.classList.add("hidden");
          else sub.classList.remove("hidden");
        }
        return;
      }
```
(Mirrors the per-burg-icon cull and the existing per-label-group rescale; `BURG_MIN_ZOOM`,
`rescaleLabels`, `hideLabels`, and `rn` are already in scope in this function.)

- [ ] **Step 2: Visual check — burg labels appear/disappear by zoom**

In the live map with Labels + hideLabels on: zoom out — hamlet/village burg labels should
disappear at low zoom (matching their icons); zoom in — they reappear. With hideLabels OFF,
all burg labels stay visible (the cull is gated on `hideLabels.checked`). Confirm label text
is not clipped/oversized.

- [ ] **Step 3: Measure pan at a normal zoom (labels were the dominant marginal cost)**

Run:
```bash
node perfdata/profile-zoom.mjs
```
Expected: the **PAN** Task time at the harness's default zoom is lower than the ~3.9s baseline
now that off-screen-tier burg labels are display:none. Record numbers.

- [ ] **Step 4: Commit**

```bash
git add public/main.js
git commit -m "perf(zoom): min-zoom cull burg labels (close the burgLabels gap)"
```

---

## Task 4: Lower render quality only during a gesture (optimizeSpeed + drop filters)

**Files:**
- Modify: `public/main.js` — fill in the `enterInteractionQuality()` / `exitInteractionQuality()` stubs from Task 1.

`shape-rendering: optimizeSpeed` disables anti-aliasing (big raster win); blur/drop-shadow
filters are recomputed on every transform and are expensive. Drop both during the gesture,
restore on settle. Must not clobber the user's persisted `shapeRendering` option.

- [ ] **Step 1: Implement the quality bracket**

Replace the two stubs from Task 1:
```js
function enterInteractionQuality() {}
function exitInteractionQuality() {}
```
with:
```js
let savedShapeRendering = null;
let savedSeaIslandFilter = null;
let savedStatesHaloDisplay = null;
function enterInteractionQuality() {
  if (customization) return; // don't interfere with heightmap/editing modes
  const mapEl = ensureEl("map");
  savedShapeRendering = mapEl.style.shapeRendering || "";
  mapEl.style.shapeRendering = "optimizeSpeed";

  const seaIsland = coastline.select("#sea_island");
  if (seaIsland.size()) {
    savedSeaIslandFilter = seaIsland.attr("filter");
    seaIsland.attr("filter", null);
  } else {
    savedSeaIslandFilter = null;
  }

  if (statesHalo.style("display") !== "none") {
    savedStatesHaloDisplay = statesHalo.style("display");
    statesHalo.style("display", "none");
  } else {
    savedStatesHaloDisplay = null;
  }
}
function exitInteractionQuality() {
  const mapEl = ensureEl("map");
  if (savedShapeRendering !== null) {
    if (savedShapeRendering) mapEl.style.shapeRendering = savedShapeRendering;
    else mapEl.style.removeProperty("shape-rendering");
    savedShapeRendering = null;
  }
  if (savedSeaIslandFilter !== null) {
    coastline.select("#sea_island").attr("filter", savedSeaIslandFilter);
    savedSeaIslandFilter = null;
  }
  if (savedStatesHaloDisplay !== null) {
    statesHalo.style("display", savedStatesHaloDisplay);
    savedStatesHaloDisplay = null;
  }
}
```
(`coastline` and `statesHalo` are existing global d3 selections used elsewhere in
`invokeActiveZooming`. The settle in `onInteraction` already calls `exitInteractionQuality()`
before `invokeActiveZooming()`, so the rescale sees the restored `shapeRendering`.)

- [ ] **Step 2: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 3: Measure pan — the big one**

Run:
```bash
node perfdata/profile-zoom.mjs
```
Expected: **PAN** Task time drops substantially below the ~3.9s baseline (anti-aliasing off +
filters dropped during the drag). **ZOOM** also improved vs baseline. Record final numbers.

- [ ] **Step 4: Visual check — quality snaps back cleanly**

In the live map: drag-pan and wheel-zoom. During motion the map may look slightly less smooth
(no AA, no coastline shadow/blur, no states halo) — expected. On release / when motion stops,
full quality must return within ~120ms. Verify: no permanently-missing coastline filter, no
permanently-hidden states halo, `#map` has no leftover inline `shape-rendering` (check with
devtools or `getComputedStyle`).

- [ ] **Step 5: Edge check — programmatic zoom and customization mode**

Trigger a programmatic zoom (search a burg / `zoomTo`) and confirm quality restores after the
transition. Enter heightmap customization (if quick) and confirm `enterInteractionQuality`
early-returns (no quality changes) — or simply confirm panning in normal mode is unaffected
afterward.

- [ ] **Step 6: Commit**

```bash
git add public/main.js
git commit -m "perf(pan): drop anti-aliasing + filters during active gesture, restore on settle"
```

---

## Task 5: Final verification & summary

- [ ] **Step 1: Full before/after capture**

Run `node perfdata/profile-zoom.mjs` once more and write the final PAN/ZOOM numbers into the
commit body or a note. Confirm: ZOOM Layout+Style collapsed; PAN Task time materially reduced.

- [ ] **Step 2: Regression sweep of interactions**

On the live large map verify, with no console errors: drag-pan; wheel-zoom in/out; double-click
zoom; search-to-burg; toggle Labels/Routes/Emblems/BurgIcons off and on; open a burg editor;
confirm labels/icons cull correctly at multiple zoom levels.

- [ ] **Step 3: Clean up scratch perf scripts**

Remove the throwaway inspection scripts created during investigation (keep `profile-zoom.mjs`,
`profile-regen.mjs`, `run-bigmap.mjs`, `analyze-profile.mjs`, `find-callers.mjs`):
```bash
git rm --cached -f --ignore-unmatch perfdata/_*.mjs 2>/dev/null; rm -f perfdata/_*.mjs
```
(`perfdata/` is untracked, so this just deletes the local scratch files.)

- [ ] **Step 4: Mark levers done**

These tasks complete Parts 1–2 of `docs/superpowers/specs/2026-06-13-webgl-burg-icons-design.md`.
Re-measure, then write the **WebGL burg-icon layer** plan (Part 3) informed by the post-lever
numbers.

---

## Self-Review

- **Spec coverage:** Part 1 (defer invokeActiveZooming + layerIsOn) → Tasks 1–2. Part 2 (cull
  burg labels + optimizeSpeed/filters) → Tasks 3–4. Part 3 (WebGL) is intentionally a separate
  plan. ✓
- **Placeholders:** none — every code step shows the full replacement text. ✓
- **Consistency:** `onInteraction`/`enterInteractionQuality`/`exitInteractionQuality` defined in
  Task 1, filled in Task 4, called in Task 1's zoomRaf edit — names match. `BURG_MIN_ZOOM`,
  `rescaleLabels`, `hideLabels`, `rn`, `coastline`, `statesHalo`, `layerIsOn`, `ensureEl` are all
  pre-existing in `main.js`/loaded modules. ✓
- **Testing honesty:** no fabricated unit tests; verification is the perf harness + visual checks,
  stated up front. ✓
