// Zoom-settle passes that upstream's zoom.ts does not do. Registered after the labels layer so
// each run sees the label DOM already materialized.

import { MEGALOPOLIS_MIN_ZOOM, MEGALOPOLIS_SPLIT_ZOOM } from "@/generators/megalopolis";
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

// Rank for contested space, lowest wins. Burg tiers come from groupRank (capital 0 … hamlet 12);
// rivers and routes sit below every burg tier but above unknown groups.
const RIVER_RANK = 50;
const ROUTE_RANK = 60;

/**
 * Thin overlapping labels the way the removed WebGL layer used to. Upstream materializes every
 * label whose anchor is in the viewport and whose group passes its zoom gate, and does no
 * collision work — which is survivable at upstream's 100K-cell ceiling but not at the fork's
 * 500K, where a dense region draws thousands of overlapping names. Route labels are the worst:
 * one per named route, and a 500K-cell map has tens of thousands of routes.
 *
 * State labels are excluded: they run their own pass above and are published as obstacles.
 */
function resolveLabelCollisions(): void {
  const labels = Array.from(document.querySelectorAll<SVGTextElement>('#labels text:not([data-label-type="state"])'));
  if (!labels.length) return;

  // a hidden label measures zero, so clear the previous verdict before reading
  for (const label of labels) label.classList.remove("hidden");

  // read every rect, then decide, then write — interleaving forces a reflow per label
  const boxes: CollisionBox[] = [];
  const capitals = new Set<string>();
  for (const label of labels) {
    const rect = label.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;

    const type = label.dataset.labelType;
    let rank: number;
    if (type === "river") rank = RIVER_RANK;
    else if (type === "route") rank = ROUTE_RANK;
    else {
      rank = groupRank(label.parentElement?.id.replace(/^labels-/, "") || "");
      if (rank === 0) capitals.add(label.id);
    }

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

// Megalopolis composite swap, SVG path only (the GL path swaps buffers inside drawBurgGL):
// below the split zoom show one composite icon per multi-burg cell and hide the members.
// Composites follow the capital tier gate. Labels need no pass here - label-data already
// gives members a minZoom and composites a maxZoom at the split.
function swapMegalopolisComposites(scale: number): void {
  const composites = document.querySelectorAll<SVGGElement>("#burgIcons .megalopolis-composite");
  if (!composites.length) return;
  const compositeMode = scale < MEGALOPOLIS_SPLIT_ZOOM;
  const compositeVisible = compositeMode && scale >= MEGALOPOLIS_MIN_ZOOM;
  for (const member of document.querySelectorAll<SVGElement>("#burgIcons .megalopolis-member"))
    member.style.display = compositeMode ? "none" : "";
  for (const composite of composites) composite.style.display = compositeVisible ? "" : "none";
}

function render(context: ViewportRenderContext): void {
  cullRoutesByZoom(context.bounds.scale);
  swapMegalopolisComposites(context.bounds.scale);
  resolveStateLabelCollisions();
  resolveLabelCollisions(); // after the state pass: it consumes that pass's obstacles
}

ViewportLayers.register({ id: "fork-zoom-extras", render });
