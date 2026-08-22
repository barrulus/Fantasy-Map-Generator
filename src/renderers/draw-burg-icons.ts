import { select } from "d3";
import type { Burg } from "../generators/burgs-generator";
import { COMPOSITE_ICON_SCALE, findMegalopolises, type Megalopolis, RING_ICON_SCALE } from "../generators/megalopolis";
import { groupMinZoom } from "./labeling/tier-table";
import { ViewportLayers, type ViewportRenderContext } from "./viewport/viewport-renderer";

declare global {
  var drawBurgIcons: () => void;
}

// Megalopolis membership is derived per full draw and reused by every viewport reconcile
let megaMemberIds = new Set<number>();

const burgIconsRenderer = (): void => {
  TIME && console.time("drawBurgIcons");
  createIconGroups();

  const megas = findMegalopolises(pack.burgs, pack.cells.burg);
  megaMemberIds = new Set();
  for (const m of megas.values()) for (const b of m.members) megaMemberIds.add(b.i);

  // Composites are few and zoom-toggled by CSS display (zoom-extras), so they materialize once
  // per draw; the per-burg member icons materialize per viewport in renderVisibleIcons.
  for (const { name } of options.burgs.groups) {
    const iconsGroup = document.querySelector<SVGGElement>(`#burgIcons > g#${name}`);
    if (!iconsGroup) continue;

    const composites = [...megas.values()].filter(m => m.anchor.group === name);
    if (composites.length) iconsGroup.innerHTML = compositesMarkup(iconsGroup, composites);
  }

  ViewportLayers.renderNow();
  TIME && console.timeEnd("drawBurgIcons");
};

function compositesMarkup(iconsGroup: SVGGElement, composites: Megalopolis[]): string {
  const icon = iconsGroup.dataset.icon || "#icon-circle";
  const size = parseFloat(getComputedStyle(iconsGroup).fontSize) || 2;
  return composites
    .map(m => {
      const cSize = size * COMPOSITE_ICON_SCALE;
      const half = cSize / 2;
      return (
        `<g class="megalopolis-composite" data-cell="${m.cell}" style="display:none">` +
        `<use data-id="${m.anchor.i}" href="${icon}" x="${m.anchor.x}" y="${m.anchor.y}" width="${cSize}" height="${cSize}" transform="translate(${-half + size / 2},${-half + size / 2})"></use>` +
        `<circle data-id="${m.anchor.i}" cx="${m.anchor.x}" cy="${m.anchor.y}" r="${(size * RING_ICON_SCALE) / 2}" fill="none" stroke="#fff" stroke-width="${size * 0.12}"></circle>` +
        `</g>`
      );
    })
    .join("");
}

/**
 * Materialize only the burg icons the viewport can show: anchor inside the (overscanned) bounds
 * and the group past its zoom gate. The gate is the label group's (per-map, user-editable in the
 * labels overview), so a burg's icon and label appear together; groups without a label group
 * (skyburgs, legacy shells) fall back to the tier table. Everything else stays out of the DOM
 * entirely, which is what keeps 100K-burg maps pannable; the removed WebGL layer achieved its
 * speed with exactly this culling, on the GPU.
 */
function renderVisibleIcons(context: ViewportRenderContext): void {
  if (!Layers.isOn("burgIcons")) return;
  const { root, bounds } = context;
  // ViewportLayers.renderTo (save/export clones) passes unbounded bounds: keep every icon there
  const unbounded = bounds.x0 === -Infinity;

  for (const { name } of options.burgs.groups) {
    const iconsGroup = root.querySelector<SVGGElement>(`#burgIcons > g#${CSS.escape(name)}`);
    if (!iconsGroup) continue;

    const minZoom = options.labels.groups.find(group => group.name === name)?.zoom?.min ?? groupMinZoom(name);
    const gatePassed = unbounded || options.labels.showAll || bounds.scale >= minZoom;
    const visible = gatePassed
      ? pack.burgs.filter(
          b =>
            b.group === name &&
            !b.removed &&
            (unbounded || (b.x >= bounds.x0 && b.x <= bounds.x1 && b.y >= bounds.y0 && b.y <= bounds.y1))
        )
      : [];

    const icon = iconsGroup.dataset.icon || "#icon-circle";
    for (const use of iconsGroup.querySelectorAll(":scope > use")) use.remove();
    if (visible.length) {
      iconsGroup.insertAdjacentHTML(
        "afterbegin",
        visible
          .map(
            b =>
              `<use id="burg${b.i}" data-id="${b.i}" href="${icon}" x="${b.x}" y="${b.y}"${megaMemberIds.has(b.i!) ? ' class="megalopolis-member"' : ""}></use>`
          )
          .join("")
      );
    }

    const portGroup = root.querySelector<SVGGElement>(`#anchors > g#${CSS.escape(name)}`);
    if (!portGroup) continue;
    const ports = visible.filter(b => b.port);
    portGroup.innerHTML = ports
      .map(b => `<use id="anchor${b.i}" data-id="${b.i}" href="#icon-anchor" x="${b.x}" y="${b.y}"></use>`)
      .join("");
  }
}

