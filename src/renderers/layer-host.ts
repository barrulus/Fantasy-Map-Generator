// src/renderers/layer-host.ts
// Renderer-agnostic layer compositor. Passthrough by default; splits the SVG stack
// at the burg layer's z-slot so the WebGL canvas can sit between SVG layers.

/** True if `splitNode` has at least one following element sibling in `container`. */
export function hasLayersAbove(container: Element, splitNode: Element): boolean {
  return splitNode.parentElement === container && splitNode.nextElementSibling != null;
}

/** Move every element sibling AFTER `splitNode` (within `viewbox`) into `viewboxTop`, in order. */
export function splitSuffix(viewbox: Element, viewboxTop: Element, splitNode: Element): void {
  if (splitNode.parentElement !== viewbox) return;
  let n = splitNode.nextElementSibling;
  while (n) {
    const next = n.nextElementSibling;
    viewboxTop.appendChild(n); // appendChild moves the node, keeping document order
    n = next;
  }
}

/** Append all `viewboxTop` children back into `viewbox` (in order), restoring the unified stack. */
export function mergeSuffix(viewbox: Element, viewboxTop: Element): void {
  while (viewboxTop.firstElementChild) {
    viewbox.appendChild(viewboxTop.firstElementChild);
  }
}

/**
 * Reunite LayerHost's split-out top layers into a *cloned* #map so the clone serializes as a
 * unified SVG stack (as stock FMG and older builds expect). When the WebGL burg layer is active,
 * reconcileLayers() moves the layers after #icons (labels, markers, ruler, armies, fogging, ...)
 * into the sibling #mapTop/#viewboxTop overlay — which lives OUTSIDE #map — so a plain
 * cloneNode(#map) drops them. Left unfixed, saved .map files and SVG/PNG exports silently lose
 * those layers, and loading such a file into stock FMG crashes at `labels.style("display")`.
 *
 * This appends clones of the live #viewboxTop children onto the clone's #viewbox, restoring
 * document order (they were the suffix after #icons, so appending to the end reproduces it).
 * No-op in passthrough state (no #viewboxTop) and idempotent (skips ids already present in the
 * clone). Burg labels are GPU-only and remain absent by design — everything else round-trips.
 */
