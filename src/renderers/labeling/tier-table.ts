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

const DEFAULT_START_PX = 17;
const DEFAULT_REST_PX = 11;
const DEFAULT_REFERENCE_D = 3.32;

/**
 * On-screen size (CSS px) at scale 1, before the curve decays toward REST_PX. Bigger tiers start
 * bigger so that when zoomed all the way out — where a capital may be the only label on screen —
 * it dominates instead of sitting at a tiny floor.
 *
 * `states` is on this same screen-space curve: it is the base font-size for the `#labels > g#states`
 * group, against which each individual state label's authored `${ratio}%` (50-130%, see
 * draw-state-labels.ts) resolves.
 */
export const START_PX: Record<string, number> = {
  states: 28,
  capital: 18,
  "skyburg-capital": 18,
  city: 16,
  skyburg: 16,
  town: 15,
  "skyburg-mid": 15,
  fort: 14,
  monastery: 14,
  caravanserai: 14,
  trading_post: 14,
  "skyburg-small": 14,
  village: 13.5,
  hamlet: 13
};

export function groupStartPx(group: string): number {
  return START_PX[group] ?? DEFAULT_START_PX;
}

/**
 * Asymptotic resting size (CSS px) the label decays toward as scale grows. Labels shrink toward
 * this rather than growing without bound as you zoom in, so deep zoom doesn't balloon labels just
 * as more of them enter the screen.
 */
export const REST_PX: Record<string, number> = {
  states: 21,
  capital: 13,
  "skyburg-capital": 13,
  city: 12.4,
  skyburg: 12.4,
  town: 11.9,
  "skyburg-mid": 11.9,
  fort: 11.5,
  monastery: 11.5,
  caravanserai: 11.5,
  trading_post: 11.5,
  "skyburg-small": 11.5,
  village: 11.2,
  hamlet: 11
};

export function groupRestPx(group: string): number {
  return REST_PX[group] ?? DEFAULT_REST_PX;
}

/**
 * Reference authored size (map units per em) each tier's START_PX/REST_PX were tuned against.
 * `authoredSizeFactor` in label-sizing.ts divides the live authored `data-size` by this to derive
 * a multiplier, so a preset's size control still does something without needing to know about the
 * screen-space curve.
 */
export const REFERENCE_D: Record<string, number> = {
  states: 22,
  capital: 4.98,
  "skyburg-capital": 4.98,
  city: 4.15,
  skyburg: 4.15,
  town: 3.32,
  "skyburg-mid": 3.32,
  fort: 3.32,
  monastery: 3.32,
  caravanserai: 3.32,
  trading_post: 3.32,
  "skyburg-small": 2.49,
  village: 2.49,
  hamlet: 1.66
};

export function groupReferenceD(group: string): number {
  return REFERENCE_D[group] ?? DEFAULT_REFERENCE_D;
}
