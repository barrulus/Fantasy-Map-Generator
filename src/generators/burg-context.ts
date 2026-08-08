import { rn } from "../utils";
import type { Burg } from "./burgs-generator";

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

/**
 * Radius of the local window. Sized as a multiple of the settlement's own extent so a
 * pass or valley on an approach usually falls inside it; see the spec's assumptions.
 */
export const DEFAULT_WINDOW_RADIUS_KM = 12;

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
  corridor?: Corridor;
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

export interface Terrain {
  elevationM: number;
}

export function readTerrain(input: { window: CellWindow; cellsH: ArrayLike<number>; heightExponent: number }): Terrain {
  const { window: win, cellsH, heightExponent } = input;
  return { elevationM: elevationMetres(Number(cellsH[win.center] ?? 0), heightExponent) };
}

export interface Climate {
  temperatureC: number;
  biome: string;
}

export function readClimate(input: {
  window: CellWindow;
  cellsG: ArrayLike<number>;
  cellsBiome: ArrayLike<number>;
  gridTemp: ArrayLike<number>;
  biomeNameById: (biomeId: number) => string | undefined;
}): Climate {
  const { window: win, cellsG, cellsBiome, gridTemp, biomeNameById } = input;
  const gridCell = Number(cellsG[win.center] ?? 0);
  return {
    temperatureC: Number(gridTemp[gridCell] ?? 0),
    biome: biomeNameById(Number(cellsBiome[win.center] ?? 0)) ?? ""
  };
}

export interface BurgContext {
  burg: {
    i: number;
    name: string;
    population: number;
    seedKey: string;
    capital: boolean;
    port: boolean;
    citadel: boolean;
    walls: boolean;
    plaza: boolean;
    temple: boolean;
    shanty: boolean;
    culture?: string;
  };
  window: { radiusKm: number; cellCount: number };
  approaches: Approach[];
  hydrology: Hydrology;
  terrain: Terrain;
  climate: Climate;
}

export interface Corridor {
  sampledKm: number;
  elevationDeltaM: number;
  maxGradient: number;
  relief: "descent" | "ascent" | "valley" | "ridge" | "flat";
  followsRiver: boolean;
  riverId?: number;
  biomes: string[];
  minTempC: number;
}

/** Metres of height change below which a corridor reads as level. */
const RELIEF_TOLERANCE_M = 40;

export function readCorridor(input: {
  routeCells: number[];
  cellsH: ArrayLike<number>;
  cellsP: ArrayLike<[number, number]>;
  cellsR: ArrayLike<number>;
  cellsG: ArrayLike<number>;
  cellsBiome: ArrayLike<number>;
  gridTemp: ArrayLike<number>;
  biomeNameById: (id: number) => string | undefined;
  heightExponent: number;
  distanceScale: number;
}): Corridor {
  const { routeCells, cellsH, cellsP, cellsR, cellsG, cellsBiome, gridTemp, biomeNameById } = input;
  const { heightExponent, distanceScale } = input;

  const heights = routeCells.map(id => elevationMetres(Number(cellsH[id] ?? 0), heightExponent));

  const biomes: string[] = [];
  let minTempC = Number.POSITIVE_INFINITY;
  const riverCounts = new Map<number, number>();

  for (const id of routeCells) {
    const name = biomeNameById(Number(cellsBiome[id] ?? 0));
    if (name && biomes.at(-1) !== name && !biomes.includes(name)) biomes.push(name);

    const temp = Number(gridTemp[Number(cellsG[id] ?? 0)] ?? 0);
    if (temp < minTempC) minTempC = temp;

    const river = Number(cellsR[id] ?? 0);
    if (river) riverCounts.set(river, (riverCounts.get(river) ?? 0) + 1);
  }
  if (!Number.isFinite(minTempC)) minTempC = 0;

  let sampledKm = 0;
  let maxGradient = 0;
  for (let i = 1; i < routeCells.length; i++) {
    const a = cellsP[routeCells[i - 1]];
    const b = cellsP[routeCells[i]];
    if (!a || !b) continue;
    const stepKm = Math.hypot(b[0] - a[0], b[1] - a[1]) * (distanceScale || 1);
    sampledKm += stepKm;
    if (stepKm > 0) {
      const gradient = Math.abs(heights[i] - heights[i - 1]) / (stepKm * 1000);
      if (gradient > maxGradient) maxGradient = gradient;
    }
  }

  const elevationDeltaM = heights.length > 1 ? heights.at(-1)! - heights[0] : 0;

  // A river only counts as followed when the corridor runs along it, not merely crosses it.
  let followsRiver = false;
  let riverId: number | undefined;
  for (const [id, count] of riverCounts) {
    if (count >= 2) {
      followsRiver = true;
      riverId = id;
      break;
    }
  }

  const relief = ((): Corridor["relief"] => {
    if (heights.length < 3) {
      if (elevationDeltaM > RELIEF_TOLERANCE_M) return "ascent";
      if (elevationDeltaM < -RELIEF_TOLERANCE_M) return "descent";
      return "flat";
    }
    const middle = heights.slice(1, -1);
    const midMin = Math.min(...middle);
    const midMax = Math.max(...middle);
    const first = heights[0];
    const last = heights.at(-1) as number;
    if (first - midMin > RELIEF_TOLERANCE_M && last - midMin > RELIEF_TOLERANCE_M) return "valley";
    if (midMax - first > RELIEF_TOLERANCE_M && midMax - last > RELIEF_TOLERANCE_M) return "ridge";
    if (elevationDeltaM > RELIEF_TOLERANCE_M) return "ascent";
    if (elevationDeltaM < -RELIEF_TOLERANCE_M) return "descent";
    return "flat";
  })();

  return { sampledKm, elevationDeltaM, maxGradient, relief, followsRiver, riverId, biomes, minTempC };
}

