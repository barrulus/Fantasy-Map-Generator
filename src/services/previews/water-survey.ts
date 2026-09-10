import type { Bounds } from "@/utils/shoreline-geometry";
import { boundsOf, closestPoint, flattenCurve, parseShorePath, ShoreIndex } from "@/utils/shoreline-geometry";
import type { MeasuredWaterContext, WaterPoint as Point, WaterSurvey } from "./water-context-types";

export const WATER_SURVEY_RADIUS_M = 3000;
const FLATTENING_ERROR_M = 0.2;
const EPSILON = 1e-7;

export interface SurveyBoundary {
  id: number;
  kind: "island" | "lake";
  path: string;
}

interface Edge {
  a: Point;
  b: Point;
  feature: number;
  error: number;
}

interface WaterBody {
  id: number;
  kind: "ocean" | "lake";
}

const xAt = (edge: Edge, y: number) => edge.a.x + ((edge.b.x - edge.a.x) * (y - edge.a.y)) / (edge.b.y - edge.a.y);
const origin = { x: 0, y: 0 };
const length = (p: Point) => Math.hypot(p.x, p.y);
const bearing = (p: Point) => ((Math.atan2(p.x, -p.y) * 180) / Math.PI + 360) % 360;

function area(polygon: Point[]): number {
  return (
    Math.abs(
      polygon.reduce((sum, p, i) => {
        const q = polygon[(i + 1) % polygon.length];
        return sum + p.x * q.y - q.x * p.y;
      }, 0)
    ) / 2
  );
}

/** The index stores the same curved feature paths used by the display and map save. */
export class WaterSurveyIndex {
  private tree: ShoreIndex;
  private features = new Map<number, SurveyBoundary & { order: number }>();

  constructor(
    boundaries: SurveyBoundary[],
    private mapBounds: Bounds
  ) {
    const curves = boundaries.flatMap((boundary, order) => {
      this.features.set(boundary.id, { ...boundary, order });
      return parseShorePath(boundary.path, boundary.id);
    });
    this.tree = new ShoreIndex(curves);
  }

  survey(input: {
    burg: Point;
    metresPerMapUnit: number;
    radiusM?: number;
    oceanAt: (world: Point) => number;
    omittedRiverIds?: number[];
  }): Extract<WaterSurvey, { coastlineGeometry: Point[][] }> {
    const { burg, metresPerMapUnit: scale, oceanAt } = input;
    const radius = input.radiusM ?? WATER_SURVEY_RADIUS_M;
    if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(radius) || radius < WATER_SURVEY_RADIUS_M) {
      throw new Error("Measured water needs a positive distance conversion and a survey of at least 3000 m");
    }
    const worldRadius = radius / scale;
    if (
      burg.x - worldRadius < this.mapBounds.minX ||
      burg.x + worldRadius > this.mapBounds.maxX ||
      burg.y - worldRadius < this.mapBounds.minY ||
      burg.y + worldRadius > this.mapBounds.maxY
    ) {
      throw new Error("Measured water survey extends beyond this map's known geography");
    }
    const toLocal = (p: Point): Point => ({ x: (p.x - burg.x) * scale, y: (p.y - burg.y) * scale });
    const toWorld = (p: Point): Point => ({ x: p.x / scale + burg.x, y: p.y / scale + burg.y });
    const edgesFor = (r: number): Edge[] =>
      this.tree
        .query({
          minX: this.mapBounds.minX,
          maxX: this.mapBounds.maxX,
          minY: burg.y - r / scale,
          maxY: burg.y + r / scale
        })
        .flatMap(curve => {
          const points = flattenCurve(curve.points.map(toLocal), FLATTENING_ERROR_M);
          return points
            .slice(1)
            .map((b, i) => ({
              a: points[i],
              b,
              feature: curve.feature,
              error: curve.points.length > 2 ? FLATTENING_ERROR_M : 0
            }))
            .filter(e => e.a.x !== e.b.x || e.a.y !== e.b.y)
            .filter(e => Math.min(e.a.y, e.b.y) <= r && Math.max(e.a.y, e.b.y) >= -r)
            .map(e => ({
              ...e,
              a:
                e.a.y < -r || e.a.y > r
                  ? { x: xAt(e, Math.max(-r, Math.min(r, e.a.y))), y: Math.max(-r, Math.min(r, e.a.y)) }
                  : e.a,
              b:
                e.b.y < -r || e.b.y > r
                  ? { x: xAt(e, Math.max(-r, Math.min(r, e.b.y))), y: Math.max(-r, Math.min(r, e.b.y)) }
                  : e.b
            }));
        });
    let edges = edgesFor(radius * Math.SQRT2 + 1);
    const bodyAt = (p: Point, all: Edge[] = edges): WaterBody | undefined => {
      const winding = new Map<number, number>();
      for (const edge of all) {
        if ((edge.a.y <= p.y && edge.b.y > p.y) || (edge.b.y <= p.y && edge.a.y > p.y)) {
          if (xAt(edge, p.y) <= p.x)
            winding.set(edge.feature, (winding.get(edge.feature) ?? 0) + Math.sign(edge.b.y - edge.a.y));
        }
      }
      let top: (SurveyBoundary & { order: number }) | undefined;
      for (const [id, count] of winding) {
        const feature = this.features.get(id)!;
        if (count && (!top || feature.order > top.order)) top = feature;
      }
      if (top?.kind === "island") return undefined;
      if (top) return { id: top.id, kind: "lake" };
      return { id: oceanAt(toWorld(p)), kind: "ocean" };
    };

