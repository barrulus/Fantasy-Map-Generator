import type { WaterPoint as Point } from "./water-context-types";

export const WATER_COORDINATE_ERROR_M = 1e-8;
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const orient = (a: Point, b: Point, c: Point) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
const on = (p: Point, a: Point, b: Point) =>
  p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
const area = (ring: Point[]) =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);

function relation(a: Point, b: Point, c: Point, d: Point): string {
  const abC = orient(a, b, c),
    abD = orient(a, b, d),
    cdA = orient(c, d, a),
    cdB = orient(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return "cross";
  if (!abC && !abD && !cdA && !cdB) {
    const axis = a.x !== b.x ? "x" : "y";
    const overlap =
      Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) -
      Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
    return overlap > 0 ? "overlap" : overlap === 0 ? "touch" : "none";
  }
  return (!abC && on(c, a, b)) || (!abD && on(d, a, b)) || (!cdA && on(a, c, d)) || (!cdB && on(b, c, d))
    ? "touch"
    : "none";
}

function containment(point: Point, ring: Point[]): number {
  let winding = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      side = orient(a, b, point);
    if (!side && on(point, a, b)) return 0;
    if (a.y <= point.y && b.y > point.y && side > 0) winding++;
    if (a.y > point.y && b.y <= point.y && side < 0) winding--;
  }
  return winding ? 1 : -1;
}

/** Shorten arithmetic tails while retaining sensitive vertices at their original precision. */
export function packWaterCoordinates(polygons: Point[][]): Point[][] {
  const rounded = polygons.map(ring => ring.map(p => ({ x: Number(p.x.toFixed(8)), y: Number(p.y.toFixed(8)) })));
  const edges = polygons.flatMap((ring, r) =>
    ring.map((a, i) => ({ r, i, j: (i + 1) % ring.length, a, b: ring[(i + 1) % ring.length] }))
  );
  let changed = true;
  while (changed) {
    changed = false;
    const retain = (r: number, i: number) => {
      if (same(rounded[r][i], polygons[r][i])) return;
      rounded[r][i] = polygons[r][i];
      changed = true;
    };
    for (let r = 0; r < polygons.length; r++) {
      if (Math.sign(area(polygons[r])) !== Math.sign(area(rounded[r])))
        for (let i = 0; i < polygons[r].length; i++) retain(r, i);
    }
    for (const e of edges) {
      if (Math.hypot(e.a.x - rounded[e.r][e.i].x, e.a.y - rounded[e.r][e.i].y) > WATER_COORDINATE_ERROR_M)
        retain(e.r, e.i);
      if (same(rounded[e.r][e.i], rounded[e.r][e.j]) && !same(e.a, e.b)) {
        retain(e.r, e.i);
        retain(e.r, e.j);
      }
    }
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) {
        const a = edges[i],
          b = edges[j];
        if (
          relation(a.a, a.b, b.a, b.b) ===
          relation(rounded[a.r][a.i], rounded[a.r][a.j], rounded[b.r][b.i], rounded[b.r][b.j])
        )
          continue;
        retain(a.r, a.i);
        retain(a.r, a.j);
        retain(b.r, b.i);
        retain(b.r, b.j);
      }
    for (let r = 0; r < polygons.length; r++)
      for (let q = r + 1; q < polygons.length; q++) {
        if (
          containment(polygons[r][0], polygons[q]) === containment(rounded[r][0], rounded[q]) &&
          containment(polygons[q][0], polygons[r]) === containment(rounded[q][0], rounded[r])
        )
          continue;
        for (let i = 0; i < polygons[r].length; i++) retain(r, i);
        for (let i = 0; i < polygons[q].length; i++) retain(q, i);
      }
  }
  return rounded.every((ring, r) => ring.every((p, i) => same(p, polygons[r][i]))) ? polygons : rounded;
}
