import type { Burg } from "@/generators/burgs-generator";
import type { River } from "@/generators/river-generator";
import { smoothRiverCourse } from "./river-curve";
import type { RiverSurvey, WaterPoint } from "./water-context-types";

interface WidthPoint extends WaterPoint {
  width: number;
}

function clipSegment(a: WidthPoint, b: WidthPoint, radius: number): [WidthPoint, WidthPoint] | undefined {
  let low = 0,
    high = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x + radius],
    [dx, radius - a.x],
    [-dy, a.y + radius],
    [dy, radius - a.y]
  ]) {
    if (!p) {
      if (q < 0) return;
      else continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return;
  }
  if (high - low < 1e-12) return;
  const at = (t: number): WidthPoint => ({
    x: a.x + dx * t,
    y: a.y + dy * t,
    width: a.width + (b.width - a.width) * t
  });
  return [at(low), at(high)];
}

export function projectRiverSurvey(
  id: number,
  course: [number, number, number][],
  widthsM: number[],
  burg: WaterPoint,
  metresPerMapUnit: number,
  radiusM: number
): { rivers: RiverSurvey[]; omitted: boolean; unlocated?: boolean } {
  if (course.length < 2 || course.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
    return { rivers: [], omitted: true, unlocated: true };
  const points = course.map(([x, y], i) => ({
    x: (x - burg.x) * metresPerMapUnit,
    y: (y - burg.y) * metresPerMapUnit,
    width: widthsM.length === course.length ? widthsM[i] : NaN
  }));
  const runs: WidthPoint[][] = [];
  let run: WidthPoint[] | undefined;
  const same = (a: WidthPoint, b: WidthPoint) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
  if (points.every(p => same(p, points[0]))) return { rivers: [], omitted: true, unlocated: true };
  // Match the consumer's bank-miter cap at sharp bends outside the survey.
  const padding = widthsM.reduce((max, width) => (Number.isFinite(width) ? Math.max(max, width) : max), 0) * 2 + 1;
  for (let i = 1; i < points.length; i++) {
    if (same(points[i - 1], points[i])) continue;
    const clipped = clipSegment(points[i - 1], points[i], radiusM + padding);
    if (!clipped) {
      run = undefined;
      continue;
    }
    if (run && same(run.at(-1)!, clipped[0])) run.push(clipped[1]);
    else {
      run = clipped;
      runs.push(run);
    }
  }
  if (runs.some(points => points.some(p => !Number.isFinite(p.width) || p.width <= 0)))
    return { rivers: [], omitted: true };
  return {
    omitted: false,
    rivers: runs.map(points => {
      let nearest = Infinity,
        widthM = points[0].width;
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1],
          b = points[i],
          dx = b.x - a.x,
          dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / (dx * dx + dy * dy || 1)));
        const distance = Math.hypot(a.x + dx * t, a.y + dy * t);
        if (distance < nearest) {
          nearest = distance;
          widthM = a.width + (b.width - a.width) * t;
        }
      }
      return {
        id: String(id),
        centreline: points.map(({ x, y }) => ({ x, y })),
        widthsM: points.map(p => p.width),
        widthM,
        widthSource: "fmg-local-width-model",
        meander: false
      };
    })
  };
}

