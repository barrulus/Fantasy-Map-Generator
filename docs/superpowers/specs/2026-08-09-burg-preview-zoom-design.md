# Design — Pan/zoom for the burg-editor preview pane

- **Status:** Approved (brainstormed 2026-08-09)
- **Author:** barrulus + Claude
- **Scope:** Burg editor dialog only (`src/controllers/burg-editor.ts`)

## Problem

The Edit Burg dialog embeds a town-plan preview (settlemaker, watabou, or a custom
`burg.link` URL) in an iframe sized to the pane (320px tall). There is no way to look
at the town up close: the preview container has `pointer-events: none`, so even
generators with native zoom (watabou) are inert, and settlemaker renders a static
plan with no interaction at all. The only recourse is opening the link in a new tab.

## Decision

Implement pan/zoom on the FMG side as a CSS transform on the iframe, driven by
pointer events on the container. Chosen over (a) adding native zoom to settlemaker —
work in another repo that wouldn't help watabou or custom-image previews — and
(b) zoom-via-URL-reload — a network round-trip per step. Settlemaker outputs SVG,
so browser re-rasterization keeps CSS-transform zoom crisp.

## Interaction model

- **Wheel** over the preview zooms toward the cursor position. Scale clamped to
  [1, 8]. `preventDefault()` so the dialog doesn't scroll while zooming; scrolling
  outside the preview is unaffected.
- **Drag** pans when zoomed in (`k > 1`). Cursor shows `grab`, `grabbing` while
  dragging. Uses pointer capture so drags survive leaving the pane.
- **Double-click** zooms in one step (×2, clamped) toward the click point.
- **⟲ reset icon** in the preview header, next to the existing open-in-new-tab
  icon (`#burgLinkOpen`), restores 1× fit.
- **State resets on preview reload** — `updateBurgPreview` recreates the iframe per
  burg, so zoom never carries across burgs.
- The container's `data-tip` becomes "Burg map preview: scroll to zoom, drag to pan".

## Mechanics

- `#burgPreviewObject` becomes the interactive viewport: `overflow: hidden`,
  `position: relative`, receives pointer/wheel events. The iframe keeps
  `pointer-events: none` permanently — the embedded page never captures events.
- The iframe gets `transform-origin: 0 0` and `transform: translate(tx, ty) scale(k)`.
- Pan clamping keeps content covering the viewport (no gaps):
  `tx ∈ [W·(1−k), 0]`, `ty ∈ [H·(1−k), 0]` where W×H is the viewport size.
- Zoom-toward-point: for cursor at viewport point `(px, py)`, the content point
  under the cursor stays fixed: `tx' = px − (px − tx)·(k'/k)`, same for `ty`,
  then clamp.

## Code shape

- **`src/utils/pan-zoom.ts`** — pure transform math, no DOM:
  - `type PanZoom = { k: number; x: number; y: number }`
  - `zoomAt(t, point, factor, viewport, {minK, maxK}) → PanZoom`
  - `panBy(t, dx, dy, viewport) → PanZoom`
  - `clamp(t, viewport) → PanZoom` (shared by both)
  - `identity` / reset value
- **`burg-editor.ts`** — wires container events to the helper and writes the
  transform to the iframe style (~40 lines). Reset icon added to the header row
  in the dialog template.

## Testing

- Unit tests for `pan-zoom.ts` (vitest, no DOM): zoom keeps the cursor-anchored
  content point fixed; scale clamps at 1 and 8; pan clamps at all four edges;
  zoom-out near an edge re-clamps pan; reset returns identity.
- Editor wiring verified manually in the dialog (consistent with the rest of
  burg-editor's untested DOM code): settlemaker preview, a watabou preview, and
  a custom image link; wheel/drag/double-click/reset; dialog scroll unaffected
  outside the pane.

## Out of scope

- Native zoom in settlemaker itself (possible later fidelity upgrade).
- Supersampled iframe rendering (only needed if a canvas-based preview source
  appears; settlemaker is SVG).
- Zoom controls in other editors or on custom-link *pages* opened in new tabs.
