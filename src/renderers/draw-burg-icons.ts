import { select } from "d3";
import type { Burg } from "../generators/burgs-generator";
import { COMPOSITE_ICON_SCALE, findMegalopolises, RING_ICON_SCALE } from "../generators/megalopolis";

declare global {
  var drawBurgIcons: () => void;
}

const burgIconsRenderer = (): void => {
  TIME && console.time("drawBurgIcons");
  createIconGroups();

  // WebGL path: the styled <g> groups exist (the atlas bakes them); skip populating
  // ~80K <use> nodes and render the icons on the GPU canvas instead.
  if ((window as { burgWebglActive?: () => boolean }).burgWebglActive?.()) {
    void (window as { rebuildBurgGL?: () => Promise<void> }).rebuildBurgGL?.();
    TIME && console.timeEnd("drawBurgIcons");
    return;
  }

  const megas = findMegalopolises(pack.burgs, pack.cells.burg);
  const megaIds = new Set<number>();
  for (const m of megas.values()) for (const b of m.members) megaIds.add(b.i);

  for (const { name } of options.burgs.groups) {
    const burgsInGroup = pack.burgs.filter(b => b.group === name && !b.removed);
    if (!burgsInGroup.length) continue;

    const iconsGroup = document.querySelector<SVGGElement>(`#burgIcons > g#${name}`);
    if (!iconsGroup) continue;

    const icon = iconsGroup.dataset.icon || "#icon-circle";
    iconsGroup.innerHTML = burgsInGroup
      .map(
        b =>
          `<use id="burg${b.i}" data-id="${b.i}" href="${icon}" x="${b.x}" y="${b.y}"${megaIds.has(b.i) ? ' class="megalopolis-member"' : ""}></use>`
      )
      .join("");

    // Composite icons (enlarged anchor + ring) for megalopolises anchored in this
    // group; the invokeActiveZooming hook swaps them with member icons by zoom.
    const composites = [...megas.values()].filter(m => m.anchor.group === name);
    if (composites.length) {
      const size = parseFloat(getComputedStyle(iconsGroup).fontSize) || 2;
      iconsGroup.innerHTML += composites
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

    const portsInGroup = burgsInGroup.filter(b => b.port);
    if (!portsInGroup.length) continue;

    const portGroup = document.querySelector<SVGGElement>(`#anchors > g#${name}`);
    if (!portGroup) continue;

    portGroup.innerHTML = portsInGroup
      .map(b => `<use id="anchor${b.i}" data-id="${b.i}" href="#icon-anchor" x="${b.x}" y="${b.y}"></use>`)
      .join("");
  }

  TIME && console.timeEnd("drawBurgIcons");
};

const drawBurgIconRenderer = (burg: Burg): void => {
  if ((window as { burgWebglActive?: () => boolean }).burgWebglActive?.()) {
    (window as { scheduleRebuildBurgGL?: () => void }).scheduleRebuildBurgGL?.();
    return;
  }

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
  if ((window as { burgWebglActive?: () => boolean }).burgWebglActive?.()) {
    (window as { scheduleRebuildBurgGL?: () => void }).scheduleRebuildBurgGL?.();
    return;
  }

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
