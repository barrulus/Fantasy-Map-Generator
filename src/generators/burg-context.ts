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
