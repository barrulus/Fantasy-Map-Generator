import { getGroupStyle } from "@/renderers/labels/label-groups";
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
  hidden: boolean; // switched off by a layer toggle (see isGroupSwitchedOff) — NOT the zoom gate
  iconDiameter: number; // map-unit diameter of this tier's burg icon (sibling #burgIcons > g#{id})
}

const DEFAULT_FONT_SIZE = 4;
const DEFAULT_ICON_DIAMETER = 1;

/**
 * True when a layer toggle has switched this group shell off (the Skyburgs layer sets it on
 * `#burgIcons`/`#burgLabels > g#skyburg-*`).
 *
 * Deliberately an explicit attribute rather than the shell's `display`: invokeActiveZooming also
 * hides shells via the `.hidden` class as the per-tier ZOOM gate, and the GL renderers do that
 * gating themselves on the GPU (GroupRender.minZoom / LabelBox.minZoom). Reading display here
 * would make a rebuild bake the current zoom's tier culling into the buffers permanently.
 */
export function isGroupSwitchedOff(el: Element): boolean {
  return el.getAttribute("data-layer-off") === "true";
}

/**
 * Read the sibling `#burgIcons > g#{id}` element's computed font-size, which the icon atlas
 * (webgl-burg-atlas.ts) treats as the icon's map-unit diameter. Falls back to a sensible default
 * when the icon group is missing (e.g. in tests that only mount #burgLabels) so label offset math
 * always has a finite input.
 */
function readIconDiameter(id: string, root: ParentNode): number {
  const iconEl = root.querySelector<SVGGElement>(`#burgIcons > g#${id}`);
  if (!iconEl) return DEFAULT_ICON_DIAMETER;
  const size = parseFloat(getComputedStyle(iconEl).fontSize);
  return Number.isFinite(size) && size > 0 ? size : DEFAULT_ICON_DIAMETER;
}

/**
 * Read the authored per-group size.
 *
 * Since v1.140 groups carry a percentage `font-size` ("6%") resolved against the `#labels` parent,
 * which zoom.ts holds at ~100px at scale 1 — so the percentage number is numerically the same
 * authored map-units-per-em that the old `data-size` attribute held, and the tier tables keep
 * working unchanged.
 */
function authoredSizeFromStyle(fontSize: unknown): number {
  const parsed = parseFloat(String(fontSize ?? ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_FONT_SIZE;
}

/**
 * Per-group style for the burg-label renderers.
 *
 * v1.140 made style data (style.labels.groups, via getGroupStyle) rather than something scraped
 * off the DOM, so colours/sizes come from there. The DOM is still consulted for the two things
 * that are not style: the layer-toggle flag written onto the shell, and the sibling icon size.
 */
export function readBurgLabelStyles(root: ParentNode = document): Record<string, GroupStyle> {
  const out: Record<string, GroupStyle> = {};
  const burgGroups = options.labels.groups.filter(group => group.type === "burg");

  // matched by id rather than a selector: group names are user-supplied and need no escaping here
  const shells = new Map<string, SVGGElement>();
  for (const shell of root.querySelectorAll<SVGGElement>("#labels > g")) {
    shells.set(shell.id.replace(/^labels-/, ""), shell);
  }

  for (const group of burgGroups) {
    const name = group.name;
    const groupStyle = getGroupStyle({ name, type: "burg" });
    const shell = shells.get(name);
    const fontSize = authoredSizeFromStyle(groupStyle["font-size"]);
    const factor = authoredSizeFactor(name, fontSize);
    const minZoom = group.zoom?.min;

    out[name] = {
      group: name,
      rank: groupRank(name),
      fontSize,
      minZoom: Number.isFinite(minZoom) ? (minZoom as number) : groupMinZoom(name),
      startPx: groupStartPx(name) * factor,
      restPx: groupRestPx(name) * factor,
      fill: groupStyle.fill || "#3e3e4b",
      halo: groupStyle.stroke || "#ffffff",
      // A stroke width from the preset wins; otherwise fall back to a modest legibility halo
      // (not 0 — no preset sets a stroke on burg-label groups today, so a 0-width default
      // silently disabled the halo entirely, and a small capital label needs it to stay readable
      // painted over a big state name).
      haloWidth: Number(groupStyle["stroke-width"]) || 0.5,
      hidden: shell ? isGroupSwitchedOff(shell) : false,
      iconDiameter: readIconDiameter(name, root)
    };
  }
  return out;
}
