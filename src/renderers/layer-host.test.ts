import { beforeEach, describe, expect, it } from "vitest";
import {
  _resetLayers,
  createTopOverlay,
  getWebglLayers,
  hasLayersAbove,
  hitTestTopDown,
  mergeSuffix,
  onFrameLayers,
  reconcileLayers,
  registerLayer,
  splitSuffix
} from "./layer-host";

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
    splitSuffix(viewbox, viewboxTop, split);
    mergeSuffix(viewbox, viewboxTop);
    expect(ids(viewbox)).toEqual(before);
  });
});

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

  it("does not register the same layer id twice", () => {
    registerLayer({ id: "dup", renderer: "webgl", visible: () => true, draw: () => {}, clear: () => {} });
    registerLayer({ id: "dup", renderer: "webgl", visible: () => true, draw: () => {}, clear: () => {} });
    expect(getWebglLayers().filter(l => l.id === "dup")).toHaveLength(1);
  });
});

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
    expect((g as SVGElement).style.pointerEvents).toBe("auto");
  });
});

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
      if (!c) {
        c = document.createElement("canvas");
        c.id = "burgIconsGL";
      }
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
    reconcileLayers();
    expect(topIds()).toEqual(["labels"]);
    (window as any).burgWebglActive = () => false;
    reconcileLayers();
    expect(topIds()).toBeNull();
    expect(vbIds()).toEqual(["ocean", "icons", "labels"]);
  });
});

describe("onFrameLayers", () => {
  beforeEach(() => {
    _resetLayers();
    document.body.innerHTML = "";
    const NS = "http://www.w3.org/2000/svg";
    const vb = document.createElementNS(NS, "g");
    vb.id = "viewbox";
    vb.setAttribute("transform", "translate(10 20) scale(2)");
    const vt = document.createElementNS(NS, "g");
    vt.id = "viewboxTop";
    document.body.append(vb, vt);
  });

  it("mirrors the #viewbox transform onto #viewboxTop", () => {
    onFrameLayers();
    expect(document.getElementById("viewboxTop")!.getAttribute("transform")).toBe("translate(10 20) scale(2)");
  });

  it("draws only visible webgl layers", () => {
    let drawnA = 0;
    let drawnB = 0;
    registerLayer({
      id: "a",
      renderer: "webgl",
      visible: () => true,
      draw: () => {
        drawnA++;
      },
      clear: () => {}
    });
    registerLayer({
      id: "b",
      renderer: "webgl",
      visible: () => false,
      draw: () => {
        drawnB++;
      },
      clear: () => {}
    });
    onFrameLayers();
    expect(drawnA).toBe(1);
    expect(drawnB).toBe(0);
  });
});

describe("hitTestTopDown", () => {
  beforeEach(() => _resetLayers());

  it("returns the topmost (last-registered) visible layer's hit", () => {
    registerLayer({
      id: "bottom",
      renderer: "webgl",
      visible: () => true,
      draw: () => {},
      clear: () => {},
      hitTest: () => 1
    });
    registerLayer({
      id: "top",
      renderer: "webgl",
      visible: () => true,
      draw: () => {},
      clear: () => {},
      hitTest: () => 2
    });
    expect(hitTestTopDown(0, 0)).toBe(2);
  });

  it("skips layers that are not visible or have no hitTest, falling through", () => {
    registerLayer({
      id: "hit",
      renderer: "webgl",
      visible: () => true,
      draw: () => {},
      clear: () => {},
      hitTest: () => 7
    });
    registerLayer({
      id: "invisible",
      renderer: "webgl",
      visible: () => false,
      draw: () => {},
      clear: () => {},
      hitTest: () => 9
    });
    registerLayer({ id: "nohit", renderer: "webgl", visible: () => true, draw: () => {}, clear: () => {} });
    expect(hitTestTopDown(0, 0)).toBe(7);
  });

  it("returns null when no layer claims the point", () => {
    registerLayer({
      id: "miss",
      renderer: "webgl",
      visible: () => true,
      draw: () => {},
      clear: () => {},
      hitTest: () => null
    });
    expect(hitTestTopDown(0, 0)).toBeNull();
  });
});
