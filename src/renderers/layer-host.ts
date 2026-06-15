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

const SVG_NS = "http://www.w3.org/2000/svg";

/** Create the `#mapTop` overlay SVG (with inner `#viewboxTop` group) mirroring `srcSvg`'s geometry. */
export function createTopOverlay(doc: Document, srcSvg: Element): SVGSVGElement {
  const top = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  top.id = "mapTop";
  for (const a of ["viewBox", "width", "height", "preserveAspectRatio"]) {
    const v = srcSvg.getAttribute(a);
    if (v != null) top.setAttribute(a, v);
  }
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
  LayerHost: { reconcile: reconcileLayers, onFrame: onFrameLayers, hitTestTopDown, registerLayer }
});
