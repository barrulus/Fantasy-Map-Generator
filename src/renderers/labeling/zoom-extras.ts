// Fork-only zoom-settle work that upstream's zoom.ts does not do.
//
// Before the 1.140 labels refactor these two passes lived in public/main.js's
// invokeActiveZooming. That function moved to src/components/zoom.ts and lost both, so they are
// re-homed here as a ViewportLayers layer: it is registered after the labels layer, so it runs
// once per reconcile with the label DOM already materialized — the same ordering the old
// document-order `labels.selectAll("g").each` pass relied on.

import { ViewportLayers, type ViewportRenderContext } from "@/renderers/viewport/viewport-renderer";
import { selectNonOverlapping, setStateLabelObstacles } from "./label-collision";

// Route groups only become legible past a certain zoom; culling them keeps low-zoom repaints cheap.
const ROUTE_MIN_ZOOM: Record<string, number> = {
  royal: 1,
  main: 1,
  major: 1,
  market: 4,
  town: 4,
  local: 4,
  trail: 7,
  footpath: 10
};

function cullRoutesByZoom(scale: number): void {
  if (!layerIsOn("toggleRoutes")) return;
  for (const group of document.querySelectorAll<SVGGElement>("#routes g g")) {
    const minZoom = ROUTE_MIN_ZOOM[group.id];
    if (minZoom === undefined) continue;
    group.classList.toggle("hidden", scale < minZoom);
  }
}

/**
 * Hide state labels that collide with a bigger neighbour, then publish the survivors as obstacles
 * for the burg-label layers. The WebGL burg labels consult these via getStateLabelObstacles();
 * without this pass they see an empty set and stop yielding to state names.
 */
function resolveStateLabelCollisions(): void {
  if (!layerIsOn("toggleLabels")) return void setStateLabelObstacles([]);

  const labels = Array.from(document.querySelectorAll<SVGTextElement>('#labels text[data-label-type="state"]'));
  if (!labels.length) return void setStateLabelObstacles([]);

  // Clear the previous verdict before measuring: a hidden label reports a zero-size rect, which
  // would wrongly exclude it from this pass.
  for (const label of labels) label.classList.remove("hidden");

  // Read every rect first, then decide, then write classes — interleaving would force a reflow
  // per label.
  const boxes = [];
  for (const label of labels) {
    const rect = label.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;

    const stateId = Number(label.dataset.id);
    const state = pack.states?.[stateId];
    // Bigger states win contested spots; fall back to rendered area when cell count is missing
    // (e.g. the fork's zero-territory sky states).
    const weight = state && Number.isFinite(state.cells) ? (state.cells as number) : rect.width * rect.height;
    boxes.push({ id: label.id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, weight });
  }
  if (!boxes.length) return void setStateLabelObstacles([]);

  const keep = selectNonOverlapping(boxes);
  for (const label of labels) label.classList.toggle("hidden", !keep.has(label.id));

  setStateLabelObstacles(boxes.filter(box => keep.has(box.id)));
}

function render(context: ViewportRenderContext): void {
  cullRoutesByZoom(context.bounds.scale);
  resolveStateLabelCollisions();
}

ViewportLayers.register({ id: "fork-zoom-extras", render });
