// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Ice } from "@/generators/ice-generator";
import { drawIce, redrawIce } from "./draw-ice";

vi.mock("@/components/layers", () => ({ Layers: { isOn: () => true } }));

const iceberg = (i: number, points: [number, number][], offset?: [number, number]): Ice => ({
  type: "iceberg",
  i,
  points,
  cellId: 0,
  size: 1,
  ...(offset ? { offset } : {})
});

const square = (x: number, y: number, size = 10): [number, number][] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size]
];

const renderedIds = (): string[] =>
  [...document.querySelectorAll("#ice polygon")].map(polygon => polygon.getAttribute("data-id")!);

beforeEach(() => {
  document.body.innerHTML = `<svg><g id="ice"></g></svg>`;
  // viewport globals read by ViewportLayers.getViewport: a 100x100 view at origin, no zoom
  Object.assign(globalThis, { scale: 1, viewX: 0, viewY: 0, svgWidth: 100, svgHeight: 100 });
  (globalThis as Record<string, unknown>).pack = { ice: [] };
});

describe("drawIce viewport culling", () => {
  test("renders only shapes intersecting the viewport", () => {
    pack.ice = [iceberg(1, square(40, 40)), iceberg(2, square(5000, 5000))];
    drawIce();
    expect(renderedIds()).toEqual(["1"]);
  });

  test("keeps a glacier whose extent overlaps the view even when its centre is far outside", () => {
    pack.ice = [{ type: "glacier", i: 7, points: square(-2000, -2000, 2050) }];
    drawIce();
    expect(renderedIds()).toEqual(["7"]);
  });

  test("culls by the offset position, not the original points", () => {
    pack.ice = [iceberg(3, square(5000, 5000), [-4960, -4960]), iceberg(4, square(40, 40), [6000, 6000])];
    drawIce();
    expect(renderedIds()).toEqual(["3"]);
    expect(document.querySelector("#ice polygon")!.getAttribute("transform")).toBe("translate(-4960,-4960)");
  });
});

describe("redrawIce", () => {
  test("patches an updated iceberg in place, preserving the DOM node and its listeners", () => {
    pack.ice = [iceberg(1, square(40, 40))];
    drawIce();
    const node = document.querySelector("#ice polygon")!;

    pack.ice[0].offset = [10, 10];
    redrawIce(1);
    expect(document.querySelector("#ice polygon")).toBe(node);
    expect(node.getAttribute("transform")).toBe("translate(10,10)");

    pack.ice[0].offset = undefined;
    redrawIce(1);
    expect(node.getAttribute("transform")).toBeNull();
  });

  test("creates the polygon of a newly added element", () => {
    pack.ice = [iceberg(1, square(40, 40))];
    drawIce();

    pack.ice.push(iceberg(2, square(60, 60)));
    redrawIce(2);
    expect(renderedIds()).toEqual(["1", "2"]);
  });

  test("removes the polygon of a deleted ice element", () => {
    pack.ice = [iceberg(1, square(40, 40)), { type: "glacier", i: 2, points: square(60, 60) }];
    drawIce();
    expect(renderedIds()).toHaveLength(2);

    pack.ice = pack.ice.filter((ice: Ice) => ice.i !== 2);
    redrawIce(2);
    expect(renderedIds()).toEqual(["1"]);
  });
});
