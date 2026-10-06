import { IconSets } from "@/components/icon-sets";
import { Icons } from "@/components/icons";
import { Layers } from "@/components/layers";
import { zoomFontSize } from "@/components/viewport";
import type { Burg } from "@/generators/burgs-generator";
import {
  COMPOSITE_ICON_SCALE,
  findMegalopolises,
  MEGALOPOLIS_MIN_ZOOM,
  MEGALOPOLIS_SPLIT_ZOOM,
  type Megalopolis,
  RING_ICON_SCALE
} from "@/generators/megalopolis";
import { ViewportLayers, type ViewportRenderContext } from "@/renderers/viewport/viewport-renderer";
import type { StylesData } from "@/types/styles";
import { rn } from "@/utils/numberUtils";
import { escapeHtml } from "@/utils/stringUtils";
import { groupMinZoom } from "./labeling/tier-table";

const layer = ViewportLayers.register({ id: "burgIcons", render: reconcileBurgIcons });

export async function drawBurgIcons(): Promise<void> {
  TIME && console.time("drawBurgIcons");
  const icons = Object.values(styles.burgIcons.groups).flatMap(({ groups }) => [
    groups.icons.options.icon,
    groups.anchors.options.icon
  ]);
  const referenced = icons.map(icon => icon && IconSets.setForId(icon)).filter(set => !!set);
  await Icons.loadAll([...new Set([...Burgs.iconSets.map(set => set.id), ...referenced])]);
  layer.render();
  TIME && console.timeEnd("drawBurgIcons");
}

type BurgPart =
  | StylesData["burgIcons"]["groups"][string]["groups"]["icons"]
  | StylesData["burgIcons"]["groups"][string]["groups"]["anchors"];

type Bounds = ViewportRenderContext["bounds"];

function reconcileBurgIcons({ root, bounds }: ViewportRenderContext): void {
  if (!Layers.isOn("burgIcons")) return;

  const burgsByGroup = new Map<string, Burg[]>();
  for (const burg of pack.burgs) {
    if (!burg.i || burg.removed || !burg.group) continue;
    const group = burgsByGroup.get(burg.group);
    if (group) group.push(burg);
    else burgsByGroup.set(burg.group, [burg]);
  }

  const container = root.querySelector<SVGGElement>("#burgIcons");
  if (!container) return;

  const unbounded = bounds.x0 === -Infinity;
  const composites = pack.cells?.burg ? [...findMegalopolises(pack.burgs, pack.cells.burg).values()] : [];
  const memberIds = new Set(composites.flatMap(mega => mega.members.map(burg => burg.i)));
  const compositeMode = !unbounded && bounds.scale < MEGALOPOLIS_SPLIT_ZOOM;
  const stylesByGroup = styles.burgIcons.groups;
  const fallback = stylesByGroup.town ?? Object.values(stylesByGroup)[0];
  const markup: string[] = [];

  for (const { name } of [...options.map.burgs.groups].sort((a, b) => a.order - b.order)) {
    const entry = stylesByGroup[name] ?? fallback;
    if (!entry) continue;
    const groupName = escapeHtml(name);
    const minZoom = options.map.labels.groups.find(group => group.name === name)?.zoom?.min ?? groupMinZoom(name);
    const visible = unbounded || options.app.labels.showAll || bounds.scale >= minZoom;
    const burgs = visible
      ? (burgsByGroup.get(name) ?? []).filter(burg => !compositeMode || !memberIds.has(burg.i))
      : [];
    markup.push(`<g id="${groupName}" data-group="${groupName}">`);
    markup.push(part("icons", entry.groups.icons, burgs, bounds, false));
    markup.push(part("anchors", entry.groups.anchors, burgs, bounds, true));
    if (compositeMode && bounds.scale >= MEGALOPOLIS_MIN_ZOOM) {
      for (const mega of composites.filter(mega => mega.anchor.group === name))
        markup.push(composite(mega, entry.groups.icons, bounds));
    }
    markup.push("</g>");
  }

  const next = document.createElementNS("http://www.w3.org/2000/svg", "g");
  next.innerHTML = markup.join("");
  reconcileChildren(container, next);
}

