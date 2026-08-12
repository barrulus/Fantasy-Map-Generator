// Zoom-settle passes that upstream's zoom.ts does not do. Registered after the labels layer so
// each run sees the label DOM already materialized.

import { ViewportLayers, type ViewportRenderContext } from "@/renderers/viewport/viewport-renderer";
import { selectNonOverlapping, setStateLabelObstacles } from "./label-collision";

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

// Survivors are published as obstacles; without them the burg-label layers stop yielding to
// state names.
function resolveStateLabelCollisions(): void {
  if (!layerIsOn("toggleLabels")) return void setStateLabelObstacles([]);

  const labels = Array.from(document.querySelectorAll<SVGTextElement>('#labels text[data-label-type="state"]'));
  if (!labels.length) return void setStateLabelObstacles([]);

  // a hidden label measures zero, so clear the previous verdict before reading
  for (const label of labels) label.classList.remove("hidden");

  // read every rect, then decide, then write — interleaving forces a reflow per label
  const boxes = [];
  for (const label of labels) {
    const rect = label.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;

    const stateId = Number(label.dataset.id);
    const state = pack.states?.[stateId];
    // bigger states win; rendered area covers zero-territory sky states
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
