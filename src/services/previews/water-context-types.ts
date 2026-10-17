export interface WaterPoint {
  x: number;
  y: number;
}

export interface RiverSurvey {
  id?: string;
  centreline: WaterPoint[];
  widthM: number;
  widthsM: number[];
  widthSource: "fmg-local-width-model";
  courseSource?: "fmg-catmull-rom-0.1";
  meander: false;
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
  | { waterContext: MeasuredWaterContext; coastlineGeometry: WaterPoint[][]; rivers?: RiverSurvey[] }
  | { waterContext: Extract<WaterContext, { status: "unknown-units" }> };
