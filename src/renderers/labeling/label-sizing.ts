import { groupMaxZoom, groupMinZoom, groupRank, groupReferenceD, groupRestPx, groupStartPx } from "./tier-table";

export { groupReferenceD, groupRestPx } from "./tier-table";

const FACTOR_MIN = 0.75;
const FACTOR_MAX = 1.5;

// Smallest fraction an individual state label's authored size can be clamped to, relative to the
// `#states` group base — see draw-state-labels.ts's `minmax(rn(ratio * ...), 50, 130)` clamp
// (currently 50-130%). If that clamp's lower bound ever changes, this must change with it, or
// stateBasePxFloor below stops guaranteeing states render bigger than capitals.
const MIN_TERRITORY_RATIO = 0.5;

// Extra headroom above the break-even point so a floored state renders visibly, not merely
// technically, larger than a capital.
const STATE_FLOOR_MARGIN = 1.05;

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

/**
 * Smallest states-group base (CSS px) that keeps even a minimum-territory-ratio state above a
 * capital label, at the given live `capitalPx`.
 *
 * The tier-table.ts START_PX/REST_PX.states constants are tuned so this holds for the *default*
 * authored sizes — but authoredSizeFactor (above) can independently scale a map's states-shell
 * size down (to FACTOR_MIN) while scaling its capital shell up (to FACTOR_MAX), a swing no
 * constant tuning survives. Callers (public/main.js's invokeActiveZooming) use this to enforce
 * the relationship at runtime instead of trusting the constants alone.
 */
export function stateBasePxFloor(capitalPx: number): number {
  if (!Number.isFinite(capitalPx) || capitalPx <= 0) return 0;
  return (capitalPx / MIN_TERRITORY_RATIO) * STATE_FLOOR_MARGIN;
}

// public/main.js is a classic script and can only reach TS through globals.
if (typeof window !== "undefined") {
  Object.assign(window, {
    effectiveLabelPx,
    labelPxForGroup,
    svgLabelFontSize,
    groupRestPx,
    stateBasePxFloor,
    labelTiers: { groupRank, groupMinZoom, groupMaxZoom, groupReferenceD }
  });
}
