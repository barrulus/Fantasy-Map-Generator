// Zoom-settle passes that upstream's zoom.ts does not do. Registered after the labels layer so
// each run sees the label DOM already materialized.

import { ViewportLayers, type ViewportRenderContext } from "@/renderers/viewport/viewport-renderer";
import {
  type CollisionBox,
  filterAgainstObstacles,
  getStateLabelObstacles,
  selectNonOverlapping,
  setStateLabelObstacles
} from "./label-collision";
import { groupRank } from "./tier-table";

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
  if (!Layers.isOn("routes")) return;
  for (const group of document.querySelectorAll<SVGGElement>("#routes g g")) {
    const minZoom = ROUTE_MIN_ZOOM[group.id];
    if (minZoom === undefined) continue;
    group.classList.toggle("hidden", scale < minZoom);
  }
}

// Survivors are published as obstacles; without them the burg-label layers stop yielding to
// state names.
function resolveStateLabelCollisions(): void {
  if (!Layers.isOn("labels")) return void setStateLabelObstacles([]);

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

/**
 * Thin burg labels the way the removed WebGL layer used to. Upstream materializes every burg
 * label whose anchor is in the viewport and whose group passes its zoom gate, which turns a dense
 * region into an unreadable mass of overlapping names. Higher tiers win contested space; every
 * tier but capitals yields to the surviving state names.
 */
function resolveBurgLabelCollisions(): void {
  const labels = Array.from(document.querySelectorAll<SVGTextElement>('#labels text[data-label-type="burg"]'));
  if (!labels.length) return;

  // a hidden label measures zero, so clear the previous verdict before reading
  for (const label of labels) label.classList.remove("hidden");

  // read every rect, then decide, then write — interleaving forces a reflow per label
  const boxes: CollisionBox[] = [];
  const capitals = new Set<string>();
  for (const label of labels) {
    const rect = label.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;

    const group = label.parentElement?.id.replace(/^labels-/, "") || "";
    const rank = groupRank(group);
    if (rank === 0) capitals.add(label.id);
    // selectNonOverlapping keeps the heaviest box, and rank 0 is the most important tier
    boxes.push({ id: label.id, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, weight: -rank });
  }
  if (!boxes.length) return;

  const obstacles = getStateLabelObstacles();
  const clear = obstacles.length ? filterAgainstObstacles(boxes, obstacles) : null;
  const contenders = clear ? boxes.filter(box => clear.has(box.id) || capitals.has(box.id)) : boxes;

  const keep = selectNonOverlapping(contenders);
  for (const label of labels) label.classList.toggle("hidden", !keep.has(label.id));
}

function render(context: ViewportRenderContext): void {
  cullRoutesByZoom(context.bounds.scale);
  resolveStateLabelCollisions();
  resolveBurgLabelCollisions(); // after the state pass: it consumes that pass's obstacles
}

ViewportLayers.register({ id: "fork-zoom-extras", render });
