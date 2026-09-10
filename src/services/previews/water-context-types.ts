export interface WaterPoint {
  x: number;
  y: number;
}

export interface MeasuredWaterContext {
  version: 1;
  status: "measured";
  coordinateSpace: "burg-local-metres";
  surveyRadiusM: number;
  geometryErrorM: number;
  omittedRivers?: Array<{ riverId?: string; reason: "local-width-unavailable" }>;
  bodies: Array<{
    featureId?: string;
    kind: "ocean" | "lake";
    distanceM: number;
    bearingDeg: number;
    polygonIndices?: number[];
  }>;
}

export type WaterContext = MeasuredWaterContext | { version: 1; status: "unknown-units"; sourceUnit: string };

export type WaterSurvey =
  | { waterContext: MeasuredWaterContext; coastlineGeometry: WaterPoint[][] }
  | { waterContext: Extract<WaterContext, { status: "unknown-units" }> };
