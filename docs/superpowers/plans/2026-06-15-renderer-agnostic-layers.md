# Renderer-Agnostic Layer System — Foundation + Burg Interleave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the existing WebGL burg layer sit at an arbitrary z-slot between SVG layers (e.g. burgs *under* labels), via a passthrough compositor that leaves the default all-SVG map byte-identical to today.

**Architecture:** A `LayerHost` compositor owns three structural states. State 0 (passthrough) = today's single `#map` SVG / single `#viewbox` / single transform. State 1 (interleaved) splits the stack at the burg layer's z-slot into `#map` (SVG, layers at/below) → `#burgIconsGL` (canvas) → `#mapTop` (SVG, layers above), all sharing one transform and `#map`'s `<defs>`. The split boundary is derived from the existing `#icons` group's DOM position (which the `toggleBurgIcons` layer-order UI already controls). `reconcile()` is an idempotent function that converges the DOM to the correct state.

**Tech Stack:** TypeScript (`src/renderers/`), classic-script glue (`public/main.js`, `public/modules/ui/*.js`), d3v5, WebGL2, vitest + jsdom for unit tests.

---

## Context the implementer needs

- **DOM order = z-order.** All map layers are `<g>` children of `#viewbox` (a `<g>` inside the `#map` SVG). `public/main.js:40-90` creates them. The burg layer is `#icons` (containing `#burgIcons` + `#anchors`), `public/main.js:76-79`.
- **Pan/zoom** writes one transform attribute on `#viewbox` each frame in `zoomRaf` (`public/main.js:201-233`). `window.getMapTransform()` (`public/main.js:179`) returns `{scale, viewX, viewY}`. `d3.zoom` is attached to `svg` = `#map` (`editors.js:8`).
- **Layer reorder:** jQuery sortable on `#mapLayers` → `moveLayer()` (`layers.js:1044`) reparents the `<g>` via `insertAfter/insertBefore`. `getLayer("toggleBurgIcons")` returns `$("#icons")` (`layers.js:1077`). Reorder does NOT re-run `drawX()`.
- **The WebGL burg layer:** `src/renderers/webgl-burg-icons.ts`. Canvas `#burgIconsGL` created by `ensureBurgGLCanvas()` (`public/main.js:302`) as a sibling placed `#map.after(c)` (always on top today). It exposes on `window`: `burgWebglActive()`, `drawBurgGL()`, `destroyBurgGL()`, `rebuildBurgGL()`, `resizeBurgGL()`, `getBurgQuadtree()`, `hitTestBurg()`, `getBurgSizes()`.
- **Click/hover dispatch is delegated from `#viewbox`:** `editors.js:9` binds `clicked` + `onMouseMove` to `viewbox`. `clicked()` (`editors.js:15`) inspects `d3.event.target` ancestors (`labels`, `markers`, `armies`, …). Burg clicks already hit-test the quadtree inline (`editors.js:16-25`, `general.js:133-136`). **When layers move to `#mapTop`, this delegation must also bind to `#viewboxTop`** or those clicks are lost.
- **Tests:** vitest, `environment: 'jsdom'`, files are `src/**/*.test.ts`. See `src/modules/routes-generator.test.ts` for the `globalThis` mocking pattern. Run a single file with `npx vitest run <path>`.
- **Renderers are bundled via** `src/renderers/index.ts` (add new modules there).

## File structure

- **Create** `src/renderers/layer-host.ts` — the compositor. Pure DOM primitives (`splitSuffix`, `mergeSuffix`, `hasLayersAbove`, `createTopOverlay`), a layer registry (`registerLayer`), and the wiring entry points (`reconcileLayers`, `onFrameLayers`, `hitTestTopDown`). Exposed as `window.LayerHost`.
- **Create** `src/renderers/layer-host.test.ts` — unit tests for the primitives + a jsdom integration test for `reconcileLayers`.
- **Modify** `src/renderers/index.ts` — import `./layer-host`.
- **Modify** `src/renderers/webgl-burg-icons.ts` — register the burg layer; call `reconcile` after `rebuildBurgGL`.
- **Modify** `public/main.js` — `zoomRaf` calls `LayerHost.onFrame()`; `webglBurgsSelect` change calls `reconcile`.
- **Modify** `public/modules/ui/layers.js` — `moveLayer`, `toggleBurgIcons`, and `drawLayers` call `reconcile`.
- **Modify** `public/modules/ui/editors.js` — expose `bindTopLayerEvents`; route burg hit-test through `LayerHost.hitTestTopDown`.
- **Modify** `public/modules/ui/general.js` — route tooltip burg hit-test through `LayerHost.hitTestTopDown`; call `reconcile` on resize.

