import { quadtree } from "d3";
import type { Burg } from "@/generators/burgs-generator";
import { Coastline } from "@/generators/coastline-generator";
import { getKmInDistanceUnit } from "@/utils/unitUtils";
import type { WaterSurvey } from "./water-context-types";
import { WaterSurveyIndex } from "./water-survey";

let cached:
  | {
      features: typeof pack.features;
      revision: number;
      index: WaterSurveyIndex;
      oceans: ReturnType<typeof quadtree<[number, number, number]>>;
    }
  | undefined;

export function surveyBurgWater(burg: Burg, omittedRiverIds: number[] = []): WaterSurvey {
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
  return cached.index.survey({
    burg,
    metresPerMapUnit: options.map.units.distance.scale * kmPerUnit * 1000,
    oceanAt: point => {
      const ocean = oceanIndex.find(point.x, point.y);
      if (!ocean) throw new Error("The map has no ocean feature for this measured water area");
      return ocean[2];
    },
    omittedRiverIds
  });
}