    const cuts = new Set<number>([-radius, radius]);
    const localEdges = edges.filter(e => {
      const b = boundsOf([e.a, e.b]);
      return b.maxX >= -radius && b.minX <= radius && b.maxY >= -radius && b.minY <= radius;
    });
    for (const edge of localEdges) {
      for (const p of [edge.a, edge.b]) if (p.y > -radius && p.y < radius) cuts.add(p.y);
      if (edge.a.x !== edge.b.x)
        for (const x of [-radius, radius]) {
          const t = (x - edge.a.x) / (edge.b.x - edge.a.x);
          const y = edge.a.y + t * (edge.b.y - edge.a.y);
          if (t > 0 && t < 1 && y > -radius && y < radius) cuts.add(y);
        }
    }
    const edgeCuts = new Map<Edge, number[]>();
    // Crossings split both the fill slabs and the exposed shore used for measurements.
    for (let i = 0; i < localEdges.length; i++)
      for (let j = i + 1; j < localEdges.length; j++) {
        const a = localEdges[i],
          b = localEdges[j];
        const uncertainty = a.error + b.error;
        const boundsA = boundsOf([a.a, a.b]),
          boundsB = boundsOf([b.a, b.b]);
        if (
          boundsA.minX > boundsB.maxX + uncertainty ||
          boundsB.minX > boundsA.maxX + uncertainty ||
          boundsA.minY > boundsB.maxY + uncertainty ||
          boundsB.minY > boundsA.maxY + uncertainty
        )
          continue;
        const ax = a.b.x - a.a.x,
          ay = a.b.y - a.a.y;
        const bx = b.b.x - b.a.x,
          by = b.b.y - b.a.y;
        const cross = ax * by - ay * bx;
        const dx = b.a.x - a.a.x,
          dy = b.a.y - a.a.y;
        const t = (dx * by - dy * bx) / cross,
          u = (dx * ay - dy * ax) / cross;
        if (uncertainty) {
          const shared = [a.a, a.b].find(p => [b.a, b.b].some(q => p.x === q.x && p.y === q.y));
          const distance = (p: Point, edge: Edge) => {
            const q = closestPoint(p, edge.a, edge.b);
            return Math.hypot(p.x - q.x, p.y - q.y);
          };
          const crossing = t > 0 && t < 1 && u > 0 && u < 1;
          const near = Math.min(distance(a.a, b), distance(a.b, b), distance(b.a, a), distance(b.b, a));
          const otherA = shared === a.a ? a.b : a.a;
          const otherB = shared && shared.x === b.a.x && shared.y === b.a.y ? b.b : b.a;
          const foldsBack =
            shared && (otherA.x - shared.x) * (otherB.x - shared.x) + (otherA.y - shared.y) * (otherB.y - shared.y) > 0;
          if (crossing || foldsBack || (!shared && near <= uncertainty))
            throw new Error(
              "Measured water cannot preserve this narrow or crossing shoreline within its precision budget"
            );
        }
        if (Math.abs(cross) < EPSILON) continue;
        const y = a.a.y + t * ay;
        if (t > 0 && t < 1 && u > 0 && u < 1 && y > -radius && y < radius) {
          cuts.add(y);
          edgeCuts.set(a, [...(edgeCuts.get(a) ?? [0, 1]), t]);
          edgeCuts.set(b, [...(edgeCuts.get(b) ?? [0, 1]), u]);
        }
      }
    edges = edges.flatMap(edge => {
      const splits = edgeCuts.get(edge);
      if (!splits) return [edge];
      const points = [...new Set(splits)]
        .sort((a, b) => a - b)
        .map(t => ({
          x: edge.a.x + (edge.b.x - edge.a.x) * t,
          y: edge.a.y + (edge.b.y - edge.a.y) * t
        }));
      return points.slice(1).map((b, i) => ({ ...edge, a: points[i], b }));
    });
    const levels = [...cuts].sort((a, b) => a - b);
    const polygons: Point[][] = [];
    const bodies = new Map<string, WaterBody & { polygonIndices: number[]; closest?: Point; normal?: Point }>();
    const keyOf = (body: WaterBody) => `${body.kind}:${body.id}`;
    for (let i = 1; i < levels.length; i++) {
      const bottom = levels[i - 1],
        top = levels[i],
        y = (bottom + top) / 2;
      if (top - bottom < EPSILON) continue;
      const crossings = edges
        .filter(e => Math.min(e.a.y, e.b.y) < y && Math.max(e.a.y, e.b.y) > y)
        .map(edge => ({ edge, x: xAt(edge, y) }))
        .filter(c => c.x > -radius && c.x < radius)
        .sort((a, b) => a.x - b.x);
      const sides = [undefined, ...crossings.map(c => c.edge), undefined];
      const xs = [-radius, ...crossings.map(c => c.x), radius];
      for (let j = 1; j < xs.length; j++) {
        if (xs[j] - xs[j - 1] < EPSILON) continue;
        const body = bodyAt({ x: (xs[j] + xs[j - 1]) / 2, y });
        if (!body) continue;
        const edgeX = (edge: Edge | undefined, atY: number, fallback: number) =>
          Math.max(-radius, Math.min(radius, edge ? xAt(edge, atY) : fallback));
        const polygon = [
          { x: edgeX(sides[j - 1], bottom, -radius), y: bottom },
          { x: edgeX(sides[j], bottom, radius), y: bottom },
          { x: edgeX(sides[j], top, radius), y: top },
          { x: edgeX(sides[j - 1], top, -radius), y: top }
        ].filter((p, k, all) => k === 0 || Math.hypot(p.x - all[k - 1].x, p.y - all[k - 1].y) > EPSILON);
        if (polygon.length < 3 || area(polygon) < EPSILON) continue;
        const key = keyOf(body);
        if (!bodies.has(key)) bodies.set(key, { ...body, polygonIndices: [] });
        bodies.get(key)!.polygonIndices.push(polygons.length);
        polygons.push(polygon);
      }
    }