---

## Task 1: Defs cross-root verification spike (GO/NO-GO gate)

**No code in the repo.** Verify that an SVG element in a *second* inline SVG root can resolve `url(#…)` references (filter, clipPath, linearGradient) to defs defined in a *first* SVG root within the same HTML document, on the target browsers. This gates the whole approach (design §3b).

**Files:**
- Create (throwaway): `/tmp/defs-spike.html`

- [ ] **Step 1: Write the spike page**

```html
<!doctype html>
<html><body>
<svg id="a" width="200" height="200" style="position:absolute;top:0;left:0">
  <defs>
    <filter id="f"><feGaussianBlur stdDeviation="3"/></filter>
    <clipPath id="c"><circle cx="50" cy="50" r="40"/></clipPath>
    <linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="100" height="100" fill="green"/>
</svg>
<svg id="b" width="200" height="200" style="position:absolute;top:0;left:0;pointer-events:none">
  <g transform="translate(0,0)">
    <!-- references live in SVG #a -->
    <rect x="10" y="110" width="80" height="60" fill="url(#g)" filter="url(#f)"/>
    <text x="110" y="40" font-size="30" clip-path="url(#c)" fill="black">CLIP</text>
  </g>
</svg>
</body></html>
```

- [ ] **Step 2: Open in each target browser and observe**

Run: `chromium /tmp/defs-spike.html` (and repeat in Firefox, and WebKit/Safari if a target).
Expected (GO): the rect in SVG `#b` shows a red→blue gradient AND a blur, and the text is clipped — proving `url(#…)` resolves across roots.
NO-GO for a browser: gradient/blur/clip is missing (renders solid/unblurred/unclipped).

- [ ] **Step 3: Record the decision**

Append a short result note to `docs/superpowers/specs/2026-06-15-renderer-agnostic-layers-design.md` under §3b (e.g. "Spike 2026-06-15: Chrome ✓, Firefox ✓, WebKit ✗ on clipPath").
- If all target browsers GO → proceed with the single-`<defs>` design (Tasks 2-10 unchanged).
- If a browser is NO-GO for some property → the fallback (duplicate the referenced defs into `#mapTop`) becomes a required sub-task; note which defs in the spec. **Stop and surface this to the user before continuing** — it changes Task 4's scope.

- [ ] **Step 4: Commit the decision note**

```bash
git add docs/superpowers/specs/2026-06-15-renderer-agnostic-layers-design.md
git commit -m "docs: record defs cross-root spike result for layer interleave"
```

---

## Task 2: LayerHost DOM primitives — `splitSuffix`, `mergeSuffix`, `hasLayersAbove`

**Files:**
- Create: `src/renderers/layer-host.ts`
- Test: `src/renderers/layer-host.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { hasLayersAbove, mergeSuffix, splitSuffix } from "./layer-host";

function ids(el: Element): string[] {
  return Array.from(el.children).map(c => c.id);
}

describe("layer-host DOM primitives", () => {
  let viewbox: HTMLElement;
  let viewboxTop: HTMLElement;
  let split: HTMLElement;

  beforeEach(() => {
    viewbox = document.createElement("div");
    viewboxTop = document.createElement("div");
    for (const id of ["ocean", "states", "icons", "labels", "markers"]) {
      const g = document.createElement("div");
      g.id = id;
      viewbox.appendChild(g);
    }
    split = viewbox.querySelector("#icons")!;
  });

  it("hasLayersAbove is true when the split node has following siblings", () => {
    expect(hasLayersAbove(viewbox, split)).toBe(true);
  });

  it("hasLayersAbove is false when the split node is last", () => {
    expect(hasLayersAbove(viewbox, viewbox.querySelector("#markers")!)).toBe(false);
  });

  it("splitSuffix moves only the nodes after the split into viewboxTop, preserving order", () => {
    splitSuffix(viewbox, viewboxTop, split);
    expect(ids(viewbox)).toEqual(["ocean", "states", "icons"]);
    expect(ids(viewboxTop)).toEqual(["labels", "markers"]);
  });

  it("mergeSuffix appends viewboxTop children back in order", () => {
    splitSuffix(viewbox, viewboxTop, split);
    mergeSuffix(viewbox, viewboxTop);
    expect(ids(viewbox)).toEqual(["ocean", "states", "icons", "labels", "markers"]);
    expect(ids(viewboxTop)).toEqual([]);
  });

  it("split then merge round-trips to the original order (idempotent reconcile core)", () => {
    const before = ids(viewbox);
    splitSuffix(viewbox, viewboxTop, split);
    mergeSuffix(viewbox, viewboxTop);
    splitSuffix(viewbox, viewboxTop, split); // second split = same result
    mergeSuffix(viewbox, viewboxTop);
    expect(ids(viewbox)).toEqual(before);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: FAIL — "does not provide an export named 'splitSuffix'".

- [ ] **Step 3: Implement the primitives**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/layer-host.ts src/renderers/layer-host.test.ts
git commit -m "feat(layers): LayerHost DOM split/merge primitives"
```

