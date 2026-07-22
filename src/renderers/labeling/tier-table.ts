/**
 * Single source of truth for per-tier burg label/icon behaviour.
 *
 * Before this module the min-zoom table existed in three places (public/main.js BURG_MIN_ZOOM,
 * webgl-burg-labels.ts, webgl-burg-icons.ts) which had to be hand-synced. Everything per-tier
 * lives here now; nothing else may declare a tier constant.
 */

/**
 * Collision priority per burg group, lower = placed first = wins overlaps.
 *
 * This must NOT be derived from the label groups' DOM order: that order is SVG *paint* order
 * (least important first, so capitals paint on top), i.e. the exact inverse of priority.
 */
export const GROUP_RANK: Record<string, number> = {
  capital: 0,
  "skyburg-capital": 1,
  city: 2,
  skyburg: 3,
  town: 4,
  "skyburg-mid": 5,
  fort: 6,
  monastery: 7,
  caravanserai: 8,
  trading_post: 9,
  "skyburg-small": 10,
  village: 11,
  hamlet: 12
};
const UNKNOWN_RANK = 99; // unknown/legacy groups rank below every known tier

export function groupRank(group: string): number {
  return GROUP_RANK[group] ?? UNKNOWN_RANK;
}

/**
 * Zoom at which a tier becomes eligible. This is the ONLY mechanism that removes a label for
 * being unimportant — size never culls (see label-sizing.ts).
 */
export const MIN_ZOOM: Record<string, number> = {
  capital: 1,
  "skyburg-capital": 2,
  skyburg: 4,
  "skyburg-mid": 6,
  "skyburg-small": 8,
  city: 4,
  town: 6,
  fort: 7,
  monastery: 7,
  caravanserai: 7,
  trading_post: 7,
  village: 10,
  hamlet: 14
};

// Fallback min-zoom for unknown/legacy groups (e.g. pre-v1.109 maps still carrying `cities`/
// `towns` shells, or a custom group made in the Burg Groups editor). Not 0: with size no longer
// culling, a 0 min-zoom would render these at every zoom level, which is how this bug was found.
// Not the hamlet value either — hamlet (14) assumes a modern, fully-tiered map where the tiniest
// settlements are meant to stay hidden until deep zoom; an unknown group carries no such intent.
// `city` (4) is the closest match to how these groups actually behaved before this branch.
const UNKNOWN_MIN_ZOOM = 4;

export function groupMinZoom(group: string): number {
  return MIN_ZOOM[group] ?? UNKNOWN_MIN_ZOOM;
}

const DEFAULT_FLOOR_PX = 6;
const DEFAULT_CEIL_PX = 56;

/**
 * Legibility floor: a label of this tier is never drawn smaller than this on screen.
 *
 * In practice this only bites for capitals, the one tier whose min-zoom is 1 and which therefore
 * enters at its natural size rather than several times it. That narrow blast radius is deliberate.
 */
export const FLOOR_PX: Record<string, number> = {
  capital: 11,
  "skyburg-capital": 11,
  city: 10,
  skyburg: 10,
  town: 9,
  "skyburg-mid": 9,
  fort: 8,
  monastery: 8,
  caravanserai: 8,
  trading_post: 8,
  "skyburg-small": 8,
  village: 7,
  hamlet: 6
};

export function groupFloorPx(group: string): number {
  return FLOOR_PX[group] ?? DEFAULT_FLOOR_PX;
}

/**
 * Growth ceiling: a label stops growing here rather than being culled. The old GROUP_MAX_PX
 * values (capital 240) were cull thresholds with headroom, not real ceilings, so they are retuned.
 * Each must stay above the tier's natural size at its own min-zoom or the tier is born clamped —
 * see entryPxExceedsCeiling in label-sizing.ts.
 */
export const CEIL_PX: Record<string, number> = {
  capital: 96,
  "skyburg-capital": 96,
  city: 80,
  skyburg: 80,
  town: 72,
  "skyburg-mid": 72,
  fort: 64,
  monastery: 64,
  caravanserai: 64,
  trading_post: 64,
  "skyburg-small": 64,
  village: 64,
  hamlet: 56
};

export function groupCeilPx(group: string): number {
  return CEIL_PX[group] ?? DEFAULT_CEIL_PX;
}