/**
 * A route's cells run end to end, so a through-route has two arms at the burg. Sample the
 * longer one — it carries more of the corridor's character.
 */
export function orderRouteCellsOutward(routeCells: number[], center: number): number[] {
  const at = routeCells.indexOf(center);
  if (at === -1) return [center];

  const backward = routeCells.slice(0, at + 1).reverse();
  const forward = routeCells.slice(at);
  return backward.length >= forward.length ? backward : forward;
}

/** The only function here that reads globals. Everything above it is pure. */
export function buildBurgContext(burg: Burg): BurgContext {
  const { cells, features, routes, biomes, cultures } = pack;
  const cell = burg.cell;

  const population = scaledPopulation(burg.population ?? 0, populationRate, urbanization);
  const win = collectWindow(cell, cells.c, cells.p, DEFAULT_WINDOW_RADIUS_KM, distanceScale);

  const routeById = new Map(routes.map(r => [r.i, { group: r.group as RouteGroup, type: r.type, name: r.name }]));
  // Flying burgs are not on the ground route network.
  const routeCellsById = new Map(routes.map(r => [r.i, r.cells ?? []]));
  const approaches = burg.flying ? [] : readApproaches(cell, cells.routes, cells.p, routeById);
  const windowCells = new Set(win.cellIds);
  const heightExponent = Number(heightExponentInput?.value ?? 2);
  for (const approach of approaches) {
    const outward = orderRouteCellsOutward(routeCellsById.get(approach.routeId) ?? [], cell);
    // Clip to the window: the readings must stay traceable to the window that produced them.
    const clipped: number[] = [];
    for (const id of outward) {
      if (!windowCells.has(id)) break;
      clipped.push(id);
    }
    approach.corridor = readCorridor({
      routeCells: clipped.length ? clipped : [cell],
      cellsH: cells.h,
      cellsP: cells.p,
      cellsR: cells.r,
      cellsG: cells.g,
      cellsBiome: cells.biome,
      gridTemp: grid.cells.temp,
      biomeNameById: id => biomes[id]?.name,
      heightExponent,
      distanceScale
    });
  }

  const hydrology = readHydrology({
    window: win,
    cellsHaven: cells.haven,
    cellsHarbor: cells.harbor,
    cellsF: cells.f,
    cellsP: cells.p,
    featureTypeById: id => features[id]?.type,
    approaches,
    isPort: Number(burg.port ?? 0) > 0,
    population
  });

  const terrain = readTerrain({
    window: win,
    cellsH: cells.h,
    heightExponent
  });

  const climate = readClimate({
    window: win,
    cellsG: cells.g,
    cellsBiome: cells.biome,
    gridTemp: grid.cells.temp,
    biomeNameById: id => biomes[id]?.name
  });

  return {
    burg: {
      i: burg.i,
      name: burg.name ?? "",
      population,
      seedKey: `${seed}${String(burg.i).padStart(4, "0")}`,
      capital: Boolean(burg.capital),
      port: Boolean(burg.port),
      citadel: Boolean(burg.citadel),
      walls: Boolean(burg.walls),
      plaza: Boolean(burg.plaza),
      temple: Boolean(burg.temple),
      shanty: Boolean(burg.shanty),
      culture: burg.culture === undefined ? undefined : cultures[burg.culture]?.name
    },
    window: { radiusKm: win.radiusKm, cellCount: win.cellIds.length },
    approaches,
    hydrology,
    terrain,
    climate
  };
}