---

## Task 3: `createTopOverlay` — build the `#mapTop` overlay SVG

**Files:**
- Modify: `src/renderers/layer-host.ts`
- Test: `src/renderers/layer-host.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/renderers/layer-host.test.ts
import { createTopOverlay } from "./layer-host";

describe("createTopOverlay", () => {
  it("mirrors the source svg's geometry attrs and overlays it, non-interactive at the root", () => {
    const NS = "http://www.w3.org/2000/svg";
    const src = document.createElementNS(NS, "svg");
    src.setAttribute("viewBox", "0 0 1000 700");
    src.setAttribute("width", "1000");
    src.setAttribute("height", "700");

    const top = createTopOverlay(document, src);

    expect(top.id).toBe("mapTop");
    expect(top.getAttribute("viewBox")).toBe("0 0 1000 700");
    expect(top.getAttribute("width")).toBe("1000");
    expect(top.getAttribute("height")).toBe("700");
    expect((top as SVGElement).style.position).toBe("absolute");
    expect((top as SVGElement).style.pointerEvents).toBe("none");
    const g = top.querySelector("#viewboxTop")!;
    expect(g).toBeTruthy();
    expect((g as SVGElement).style.pointerEvents).toBe("auto"); // children stay clickable
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: FAIL — "does not provide an export named 'createTopOverlay'".

- [ ] **Step 3: Implement**

```ts
// add to src/renderers/layer-host.ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/layer-host.ts src/renderers/layer-host.test.ts
git commit -m "feat(layers): createTopOverlay builds the #mapTop overlay SVG"
```

---

## Task 4: Layer registry — `registerLayer` + `MapLayer` type

**Files:**
- Modify: `src/renderers/layer-host.ts`
- Test: `src/renderers/layer-host.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to src/renderers/layer-host.test.ts
import { _resetLayers, getWebglLayers, registerLayer } from "./layer-host";

