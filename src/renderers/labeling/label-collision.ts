export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CollisionBox extends Rect {
  id: string;
  weight: number;
}

/**
 * Axis-aligned rectangle overlap test shared by every collision pass in this module. Touching
 * edges (e.g. one box's `right` equal to another's `left`) do NOT count as a collision — overlap
 * requires strictly positive intersection on both axes.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Greedy, priority-ordered rectangle collision resolution: sort boxes by weight (higher wins),
 * then walk the sorted list keeping placed boxes and dropping any that overlaps one already
 * placed. Pure and fully recomputed on every call — no memory between calls, so a box that lost
 * a contested spot in one call can win it back in the next once its neighbour is gone.
 *
 * Ties in weight are broken by `id` (ascending) so the result is deterministic regardless of the
 * order boxes are passed in.
 */
export function selectNonOverlapping(boxes: CollisionBox[]): Set<string> {
  const sorted = [...boxes].sort((a, b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const placed: CollisionBox[] = [];
  const kept = new Set<string>();

  for (const box of sorted) {
    let collides = false;
    for (const p of placed) {
      if (rectsIntersect(box, p)) {
        collides = true;
        break;
      }
    }
    if (collides) continue;

    kept.add(box.id);
    placed.push(box);
  }

  return kept;
}

/**
 * Drop any box that intersects one or more `obstacles`. Obstacles are fixed — unlike
 * `selectNonOverlapping` there is no priority contest, an intersecting box simply loses. Pure;
 * an empty `obstacles` list keeps every box. Same touching-edges-don't-count convention as
 * `selectNonOverlapping` (via the shared `rectsIntersect`).
 */
export function filterAgainstObstacles<T extends Rect & { id: string }>(
  boxes: T[],
  obstacles: readonly Rect[]
): Set<string> {
  const kept = new Set<string>();
  for (const box of boxes) {
    let blocked = false;
    for (const obstacle of obstacles) {
      if (rectsIntersect(box, obstacle)) {
        blocked = true;
        break;
      }
    }
    if (!blocked) kept.add(box.id);
  }
  return kept;
}

// ---- State-label obstacle store ----
//
// State labels (public/main.js's `#states` branch of invokeActiveZooming) publish their
// SURVIVING (post state-vs-state collision) rects here, in SCREEN coordinates (what
// `getBoundingClientRect` returns). The burg-label renderer reads the store to decide which
// non-capital burg labels to hide. Capitals never consult this store — see tier-table.ts
// `groupRank`.
let stateLabelObstacles: readonly Rect[] = [];

/** Publish the current surviving state-label rects. */
export function setStateLabelObstacles(rects: readonly Rect[]): void {
  stateLabelObstacles = rects;
}

export function getStateLabelObstacles(): readonly Rect[] {
  return stateLabelObstacles;
}

// public/main.js is a classic script and can only reach TS through globals.
if (typeof window !== "undefined") {
  Object.assign(window, {
    selectNonOverlapping,
    filterAgainstObstacles,
    setStateLabelObstacles,
    getStateLabelObstacles
  });
}
