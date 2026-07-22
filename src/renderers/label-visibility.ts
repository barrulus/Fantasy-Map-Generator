import { effectiveLabelPx } from "./labeling/label-sizing";

export interface LabelBox {
  id: number;
  x: number;
  y: number; // anchor (map units), already includes any drag override
  order: number; // group priority (lower = higher priority)
  population: number; // tiebreak (higher = higher priority)
  halfWEm: number;
  halfHEm: number; // half-extents in em, so they track the size actually drawn
  d: number; // authored map units per em
  minZoom: number;
  floorPx: number;
  ceilPx: number;
}

export interface MapViewport {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface VisibleLabel {
  id: number;
  px: number; // on-screen size the painter must draw at
}

export interface VisibilityOptions {
  hideLabels?: boolean; // apply min-zoom tier gating (the hideLabels checkbox)
  rescale?: boolean; // clamp size per tier (the rescaleLabels checkbox); default true
}

const GRID_PX = 64; // collision spatial-hash cell, screen px

/**
 * Per-frame visibility: gate on min-zoom, size every survivor, cull to the viewport, sort by
 * priority, then greedy collision-place in screen space. Returns survivors with their size. Pure.
 *
 * Size does NOT cull. It used to (`px < 6 -> drop`), which silently overruled the tier system:
 * a capital with a small preset font was dropped before it reached the collision pass it would
 * have won, while hamlets with larger fonts rendered. min-zoom is now the only tier gate.
 */
export function selectVisibleLabels(
  boxes: LabelBox[],
  scale: number,
  vp: MapViewport,
  opts: VisibilityOptions = {}
): VisibleLabel[] {
  const gate = opts.hideLabels !== false;
  const rescale = opts.rescale !== false;

  // 1. gate + size + viewport cull
  const candidates: { b: LabelBox; px: number; hwMap: number; hhMap: number }[] = [];
  for (const b of boxes) {
    if (gate && scale < b.minZoom) continue;
    const px = rescale ? effectiveLabelPx(b.d, scale, b.floorPx, b.ceilPx) : b.d * scale;
    // extents follow the drawn size, converted back to map units for the viewport test
    const hwMap = (b.halfWEm * px) / scale;
    const hhMap = (b.halfHEm * px) / scale;
    if (b.x + hwMap < vp.x0 || b.x - hwMap > vp.x1) continue;
    if (b.y + hhMap < vp.y0 || b.y - hhMap > vp.y1) continue;
    candidates.push({ b, px, hwMap, hhMap });
  }

  // 2. priority sort: lower order first, then higher population
  candidates.sort((p, q) => p.b.order - q.b.order || q.b.population - p.b.population);

  // 3. greedy collision in screen space using a spatial hash
  const grid = new Map<string, { l: number; t: number; r: number; bo: number }[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const kept: VisibleLabel[] = [];

  for (const c of candidates) {
    const l = (c.b.x - c.hwMap) * scale;
    const t = (c.b.y - c.hhMap) * scale;
    const r = (c.b.x + c.hwMap) * scale;
    const bo = (c.b.y + c.hhMap) * scale;
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

    kept.push({ id: c.b.id, px: c.px });
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
