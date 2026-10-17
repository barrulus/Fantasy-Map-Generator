// @vitest-environment node

import { curveCatmullRom, path } from "d3";
import { describe, expect, it } from "vitest";
import { closestPoint, parseShorePath } from "@/utils/shoreline-geometry";
import { smoothRiverCourse } from "./river-curve";
import { projectRiverSurvey } from "./river-water-survey";

const anchors = [
  { x: -5000, y: 0, width: 20 },
  { x: -1000, y: 800, width: 30 },
  { x: 0, y: 0, width: 40 },
  { x: 1000, y: 800, width: 50 },
  { x: 5000, y: 0, width: 60 }
];
const distance = (p: { x: number; y: number }, points: { x: number; y: number }[]) =>
  Math.min(
    ...points.slice(1).map((b, i) => {
      const q = closestPoint(p, points[i], b);
      return Math.hypot(p.x - q.x, p.y - q.y);
    })
  );

describe("measured smooth river course", () => {
  it("passes through original anchors and joins the banks with smooth tangents", () => {
    const result = smoothRiverCourse(anchors, 6000);
    for (const a of anchors) expect(result).toContainEqual(a);
    expect(result.length).toBeGreaterThan(20);
    for (const a of anchors.slice(1, -1)) {
      const i = result.findIndex(p => p.x === a.x && p.y === a.y),
        prev = result[i - 1],
        next = result[i + 1];
      const v = [a.x - prev.x, a.y - prev.y],
        w = [next.x - a.x, next.y - a.y];
      expect((v[0] * w[0] + v[1] * w[1]) / Math.hypot(...v) / Math.hypot(...w)).toBeGreaterThan(0.99);
    }
    expect(result.every(p => p.width >= 20 && p.width <= 60)).toBe(true);
  });

  it("converges to the full-precision FMG Catmull-Rom curve within the metric budget", () => {
    const result = smoothRiverCourse(anchors, 6000, 0.2);
    const finer = smoothRiverCourse(anchors, 6000, 0.02);
    expect(finer.length).toBeGreaterThan(result.length);
    const context = path();
    const curve = curveCatmullRom.alpha(0.1)(context);
    curve.lineStart();
    for (const p of anchors) curve.point(p.x, p.y);
    curve.lineEnd();
    const curves = parseShorePath(context.toString(), 1).slice(0, -1);
    let maxError = 0;
    for (const c of curves)
      for (let i = 0; i <= 400; i++) {
        const t = i / 400,
          u = 1 - t,
          p = c.points;
        const q = {
          x: p[0].x * u ** 3 + 3 * p[1].x * u * u * t + 3 * p[2].x * u * t * t + p[3].x * t ** 3,
          y: p[0].y * u ** 3 + 3 * p[1].y * u * u * t + 3 * p[2].y * u * t * t + p[3].y * t ** 3
        };
        maxError = Math.max(maxError, distance(q, result));
        expect(distance(q, finer)).toBeLessThanOrEqual(0.021);
      }
    expect(maxError).toBeLessThanOrEqual(0.201);
  });

  it("retains an outside-anchor curve that bends into the survey", () => {
    const points = [
      { x: 3300, y: -3000, width: 20 },
      { x: 3020, y: -1000, width: 30 },
      { x: 3020, y: 1000, width: 40 },
      { x: 3300, y: 3000, width: 50 }
    ];
    const result = smoothRiverCourse(points, 3000);
    expect(result.some(p => p.x < 3000)).toBe(true);
    const survey = projectRiverSurvey(
      1,
      result.map(p => [p.x, p.y, 0]),
      result.map(p => p.width),
      { x: 0, y: 0 },
      1,
      3000
    );
    expect(survey.rivers).toHaveLength(1);
    expect(survey.rivers[0].centreline.some(p => p.x < 3000)).toBe(true);
  });

  it("keeps full-course tangents and widths when the survey crop changes", () => {
    const small = smoothRiverCourse(anchors, 1000),
      large = smoothRiverCourse(anchors, 6000);
    const local = small.filter(p => Math.abs(p.x) < 1000 && Math.abs(p.y) < 1000);
    expect(local.length).toBeGreaterThan(10);
    for (const p of local) expect(large).toContainEqual(p);
    expect(anchors[2]).toEqual({ x: 0, y: 0, width: 40 });
  });
});
