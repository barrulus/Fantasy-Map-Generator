import { authoredSizeFactor } from "./label-sizing";
import { groupMinZoom, groupRank, groupRestPx, groupStartPx } from "./tier-table";

export interface GroupStyle {
  group: string;
  rank: number; // collision priority, lower wins
  fontSize: number; // d — authored map units per em
  minZoom: number; // tier gate, incl. any data-min-zoom override
  startPx: number; // screen px at scale 1, already multiplied by the authored-size factor
  restPx: number; // asymptotic resting screen px, already multiplied by the authored-size factor
  fill: string;
  halo: string;
  haloWidth: number;
  hidden: boolean; // display:none — read here, consumed by the GL painter in phase 3
}

const DEFAULT_FONT_SIZE = 4;

/**
 * Read the authored per-group size.
 *
 * Order matters: `data-size` is what the user styled, while the `font-size` attribute is
 * overwritten on every zoom whenever rescaleLabels is on, so it holds the *current* size rather
 * than the authored one. Reading font-size first would make the size drift with the zoom level.
 */
function readAuthoredSize(el: SVGGElement): number {
  const data = parseFloat(el.getAttribute("data-size") || "");
  if (Number.isFinite(data) && data > 0) return data;
  const attr = parseFloat(el.getAttribute("font-size") || "");
  if (Number.isFinite(attr) && attr > 0) return attr;
  const computed = parseFloat(getComputedStyle(el).fontSize || "");
  return Number.isFinite(computed) && computed > 0 ? computed : DEFAULT_FONT_SIZE;
}

/**
 * Read the live #burgLabels group shells into per-group style. The shells stay the style carrier
 * for both renderers, so this is the one place that turns DOM into a decision input.
 */
export function readBurgLabelStyles(root: ParentNode = document): Record<string, GroupStyle> {
  const out: Record<string, GroupStyle> = {};
  const shells = Array.from(root.querySelectorAll<SVGGElement>("#burgLabels > g"));
  for (const el of shells) {
    const stroke = el.getAttribute("stroke");
    const override = parseFloat(el.getAttribute("data-min-zoom") || "");
    const fontSize = readAuthoredSize(el);
    const factor = authoredSizeFactor(el.id, fontSize);
    out[el.id] = {
      group: el.id,
      rank: groupRank(el.id),
      fontSize,
      minZoom: Number.isFinite(override) ? override : groupMinZoom(el.id),
      startPx: groupStartPx(el.id) * factor,
      restPx: groupRestPx(el.id) * factor,
      fill: el.getAttribute("fill") || "#3e3e4b",
      halo: stroke || "#ffffff",
      // only halo when the group actually has a stroke; 0 width disables the halo ring in the shader
      haloWidth: stroke ? +(el.getAttribute("stroke-width") || 0.5) : 0,
      hidden: (el.getAttribute("style") || "").includes("display:none") || getComputedStyle(el).display === "none"
    };
  }
  return out;
}
