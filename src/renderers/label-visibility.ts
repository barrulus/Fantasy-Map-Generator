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
 * Per-frame visibility: cull by min-zoom + on-screen size band + viewport, sort by priority,
 * then greedy collision-place in screen space. Returns surviving label ids. Pure.
 */
export function selectVisibleLabels(boxes: LabelBox[], scale: number, vp: MapViewport): number[] {
  // 1. cull
  const candidates = boxes.filter(b => {
    if (scale < b.minZoom) return false;
    const px = b.fontSize * scale;
    if (px < MIN_PX || px > MAX_PX) return false;
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
