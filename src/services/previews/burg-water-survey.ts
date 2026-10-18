import { quadtree } from "d3";
import type { Burg } from "@/generators/burgs-generator";
import { Coastline } from "@/generators/coastline-generator";
import { getKmInDistanceUnit } from "@/utils/unitUtils";
import { surveyBurgRivers } from "./river-water-survey";
import type { WaterSurvey } from "./water-context-types";
import { WATER_SURVEY_RADIUS_M, WaterSurveyIndex } from "./water-survey";

let cached:
  | {
      features: typeof pack.features;
      revision: number;
      index: WaterSurveyIndex;
      oceans: ReturnType<typeof quadtree<[number, number, number]>>;
    }
  | undefined;

export function surveyBurgWater(
  burg: Burg,
  omittedRiverIds: number[] = [],
  radiusM?: number,
  requiredRiverId?: string,
  requiredShore?: { kind: "ocean" | "lake"; featureId?: string }
): WaterSurvey {
  const kmPerUnit = getKmInDistanceUnit();
  if (!kmPerUnit)
    return {
      waterContext: {
        version: 1,
        status: "unknown-units",
        sourceUnit: options.map.units.distance.unit
      }
    };
  if (!cached || cached.features !== pack.features || cached.revision !== Coastline.boundaryRevision) {
    const boundaries = pack.features
      .filter(feature => feature && feature.type !== "ocean")
      .map(feature => ({
        id: feature.i,
        kind: feature.type as "island" | "lake",
        path: Coastline.getFeaturePath(feature)
      }));
    const oceans = quadtree<[number, number, number]>()
      .x(p => p[0])
      .y(p => p[1]);
    for (const cell of pack.cells.i)
      if (pack.features[pack.cells.f[cell]]?.type === "ocean") {
        oceans.add([pack.cells.p[cell][0], pack.cells.p[cell][1], pack.cells.f[cell]]);
      }
    cached = {
      features: pack.features,
      revision: Coastline.boundaryRevision,
      oceans,
      index: new WaterSurveyIndex(boundaries, {
        minX: 0,
        minY: 0,
        maxX: options.map.graph.width,
        maxY: options.map.graph.height
      })
    };
  }
  const oceanIndex = cached.oceans;
  const metresPerMapUnit = options.map.units.distance.scale * kmPerUnit * 1000;
  const baseRadius = radiusM ?? WATER_SURVEY_RADIUS_M;
  const survey = (radiusM: number) =>
    cached!.index.survey({
      burg,
      radiusM,
      metresPerMapUnit,
      oceanAt: point => {
        const ocean = oceanIndex.find(point.x, point.y);
        if (!ocean) throw new Error("The map has no ocean feature for this measured water area");
        return ocean[2];
      }
    });
  let radius = baseRadius;
  let water = survey(radius);
  if (requiredShore) {
    const matches = (body: (typeof water.waterContext.bodies)[number]) =>
      body.kind === requiredShore.kind && (!requiredShore.featureId || body.featureId === requiredShore.featureId);
    const mapRadius =
      Math.min(burg.x, burg.y, options.map.graph.width - burg.x, options.map.graph.height - burg.y) * metresPerMapUnit;
    let body = water.waterContext.bodies.find(matches);
    while (!body) {
      const nextRadius = Math.min(radius * 2, mapRadius);
      if (nextRadius <= radius) throw new Error("Cannot locate this settlement's associated shoreline within the map");
      radius = nextRadius;
      water = survey(radius);
      body = water.waterContext.bodies.find(matches);
    }
    radius = Math.ceil((baseRadius + body.distanceM) / 1000) * 1000;
    water = survey(radius);
  }
  const riverSurvey = surveyBurgRivers(burg, metresPerMapUnit, radius, omittedRiverIds, requiredRiverId);
  if (riverSurvey.omittedRiverIds.length)
    water.waterContext.omittedRivers = riverSurvey.omittedRiverIds.map(id => ({
      riverId: String(id),
      reason: "local-width-unavailable"
    }));
  return { ...water, ...(riverSurvey.rivers.length ? { rivers: riverSurvey.rivers } : {}) };
}
