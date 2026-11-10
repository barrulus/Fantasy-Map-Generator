// @vitest-environment jsdom
import type { Route } from "@/model/economy/routes-generator";
import { Routes } from "@/model/economy/routes-generator";
import "@/model/styles/styles";
import { beforeEach, expect, test, vi } from "vitest";
import { Styles } from "@/model/styles/styles";
import {
  drawRoutes,
  getRouteBox,
  redrawRoute,
  removeRoutes,
  setEditedRoute,
  setTempRoute
} from "@/renderers/draw-routes";
import type { Layer } from "@/renderers/layers";
import { setViewportSize, setViewportTransform } from "@/renderers/viewport/viewport";
import { ViewportLayers } from "@/renderers/viewport/viewport-renderer";

const mocks = vi.hoisted(() => ({ layerOn: true }));
vi.mock("@/renderers/layers", () => ({ Layers: { isOn: () => mocks.layerOn } }));

const routesLayer = { getEl: () => document.getElementById("routes") } as unknown as Layer;

function route(i: number, x: number, group = "roads"): Route {
  return {
    i,
    group,
    feature: 1,
    points: [
      [x, 10, 1],
      [x + 40, 50, 2]
    ]
  };
}

const getPath = vi.fn(({ points }: { points: number[][] }) => `M${points.map(([x, y]) => `${x},${y}`).join("L")}`);

beforeEach(() => {
  mocks.layerOn = true;
  document.body.innerHTML = /* html */ `<svg id="map">
      <g id="routes"><g data-group="roads"></g><g data-group="trails"></g><g data-group="searoutes"></g></g>
    </svg>`;
  globalThis.pack = { routes: [route(1, 0), route(2, 500), route(3, 0, "trails")] } as never;
  Object.assign(Routes, { getPath });
  getPath.mockClear();
  setViewportSize(100, 100);
  setViewportTransform(1, 0, 0);
  setEditedRoute(null);
  setTempRoute(null);
});

test("routes are materialized into their own group and culled on panning", () => {
  drawRoutes(routesLayer);
  expect(document.querySelector('[data-group="roads"] > #route1')).not.toBeNull();
  expect(document.querySelector('[data-group="trails"] > #route3')).not.toBeNull();
  expect(document.getElementById("route2")).toBeNull();
  expect(document.getElementById("routes")!.getAttribute("fill")).toBe("none");
  expect(document.querySelector("#routes g[id]")).toBeNull();

  const first = document.getElementById("route1");
  ViewportLayers.renderNow();
  expect(document.getElementById("route1")).toBe(first);
  expect(getPath).toHaveBeenCalledTimes(3); // paths are built once, not per frame

  setViewportTransform(1, -500, 0);
  ViewportLayers.renderNow();
  expect(document.getElementById("route1")).toBeNull();
  expect(document.querySelector('[data-group="roads"] > #route2')?.getAttribute("d")).toBe("M500,10L540,50");
  expect(getPath).toHaveBeenCalledTimes(3);
});

test("the edited route stays rendered off-screen and follows a group change", () => {
  drawRoutes(routesLayer);
  setEditedRoute(2);
  expect(document.querySelector('[data-group="roads"] > #route2')).not.toBeNull();

  pack.routes[1].group = "searoutes";
  redrawRoute(pack.routes[1]);
  expect(document.querySelector('[data-group="roads"] > #route2')).toBeNull();
  expect(document.querySelector('[data-group="searoutes"] > #route2')).not.toBeNull();

  setEditedRoute(null);
  ViewportLayers.renderNow();
  expect(document.getElementById("route2")).toBeNull();
});

test("editing a visible route updates its path in place", () => {
  drawRoutes(routesLayer);
  const edited = document.getElementById("route1");
  pack.routes[0].points = [
    [0, 10, 1],
    [30, 30, 2]
  ];
  redrawRoute(pack.routes[0]);
  expect(document.getElementById("route1")).toBe(edited);
  expect(edited?.getAttribute("d")).toBe("M0,10L30,30");
});

test("the creator's temporary route renders in the selected group and never in an export", () => {
  drawRoutes(routesLayer);
  setTempRoute({
    group: "trails",
    points: [
      [0, 0, 1],
      [10, 10, 2]
    ]
  });
  expect(document.querySelector('[data-group="trails"] > #routeTemp')?.getAttribute("d")).toBe("M0,0L10,10");

  const clone = document.getElementById("map")!.cloneNode(true) as SVGSVGElement;
  ViewportLayers.renderTo(clone);
  expect(clone.querySelector("#routeTemp")).toBeNull();
  expect(clone.querySelectorAll("#routes path")).toHaveLength(3);

  setTempRoute(null);
  expect(document.getElementById("routeTemp")).toBeNull();
});

