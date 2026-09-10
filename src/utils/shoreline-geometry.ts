import type { WaterPoint as Point } from "@/services/previews/water-context-types";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface ShoreCurve extends Bounds {
  points: Point[];
  feature: number;
}

export const boundsOf = (points: Point[]): Bounds => ({
  minX: Math.min(...points.map(p => p.x)),
  minY: Math.min(...points.map(p => p.y)),
  maxX: Math.max(...points.map(p => p.x)),
  maxY: Math.max(...points.map(p => p.y))
});

export function closestPoint(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Generated and historical FMG feature paths use lines and quadratic/cubic Beziers. */
export function parseShorePath(path: string, feature: number): ShoreCurve[] {
  const tokenPattern = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const tokens = path.match(tokenPattern) ?? [];
  if (!/^[mM]$/.test(tokens[0] ?? "") || path.replace(tokenPattern, "").replace(/[\s,]/g, ""))
    throw new Error("Invalid saved shoreline path");
  const curves: ShoreCurve[] = [];
  let i = 0,
    command = "",
    at = { x: 0, y: 0 },
    start = at;
  let control: Point | undefined,
    previous = "";
  const number = () => {
    const value = Number(tokens[i++]);
    if (!Number.isFinite(value)) throw new Error("Invalid saved shoreline coordinate");
    return value;
  };
  const closeFill = () => {
    if (at.x !== start.x || at.y !== start.y) {
      const points = [at, start];
      curves.push({ ...boundsOf(points), points, feature });
    }
  };
  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) command = tokens[i++];
    const kind = command.toUpperCase(),
      relative = kind !== command;
    const point = (): Point => ({ x: number() + (relative ? at.x : 0), y: number() + (relative ? at.y : 0) });
    let points: Point[];
    if (kind === "M") {
      closeFill();
      at = point();
      start = at;
      command = relative ? "l" : "L";
      control = undefined;
      previous = kind;
      continue;
    }
    if (kind === "Z") {
      points = [at, start];
      command = "";
    } else if (kind === "L") points = [at, point()];
    else if (kind === "H") points = [at, { x: number() + (relative ? at.x : 0), y: at.y }];
    else if (kind === "V") points = [at, { x: at.x, y: number() + (relative ? at.y : 0) }];
    else if (kind === "Q") points = [at, point(), point()];
    else if (kind === "C") points = [at, point(), point(), point()];
    else if (kind === "T" || kind === "S") {
      const reflect = control && (kind === "T" ? /[QT]/.test(previous) : /[CS]/.test(previous));
      const c = reflect ? { x: 2 * at.x - control!.x, y: 2 * at.y - control!.y } : at;
      points = kind === "T" ? [at, c, point()] : [at, c, point(), point()];
    } else throw new Error(`Unsupported saved shoreline command: ${command || "missing command"}`);
    control = points.length > 2 ? points.at(-2) : undefined;
    curves.push({ ...boundsOf(points), points, feature });
    at = points.at(-1)!;
    previous = kind;
  }
  closeFill();
  return curves;
}

/** A Bezier lies in its control hull: chord distance bounds the flattening error. */
export function flattenCurve(points: Point[], tolerance: number): Point[] {
  const result: Point[] = [points[0]];
  function split(p: Point[], depth: number) {
    const a = p[0],
      b = p.at(-1)!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    let projection = 0;
    const monotone = p.every(c => {
      const next = (c.x - a.x) * dx + (c.y - a.y) * dy;
      const ordered = next >= projection;
      projection = next;
      return ordered;
    });
    const flat =
      (dx !== 0 || dy !== 0 || p.every(c => c.x === a.x && c.y === a.y)) &&
      monotone &&
      p.slice(1, -1).every(c => {
        const q = closestPoint(c, a, b);
        return Math.hypot(c.x - q.x, c.y - q.y) <= tolerance;
      });
    if (flat) {
      result.push(b);
      return;
    }
    if (depth === 24) throw new Error("Shoreline exceeds the measured preview precision limit");
    const left = [a],
      right = [b];
    let row = p;
    while (row.length > 1) {
      row = row.slice(1).map((q, i) => midpoint(row[i], q));
      left.push(row[0]);
      right.push(row.at(-1)!);
    }
    split(left, depth + 1);
    split(right.reverse(), depth + 1);
  }
  split(points, 0);
  return result;
}

const intersects = (a: Bounds, b: Bounds) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

/** Static bounding-volume tree over curves; rebuilt only when the displayed geometry changes. */
export class ShoreIndex {
  private bounds: Bounds;
  private children?: [ShoreIndex, ShoreIndex];
  private curves: ShoreCurve[];

  constructor(curves: ShoreCurve[]) {
    this.bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const c of curves) {
      this.bounds.minX = Math.min(this.bounds.minX, c.minX);
      this.bounds.minY = Math.min(this.bounds.minY, c.minY);
      this.bounds.maxX = Math.max(this.bounds.maxX, c.maxX);
      this.bounds.maxY = Math.max(this.bounds.maxY, c.maxY);
    }
    this.curves = curves;
    if (curves.length <= 16) return;
    const x = this.bounds.maxX - this.bounds.minX > this.bounds.maxY - this.bounds.minY;
    const sorted = [...curves].sort((a, b) =>
      x ? a.minX + a.maxX - b.minX - b.maxX : a.minY + a.maxY - b.minY - b.maxY
    );
    const middle = sorted.length >> 1;
    this.children = [new ShoreIndex(sorted.slice(0, middle)), new ShoreIndex(sorted.slice(middle))];
    this.curves = [];
  }

  query(bounds: Bounds, result: ShoreCurve[] = []): ShoreCurve[] {
    if (!intersects(bounds, this.bounds)) return result;
    if (this.children) for (const child of this.children) child.query(bounds, result);
    else for (const curve of this.curves) if (intersects(bounds, curve)) result.push(curve);
    return result;
  }
}
