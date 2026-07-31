// Default interaction on the map canvas: pan/zoom, click-to-edit and hover tooltips
import { drag, select } from "d3";
import { Controllers } from "@/controllers";
import { dragLegendBox } from "@/renderers/draw-legend";
import { debounce } from "@/utils/commonUtils";
import { getPointer } from "@/utils";
import { handleMouseMove } from "./map-tooltip";

const onMouseMove = debounce(handleMouseMove, 100);

/** Restore the default viewbox events, dropping whatever an editor bound to the map */
export function applyDefaultViewboxEvents(): void {
  svg.call(zoom);

  select<SVGGElement, unknown>("#viewbox")
    .style("cursor", "default")
    .on(".drag", null)
    .on("click", onClick)
    .on("touchmove mousemove", onMouseMove);

  select<SVGGElement, unknown>("#legend").call(drag<SVGGElement, unknown>().on("start", dragLegendBox));

  bindTopLayerEvents();
}

// The interleaved overlay (#viewboxTop) is a separate SVG root, so the #viewbox-delegated
// click/move handlers never fire for layers moved into it — bind the same handlers there.
// Coordinate note: onClick derives map coords via getPointer(event, node) against the clicked
// root's own CTM. This stays correct because #mapTop is built by createTopOverlay() with the
// SAME viewBox/geometry as #map and #viewboxTop is fed the SAME transform each frame
// (LayerHost.onFrame), so both roots share one map coordinate space. If that geometry/transform
// parity is ever broken, top-layer hit coords would silently drift.
export function bindTopLayerEvents(): void {
  const viewboxTop = document.getElementById("viewboxTop");
  if (viewboxTop) {
    select<SVGGElement, unknown>(viewboxTop as unknown as SVGGElement)
      .on("click", onClick)
      .on("touchmove mousemove", onMouseMove);
  }
}
window.bindTopLayerEvents = bindTopLayerEvents;

// map group id -> editor to open. The click target is resolved by walking up its ancestors
type Opener = (target: SVGElement, parent: SVGElement) => void;

const PARENT_EDITORS: Record<string, Opener> = {
  rivers: target => Controllers.RiverEditor.open(target.id),
  ice: target => Controllers.IceEditor.open(target),
  terrain: target => Controllers.ReliefEditor.open(target),
  goodsCells: () => Controllers.GoodsEditor.open()
};

const GRAND_EDITORS: Record<string, Opener> = {
  emblems: target => Controllers.EmblemsEditor.open(undefined, undefined, undefined, target),
  routes: target => Controllers.RouteEditor.open(target.id),
  burgLabels: target => Controllers.BurgEditor.open(Number(target.dataset.id)),
  burgIcons: target => Controllers.BurgEditor.open(Number(target.dataset.id)),
  markers: target => Controllers.MarkersEditor.open(undefined, target),
  ruler: () => Controllers.MeasurersEditor.open(),
  goodsIcons: () => Controllers.GoodsEditor.open(),
  goodsBurgs: (_target, parent) => Controllers.ProductionOverview.open(Number(parent.dataset.id)),
  coastline: target => Controllers.CoastlineVertexEditor.open(target),
  lakes: target => Controllers.LakesEditor.open(target),
  markets: (target, parent) => {
    if (target.tagName !== "path") Controllers.MarketOverview.open(Number(parent.dataset.id));
  }
};

const GREAT_EDITORS: Record<string, Opener> = {
  markers: target => Controllers.MarkersEditor.open(undefined, target),
  ruler: () => Controllers.MeasurersEditor.open(),
  armies: (_target, parent) => Controllers.RegimentEditor.open(`#${parent.id}`),
  // Megalopolis composite icons/labels sit one <g> wrapper deeper than plain burgs, so the
  // GRAND_EDITORS burgLabels/burgIcons entries miss them — walk up to the nearest [data-id].
  burgLabels: target => {
    const burgEl = target.closest<SVGElement>("[data-id]");
    if (burgEl) Controllers.BurgEditor.open(Number(burgEl.dataset.id));
  },
  burgIcons: target => {
    const burgEl = target.closest<SVGElement>("[data-id]");
    if (burgEl) Controllers.BurgEditor.open(Number(burgEl.dataset.id));
  }
};

/** Handle a click on the map: open the editor for the clicked element */
function onClick(event: MouseEvent): void {
  // An active tool mode (add burg, relocate, zone paint, ...) owns map clicks: its handler
  // replaces the #viewbox listener, but this default dispatcher stays bound on #viewboxTop
  // and would steal the click.
  if (customization) return;

  // WebGL burgs have no per-burg DOM, so hit-test the click against the burg quadtree.
  const layerHost = (window as any).LayerHost;
  if (layerHost) {
    const node = event.currentTarget as SVGGElement;
    const [mx, my] = getPointer(event, node);
    const hit = layerHost.hitTestTopDown(mx, my);
    if (hit) return void Controllers.BurgEditor.open(hit);
  }

  const target = event?.target as SVGElement | null;
  const parent = target?.parentElement as SVGElement | null;
  const grand = parent?.parentElement as SVGElement | null;
  const great = grand?.parentElement as SVGElement | null;
  const ancestor = great?.parentElement as SVGElement | null;
  if (!target || !parent || !grand || !great || !ancestor) return;

  if (ancestor.id === "labels" && target.tagName === "tspan")
    return void Controllers.LabelsEditor.open(target as SVGTSpanElement);

  const open = PARENT_EDITORS[parent.id] || GRAND_EDITORS[grand.id] || GREAT_EDITORS[great.id];
  open?.(target, parent);
}

declare global {
  var zoom: any; // d3 v5 zoom behaviour created in main.js
}

window.applyDefaultViewboxEvents = applyDefaultViewboxEvents;