test("redraw picks up new paths and removed routes", () => {
  drawRoutes(routesLayer);
  pack.routes = [pack.routes[0]];
  drawRoutes(routesLayer);
  expect(document.querySelectorAll("#routes path")).toHaveLength(1);
  expect(getRouteBox(3)).toBeNull();

  const box = getRouteBox(1)!;
  expect(box.x).toBe(-1.4); // the course inflated by the type stroke width, which overrides the group's
  expect(box.width).toBeCloseTo(42.8);
});

test("erasing the layer keeps the groups, which carry the user's styles", () => {
  drawRoutes(routesLayer);
  removeRoutes();
  expect(document.querySelectorAll("#routes path")).toHaveLength(0);
  expect(document.querySelectorAll("#routes > g")).toHaveLength(Object.keys(styles.routes.groups).length);

  ViewportLayers.renderNow();
  expect(document.querySelectorAll("#routes path")).toHaveLength(0); // invalidated: nothing to reconcile against
  drawRoutes(routesLayer);
  expect(document.querySelectorAll("#routes path")).toHaveLength(2);
});

test("viewport rendering leaves a disabled layer empty", () => {
  drawRoutes(routesLayer);
  mocks.layerOn = false;
  document.querySelector('[data-group="roads"]')!.replaceChildren(); // the layer registry erases the content when hidden
  ViewportLayers.renderNow();
  expect(document.getElementById("route1")).toBeNull();

  mocks.layerOn = true;
  ViewportLayers.renderNow();
  expect(document.getElementById("route1")).not.toBeNull();
});

// route types (royal, footpath, ...) draw as a sub-group per type inside the group, styled from styles.routes.types
test("type sub-groups take their line style from the store, marked for Styles.write", () => {
  (globalThis as { CSS?: unknown }).CSS ??= { escape: (value: string) => value }; // jsdom has no CSS.escape
  document.getElementById("routes")!.setAttribute("data-layer", "routes");
  pack.routes = [
    { ...route(1, 0), type: "royal" },
    { ...route(3, 0, "trails"), type: "footpath" }
  ];
  styles.routes.types.royal.attrs["stroke-width"] = 3.5;
  styles.routes.types.royal.attrs["stroke-dasharray"] = "9 1";
  drawRoutes(routesLayer);

  const royal = document.querySelector<SVGGElement>("#routes > [data-group=roads] > g#royal")!;
  expect(royal.dataset.type).toBe("royal");
  expect(royal.getAttribute("stroke-width")).toBe("3.5");
  expect(royal.getAttribute("stroke-dasharray")).toBe("9 1");
  expect(royal.hasAttribute("stroke")).toBe(false); // inherits the group's colour
  expect(royal.querySelector("#route1")).not.toBeNull();
  expect(document.querySelector("#routes > [data-group=trails] > g#footpath")?.getAttribute("stroke-linecap")).toBe(
    "round"
  );

  styles.routes.types.royal.attrs["stroke-width"] = 1;
  Styles.write("routes");
  expect(royal.getAttribute("stroke-width")).toBe("1");
});

test("a type the store does not know falls back to the built-in table, then the group", () => {
  pack.routes = [{ ...route(1, 0), type: "mystery" }];
  drawRoutes(routesLayer);
  const mystery = document.querySelector<SVGGElement>("#routes > [data-group=roads] > g#mystery")!;
  expect(mystery.dataset.type).toBe("mystery");
  expect(mystery.hasAttribute("stroke-width")).toBe(false);
});

test("editing a shared route type writes every matching group", () => {
  document.body.innerHTML = `<svg><g id="routes" data-layer="routes">
    <g data-group="roads"><g data-type="royal"></g></g>
    <g data-group="custom"><g data-type="royal"></g></g>
  </g></svg>`;
  Styles.setValue("routes.types.royal.attrs.stroke", "#123456");
  Styles.writeAttr(["routes", "types", "royal", "attrs", "stroke"]);
  for (const element of document.querySelectorAll('[data-type="royal"]'))
    expect(element.getAttribute("stroke")).toBe("#123456");
});
