import { select } from "d3";
import type { Burg } from "../generators/burgs-generator";

declare global {
  var drawBurgLabels: () => void;
  var drawBurgLabel: (burg: Burg) => void;
  var removeBurgLabel: (burgId: number) => void;
  var migrateLabelOverrides: () => void;
}

interface BurgGroup {
  name: string;
  order: number;
}

const burgLabelsRenderer = (): void => {
  TIME && console.time("drawBurgLabels");
  createLabelGroups();

  // When the GPU label layer is active it owns burg-name rendering; build only the styled group
  // shells (createLabelGroups above) and skip emitting ~67K <text> nodes. Trigger a GPU rebuild.
  if ((window as any).burgLabelsWebglActive?.()) {
    (window as any).scheduleRebuildBurgLabelGL?.();
    TIME && console.timeEnd("drawBurgLabels");
    return;
  }

  for (const { name } of options.burgs.groups as BurgGroup[]) {
    const burgsInGroup = pack.burgs.filter(b => b.group === name && !b.removed);
    if (!burgsInGroup.length) continue;

    const labelGroup = select("#burgLabels").select<SVGGElement>(`#${name}`);
    if (labelGroup.empty()) continue;

    const dx = labelGroup.attr("data-dx") || 0;
    // Vertical offset is owned entirely by invokeActiveZooming's icon-clearance lift (see
    // public/main.js's #burgLabels branch, which applies a per-tier `translate(0 -offsetMap)`
    // recomputed every frame from the icon's on-screen radius). A per-text data-dy em here would
    // stack with that group transform and either over-lift or, at some zooms, put the label back
    // on top of the icon, so burg labels always draw with dy=0.

    labelGroup
      .selectAll("text")
      .data(burgsInGroup)
      .enter()
      .append("text")
      .attr("text-rendering", "optimizeSpeed")
      .attr("id", d => `burgLabel${d.i}`)
      .attr("data-id", d => d.i!)
      .attr("x", d => d.x)
      .attr("y", d => d.y)
      .attr("dx", `${dx}em`)
      .attr("dy", "0em")
      .text(d => d.name!);
  }

  TIME && console.timeEnd("drawBurgLabels");
};

const drawBurgLabelRenderer = (burg: Burg): void => {
  if ((window as any).burgLabelsWebglActive?.()) {
    (window as any).scheduleRebuildBurgLabelGL?.();
    return;
  }
  const labelGroup = select("#burgLabels").select<SVGGElement>(`#${burg.group}`);
  if (labelGroup.empty()) {
    drawBurgLabels();
    return; // redraw all labels if group is missing
  }

  const dx = labelGroup.attr("data-dx") || 0;
  // See burgLabelsRenderer above: vertical offset is owned by invokeActiveZooming's icon-clearance
  // group transform, so dy stays 0 here to avoid double-applying it.

  removeBurgLabelRenderer(burg.i!);
  labelGroup
    .append("text")
    .attr("text-rendering", "optimizeSpeed")
    .attr("id", `burgLabel${burg.i}`)
    .attr("data-id", burg.i!)
    .attr("x", burg.x)
    .attr("y", burg.y)
    .attr("dx", `${dx}em`)
    .attr("dy", "0em")
    .text(burg.name!);
};

const removeBurgLabelRenderer = (burgId: number): void => {
  if ((window as any).burgLabelsWebglActive?.()) {
    (window as any).scheduleRebuildBurgLabelGL?.();
    return;
  }
  const existingLabel = document.getElementById(`burgLabel${burgId}`);
  if (existingLabel) existingLabel.remove();
};

function createLabelGroups(): void {
  // save existing styles and remove all groups
  document.querySelectorAll("g#burgLabels > g").forEach(group => {
    style.burgLabels[group.id] = Array.from(group.attributes).reduce((acc: { [key: string]: string }, attribute) => {
      acc[attribute.name] = attribute.value;
      return acc;
    }, {});
    group.remove();
  });

  // create groups for each burg group and apply stored or default style
  const defaultStyle = style.burgLabels.town || Object.values(style.burgLabels)[0] || {};
  const sortedGroups = [...options.burgs.groups].sort((a, b) => a.order - b.order);
  for (const { name } of sortedGroups) {
    const group = select("#burgLabels").append("g");
    const styles = style.burgLabels[name] || defaultStyle;
    Object.entries(styles).forEach(([key, value]) => {
      group.attr(key, value);
    });
    group.attr("id", name);
  }
}

/**
 * Convert legacy SVG-baked label positions to burg.labelDx/labelDy before the GPU layer
 * discards the <text> nodes. Handles both relocate-style (moved x/y) and fine-tune-drag
 * (transform translate) overrides. A net offset > epsilon from the burg anchor is preserved.
 */
function migrateLabelOverrides(): void {
  const EPS = 0.5;
  const nodes = document.querySelectorAll<SVGTextElement>("#burgLabels text[data-id]");
  for (const node of nodes) {
    const id = +node.getAttribute("data-id")!;
    const burg = pack.burgs[id];
    if (!burg) continue;
    const x = parseFloat(node.getAttribute("x") || "");
    const y = parseFloat(node.getAttribute("y") || "");
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    let tx = 0;
    let ty = 0;
    const tr = /translate\(\s*([-\d.]+)[ ,]+([-\d.]+)/.exec(node.getAttribute("transform") || "");
    if (tr) {
      tx = +tr[1];
      ty = +tr[2];
    }
    const dx = x + tx - burg.x;
    const dy = y + ty - burg.y;
    if (Math.abs(dx) > EPS || Math.abs(dy) > EPS) {
      burg.labelDx = Math.round(dx * 100) / 100;
      burg.labelDy = Math.round(dy * 100) / 100;
    }
  }
}
window.migrateLabelOverrides = migrateLabelOverrides;

window.drawBurgLabels = burgLabelsRenderer;
window.drawBurgLabel = drawBurgLabelRenderer;
window.removeBurgLabel = removeBurgLabelRenderer;