ViewportLayers.register({ id: "fork-burg-icons", render: renderVisibleIcons });

const drawBurgIconRenderer = (burg: Burg): void => {
  const iconGroup = select("#burgIcons").select<SVGGElement>(`#${burg.group}`);
  if (iconGroup.empty()) {
    drawBurgIcons();
    return; // redraw all icons if group is missing
  }

  removeBurgIconRenderer(burg.i!);
  const icon = iconGroup.attr("data-icon") || "#icon-circle";
  select("#burgIcons")
    .select(`#${burg.group}`)
    .append("use")
    .attr("href", icon)
    .attr("id", `burg${burg.i}`)
    .attr("data-id", burg.i!)
    .attr("x", burg.x)
    .attr("y", burg.y);

  if (burg.port) {
    select("#anchors")
      .select(`#${burg.group}`)
      .append("use")
      .attr("href", "#icon-anchor")
      .attr("id", `anchor${burg.i}`)
      .attr("data-id", burg.i!)
      .attr("x", burg.x)
      .attr("y", burg.y);
  }
};

const removeBurgIconRenderer = (burgId: number): void => {
  const existingIcon = document.getElementById(`burg${burgId}`);
  if (existingIcon) existingIcon.remove();

  const existingAnchor = document.getElementById(`anchor${burgId}`);
  if (existingAnchor) existingAnchor.remove();
};

/** drop the icons, keeping the burg groups: they carry the styles edited in the Style editor */
export const removeBurgIcons = (): void => {
  for (const icon of Array.from(document.querySelectorAll("#icons use, #icons circle"))) icon.remove();
};

function createIconGroups(): void {
  // save existing styles and remove all groups
  document.querySelectorAll("g#burgIcons > g").forEach(group => {
    style.burgIcons[group.id] = Array.from(group.attributes).reduce((acc: { [key: string]: string }, attribute) => {
      acc[attribute.name] = attribute.value;
      return acc;
    }, {});
    group.remove();
  });

  document.querySelectorAll("g#anchors > g").forEach(group => {
    style.anchors[group.id] = Array.from(group.attributes).reduce((acc: { [key: string]: string }, attribute) => {
      acc[attribute.name] = attribute.value;
      return acc;
    }, {});
    group.remove();
  });

  // create groups for each burg group and apply stored or default style
  const defaultIconStyle = style.burgIcons.town || Object.values(style.burgIcons)[0] || {};
  const defaultAnchorStyle = style.anchors.town || Object.values(style.anchors)[0] || {};
  const sortedGroups = [...options.burgs.groups].sort((a, b) => a.order - b.order);
  for (const { name } of sortedGroups) {
    const burgGroup = select("#burgIcons").append("g");
    const iconStyles = style.burgIcons[name] || defaultIconStyle;
    Object.entries(iconStyles).forEach(([key, value]) => {
      burgGroup.attr(key, value);
    });
    burgGroup.attr("id", name);

    const anchorGroup = select("#anchors").append("g");
    const anchorStyles = style.anchors[name] || defaultAnchorStyle;
    Object.entries(anchorStyles).forEach(([key, value]) => {
      anchorGroup.attr(key, value);
    });
    anchorGroup.attr("id", name);
  }
}

window.drawBurgIcons = burgIconsRenderer;

export { drawBurgIconRenderer as drawBurgIcon, removeBurgIconRenderer as removeBurgIcon };

// burgs-generator still draws icons directly; it cannot import upwards, so the bridge stays
window.drawBurgIcon = drawBurgIconRenderer;
window.removeBurgIcon = removeBurgIconRenderer;

export { burgIconsRenderer as drawBurgIcons };
