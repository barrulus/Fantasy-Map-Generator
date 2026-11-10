import { IconSets } from "@/model/icon-sets";
import { Icons } from "@/model/icons";
import type { Burg } from "@/model/political/burgs-generator";
import { Burgs } from "@/model/political/burgs-generator";
import { groupMinZoom } from "@/renderers/labeling/tier-table";
import { Layers } from "@/renderers/layers";
import { zoomFontSize } from "@/renderers/viewport/viewport";
import { ViewportLayers, type ViewportRenderContext } from "@/renderers/viewport/viewport-renderer";
import type { StylesData } from "@/types/styles";
import { log } from "@/utils/logger";
import { rn } from "@/utils/number-utils";
import { escapeHtml } from "@/utils/string-utils";

const layer = ViewportLayers.register({ id: "burgIcons", render: reconcileBurgIcons });

export async function drawBurgIcons(): Promise<void> {
  log.time("drawBurgIcons");
  const icons = Object.values(styles.burgIcons.groups).flatMap(({ groups }) => [
    groups.icons.options.icon,
    groups.anchors.options.icon
  ]);
  const referenced = icons.map(icon => icon && IconSets.setForId(icon)).filter(set => !!set);
  await Icons.loadAll([...new Set([...Burgs.iconSets.map(set => set.id), ...referenced])]);
  layer.render();
  log.timeEnd("drawBurgIcons");
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

  const stylesByGroup = styles.burgIcons.groups;
  const fallback = stylesByGroup.town ?? Object.values(stylesByGroup)[0];
  const markup: string[] = [];

  for (const { name } of [...options.map.burgs.groups].sort((a, b) => a.order - b.order)) {
    const entry = stylesByGroup[name] ?? fallback;
    if (!entry) continue;
    const groupName = escapeHtml(name);
    const minZoom = options.map.labels.groups.find(group => group.name === name)?.zoom?.min ?? groupMinZoom(name);
    const visible = bounds.x0 === -Infinity || options.app.labels.showAll || bounds.scale >= minZoom;
    const burgs = visible ? (burgsByGroup.get(name) ?? []) : [];
    markup.push(`<g data-group="${groupName}">`);
    markup.push(part("icons", entry.groups.icons, burgs, bounds, false));
    markup.push(part("anchors", entry.groups.anchors, burgs, bounds, true));
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
