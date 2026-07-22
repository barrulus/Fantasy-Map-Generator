import { groupCeilPx, groupFloorPx, groupMinZoom, groupRank } from "./tier-table";

/**
 * On-screen font size for a label, in CSS px: map-space growth bounded by the tier's legibility
 * floor and growth ceiling.
 *
 * This function NEVER signals "cull". Size used to be a second, tier-blind culling mechanism that
 * overruled min-zoom: a capital with a small preset font died to the 6px band before it ever
 * reached the collision pass it would have won. Min-zoom decides whether a label shows; this
 * decides only how big it is.
 */
export function effectiveLabelPx(d: number, scale: number, floorPx: number, ceilPx: number): number {
  const natural = d * scale;
  if (!(natural > floorPx)) return floorPx; // also catches NaN
  if (natural > ceilPx) return ceilPx;
  return natural;
}

export function effectiveLabelPxForGroup(group: string, d: number, scale: number): number {
  return effectiveLabelPx(d, scale, groupFloorPx(group), groupCeilPx(group));
}

/**
 * The `font-size` attribute that renders at `px` on screen. SVG <text> sits inside the
 * zoom-transformed #viewbox, so rendered size is attribute * scale.
 */
export function svgLabelFontSize(px: number, scale: number): number {
  return scale > 0 ? px / scale : px;
}

/**
 * True when a tier's ceiling is below its natural size at its own min-zoom, i.e. the tier is born
 * already clamped and never scales at all. Preset-dependent, so it is a runtime check rather than
 * a static guarantee.
 */
export function entryPxExceedsCeiling(group: string, d: number): boolean {
  return d * groupMinZoom(group) > groupCeilPx(group);
}

// public/main.js is a classic script and can only reach TS through globals.
if (typeof window !== "undefined") {
  Object.assign(window, {
    effectiveLabelPx,
    svgLabelFontSize,
    labelTiers: { groupRank, groupMinZoom, groupFloorPx, groupCeilPx }
  });
}
