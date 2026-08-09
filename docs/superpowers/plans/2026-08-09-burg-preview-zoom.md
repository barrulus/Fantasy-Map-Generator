# Burg Preview Pan/Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wheel-zoom, drag-pan, double-click-zoom and reset for the burg-editor preview pane, applied as a CSS transform on the preview iframe.

**Architecture:** Pure transform math (zoom-toward-point, pan, clamping) lives in a new `src/utils/panZoomUtils.ts` with unit tests. `src/controllers/burg-editor.ts` wires pointer/wheel events on the preview container to that math and writes `transform: translate(...) scale(...)` onto the iframe, which keeps `pointer-events: none` so the embedded page never captures events. Spec: `docs/superpowers/specs/2026-08-09-burg-preview-zoom-design.md`.

**Tech Stack:** TypeScript, vitest (no DOM needed for the math tests), no new dependencies.

## Global Constraints

- Zoom scale clamped to [1, 8]; pan clamped so content always covers the viewport.
- The iframe keeps `pointer-events: none` at all times.
- Format with Biome only (`npx biome check --write <files>`); never Prettier.
- No Co-Authored-By / AI attribution lines in commits.
- `npx tsc --noEmit` must stay clean.
- File naming follows the `src/utils/*Utils.ts` convention (the spec's `pan-zoom.ts` is renamed `panZoomUtils.ts` for consistency).

---

### Task 1: Pan-zoom transform math

**Files:**
- Create: `src/utils/panZoomUtils.ts`
- Test: `src/utils/panZoomUtils.test.ts`

**Interfaces:**
- Consumes: `minmax(value, min, max)` from `./numberUtils` (already exists).
- Produces (Task 2 imports exactly these from `@/utils/panZoomUtils`):
  - `interface PanZoom { k: number; x: number; y: number }`
  - `interface Viewport { width: number; height: number }`
  - `const PAN_ZOOM_IDENTITY: PanZoom` (k=1, x=0, y=0)
  - `const MIN_ZOOM = 1`, `const MAX_ZOOM = 8`
  - `zoomAt(t: PanZoom, point: {x: number; y: number}, factor: number, viewport: Viewport): PanZoom`
  - `panBy(t: PanZoom, dx: number, dy: number, viewport: Viewport): PanZoom`
  - `clampPanZoom(t: PanZoom, viewport: Viewport): PanZoom`

- [ ] **Step 1: Write the failing tests**

Create `src/utils/panZoomUtils.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  clampPanZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  PAN_ZOOM_IDENTITY,
  panBy,
  zoomAt
} from "./panZoomUtils";

const viewport = { width: 400, height: 320 };

describe("zoomAt", () => {
  it("keeps the content point under the cursor fixed while zooming", () => {
    const t = zoomAt(PAN_ZOOM_IDENTITY, { x: 100, y: 80 }, 2, viewport);
    expect(t).toEqual({ k: 2, x: -100, y: -80 });
    // content point under the cursor before: (100 - 0) / 1 = 100
    // after: (100 - (-100)) / 2 = 100 — unchanged
  });

  it("compounds zooms toward different points", () => {
    const once = zoomAt(PAN_ZOOM_IDENTITY, { x: 100, y: 80 }, 2, viewport);
    const twice = zoomAt(once, { x: 200, y: 160 }, 2, viewport);
    expect(twice.k).toBe(4);
    // content point under (200,160) at k=2: (200 - (-100)) / 2 = 150
    // must still be there at k=4: (200 - x) / 4 = 150 → x = -400
    expect(twice.x).toBe(-400);
    expect(twice.y).toBe(-320);
  });

  it("clamps scale at MAX_ZOOM", () => {
    const t = zoomAt(PAN_ZOOM_IDENTITY, { x: 0, y: 0 }, 1000, viewport);
    expect(t.k).toBe(MAX_ZOOM);
  });

  it("clamps scale at MIN_ZOOM and recentres to identity", () => {
    const t = zoomAt({ k: 1, x: 0, y: 0 }, { x: 200, y: 160 }, 0.5, viewport);
    expect(t).toEqual({ k: MIN_ZOOM, x: 0, y: 0 });
  });

  it("re-clamps pan when zooming out from a corner", () => {
    // fully panned to the bottom-right corner at k=4
    const cornered = { k: 4, x: -1200, y: -960 };
    const t = zoomAt(cornered, { x: 0, y: 0 }, 0.25, viewport);
    expect(t).toEqual({ k: 1, x: 0, y: 0 });
  });
});

describe("panBy", () => {
  it("moves the content by the pointer delta", () => {
    const zoomed = { k: 2, x: -100, y: -80 };
    const t = panBy(zoomed, -50, 30, viewport);
    expect(t).toEqual({ k: 2, x: -150, y: -50 });
  });

  it("clamps pan at all four edges", () => {
    const zoomed = { k: 2, x: -100, y: -80 };
    // at k=2 the pan range is x ∈ [-400, 0], y ∈ [-320, 0]
    expect(panBy(zoomed, 9999, 9999, viewport)).toEqual({ k: 2, x: 0, y: 0 });
    expect(panBy(zoomed, -9999, -9999, viewport)).toEqual({ k: 2, x: -400, y: -320 });
  });

  it("cannot pan at 1x", () => {
    expect(panBy(PAN_ZOOM_IDENTITY, 40, 40, viewport)).toEqual(PAN_ZOOM_IDENTITY);
  });
});

describe("clampPanZoom", () => {
  it("returns offsets to zero at scale 1", () => {
    expect(clampPanZoom({ k: 1, x: -50, y: 20 }, viewport)).toEqual({ k: 1, x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/panZoomUtils.test.ts`
Expected: FAIL — cannot resolve `./panZoomUtils`.

- [ ] **Step 3: Write the implementation**

Create `src/utils/panZoomUtils.ts`:

```typescript
import { minmax } from "./numberUtils";

// Pan/zoom transform for a fixed viewport whose content is viewport-sized at k=1
// (the burg-editor preview iframe). Transform maps content px c to viewport px c*k + offset.

export interface PanZoom {
  k: number;
  x: number;
  y: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
export const PAN_ZOOM_IDENTITY: PanZoom = { k: 1, x: 0, y: 0 };

// Keep the scaled content covering the whole viewport: no gaps at any edge.
export function clampPanZoom({ k, x, y }: PanZoom, viewport: Viewport): PanZoom {
  return {
    k,
    x: minmax(x, viewport.width * (1 - k), 0),
    y: minmax(y, viewport.height * (1 - k), 0)
  };
}

// Rescale by factor keeping the content point under `point` (viewport px) fixed.
export function zoomAt(t: PanZoom, point: { x: number; y: number }, factor: number, viewport: Viewport): PanZoom {
  const k = minmax(t.k * factor, MIN_ZOOM, MAX_ZOOM);
  const ratio = k / t.k;
  return clampPanZoom({ k, x: point.x - (point.x - t.x) * ratio, y: point.y - (point.y - t.y) * ratio }, viewport);
}

export function panBy(t: PanZoom, dx: number, dy: number, viewport: Viewport): PanZoom {
  return clampPanZoom({ k: t.k, x: t.x + dx, y: t.y + dy }, viewport);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/panZoomUtils.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Type-check, format, commit**

```bash
npx tsc --noEmit
npx biome check --write src/utils/panZoomUtils.ts src/utils/panZoomUtils.test.ts
git add src/utils/panZoomUtils.ts src/utils/panZoomUtils.test.ts
git commit --no-verify -m "feat(utils): pan-zoom transform math for the burg preview"
```

---

### Task 2: Wire pan/zoom into the burg-editor preview

**Files:**
- Modify: `src/controllers/burg-editor.ts` — dialog template (~line 236–244), event wiring block (~line 305–322, next to the `burgLinkOpen` line), `updateBurgPreview` (~line 672–693), plus the new handler functions.

**Interfaces:**
- Consumes from Task 1 (`import ... from "@/utils/panZoomUtils"`): `PAN_ZOOM_IDENTITY`, `type PanZoom`, `panBy`, `zoomAt`.
- Produces: no exports — DOM behavior only. New element id `burgPreviewReset`.

- [ ] **Step 1: Update the dialog template**

In the template, replace the preview section markup:

```html
        <div id="burgPreviewSection" data-tip="Burg map preview" style="display: flex; flex-direction: column">
          <div style="display: flex; justify-content: space-between">
            <span>Burg preview:</span>
            <div style="display: flex; gap: 0.5em">
              <i id="burgLinkOpen" data-tip="Open burg map in a new tab" class="icon-link-ext pointer"></i>
            </div>
          </div>
          <div id="burgPreviewObject" style="pointer-events: none"></div>
        </div>
```

with:

```html
        <div id="burgPreviewSection" data-tip="Burg map preview: scroll to zoom, drag to pan" style="display: flex; flex-direction: column">
          <div style="display: flex; justify-content: space-between">
            <span>Burg preview:</span>
            <div style="display: flex; gap: 0.5em">
              <i id="burgPreviewReset" data-tip="Reset preview zoom" class="icon-ccw pointer"></i>
              <i id="burgLinkOpen" data-tip="Open burg map in a new tab" class="icon-link-ext pointer"></i>
            </div>
          </div>
          <div id="burgPreviewObject" style="overflow: hidden; position: relative; touch-action: none"></div>
        </div>
```

(`pointer-events: none` moves from the container to the iframe in Step 3 — the container must now receive events, the embedded page still must not.)

- [ ] **Step 2: Add the pan/zoom state and handlers**

Add the import at the top of `burg-editor.ts` alongside the existing `@/utils` imports:

```typescript
import { PAN_ZOOM_IDENTITY, type PanZoom, panBy, zoomAt } from "@/utils/panZoomUtils";
```

Add module-level state next to the other module-level `let` declarations near the top of the file:

```typescript
let previewTransform: PanZoom = { ...PAN_ZOOM_IDENTITY };
```

Add the handler functions near `updateBurgPreview`:

```typescript
function getPreviewViewport(): { width: number; height: number } {
  const frame = ensureEl("burgPreviewObject").querySelector("iframe");
  // offsetWidth/Height are the layout (untransformed) size — the k=1 content size
  return frame ? { width: frame.offsetWidth, height: frame.offsetHeight } : { width: 0, height: 0 };
}

function applyPreviewTransform(): void {
  const container = ensureEl("burgPreviewObject");
  const frame = container.querySelector<HTMLIFrameElement>("iframe");
  if (!frame) return;
  const { k, x, y } = previewTransform;
  frame.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  container.style.cursor = k > 1 ? "grab" : "default";
}

function resetPreviewZoom(): void {
  previewTransform = { ...PAN_ZOOM_IDENTITY };
  applyPreviewTransform();
}

function previewPointFromEvent(event: MouseEvent): { x: number; y: number } {
  const rect = ensureEl("burgPreviewObject").getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function onPreviewWheel(event: WheelEvent): void {
  event.preventDefault(); // zoom the preview, don't scroll the dialog
  const factor = Math.exp(-event.deltaY * 0.002);
  previewTransform = zoomAt(previewTransform, previewPointFromEvent(event), factor, getPreviewViewport());
  applyPreviewTransform();
}

function onPreviewDoubleClick(event: MouseEvent): void {
  previewTransform = zoomAt(previewTransform, previewPointFromEvent(event), 2, getPreviewViewport());
  applyPreviewTransform();
}

function onPreviewPointerDown(event: PointerEvent): void {
  if (previewTransform.k <= 1) return;
  event.preventDefault();
  const container = ensureEl("burgPreviewObject");
  container.setPointerCapture(event.pointerId);
  container.style.cursor = "grabbing";
  let last = { x: event.clientX, y: event.clientY };

  const move = (e: Event) => {
    const p = e as PointerEvent;
    previewTransform = panBy(previewTransform, p.clientX - last.x, p.clientY - last.y, getPreviewViewport());
    last = { x: p.clientX, y: p.clientY };
    applyPreviewTransform();
  };
  const up = () => {
    container.off("pointermove", move);
    container.off("pointerup", up);
    container.off("pointercancel", up);
    container.style.cursor = "grab";
  };
  container.on("pointermove", move);
  container.on("pointerup", up);
  container.on("pointercancel", up);
}
```

- [ ] **Step 3: Wire the events and reset on preview reload**

In the wiring block, immediately after the `ensureEl("burgLinkOpen").on("click", ...)` line, add:

```typescript
  ensureEl("burgPreviewReset").on("click", resetPreviewZoom);
  ensureEl("burgPreviewObject").on("wheel", onPreviewWheel as EventListener, { passive: false });
  ensureEl("burgPreviewObject").on("dblclick", onPreviewDoubleClick as EventListener);
  ensureEl("burgPreviewObject").on("pointerdown", onPreviewPointerDown as EventListener);
```

In `updateBurgPreview`, where the iframe is created (after `frame.setAttribute("sandbox", ...)`), add:

```typescript
  frame.style.pointerEvents = "none"; // the container owns all interaction
  frame.style.transformOrigin = "0 0";
  frame.style.display = "block";
```

and after `container.insertBefore(frame, null);` add:

```typescript
  resetPreviewZoom(); // zoom never carries across burgs
```

- [ ] **Step 4: Type-check and run the full test suite**

```bash
npx tsc --noEmit
npx vitest run
```
Expected: tsc clean; all tests pass (no regressions — this task adds no tests, the math is covered by Task 1).

- [ ] **Step 5: Manual verification in the running app**

The dev server is the user's own session — do not start or stop one. In the app (or via the chromium MCP against the user's session), open a map, click a burg with a settlemaker preview group (Edit Burg dialog):

1. Wheel over the preview → zooms toward the cursor, crisp SVG; wheel outside the preview still scrolls the dialog.
2. Zoomed in: cursor is grab; drag pans, clamps at all four edges (no gray gaps).
3. Double-click → zooms in a step. Wheel out past 1× → stops at 1×, recentred.
4. ⟲ icon resets to 1×.
5. Switch to another burg → preview reloads at 1×.
6. A burg with a watabou preview and one with a custom `burg.link` image behave the same.

- [ ] **Step 6: Format and commit**

```bash
npx biome check --write src/controllers/burg-editor.ts
git add src/controllers/burg-editor.ts
git commit --no-verify -m "feat(burg-editor): wheel-zoom and drag-pan for the burg preview"
```
