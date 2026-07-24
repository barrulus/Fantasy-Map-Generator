import { groupMaxZoom, groupMinZoom, groupRank, groupReferenceD, groupRestPx, groupStartPx } from "./tier-table";

export { groupReferenceD, groupRestPx } from "./tier-table";

const FACTOR_MIN = 0.75;
const FACTOR_MAX = 1.5;

/**
 * On-screen font size for a label, in CSS px: screen-space size that starts at `startPx` at
 * scale 1 and decays asymptotically toward `restPx` as scale grows, bounded by construction
 * (always between restPx and startPx for scale >= 1) — no floor/ceiling clamp needed.
 *
 * This is the opposite of the old map-space model, where size grew with zoom. Zoomed out, a
 * capital may be the only label on screen and should dominate; zoomed in, labels should settle
 * to a comfortable resting size rather than ballooning as more labels enter the screen.
 *
 * This function NEVER signals "cull" — it always returns a positive size. min-zoom is the only
 * tier gate; this decides only how big a shown label is.
 */
export function effectiveLabelPx(scale: number, startPx: number, restPx: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) return startPx;
  return restPx + (startPx - restPx) / scale;
}

/**
 * Authored size (`data-size`, map units per em) turned into a multiplier on a tier's START_PX/
 * REST_PX, normalised against the tier's reference size and clamped so a stray preset value
 * can't make labels illegible or enormous. Absent/non-finite `d` is treated as the reference,
 * i.e. factor 1.
 */
export function authoredSizeFactor(group: string, d: number): number {
  if (!Number.isFinite(d)) return 1;
  const ref = groupReferenceD(group);
  if (!(ref > 0)) return 1;
  const raw = d / ref;
  return Math.min(FACTOR_MAX, Math.max(FACTOR_MIN, raw));
}

/** Composes the authored-size factor with the screen-space curve for one burg tier. */
export function labelPxForGroup(group: string, d: number, scale: number): number {
  const factor = authoredSizeFactor(group, d);
  return effectiveLabelPx(scale, groupStartPx(group) * factor, groupRestPx(group) * factor);
}

/**
 * The `font-size` attribute that renders at `px` on screen. SVG <text> sits inside the
 * zoom-transformed #viewbox, so rendered size is attribute * scale.
 */
export function svgLabelFontSize(px: number, scale: number): number {
  return scale > 0 ? px / scale : px;
}

// public/main.js is a classic script and can only reach TS through globals.
if (typeof window !== "undefined") {
  Object.assign(window, {
    effectiveLabelPx,
    labelPxForGroup,
    svgLabelFontSize,
    groupRestPx,
    labelTiers: { groupRank, groupMinZoom, groupMaxZoom, groupReferenceD }
  });
}
