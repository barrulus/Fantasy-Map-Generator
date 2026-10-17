import { curveCatmullRom, path } from "d3";
import { flattenCurve } from "@/utils/shoreline-geometry";
import type { WaterPoint } from "./water-context-types";

export interface RiverCurvePoint extends WaterPoint {
  width: number;
}

export const RIVER_CURVE_ERROR_M = 0.2;

/** FMG's drawing interpolation applied to its centre anchors, without rounded cartographic bank offsets. */
export function smoothRiverCourse(
  points: RiverCurvePoint[],
  radiusM: number,
  toleranceM = RIVER_CURVE_ERROR_M
): RiverCurvePoint[] {
  if (points.length < 2) return points;
  const output: RiverCurvePoint[] = [points[0]];
  const padding = points.reduce((max, p) => (Number.isFinite(p.width) ? Math.max(max, p.width) : max), 0) * 2 + 1;
  let at: WaterPoint = points[0],
    segment = 0;
  const context = path();
  const append = (controls: WaterPoint[]) => {
    const start = points[segment],
      end = points[++segment];
    // Complete-course neighbours define every tangent; distant curves need no tessellation.
    const outside = ["x", "y"].some(axis => {
      const values = controls.map(p => p[axis as "x" | "y"]);
      return Math.min(...values) > radiusM + padding || Math.max(...values) < -radiusM - padding;
    });
    if (outside) output.push(end);
    else
      flattenCurve(controls, toleranceM, (point, parameter) => {
        if (parameter === 0) return;
        output.push({ ...point, width: start.width + (end.width - start.width) * parameter });
      });
    at = controls.at(-1)!;
  };
  context.moveTo = (x, y) => {
    at = { x, y };
  };
  context.lineTo = (x, y) => append([at, { x, y }]);
  context.bezierCurveTo = (x1, y1, x2, y2, x, y) => append([at, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }]);
  const curve = curveCatmullRom.alpha(0.1)(context);
  curve.lineStart();
  for (const p of points) curve.point(p.x, p.y);
  curve.lineEnd();
  return output;
}