/** One part of a burg group — the icons or the anchors — as its own data-group element */
function part(name: "icons" | "anchors", style: BurgPart, burgs: Burg[], bounds: Bounds, anchors: boolean): string {
  const id = style.options.icon;
  const icon = escapeHtml(Icons.href(id));
  // anchored art stands on the burg by its own frame; any other icon is a 1em box centred on it
  const [boxX, boxY, boxWidth, boxHeight] = Icons.anchoredBox(id) ?? [-0.5, -0.5, 1, 1];
  const size = style.options.size ?? 1;
  const shift = anchors ? (style.options as { dx?: number; dy?: number }) : undefined;
  const shiftX = shift?.dx ?? 0;
  const shiftY = shift?.dy ?? 0;

  const attrs: string[] = [];
  for (const [key, value] of Object.entries(style.attrs)) {
    if (value !== null && value !== undefined) attrs.push(` ${key}="${escapeHtml(String(value))}"`);
  }
  // The box and the shift are in icon em, so they stay true to the icon as the zoom resizes it
  const [translateX, translateY] = [rn(shiftX + boxX, 4), rn(shiftY + boxY, 4)];
  if (translateX || translateY) attrs.push(` style="transform: translate(${translateX}em, ${translateY}em)"`);

  // An icon is sized in % of the layer font, so it follows the zoom on the burg icons curve
  const markup = [`<g data-group="${name}" data-icon="${escapeHtml(id)}"${attrs.join("")} font-size="${size}%">`];
  const em = (size * zoomFontSize("burgIcons", bounds.scale)) / 100; // the icon em in map units at this zoom
  // Symbols overflow their viewBox; the tallest burg artwork reaches two em above its anchor.
  const padding = 2 * (Math.abs(em) + (style.attrs["stroke-width"] ?? 0));

  for (const { i, x, y, port } of burgs) {
    if (!id || (anchors && !port)) continue;
    const cx = x + shiftX * em;
    const cy = y + shiftY * em;
    if (cx + padding < bounds.x0 || cx - padding > bounds.x1 || cy + padding < bounds.y0 || cy - padding > bounds.y1)
      continue;
    markup.push(
      `<use id="${anchors ? "anchor" : "burg"}${i}" data-id="${i}" href="${icon}" x="${x}" y="${y}" width="${rn(boxWidth, 4)}em" height="${rn(boxHeight, 4)}em"/>`
    );
  }

  markup.push("</g>");
  return markup.join("");
}

function composite(mega: Megalopolis, style: BurgPart, bounds: Bounds): string {
  const { x, y, i } = mega.anchor;
  const em = ((style.options.size ?? 1) * zoomFontSize("burgIcons", bounds.scale)) / 100;
  const radius = (em * RING_ICON_SCALE) / 2;
  if (x + radius < bounds.x0 || x - radius > bounds.x1 || y + radius < bounds.y0 || y - radius > bounds.y1) return "";
  const [bx, by, width, height] = Icons.anchoredBox(style.options.icon) ?? [-0.5, -0.5, 1, 1];
  const size = em * COMPOSITE_ICON_SCALE;
  const attrs = Object.entries(style.attrs)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
    .join("");
  return `<g class="megalopolis-composite" data-cell="${mega.cell}"${attrs}>
    <use data-id="${i}" href="${escapeHtml(Icons.href(style.options.icon))}" x="${x + bx * size}" y="${y + by * size}" width="${width * size}" height="${height * size}"/>
    <circle data-id="${i}" cx="${x}" cy="${y}" r="${radius}" fill="none" stroke="#fff" stroke-width="${em * 0.12}"/>
  </g>`;
}

// Keep keyed icons alive through zoom reconciliation so a click's target does not disappear.
function reconcileChildren(current: Element, next: Element): void {
  const key = (element: Element, index: number): string =>
    element.id || element.getAttribute("data-group") || element.getAttribute("data-cell") || `child-${index}`;
  const existing = new Map(Array.from(current.children, (child, index) => [key(child, index), child]));
  for (const [index, candidate] of Array.from(next.children).entries()) {
    const id = key(candidate, index);
    const previous = existing.get(id);
    const child = previous?.tagName === candidate.tagName ? previous : candidate;
    if (child === previous) {
      for (const attr of Array.from(child.attributes))
        if (!candidate.hasAttribute(attr.name)) child.removeAttribute(attr.name);
      for (const attr of Array.from(candidate.attributes))
        if (child.getAttribute(attr.name) !== attr.value) child.setAttribute(attr.name, attr.value);
      reconcileChildren(child, candidate);
      existing.delete(id);
    }
    if (current.children[index] !== child) current.insertBefore(child, current.children[index] ?? null);
  }
  for (const child of existing.values()) child.remove();
}
