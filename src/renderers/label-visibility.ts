import type { Rect } from "./labeling/label-collision";
import { effectiveLabelPx, labelIconOffsetPx } from "./labeling/label-sizing";

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
  startPx: number; // screen px at scale 1
  restPx: number; // asymptotic resting screen px as scale grows
  iconDiameter: number; // map-unit diameter of this box's tier's burg icon
}

/**
 * The map-units anchor y a label is actually drawn/collided/hit-tested at: the burg's raw y,
 * lifted above the icon by labelIconOffsetPx converted back to map units (the GL painter works
 * in map units; dividing by scale undoes the shader's `* uScale`). Scale-independent (built once
 * from static burg/style data) inputs stay in buildLabelBoxes; this is the one DRY spot every
 * per-frame consumer (visibility/collision, glyph layout, hit-test) calls with the frame's scale
 * so they all agree on where the label sits.
 */
export function liftedAnchorY(box: LabelBox, scale: number): number {
  if (!(scale > 0)) return box.y;
  return box.y - labelIconOffsetPx(box.iconDiameter, scale) / scale;
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
  rescale?: boolean; // screen-space size curve per tier (the rescaleLabels checkbox); default true
  // Fixed obstacle rects (e.g. surviving state labels) in the SAME screen-space frame as
  // `translate` below — a candidate whose box intersects one is dropped, UNLESS it's a capital
  // (order 0), which is exempt from every obstacle check (and from collision generally — a
  // capital is never hidden). Obstacles are seeded into the collision grid before any candidate
  // is placed, so they always win, and are never evicted.
  obstacles?: readonly Rect[];
  // Screen-space offset (map-space translate, e.g. {x: viewX, y: viewY}) to align this
  // function's internal box coordinates with `obstacles`' coordinate frame. Defaults to {0,0},
  // which keeps prior behaviour (translation-invariant burg-vs-burg collision) when no obstacles
  // are supplied.
  translate?: { x: number; y: number };
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
  const candidates: { b: LabelBox; ay: number; px: number; hwMap: number; hhMap: number }[] = [];
  for (const b of boxes) {
    if (gate && scale < b.minZoom) continue;
    // Anchor lifted above the icon so culling/collision reflect where the label is actually drawn.
    const ay = liftedAnchorY(b, scale);
    // rescale off means constant screen size at the tier's resting size: the label simply stops
    // responding to zoom, which is the sensible reading of "don't rescale" under a screen-space
    // sizing model (the old model's fallback, raw d*scale, was a map-space artifact).
    const px = rescale ? effectiveLabelPx(scale, b.startPx, b.restPx) : b.restPx;
    // extents follow the drawn size, converted back to map units for the viewport test
    const hwMap = (b.halfWEm * px) / scale;
    const hhMap = (b.halfHEm * px) / scale;
    if (b.x + hwMap < vp.x0 || b.x - hwMap > vp.x1) continue;
    if (ay + hhMap < vp.y0 || ay - hhMap > vp.y1) continue;
    candidates.push({ b, ay, px, hwMap, hhMap });
  }

  // 2. priority sort: lower order first, then higher population
  candidates.sort((p, q) => p.b.order - q.b.order || q.b.population - p.b.population);

  // 3. greedy collision in screen space using a spatial hash
  const grid = new Map<string, { l: number; t: number; r: number; bo: number }[]>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const kept: VisibleLabel[] = [];

  const place = (l: number, t: number, r: number, bo: number): void => {
    const cx0 = Math.floor(l / GRID_PX);
    const cy0 = Math.floor(t / GRID_PX);
    const cx1 = Math.floor(r / GRID_PX);
    const cy1 = Math.floor(bo / GRID_PX);
    const placed = { l, t, r, bo };
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const k = key(cx, cy);
        const bucket = grid.get(k);
        if (bucket) bucket.push(placed);
        else grid.set(k, [placed]);
      }
    }
  };

  // Seed obstacles first so they always win: any burg candidate checked below sees them already
  // "placed" in the grid. Obstacles are fixed — they are never evicted and never appear in `kept`.
  if (opts.obstacles) {
    for (const o of opts.obstacles) place(o.left, o.top, o.right, o.bottom);
  }

  const tx = opts.translate?.x ?? 0;
  const ty = opts.translate?.y ?? 0;

  for (const c of candidates) {
    const isCapital = c.b.order === 0; // groupRank(...) === 0 — never hidden, exempt from every check
    const l = (c.b.x - c.hwMap) * scale + tx;
    const t = (c.ay - c.hhMap) * scale + ty;
    const r = (c.b.x + c.hwMap) * scale + tx;
    const bo = (c.ay + c.hhMap) * scale + ty;

    if (!isCapital) {
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
    }

    kept.push({ id: c.b.id, px: c.px });
    place(l, t, r, bo);
  }
  return kept;
}