    const measure = (all: Edge[], limit: number) => {
      for (const edge of all) {
        const nearest = closestPoint(origin, edge.a, edge.b);
        if (length(nearest) > limit) continue;
        const a = toWorld(edge.a),
          b = toWorld(edge.b);
        if (
          (a.x === b.x && (a.x === this.mapBounds.minX || a.x === this.mapBounds.maxX)) ||
          (a.y === b.y && (a.y === this.mapBounds.minY || a.y === this.mapBounds.maxY))
        )
          continue;
        const dx = edge.b.x - edge.a.x,
          dy = edge.b.y - edge.a.y,
          size = Math.hypot(dx, dy);
        if (!size) continue;
        const mid = { x: (edge.a.x + edge.b.x) / 2, y: (edge.a.y + edge.b.y) / 2 };
        const n = { x: -dy / size, y: dx / size };
        const probe = all.reduce((offset, other) => {
          const q = closestPoint(mid, other.a, other.b);
          const distance = Math.hypot(q.x - mid.x, q.y - mid.y);
          return distance > EPSILON ? Math.min(offset, distance / 4) : offset;
        }, 0.001);
        const left = bodyAt({ x: mid.x + n.x * probe, y: mid.y + n.y * probe }, all);
        const right = bodyAt({ x: mid.x - n.x * probe, y: mid.y - n.y * probe }, all);
        if (!!left === !!right) continue;
        const body = bodies.get(keyOf((left ?? right)!));
        if (!body || (body.closest && length(body.closest) <= length(nearest))) continue;
        body.closest = nearest;
        body.normal = left ? n : { x: -n.x, y: -n.y };
      }
    };
    measure(edges, radius * Math.SQRT2);
    const fullRadius =
      Math.hypot(this.mapBounds.maxX - this.mapBounds.minX, this.mapBounds.maxY - this.mapBounds.minY) * scale;
    for (let search = radius * 2; [...bodies.values()].some(b => !b.closest); search *= 2) {
      measure(edgesFor(search), search);
      if (search >= fullRadius) break;
    }
    const waterContext: MeasuredWaterContext = {
      version: 1,
      status: "measured",
      coordinateSpace: "burg-local-metres",
      surveyRadiusM: radius,
      geometryErrorM: 0.5,
      bodies: [...bodies.values()]
        .sort((a, b) => a.id - b.id)
        .map(body => {
          if (!body.closest) throw new Error("Cannot establish a real shoreline distance for the measured water body");
          return {
            featureId: String(body.id),
            kind: body.kind,
            distanceM: length(body.closest),
            bearingDeg: bearing(length(body.closest) < EPSILON ? body.normal! : body.closest),
            polygonIndices: body.polygonIndices
          };
        })
    };
    if (input.omittedRiverIds?.length)
      waterContext.omittedRivers = [...new Set(input.omittedRiverIds)]
        .sort((a, b) => a - b)
        .map(id => ({ riverId: String(id), reason: "local-width-unavailable" }));
    return { waterContext, coastlineGeometry: polygons };
  }
}
