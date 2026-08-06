import { type Quadtree, quadtree } from "d3-quadtree";
import type { Burg } from "../generators/burgs-generator";
import {
  COMPOSITE_ICON_SCALE,
  MEGALOPOLIS_MIN_ZOOM,
  type Megalopolis,
  RING_ICON_SCALE
} from "../generators/megalopolis";

export interface GroupRender {
  tileIndex: number; // atlas tile for this group's baked symbol
  size: number; // rendered icon diameter in map units (group font-size)
  minZoom: number; // groupMinZoom() from the shared tier table (src/renderers/labeling/tier-table.ts) — GPU cull threshold
  hidden?: boolean; // group switched off by a layer toggle (Skyburgs) — cull; NOT the zoom gate
}

export const INSTANCE_STRIDE = 5; // x, y, size, tileIndex, minZoom

export interface CompositeInstanceSpec {
  x: number;
  y: number;
  size: number;
  tileIndex: number;
  anchorId: number;
  minZoom: number; // GPU tier gate — composites follow the capital tier
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
    if (g.hidden) continue; // the group's layer is switched off; the GL canvas must match
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
    data[o + 4] = c.minZoom; // upper bound comes from the buffer swap at the split zoom
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
    if (g.hidden) continue;
    specs.push({
      x: m.anchor.x!,
      y: m.anchor.y!,
      size: g.size * COMPOSITE_ICON_SCALE,
      tileIndex: g.tileIndex,
      anchorId: m.anchor.i,
      minZoom: MEGALOPOLIS_MIN_ZOOM
    });
    if (ringTileIndex >= 0)
      specs.push({
        x: m.anchor.x!,
        y: m.anchor.y!,
        size: g.size * RING_ICON_SCALE,
        tileIndex: ringTileIndex,
        anchorId: m.anchor.i,
        minZoom: MEGALOPOLIS_MIN_ZOOM
      });
  }
  return specs;
}

export type BurgQuadtree = Quadtree<Burg>;

// `groups` is optional so the index can be built before the atlas exists; when given, burgs in a
// hidden group are left out — an unpainted icon must not be clickable either.
export function buildBurgQuadtree(burgs: Burg[], groups?: Record<string, GroupRender>): BurgQuadtree {
  return quadtree<Burg>()
    .x(b => b.x!)
    .y(b => b.y!)
    .addAll(burgs.filter(b => b && b.i && !b.removed && !groups?.[b.group as string]?.hidden));
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