describe("layer registry", () => {
  beforeEach(() => _resetLayers());

  it("registers webgl layers and exposes them in registration order", () => {
    registerLayer({ id: "a", renderer: "webgl", visible: () => true, draw: () => {}, clear: () => {} });
    registerLayer({ id: "b", renderer: "webgl", visible: () => false, draw: () => {}, clear: () => {} });
    expect(getWebglLayers().map(l => l.id)).toEqual(["a", "b"]);
  });

  it("ignores svg-renderer layers (they ride the transform and native events)", () => {
    registerLayer({ id: "svgish", renderer: "svg", visible: () => true, draw: () => {}, clear: () => {} });
    expect(getWebglLayers()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: FAIL — "does not provide an export named 'registerLayer'".

- [ ] **Step 3: Implement**

```ts
// add to src/renderers/layer-host.ts
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
  if (layer.renderer === "webgl") webglLayers.push(layer);
}

export function getWebglLayers(): MapLayer[] {
  return webglLayers;
}

/** Test-only: clear the registry between tests. */
export function _resetLayers(): void {
  webglLayers.length = 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/layer-host.ts src/renderers/layer-host.test.ts
git commit -m "feat(layers): layer registry for webgl layers"
```

---

## Task 5: `reconcileLayers`, `onFrameLayers`, `hitTestTopDown` + window exposure

**Files:**
- Modify: `src/renderers/layer-host.ts`
- Modify: `src/renderers/index.ts`
- Test: `src/renderers/layer-host.test.ts`

- [ ] **Step 1: Write the failing integration test (jsdom, mocked window)**

```ts
// add to src/renderers/layer-host.test.ts
import { reconcileLayers } from "./layer-host";

describe("reconcileLayers (integration)", () => {
  let wrapper: HTMLElement;

  function buildDom(order: string[]) {
    const NS = "http://www.w3.org/2000/svg";
    document.body.innerHTML = "";
    wrapper = document.createElement("div");
    const svg = document.createElementNS(NS, "svg");
    svg.id = "map";
    svg.setAttribute("viewBox", "0 0 100 100");
    const vb = document.createElementNS(NS, "g");
    vb.id = "viewbox";
    for (const id of order) {
      const g = document.createElementNS(NS, "g");
      g.id = id;
      vb.appendChild(g);
    }
    svg.appendChild(vb);
    wrapper.appendChild(svg);
    document.body.appendChild(wrapper);
  }

  function vbIds() {
    return Array.from(document.getElementById("viewbox")!.children).map(c => c.id);
  }
  function topIds() {
    const t = document.getElementById("viewboxTop");
    return t ? Array.from(t.children).map(c => c.id) : null;
  }

  beforeEach(() => {
    (globalThis as any).window = globalThis;
    (window as any).ensureBurgGLCanvas = () => {
      let c = document.getElementById("burgIconsGL");
      if (!c) { c = document.createElement("canvas"); c.id = "burgIconsGL"; }
      return c;
    };
  });

  it("State 0: gl inactive → no overlay, no canvas in tree", () => {
    buildDom(["ocean", "icons", "labels"]);
    (window as any).burgWebglActive = () => false;
    reconcileLayers();
    expect(topIds()).toBeNull();
    expect(vbIds()).toEqual(["ocean", "icons", "labels"]);
  });

  it("State 1: gl active with layers above icons → splits, canvas between #map and #mapTop", () => {
    buildDom(["ocean", "icons", "labels", "markers"]);
    (window as any).burgWebglActive = () => true;
    reconcileLayers();
    expect(vbIds()).toEqual(["ocean", "icons"]);
    expect(topIds()).toEqual(["labels", "markers"]);
    const kids = Array.from(wrapper.children).map(c => c.id);
    expect(kids).toEqual(["map", "burgIconsGL", "mapTop"]);
  });

  it("gl active but icons on top → no split, canvas right after #map (today's behavior)", () => {
    buildDom(["ocean", "labels", "icons"]);
    (window as any).burgWebglActive = () => true;
    reconcileLayers();
    expect(topIds()).toBeNull();
    expect(Array.from(wrapper.children).map(c => c.id)).toEqual(["map", "burgIconsGL"]);
  });

  it("reconcile is idempotent and merges back when gl turns off", () => {
    buildDom(["ocean", "icons", "labels"]);
    (window as any).burgWebglActive = () => true;
    reconcileLayers();
    reconcileLayers(); // idempotent
    expect(topIds()).toEqual(["labels"]);
    (window as any).burgWebglActive = () => false;
    reconcileLayers(); // merge back
    expect(topIds()).toBeNull();
    expect(vbIds()).toEqual(["ocean", "icons", "labels"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: FAIL — "does not provide an export named 'reconcileLayers'".

- [ ] **Step 3: Implement the wiring**

```ts
// add to src/renderers/layer-host.ts
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

  const canvas = w().ensureBurgGLCanvas() as HTMLElement;
  const icons = document.getElementById("icons");
  const parent = svg.parentNode as Node;

  if (icons && hasLayersAbove(viewbox, icons)) {
    // State 1: interleave. Order under wrapper: #map, canvas, #mapTop.
    const top = ensureTopOverlay(svg);
    parent.insertBefore(canvas, svg.nextSibling);
    parent.insertBefore(top, canvas.nextSibling);
    splitSuffix(viewbox, document.getElementById("viewboxTop")!, icons);
    w().bindTopLayerEvents?.();
  } else {
    // State 0 with GL on top: canvas right after #map (today's behavior), no overlay.
    removeTopOverlay();
    parent.insertBefore(canvas, svg.nextSibling);
  }
}

/** Called every frame from zoomRaf: mirror the viewbox transform to #viewboxTop and draw webgl layers. */
export function onFrameLayers(): void {
  const vb = document.getElementById("viewbox");
  const vt = document.getElementById("viewboxTop");
  if (vb && vt) {
    const t = vb.getAttribute("transform");
    if (t != null) vt.setAttribute("transform", t);
  }
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
```

- [ ] **Step 4: Add the module to the renderer bundle**

In `src/renderers/index.ts`, add after the `webgl-burg-icons` import:

```ts
import "./layer-host";
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/renderers/layer-host.test.ts`
Expected: PASS (12 passed).
Run: `tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 6: Commit**

```bash
git add src/renderers/layer-host.ts src/renderers/layer-host.test.ts src/renderers/index.ts
git commit -m "feat(layers): reconcile/onFrame/hitTest wiring + window.LayerHost"
```

---

## Task 6: Register the burg layer + reconcile after rebuild

**Files:**
- Modify: `src/renderers/webgl-burg-icons.ts`

- [ ] **Step 1: Register the burg layer as a `MapLayer`**

In `src/renderers/webgl-burg-icons.ts`, add the import at the top (after the existing imports):

```ts
import { registerLayer } from "./layer-host";
```

Then, at the bottom of the file (just before the final `Object.assign(window, {...})`), register the layer:

```ts
registerLayer({
  id: "toggleBurgIcons",
  renderer: "webgl",
  visible: () => burgWebglActive(),
  draw: () => drawBurgGL(),
  clear: () => destroyBurgGL(),
  hitTest: (mapX, mapY) => {
    const qt = getBurgQuadtree();
    if (!qt) return null;
    const id = hitTestBurg(qt, mapX, mapY, (window as any).scale ?? 1, getBurgSizes());
    return id ?? null;
  }
});
```

- [ ] **Step 2: Call reconcile after a GL rebuild**

In `rebuildBurgGL()` (`src/renderers/webgl-burg-icons.ts`), replace the final `drawBurgGL();` call (currently the last line of the function, ~line 148) with:

```ts
  drawBurgGL();
  (window as any).LayerHost?.reconcile(); // position the canvas at its z-slot once instances are ready
```

- [ ] **Step 3: Typecheck**

Run: `tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run the full unit suite to confirm no regression**

Run: `npx vitest run`
Expected: PASS (all existing + new tests green).

- [ ] **Step 5: Commit**

```bash
git add src/renderers/webgl-burg-icons.ts
git commit -m "feat(layers): register burg layer + reconcile after GL rebuild"
```

---

## Task 7: Drive the per-frame transform through `LayerHost.onFrame`

**Files:**
- Modify: `public/main.js:231-232`

- [ ] **Step 1: Replace the inline GL draw in zoomRaf**

In `public/main.js`, inside the RAF callback in `zoomRaf` (currently around line 231-232):

```js
    // Keep the WebGL burg layer in sync with the viewbox transform (composited, no SVG repaint).
    if (window.burgWebglActive && window.burgWebglActive()) window.drawBurgGL();
```

Replace with:

```js
    // Compositor: mirror the transform to any #viewboxTop and draw WebGL layers (no SVG repaint).
    if (window.LayerHost) window.LayerHost.onFrame();
    else if (window.burgWebglActive && window.burgWebglActive()) window.drawBurgGL(); // fallback pre-init
```

- [ ] **Step 2: Verify the dev server still loads with no console errors**

Run: open the running dev session, load any map, pan/zoom.
Expected: pan/zoom works; no console errors; burgs (if GL active) track the transform exactly as before.

- [ ] **Step 3: Commit**

```bash
git add public/main.js
git commit -m "feat(layers): route per-frame WebGL draw through LayerHost.onFrame"
```

---

## Task 8: Bind interaction handlers to `#viewboxTop` + route burg hit-test through the seam

**Files:**
- Modify: `public/modules/ui/editors.js:9` and `editors.js:15-25`
- Modify: `public/modules/ui/general.js:133-136`

- [ ] **Step 1: Expose `bindTopLayerEvents` and reuse it for the main viewbox**

In `public/modules/ui/editors.js`, replace the body of `restoreDefaultEvents` (lines 7-11) so the click/move binding is factored out and also applied to `#viewboxTop` when present:

```js
function restoreDefaultEvents() {
  svg.call(zoom);
  viewbox.style("cursor", "default").on(".drag", null).on("click", clicked).on("touchmove mousemove", onMouseMove);
  bindTopLayerEvents();
  legend.call(d3.drag().on("start", dragLegendBox));
  svg.call(zoom);
}

// The interleaved overlay (#viewboxTop) is a separate SVG root, so the #viewbox-delegated
// click/move handlers never fire for layers moved into it — bind the same handlers there.
function bindTopLayerEvents() {
  const vt = document.getElementById("viewboxTop");
  if (vt) d3.select(vt).on("click", clicked).on("touchmove mousemove", onMouseMove);
}
window.bindTopLayerEvents = bindTopLayerEvents;
```

- [ ] **Step 2: Route the burg click hit-test through `LayerHost.hitTestTopDown`**

In `editors.js`, in `clicked()` (lines 16-25), replace the inline quadtree block:

```js
  if (window.burgWebglActive && window.burgWebglActive()) {
    const [mx, my] = d3.mouse(ensureEl("viewbox"));
    const qt = window.getBurgQuadtree && window.getBurgQuadtree();
    if (qt) {
      const id = window.hitTestBurg(qt, mx, my, scale, window.getBurgSizes());
      if (id) return editBurg(id);
    }
  }
```

with:

```js
  if (window.LayerHost) {
    const [mx, my] = d3.mouse(ensureEl("viewbox"));
    const hit = window.LayerHost.hitTestTopDown(mx, my);
    if (hit) return editBurg(hit);
  }
```

- [ ] **Step 3: Route the tooltip burg hit-test through the seam too**

In `public/modules/ui/general.js` (lines 133-136), replace:

```js
  if (window.burgWebglActive && window.burgWebglActive()) {
    const qt = window.getBurgQuadtree && window.getBurgQuadtree();
    const burgId = qt && window.hitTestBurg(qt, point[0], point[1], scale, window.getBurgSizes());
```

with (keep the rest of the block — the `if (burgId) {...}` tooltip logic — unchanged):

```js
  if (window.LayerHost) {
    const burgId = window.LayerHost.hitTestTopDown(point[0], point[1]);
```

> Note: the closing of this `if` block and its tooltip body stay as-is; only the condition + `burgId` derivation change. Read the surrounding lines before editing to keep the braces balanced.

- [ ] **Step 4: Verify in the dev session**

Run: load a >5000-burg map (GL auto-on), confirm clicking a burg opens the burg editor and hovering shows the tooltip — both with default layer order (burgs under labels) and after dragging burgs to the top.
Expected: burg click/hover work in both arrangements; clicking a label still opens the label editor.

- [ ] **Step 5: Commit**

```bash
git add public/modules/ui/editors.js public/modules/ui/general.js
git commit -m "feat(layers): bind interaction to #viewboxTop; route burg hit-test via LayerHost"
```

---

## Task 9: Call `reconcile()` from the remaining layer-state change sites

**Files:**
- Modify: `public/modules/ui/layers.js` — `moveLayer` (1044), `toggleBurgIcons` (~930-940), `drawLayers` (192)
- Modify: `public/main.js` — `webglBurgsSelect` change handler (~298-300)
- Modify: `public/modules/ui/general.js` — resize handler (line 5)

- [ ] **Step 1: Reconcile after a layer reorder**

In `layers.js`, append to `moveLayer()` (after the `insertAfter/insertBefore` block, before the closing brace at line 1051):

```js
  if (window.LayerHost) window.LayerHost.reconcile();
```

- [ ] **Step 2: Reconcile after toggling the burg layer on/off**

In `layers.js` `toggleBurgIcons()` (~lines 930-940): the ON branch calls `drawBurgIcons()` (which triggers `rebuildBurgGL` → reconcile when GL is active), but the all-SVG case and the OFF branch need an explicit reconcile. Add `if (window.LayerHost) window.LayerHost.reconcile();` as the last statement of BOTH branches:

```js
function toggleBurgIcons(event) {
  if (!layerIsOn("toggleBurgIcons")) {
    turnButtonOn("toggleBurgIcons");
    drawBurgIcons();
    if (event && isCtrlClick(event)) editStyle("burgIcons");
    if (window.LayerHost) window.LayerHost.reconcile();
  } else {
    if (event && isCtrlClick(event)) return editStyle("burgIcons");
    turnButtonOff("toggleBurgIcons");
    icons.selectAll("circle, use").remove();
    if (window.destroyBurgGL) window.destroyBurgGL();
    if (window.LayerHost) window.LayerHost.reconcile();
  }
}
```

- [ ] **Step 3: Reconcile after a full layer redraw (map generation/load)**

In `layers.js`, append to the end of `drawLayers()` (after line 222, before its closing brace):

```js
  if (window.LayerHost) window.LayerHost.reconcile();
```

- [ ] **Step 4: Reconcile when the WebGL preference changes**

In `public/main.js`, in the `webglBurgsSelect` change handler, after the existing `drawBurgIcons()` call (line 299), add:

```js
    if (window.LayerHost) window.LayerHost.reconcile();
```

- [ ] **Step 5: Reconcile on resize (so #mapTop tracks #map's size)**

In `public/modules/ui/general.js`, in the resize handler (around line 5 where `resizeBurgGL()` is called), add after it:

```js
  if (window.LayerHost) window.LayerHost.reconcile();
```

- [ ] **Step 6: Verify the full transition matrix in the dev session**

Run: with a GL-active map — toggle the burg layer off → on (DOM merges then re-splits), drag burgs above/below labels (split point moves), resize the window (overlay stays aligned), switch the WebGL pref auto/on/off.
Expected: every transition lands in the right state; when all-SVG (pref off), `#mapTop` and `#burgIconsGL` are gone and the DOM matches today.

- [ ] **Step 7: Commit**

```bash
git add public/modules/ui/layers.js public/main.js public/modules/ui/general.js
git commit -m "feat(layers): reconcile on reorder, toggle, redraw, pref change, and resize"
```

---

## Task 10: Full manual browser acceptance

**Files:** none (verification only). Use the NixOS Playwright/CDP setup; force `page.reload()`, let the console quiesce; never compare across canvas sizes.

- [ ] **Step 1: Verify all-SVG parity (the default, zero-regression criterion)**

Load a small map (GL auto-off, <5000 burgs). Inspect the DOM.
Expected: single `#map` SVG, single `#viewbox`, NO `#mapTop`, NO `#burgIconsGL`. Identical to `main` before this branch. Pan/zoom, click a burg/label/route — all work.

- [ ] **Step 2: Verify burgs render UNDER labels (the headline feature)**

Load a >5000-burg map (GL auto-on), default order.
Expected: `#mapTop` exists holding `#labels` (and the groups above `#icons`); `#burgIconsGL` sits between `#map` and `#mapTop`; visually, burg icons render *beneath* their labels. Pan/zoom: no drift between burgs and labels.

- [ ] **Step 3: Verify free z-order across renderers**

Drag `toggleBurgIcons` in the layer-order list above `toggleLabels`.
Expected: burgs now render *above* labels; `#icons` becomes last in `#viewbox`, `#mapTop` is removed, the canvas moves to the top (State 0-with-GL). Drag it back down → burgs under labels again.

- [ ] **Step 4: Verify interaction in both arrangements**

In each arrangement: click a burg (opens burg editor), hover a burg (tooltip), relocate a burg (drag in burg editor), click a label (opens label editor).
Expected: all work regardless of z-order.

- [ ] **Step 5: Verify merge-back**

Toggle the burg layer off, then set the WebGL pref to "off".
Expected: `#mapTop` and `#burgIconsGL` removed; `#viewbox` child order restored exactly; SVG burgs render normally.

- [ ] **Step 6: Record results and finish the branch**

Note the verification results (browser, map size, pass/fail per step). Then proceed to the `superpowers:finishing-a-development-branch` skill to decide merge/PR.

---

## Notes / known limitations (in scope, accepted)

- **Wheel-zoom directly over a label glyph in State 1** may not zoom (the event lands on `#viewboxTop`, which has no `d3.zoom`). Labels are small; acceptable for this phase. A later phase can forward wheel events from `#mapTop` to `#map`.
- **Generalized save/load of per-layer renderer choice, multi-WebGL-layer UI, and a second WebGL layer are out of scope** (deferred per the design's "Out of scope" section). The renderer choice is still derived from `burgWebglActive()` (burg count + `webglBurgs` pref), not persisted per-layer.
- If Task 1's spike was NO-GO for any target browser, the defs-duplication fallback must be added to `ensureTopOverlay` (copy the referenced `<defs>` subset into `#mapTop`) before Task 10 can pass on that browser.
```
