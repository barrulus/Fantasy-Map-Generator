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
  return GROUP_RANK[resolveGroup(group)] ?? UNKNOWN_RANK;
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
  return MIN_ZOOM[resolveGroup(group)] ?? UNKNOWN_MIN_ZOOM;
}

/**
 * Zoom beyond which a tier is hidden, the counterpart to MIN_ZOOM. Only `states` uses this today:
 * state labels are tuned to stop shrinking (see REST_PX.states) rather than asymptote to
 * illegibility, so they need an explicit upper gate instead. This is a ZOOM gate like MIN_ZOOM,
 * not a size cull — see the "size never culls" note on label-sizing.ts.
 */
export const MAX_ZOOM: Record<string, number> = {
  states: 10
};

export function groupMaxZoom(group: string): number {
  return MAX_ZOOM[resolveGroup(group)] ?? Infinity;
}

const DEFAULT_START_PX = 16;
const DEFAULT_REST_PX = 13;
const DEFAULT_REFERENCE_D = 3.32;

// Legacy burg group aliases: pre-v1.109 maps carry burg groups named `cities`/`towns` that were
// never migrated to the modern `capital`/`city`/`town` ids by the v1.109 migration. Without this
// alias they'd fall through to the generic unknown-group defaults (rank/min-zoom/size), which
// looks broken (e.g. capitals rendering as plain circles). This alias only stops that visual
// regression — the real fix for an affected map is the Burg Groups editor's Restore -> Apply
// migration, which remaps the burgs to the modern group ids properly.
const LEGACY_GROUP_ALIAS: Record<string, string> = {
  cities: "city",
  towns: "town"
};

function resolveGroup(group: string): string {
  return LEGACY_GROUP_ALIAS[group] ?? group;
}

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
  // States dwarf burgs: the owner wants a large state name and a small capital under it, with a
  // huge ratio between them (vanilla FMG behaviour). States sit far above the whole burg band;
  // the burg tiers are compressed into a tight, still-legible 11-14px range so that even the
  // capital (the biggest burg) is nowhere near the size of a state label.
  states: 52,
  capital: 14,
  "skyburg-capital": 14,
  city: 13,
  skyburg: 13,
  town: 12.5,
  "skyburg-mid": 12.5,
  fort: 12,
  monastery: 12,
  caravanserai: 12,
  trading_post: 12,
  "skyburg-small": 12,
  village: 11.5,
  hamlet: 11.4
};

export function groupStartPx(group: string): number {
  return START_PX[resolveGroup(group)] ?? DEFAULT_START_PX;
}

/**
 * Asymptotic resting size (CSS px) the label decays toward as scale grows. Labels shrink toward
 * this rather than growing without bound as you zoom in, so deep zoom doesn't balloon labels just
 * as more of them enter the screen.
 */
export const REST_PX: Record<string, number> = {
  // Barely decays from START_PX (44): states must stop shrinking rather than asymptote toward
  // burg-label sizes, and even a state territory clamped to the minimum 50% ratio (see
  // draw-state-labels.ts) must still render bigger than the largest burg tier (capital) across the
  // WHOLE curve, not just at rest — the failure case is at scale 1 (START_PX), not just at rest.
  // Invariant asserted in tier-table.test.ts across scales 1, 1.5, 2, 5, 10, 20. This constant
  // alone still isn't sufficient when authoredSizeFactor skews states/capitals apart at runtime —
  // see stateBasePxFloor in label-sizing.ts for the runtime enforcement.
  states: 40,
  capital: 12,
  "skyburg-capital": 12,
  city: 11.6,
  skyburg: 11.6,
  town: 11.4,
  "skyburg-mid": 11.4,
  fort: 11.3,
  monastery: 11.3,
  caravanserai: 11.3,
  trading_post: 11.3,
  "skyburg-small": 11.3,
  village: 11.1,
  hamlet: 11
};

export function groupRestPx(group: string): number {
  return REST_PX[resolveGroup(group)] ?? DEFAULT_REST_PX;
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
  return REFERENCE_D[resolveGroup(group)] ?? DEFAULT_REFERENCE_D;
}
