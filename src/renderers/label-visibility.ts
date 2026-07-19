export interface LabelBox {
  id: number;
  x: number;
  y: number; // anchor (map units), already includes any drag override
  order: number; // group priority (lower = higher priority)
  population: number; // tiebreak (higher = higher priority)
  halfW: number;
  halfH: number; // half-extents in map units
  minZoom: number;
  fontSize: number; // map units per em
  maxPx?: number; // per-group on-screen ceiling; defaults to MAX_PX
}

export interface MapViewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN_PX = 6; // on-screen size band (matches today's invokeActiveZooming)
const MAX_PX = 60;
const GRID_PX = 64; // collision spatial-hash cell, screen px

/**
 * Collision priority per burg group, lower = placed first = wins overlaps.
 *
 * This must NOT be derived from the label groups' DOM order: that order is SVG *paint* order
 * (least important first, so capitals paint on top), i.e. the exact inverse of priority. Using
 * it directly let hamlets outrank capitals and monopolise the screen wherever both were eligible.
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
 * Per-group on-screen ceiling. The flat MAX_PX exists to stop labels ballooning as you zoom in,
 * but applying one ceiling to every tier meant the *important* labels died first: on a large map
 * capitals/cities/towns all exceeded 60px well before the small tiers did, so zooming in swapped
 * tiers out instead of accumulating them. Important tiers get proportionally more headroom.
 */
export const GROUP_MAX_PX: Record<string, number> = {
  capital: 240,
  "skyburg-capital": 240,
  city: 180,
  skyburg: 180,
  town: 140,
  "skyburg-mid": 140
};

export function groupMaxPx(group: string): number {
  return GROUP_MAX_PX[group] ?? MAX_PX;
}

/**
 * Per-frame visibility: cull by min-zoom + on-screen size band + viewport, sort by priority,
 * then greedy collision-place in screen space. Returns surviving label ids. Pure.
 */
export function selectVisibleLabels(boxes: LabelBox[], scale: number, vp: MapViewport): number[] {
  // 1. cull
  const candidates = boxes.filter(b => {
    if (scale < b.minZoom) return false;
    const px = b.fontSize * scale;
    if (px < MIN_PX || px > (b.maxPx ?? MAX_PX)) return false;
    if (b.x + b.halfW < vp.x0 || b.x - b.halfW > vp.x1) return false;
    if (b.y + b.halfH < vp.y0 || b.y - b.halfH > vp.y1) return false;
    return true;
  });

  // 2. priority sort: lower order first, then higher population
  candidates.sort((a, b) => a.order - b.order || b.population - a.population);

  // 3. greedy collision in screen space using a spatial hash
  const grid = new Map<string, { l: number; t: number; r: number; bo: number }[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const kept: number[] = [];

  for (const b of candidates) {
    const l = (b.x - b.halfW) * scale;
    const t = (b.y - b.halfH) * scale;
    const r = (b.x + b.halfW) * scale;
    const bo = (b.y + b.halfH) * scale;
    const cx0 = Math.floor(l / GRID_PX);
    const cy0 = Math.floor(t / GRID_PX);
    const cx1 = Math.floor(r / GRID_PX);
    const cy1 = Math.floor(bo / GRID_PX);

    let collides = false;
    outer: for (let cx = cx0; cx <= cx1 && !collides; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = grid.get(key(cx, cy));
        if (!bucket) continue;
        for (const p of bucket) {
          if (l < p.r && r > p.l && t < p.bo && bo > p.t) {
            collides = true;
            break outer;
          }
        }
      }
    }
    if (collides) continue;

    kept.push(b.id);
    const placed = { l, t, r, bo };
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(placed);
        else grid.set(k, [placed]);
      }
    }
  }
  return kept;
}
