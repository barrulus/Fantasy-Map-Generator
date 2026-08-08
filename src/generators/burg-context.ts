import { rn } from "../utils";

/** Compass bearing in degrees, 0 = N, clockwise, on SVG coordinates where y grows downward. */
export function compassBearing(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
}

/**
 * Height in metres. Mirrors getHeight() in utils/unitUtils.ts but stays numeric and
 * unit-free — getHeight returns a formatted string and reads the unit <select> from
 * the DOM, which would make this module impure.
 */
export function elevationMetres(h: number, heightExponent: number): number {
  if (h >= 20) return (h - 18) ** heightExponent;
  if (h > 0) return ((h - 20) / h) * 50;
  return -990;
}

/** distanceScale is km per world unit. */
export function kmToWorldUnits(km: number, distanceScale: number): number {
  return km / (distanceScale || 1);
}

/** FNV-1a 32-bit. settlemaker's seed is a number; FMG's burg seed is a string. */
export function hashSeedToInt(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The same population scaling the watabou preview builders apply. */
export function scaledPopulation(population: number, populationRate: number, urbanization: number): number {
  return rn(population * populationRate * urbanization);
}

export interface CellWindow {
  center: number;
  cellIds: number[];
  radiusKm: number;
}

/** BFS from the centre cell, bounded by straight-line distance rather than hop count. */
export function collectWindow(
  center: number,
  cellsC: ArrayLike<number[]>,
  cellsP: ArrayLike<[number, number]>,
  radiusKm: number,
  distanceScale: number
): CellWindow {
  const radiusUnits = kmToWorldUnits(radiusKm, distanceScale);
  const maxSq = radiusUnits * radiusUnits;
  const [cx, cy] = cellsP[center] ?? [0, 0];

  const seen = new Set<number>([center]);
  const cellIds: number[] = [center];
  const queue = [center];

  while (queue.length) {
    const current = queue.shift() as number;
    for (const neighbour of cellsC[current] ?? []) {
      if (seen.has(neighbour)) continue;
      seen.add(neighbour);
      const p = cellsP[neighbour];
      if (!p) continue;
      const dx = p[0] - cx;
      const dy = p[1] - cy;
      if (dx * dx + dy * dy > maxSq) continue;
      cellIds.push(neighbour);
      queue.push(neighbour);
    }
  }

  return { center, cellIds, radiusKm };
}

export type RouteGroup = "roads" | "trails" | "searoutes" | "airroutes" | "traderoutes";

export interface Approach {
  routeId: number;
  group: RouteGroup;
  type?: string;
  name?: string;
  bearingDeg: number;
  through: boolean;
}

/**
 * One entry per route connection leaving the burg cell. An empty array is meaningful:
 * settlemaker treats [] as "this burg genuinely has no roads" and an omitted field as
 * "route data unknown", which makes it invent random gates instead.
 */
export function readApproaches(
  center: number,
  cellsRoutes: Record<number, Record<number, number>>,
  cellsP: ArrayLike<[number, number]>,
  routeById: Map<number, { group: RouteGroup; type?: string; name?: string }>
): Approach[] {
  const connections = cellsRoutes[center];
  if (!connections) return [];

  const [cx, cy] = cellsP[center] ?? [0, 0];
  const sidesByRoute = new Map<number, number>();
  for (const routeId of Object.values(connections)) {
    sidesByRoute.set(routeId, (sidesByRoute.get(routeId) ?? 0) + 1);
  }

  const approaches: Approach[] = [];
  for (const [neighbourKey, routeId] of Object.entries(connections)) {
    const route = routeById.get(routeId);
    if (!route) continue;
    const p = cellsP[Number(neighbourKey)];
    if (!p) continue;
    approaches.push({
      routeId,
      group: route.group,
      type: route.type,
      name: route.name,
      bearingDeg: compassBearing(p[0] - cx, p[1] - cy),
      through: (sidesByRoute.get(routeId) ?? 0) > 1
    });
  }

  return approaches.sort((a, b) => a.bearingDeg - b.bearingDeg);
}

export interface Hydrology {
  oceanBearingDeg?: number;
  harbourSize?: "large" | "small";
  coastal: boolean;
  lakeside: boolean;
}

export const LARGE_HARBOUR_MIN_POPULATION = 5000;

const SEA_TRADE_GROUPS = new Set<RouteGroup>(["searoutes", "traderoutes"]);

export function readHydrology(input: {
  window: CellWindow;
  cellsHaven: ArrayLike<number>;
  cellsHarbor: ArrayLike<number>;
  cellsF: ArrayLike<number>;
  cellsP: ArrayLike<[number, number]>;
  featureTypeById: (featureId: number) => string | undefined;
  approaches: Approach[];
  isPort: boolean;
  population: number;
}): Hydrology {
  const {
    window: win,
    cellsHaven,
    cellsHarbor,
    cellsF,
    cellsP,
    featureTypeById,
    approaches,
    isPort,
    population
  } = input;
  const center = win.center;

  const coastal = isPort || Number(cellsHarbor[center] ?? 0) > 0;

  const lakeside = win.cellIds.some(id => featureTypeById(Number(cellsF[id])) === "lake");

  const haven = Number(cellsHaven[center] ?? 0);
  const havenPoint = haven ? cellsP[haven] : undefined;
  const [cx, cy] = cellsP[center] ?? [0, 0];
  const oceanBearingDeg = coastal && havenPoint ? compassBearing(havenPoint[0] - cx, havenPoint[1] - cy) : undefined;

  const hasSeaTradeRoute = approaches.some(a => SEA_TRADE_GROUPS.has(a.group));
  const harbourSize = coastal
    ? hasSeaTradeRoute && population >= LARGE_HARBOUR_MIN_POPULATION
      ? "large"
      : "small"
    : undefined;

  return {
    coastal,
    lakeside,
    ...(oceanBearingDeg !== undefined && { oceanBearingDeg }),
    ...(harbourSize !== undefined && { harbourSize })
  };
}
