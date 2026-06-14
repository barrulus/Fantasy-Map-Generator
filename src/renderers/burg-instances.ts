import { type Quadtree, quadtree } from "d3-quadtree";
import type { Burg } from "../modules/burgs-generator";

export interface GroupRender {
  tileIndex: number; // atlas tile for this group's baked symbol
  size: number; // rendered icon diameter in map units (group font-size)
  minZoom: number; // BURG_MIN_ZOOM for this group (GPU cull threshold)
}

export const INSTANCE_STRIDE = 5; // x, y, size, tileIndex, minZoom

export function buildBurgInstances(
  burgs: Burg[],
  groups: Record<string, GroupRender>,
  fallback: GroupRender = { tileIndex: 0, size: 2, minZoom: 0 }
): { data: Float32Array; count: number; ids: number[] } {
  const data = new Float32Array(burgs.length * INSTANCE_STRIDE);
  const ids: number[] = [];
  let n = 0;
  for (const b of burgs) {
    if (!b || !b.i || b.removed) continue; // skip index-0 placeholder + removed
    const g = groups[b.group as string] || fallback;
    const o = n * INSTANCE_STRIDE;
    data[o] = b.x!;
    data[o + 1] = b.y!;
    data[o + 2] = g.size;
    data[o + 3] = g.tileIndex;
    data[o + 4] = g.minZoom;
    ids.push(b.i);
    n++;
  }
  return { data: data.subarray(0, n * INSTANCE_STRIDE), count: n, ids };
}

export type BurgQuadtree = Quadtree<Burg>;

export function buildBurgQuadtree(burgs: Burg[]): BurgQuadtree {
  return quadtree<Burg>()
    .x(b => b.x!)
    .y(b => b.y!)
    .addAll(burgs.filter(b => b && b.i && !b.removed));
}

// hitX/hitY in MAP coords; tolerance = max(icon radius in map units, a min screen-px radius / scale)
export function hitTestBurg(
  qt: BurgQuadtree,
  hitX: number,
  hitY: number,
  scale: number,
  sizeByGroup: Record<string, number>
): number | null {
  const minScreenPx = 6; // always allow a ~6px tap target
  const found = qt.find(hitX, hitY);
  if (!found || found.i == null) return null;
  const rMap = Math.max((sizeByGroup[found.group as string] || 2) / 2, minScreenPx / Math.max(scale, 0.0001));
  const dx = found.x! - hitX;
  const dy = found.y! - hitY;
  return dx * dx + dy * dy <= rMap * rMap ? found.i : null;
}