/** The same course and cumulative discharge as drawing, with local model widths in metres. */
export function surveyRiver(
  river: River,
  burg: WaterPoint,
  metresPerMapUnit: number,
  radiusM: number,
  retainAvailableWidths = false
): { rivers: RiverSurvey[]; omitted: boolean; unlocated?: boolean } {
  if (!river.cells || river.cells.length < 2) return { rivers: [], omitted: true, unlocated: true };
  const anchors = river.points?.length === river.cells.length ? river.points : undefined;
  const course = Rivers.addMeandering(river.cells, anchors);
  let flux = 0;
  const widths = course.map(([, , pointFlux], pointIndex) => {
    flux = Math.max(flux, pointFlux);
    const offset = Rivers.getOffset({
      flux,
      pointIndex,
      widthFactor: river.widthFactor,
      startingWidth: river.sourceWidth
    });
    return Rivers.getWidth(offset) * 1000;
  });
  if (course.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
    return { rivers: [], omitted: true, unlocated: true };
  const smooth = smoothRiverCourse(
    course.map(([x, y], i) => ({
      x: (x - burg.x) * metresPerMapUnit,
      y: (y - burg.y) * metresPerMapUnit,
      width: widths[i]
    })),
    radiusM
  );
  const runs: (typeof smooth)[] = [];
  if (retainAvailableWidths) {
    let run: typeof smooth = [];
    for (const point of smooth) {
      if (Number.isFinite(point.width) && point.width > 0) run.push(point);
      else {
        if (run.length > 1) runs.push(run);
        run = [];
      }
    }
    if (run.length > 1) runs.push(run);
  } else runs.push(smooth);
  const parts = runs.map(run =>
    projectRiverSurvey(
      river.i,
      run.map(p => [p.x, p.y, 0]),
      run.map(p => p.width),
      { x: 0, y: 0 },
      1,
      radiusM
    )
  );
  const projected = {
    rivers: parts.flatMap(part => part.rivers),
    omitted:
      parts.some(part => part.omitted) ||
      (retainAvailableWidths &&
        smooth.some(
          p => (!Number.isFinite(p.width) || p.width <= 0) && Math.abs(p.x) <= radiusM && Math.abs(p.y) <= radiusM
        ))
  };
  for (const river of projected.rivers) {
    river.courseSource = "fmg-catmull-rom-0.1";
    river.centreline = river.centreline.map(p => ({ x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100 }));
    river.widthsM = river.widthsM.map(width => Number(width.toPrecision(8)));
  }
  return projected;
}

/** Preserve the associated source reach even when the cartographic burg marker was shifted far away. */
function surveyAssociatedRiver(
  river: River,
  burg: Burg,
  metresPerMapUnit: number,
  radiusM: number
): ReturnType<typeof surveyRiver> {
  if (!river.cells || river.cells.length < 2) return { rivers: [], omitted: true };
  const anchors = river.points?.length === river.cells.length ? river.points : undefined;
  const course = Rivers.addMeandering(river.cells, anchors);
  let nearest: WaterPoint | undefined;
  let distance = Infinity;
  for (let i = 1; i < course.length; i++) {
    const [x, y] = course[i - 1],
      dx = course[i][0] - x,
      dy = course[i][1] - y;
    const t = Math.max(0, Math.min(1, ((burg.x - x) * dx + (burg.y - y) * dy) / (dx * dx + dy * dy || 1)));
    const point = { x: x + t * dx, y: y + t * dy };
    const d = Math.hypot(point.x - burg.x, point.y - burg.y);
    if (d < distance) {
      nearest = point;
      distance = d;
    }
  }
  if (!nearest) return { rivers: [], omitted: true };
  const survey = surveyRiver(river, nearest, metresPerMapUnit, radiusM, true);
  const dx = (nearest.x - burg.x) * metresPerMapUnit,
    dy = (nearest.y - burg.y) * metresPerMapUnit;
  for (const reach of survey.rivers)
    reach.centreline = reach.centreline.map(p => ({
      x: Math.round((p.x + dx) * 100) / 100,
      y: Math.round((p.y + dy) * 100) / 100
    }));
  return survey;
}

export function surveyBurgRivers(
  burg: Burg,
  metresPerMapUnit: number,
  radiusM: number,
  expectedIds: number[] = [],
  requiredRiverId?: string
) {
  const rivers: RiverSurvey[] = [],
    omitted = new Set(expectedIds);
  if (requiredRiverId) omitted.add(Number(requiredRiverId));
  for (const river of (pack.rivers ?? []).toSorted((a, b) => a.i - b.i)) {
    const required = String(river.i) === requiredRiverId;
    const survey = required
      ? surveyAssociatedRiver(river, burg, metresPerMapUnit, radiusM)
      : surveyRiver(river, burg, metresPerMapUnit, radiusM);
    if (survey.omitted) {
      if (!survey.unlocated || expectedIds.includes(river.i) || required) omitted.add(river.i);
    } else omitted.delete(river.i);
    rivers.push(...survey.rivers);
  }
  return { rivers, omittedRiverIds: [...omitted].sort((a, b) => a - b) };
}
