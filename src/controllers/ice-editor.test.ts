// @vitest-environment jsdom

import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Ice } from "@/generators/ice-generator";
import { IceEditor } from "./ice-editor";

vi.mock("@/components/layers", () => ({ Layers: { isOn: () => true, show: vi.fn() } }));
vi.mock("@/components/dialog/dialog-helpers", () => ({ closeDialogs: vi.fn(), destroyDialog: vi.fn() }));
vi.mock("@/components/tooltips", () => ({ clearMainTip: vi.fn(), tip: vi.fn() }));
vi.mock("@/components/viewbox-events", () => ({ applyDefaultViewboxEvents: vi.fn() }));

const iceberg = (i: number, x: number, y: number): Ice => ({
  type: "iceberg",
  i,
  points: [
    [x, y],
    [x + 10, y],
    [x + 10, y + 10],
    [x, y + 10]
  ],
  cellId: 0,
  size: 1
});

const polygon = (id: number): SVGElement => document.querySelector(`#ice polygon[data-id="${id}"]`)!;

const mouseEvent = (type: string, init: MouseEventInit): MouseEvent => {
  const view = document.defaultView!;
  const event = new view.MouseEvent(type, init);
  Object.defineProperty(event, "view", { value: view });
  return event;
};

const drag = (target: Element, from: [number, number], ...to: [number, number][]): void => {
  const view = document.defaultView!;
  target.dispatchEvent(mouseEvent("mousedown", { bubbles: true, button: 0, clientX: from[0], clientY: from[1] }));
  for (const [x, y] of to) {
    view.dispatchEvent(mouseEvent("mousemove", { bubbles: true, buttons: 1, clientX: x, clientY: y }));
  }
  view.dispatchEvent(
    mouseEvent("mouseup", { bubbles: true, button: 0, clientX: to.at(-1)![0], clientY: to.at(-1)![1] })
  );
};

beforeEach(() => {
  document.body.innerHTML = `
    <div id="dialogs"></div>
    <svg><g id="ice">
      <polygon points="40,40 50,40 50,50 40,50" data-id="1"/>
      <polygon points="60,60 70,60 70,70 60,70" data-id="2"/>
    </g></svg>`;
  Object.assign(globalThis, {
    customization: false,
    scale: 1,
    viewX: 0,
    viewY: 0,
    svgWidth: 100,
    svgHeight: 100,
    $: () => ({ dialog: vi.fn() })
  });
  (globalThis as Record<string, unknown>).pack = { ice: [iceberg(1, 40, 40), iceberg(2, 60, 60)] };
});

describe("ice editor drag", () => {
  test("only the selected element is draggable", () => {
    IceEditor.open(polygon(1));
    expect(polygon(1).classList.contains("draggable")).toBe(true);
    expect(polygon(2).classList.contains("draggable")).toBe(false);
  });

  test("dragging an unselected iceberg neither moves it nor corrupts other offsets", () => {
    IceEditor.open(polygon(1));
    drag(polygon(2), [60, 60], [80, 80]);

    expect(polygon(2).getAttribute("transform")).toBeNull();
    expect(pack.ice[0].offset).toBeUndefined();
    expect(pack.ice[1].offset).toBeUndefined();
  });

  test("the selected iceberg follows the first mouse movement", () => {
    IceEditor.open(polygon(1));
    drag(polygon(1), [40, 40], [45, 45]);

    expect(polygon(1).getAttribute("transform")).toBe("translate(5,5)");
    expect(pack.ice[0].offset).toEqual([5, 5]);
  });
});
