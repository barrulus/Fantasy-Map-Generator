import { Layers } from "@/components/layers";
import type { Ice } from "@/generators/ice-generator";
import { Scene, ViewportLayers, type ViewportRenderContext } from "./viewport/viewport-renderer";

interface IceSceneItem {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  markup: string;
}

const scene = new Scene<IceSceneItem>();
const layer = ViewportLayers.register({ id: "ice", render: reconcileIce });

export const drawIce = (): void => {
  TIME && console.time("drawIce");
  scene.replace(pack.ice.map(buildItem));
  layer.render();
  TIME && console.timeEnd("drawIce");
};

/** sync one updated or deleted ice element into the scene and the visible DOM;
 * existing polygons are patched in place so editor listeners on them survive */
export const redrawIce = (id: number): void => {
  const ice = pack.ice.find((element: Ice) => element.i === id);
  const group = document.querySelector("#ice");
  const polygon = group?.querySelector(`polygon[data-id="${id}"]`);

  if (!ice) {
    scene.remove(String(id));
    polygon?.remove();
    return;
  }

  const item = buildItem(ice);
  scene.set(item);
  if (!group) return;
  if (polygon) {
    polygon.setAttribute("points", ice.points.toString());
    if (ice.offset) polygon.setAttribute("transform", `translate(${ice.offset[0]},${ice.offset[1]})`);
    else polygon.removeAttribute("transform");
  } else {
    group.insertAdjacentHTML("beforeend", item.markup);
  }
};

export const removeIce = (): void => {
  scene.invalidate();
  document.querySelector("#ice")?.replaceChildren();
};

function reconcileIce(context: ViewportRenderContext): void {
  const group = context.root.querySelector("#ice");
  if (!group) return;
  if (!scene.valid || !Layers.isOn("ice")) return void group.replaceChildren();

  const { x0, y0, x1, y1 } = context.bounds;
  const markup: string[] = [];
  for (const item of scene.values()) {
    if (item.x0 > x1 || item.y0 > y1 || item.x1 < x0 || item.y1 < y0) continue;
    markup.push(item.markup);
  }
  group.innerHTML = markup.join("");
}

function buildItem(ice: Ice): IceSceneItem {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of ice.points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }

  const type = ice.type === "glacier" ? ` type="glacier"` : "";
  const transform = ice.offset ? ` transform="translate(${ice.offset[0]},${ice.offset[1]})"` : "";
  const markup = /* html */ `<polygon points="${ice.points.toString()}"${type} data-id="${ice.i}"${transform}/>`;

  const [dx, dy] = ice.offset ?? [0, 0];
  return { id: String(ice.i), x0: x0 + dx, y0: y0 + dy, x1: x1 + dx, y1: y1 + dy, markup };
}
