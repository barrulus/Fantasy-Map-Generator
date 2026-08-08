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
