import type { WaterPoint as Point } from "./water-context-types";

interface Edge {
  a: Point;
  b: Point;
}

const key = (p: Point) => `${p.x},${p.y}`;
const area = (ring: Point[]) =>
  ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length];
    return sum + p.x * q.y - q.x * p.y;
  }, 0);
const edges = (ring: Point[]): Edge[] => ring.map((a, i) => ({ a, b: ring[(i + 1) % ring.length] }));

function clean(ring: Point[], roundoff = false, shared = new Set<string>()): Point[] {
  const result = ring.filter((p, i) => key(p) !== key(ring[(i + 1) % ring.length]));
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const a = result[(i + result.length - 1) % result.length],
        b = result[i],
        c = result[(i + 1) % result.length];
      if (shared.has(key(b))) continue;
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const magnitude = Math.max(
        1,
        Math.abs(a.x),
        Math.abs(a.y),
        Math.abs(b.x),
        Math.abs(b.y),
        Math.abs(c.x),
        Math.abs(c.y)
      );
      const tolerance = roundoff ? Number.EPSILON * magnitude * Math.hypot(c.x - a.x, c.y - a.y) : 0;
      if (Math.abs(cross) > tolerance) continue;
      if ((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) < 0) continue;
      result.splice(i, 1);
      changed = true;
      break;
    }
  }
  return area(result) < 0 ? result.reverse() : result;
}

function merge(a: Point[], b: Point[]): Point[] | undefined {
  const all = [...edges(a), ...edges(b)];
  const horizontalA = edges(a).filter(e => e.a.y === e.b.y);
  const horizontalB = edges(b).filter(e => e.a.y === e.b.y);
  if (
    !horizontalA.some(p =>
      horizontalB.some(
        q =>
          p.a.y === q.a.y &&
          Math.min(Math.max(p.a.x, p.b.x), Math.max(q.a.x, q.b.x)) >
            Math.max(Math.min(p.a.x, p.b.x), Math.min(q.a.x, q.b.x))
      )
    )
  )
    return;

  const levels = new Map<number, Set<number>>();
  for (const { a, b } of all)
    if (a.y === b.y) {
      if (!levels.has(a.y)) levels.set(a.y, new Set());
      levels.get(a.y)!.add(a.x).add(b.x);
    }
  const boundary = new Map<string, Edge>();
  for (const edge of all) {
    const points =
      edge.a.y === edge.b.y
        ? [...levels.get(edge.a.y)!]
            .filter(x => x >= Math.min(edge.a.x, edge.b.x) && x <= Math.max(edge.a.x, edge.b.x))
            .sort((x, y) => (x - y) * Math.sign(edge.b.x - edge.a.x))
            .map(x => ({ x, y: edge.a.y }))
        : [edge.a, edge.b];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        forward = `${key(a)}>${key(b)}`,
        reverse = `${key(b)}>${key(a)}`;
      if (boundary.has(reverse)) boundary.delete(reverse);
      else if (boundary.has(forward)) return;
      else boundary.set(forward, { a, b });
    }
  }
  const outgoing = new Map<string, Edge>(),
    incoming = new Set<string>();
  for (const edge of boundary.values()) {
    if (outgoing.has(key(edge.a)) || incoming.has(key(edge.b))) return;
    outgoing.set(key(edge.a), edge);
    incoming.add(key(edge.b));
  }
  const first = boundary.values().next().value;
  if (!first) return;
  const ring: Point[] = [];
  let current: Edge | undefined = first;
  while (current) {
    ring.push(current.a);
    outgoing.delete(key(current.a));
    if (key(current.b) === key(first.a)) break;
    current = outgoing.get(key(current.b));
  }
  // Multiple loops include holes; leave those as separate positive fill pieces.
  if (!current || outgoing.size || ring.length < 3) return;
  return clean(ring);
}

/** Lossless packing of non-overlapping scanline fill pieces from one water body. */
export function packWaterPolygons(polygons: Point[][]): Point[][] {
  const packed = polygons.map(ring => clean(ring));
  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      const joined = merge(packed[i], packed[j]);
      if (!joined) continue;
      packed[i] = joined;
      packed.splice(j, 1);
      j = i;
    }
  }
  const seen = new Set<string>(),
    shared = new Set<string>();
  for (const ring of packed)
    for (const point of ring) {
      const id = key(point);
      if (seen.has(id)) shared.add(id);
      seen.add(id);
    }
  // Scanline interpolation can leave collinear knots a single floating-point step off their source edge.
  return packed.map(ring => clean(ring, true, shared));
}