export function unifyClonedMapStack(clonedMap: Element, doc: Document = document): void {
  const viewboxTop = doc.getElementById("viewboxTop");
  if (!viewboxTop || !viewboxTop.firstElementChild) return;
  const clonedViewbox = clonedMap.querySelector("#viewbox");
  if (!clonedViewbox) return;
  const present = new Set(Array.from(clonedViewbox.children, c => c.id).filter(Boolean));
  for (const child of Array.from(viewboxTop.children)) {
    if (child.id && present.has(child.id)) continue; // already in the stack (mid-reconcile) — don't duplicate
    clonedViewbox.appendChild(child.cloneNode(true));
    if (child.id) present.add(child.id);
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

// The attributes that define an SVG root's clip box. #mapTop is a sibling root, so it clips its
// own content to these — they must track #map or the overlay spills past the map edge.
const GEOMETRY_ATTRS = ["viewBox", "width", "height", "preserveAspectRatio"];

/** Mirror the SVG-root geometry attrs from `src` onto `dst` (removing any the source lacks). */
function copyGeometryAttrs(dst: Element, src: Element): void {
  for (const a of GEOMETRY_ATTRS) {
    const v = src.getAttribute(a);
    if (v != null) dst.setAttribute(a, v);
    else dst.removeAttribute(a);
  }
}

/** Create the `#mapTop` overlay SVG (with inner `#viewboxTop` group) mirroring `srcSvg`'s geometry. */
export function createTopOverlay(doc: Document, srcSvg: Element): SVGSVGElement {
  const top = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  top.id = "mapTop";
  copyGeometryAttrs(top, srcSvg);
  top.style.position = "absolute";
  top.style.top = "0";
  top.style.left = "0";
  top.style.pointerEvents = "none"; // wheel/drag fall through to #map's d3.zoom
  const g = doc.createElementNS(SVG_NS, "g") as SVGGElement;
  g.id = "viewboxTop";
  g.style.pointerEvents = "auto"; // rendered children (labels, markers) stay clickable
  top.appendChild(g);
  return top;
}

export interface MapLayer {
  id: string; // matches the #mapLayers <li> id, e.g. "toggleBurgIcons"
  renderer: "svg" | "webgl";
  visible(): boolean;
  draw(): void;
  clear(): void;
  hitTest?(mapX: number, mapY: number): number | null; // webgl only; returns an element id or null
}

const webglLayers: MapLayer[] = [];

/** Register a layer. Only webgl layers are tracked here (svg layers ride the transform + native events). */
export function registerLayer(layer: MapLayer): void {
  if (layer.renderer === "webgl" && !webglLayers.some(l => l.id === layer.id)) {
    webglLayers.push(layer);
  }
}

export function getWebglLayers(): MapLayer[] {
  return webglLayers;
}

/** Test-only: clear the registry between tests. */
export function _resetLayers(): void {
  webglLayers.length = 0;
}

/**
 * Stack the burg-label canvas directly above the burg-icon canvas (or right after #map when
 * icons are off), keeping it below the #mapTop overlay. Idempotent.
 */
export function positionLabelCanvas(labelCanvas: Element): void {
  const icons = document.getElementById("burgIconsGL");
  const map = document.getElementById("map");
  const anchor = icons ?? map;
  if (!anchor || !anchor.parentNode) return;
  if (anchor.nextElementSibling === labelCanvas) return; // already placed
  anchor.parentNode.insertBefore(labelCanvas, anchor.nextSibling);
}

function w(): any {
  return window as any;
}

function ensureTopOverlay(svg: Element): SVGSVGElement {
  let top = document.getElementById("mapTop") as SVGSVGElement | null;
  if (!top) {
    top = createTopOverlay(document, svg);
    svg.parentNode!.appendChild(top);
  }
  return top;
}

function removeTopOverlay(): void {
  document.getElementById("mapTop")?.remove();
}

/**
 * Re-sync #mapTop's geometry (its clip box) to #map. createTopOverlay snapshots these attrs once
 * at creation; fitMapToScreen later resizes #map on a canvas-size change without touching the
 * overlay, leaving #mapTop's clip rect stale and larger — so split-out #viewboxTop layers spill
 * past the map edge into the letterbox. Call after #map's width/height are applied; no-op when the
 * overlay isn't mounted (passthrough / State 0).
 */
export function syncTopOverlayGeometry(): void {
  const map = document.getElementById("map");
  const top = document.getElementById("mapTop");
  if (map && top) copyGeometryAttrs(top, map);
}

/**
 * Converge the DOM to State 0 (passthrough) or State 1 (interleaved) based on the burg
 * layer's z-slot and whether the WebGL renderer is active. Idempotent.
 */
export function reconcileLayers(): void {
  const svg = document.getElementById("map");
  const viewbox = document.getElementById("viewbox");
  if (!svg || !viewbox) return;

  // 1. Unify: pull any split-out groups back so we reason about one ordered list.
  const existingTop = document.getElementById("viewboxTop");
  if (existingTop) mergeSuffix(viewbox, existingTop);

  const glActive = !!(w().burgWebglActive && w().burgWebglActive());
  if (!glActive) {
    removeTopOverlay(); // State 0, all-SVG: tear down overlay (canvas left empty/hidden by caller)
    return;
  }

  // Only create/size the canvas if it's absent. ensureBurgGLCanvas() resets canvas.width/height,
  // which clears the WebGL framebuffer — and reconcile runs right after draws (rebuildBurgGL) and
  // on every toggle/reorder, so resizing here would blank the burgs until the next pan/zoom frame.
  const canvas =
    (document.getElementById("burgIconsGL") as HTMLElement | null) ?? (w().ensureBurgGLCanvas() as HTMLElement);
  const icons = document.getElementById("icons");
  const parent = svg.parentNode as Node;

  if (icons && hasLayersAbove(viewbox, icons)) {
    // State 1: interleave. Order under wrapper: #map, canvas, #mapTop.
    const top = ensureTopOverlay(svg);
    parent.insertBefore(canvas, svg.nextSibling);
    parent.insertBefore(top, canvas.nextSibling);
    const viewboxTop = top.querySelector("#viewboxTop")!;
    splitSuffix(viewbox, viewboxTop, icons);
    // Sync the transform immediately: a split can happen while the map is already zoomed
    // (toggle/reorder/GL-activate with no pending zoom frame). Without this, #viewboxTop
    // renders untransformed until the next onFrame, misplacing the overlay layers.
    syncTopTransform(viewbox, viewboxTop);
    w().bindTopLayerEvents?.();
  } else {
    // State 0 with GL on top: canvas right after #map (today's behavior), no overlay.
    removeTopOverlay();
    parent.insertBefore(canvas, svg.nextSibling);
  }

  // Keep the burg-label GL canvas stacked above icons / below the overlay when labels are active.
  if (w().burgLabelsWebglActive && w().burgLabelsWebglActive()) {
    const labelCanvas =
      (document.getElementById("burgLabelsGL") as HTMLElement | null) ??
      (w().ensureBurgLabelGLCanvas?.() as HTMLElement | undefined);
    if (labelCanvas) {
      positionLabelCanvas(labelCanvas);
      // The label canvas must sit below #mapTop; if the overlay exists, move the canvas before it.
      const top = document.getElementById("mapTop");
      if (top && top.parentNode === labelCanvas.parentNode) labelCanvas.parentNode!.insertBefore(labelCanvas, top);
    }
  }
}

/** Copy #viewbox's transform onto #viewboxTop (or clear it when #viewbox has none), keeping the two roots in lockstep. */
function syncTopTransform(viewbox: Element, viewboxTop: Element): void {
  const t = viewbox.getAttribute("transform");
  if (t != null) viewboxTop.setAttribute("transform", t);
  else viewboxTop.removeAttribute("transform");
}

/** Called every frame from zoomRaf: mirror the viewbox transform to #viewboxTop and draw webgl layers. */
export function onFrameLayers(): void {
  const vb = document.getElementById("viewbox");
  const vt = document.getElementById("viewboxTop");
  if (vb && vt) syncTopTransform(vb, vt);
  for (const layer of webglLayers) {
    if (layer.visible()) layer.draw();
  }
}

/** Hit-test webgl layers top-down (last registered = topmost wins). Returns the first non-null id. */
export function hitTestTopDown(mapX: number, mapY: number): number | null {
  for (let i = webglLayers.length - 1; i >= 0; i--) {
    const layer = webglLayers[i];
    if (!layer.visible() || !layer.hitTest) continue;
    const hit = layer.hitTest(mapX, mapY);
    if (hit != null) return hit;
  }
  return null;
}

Object.assign(window, {
  LayerHost: {
    reconcile: reconcileLayers,
    onFrame: onFrameLayers,
    hitTestTopDown,
    registerLayer,
    syncGeometry: syncTopOverlayGeometry
  }
});
