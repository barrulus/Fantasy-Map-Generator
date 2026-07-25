import { type Quadtree, quadtree } from "d3-quadtree";
import type { Burg } from "../generators/burgs-generator";
import { COMPOSITE_ICON_SCALE, type Megalopolis, RING_ICON_SCALE } from "../generators/megalopolis";

export interface GroupRender {
  tileIndex: number; // atlas tile for this group's baked symbol
  size: number; // rendered icon diameter in map units (group font-size)
  minZoom: number; // groupMinZoom() from the shared tier table (src/renderers/labeling/tier-table.ts) — GPU cull threshold
}

export const INSTANCE_STRIDE = 5; // x, y, size, tileIndex, minZoom

export interface CompositeInstanceSpec {
  x: number;
  y: number;
  size: number;
  tileIndex: number;
  anchorId: number;
}

export function buildBurgInstances(
  burgs: Burg[],
  groups: Record<string, GroupRender>,
  fallback: GroupRender = { tileIndex: 0, size: 2, minZoom: 0 },
  opts?: { suppress?: Set<number>; composites?: CompositeInstanceSpec[] }
): { data: Float32Array; count: number; ids: number[] } {
  const extra = opts?.composites?.length || 0;
  const data = new Float32Array((burgs.length + extra) * INSTANCE_STRIDE);
  const ids: number[] = [];
  let n = 0;
  for (const b of burgs) {
    if (!b || !b.i || b.removed) continue; // skip index-0 placeholder + removed
    if (opts?.suppress?.has(b.i)) continue; // megalopolis members hidden in composite mode
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
  for (const c of opts?.composites ?? []) {
    const o = n * INSTANCE_STRIDE;
    data[o] = c.x;
    data[o + 1] = c.y;
    data[o + 2] = c.size;
    data[o + 3] = c.tileIndex;
    data[o + 4] = 0; // composite instances are visible at any zoom (buffer choice gates them)
    ids.push(c.anchorId);
    n++;
  }
  return { data: data.subarray(0, n * INSTANCE_STRIDE), count: n, ids };
}

// One enlarged anchor icon + one ring per megalopolis.
export function buildCompositeSpecs(
  megas: Map<number, Megalopolis>,
  groups: Record<string, GroupRender>,
  ringTileIndex: number,
  fallback: GroupRender = { tileIndex: 0, size: 2, minZoom: 0 }
): CompositeInstanceSpec[] {
  const specs: CompositeInstanceSpec[] = [];
  for (const m of megas.values()) {
    const g = groups[m.anchor.group as string] || fallback;
    specs.push({
      x: m.anchor.x!,
      y: m.anchor.y!,
      size: g.size * COMPOSITE_ICON_SCALE,
      tileIndex: g.tileIndex,
      anchorId: m.anchor.i
    });
    if (ringTileIndex >= 0)
      specs.push({
        x: m.anchor.x!,
        y: m.anchor.y!,
        size: g.size * RING_ICON_SCALE,
        tileIndex: ringTileIndex,
        anchorId: m.anchor.i
      });
  }
  return specs;
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
