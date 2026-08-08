import type { BurgContext } from "@/generators/burg-context";

export interface SettlemakerRoadBearing {
  bearing_deg: number;
  route_id: string;
  kind: string;
}

/** Mirrors AzgaarBurgInput in settlemaker's src/input/azgaar-input.ts (url-api.md §3). */
export interface AzgaarBurgInput {
  name: string;
  population: number;
  port: boolean;
  citadel: boolean;
  walls: boolean;
  plaza: boolean;
  temple: boolean;
  shanty: boolean;
  capital: boolean;
  culture?: string;
  elevation?: number;
  temperature?: number;
  roadBearings?: SettlemakerRoadBearing[];
  oceanBearing?: number;
  harbourSize?: "large" | "small";
  urbanDensity?: number;
  biome?: string;
  trade?: boolean;
}

export const LAND_ROUTE_GROUPS = new Set<string>(["roads", "trails", "traderoutes"]);

/**
 * The narrow projection: everything settlemaker declares today, nothing else.
 * When settlemaker adds a field, this is the only function that changes.
 */
export function toSettlemakerInput(
  ctx: BurgContext,
  opts: { urbanDensity?: number; trade?: boolean }
): AzgaarBurgInput {
  const { burg, hydrology, terrain, climate } = ctx;

  const input: AzgaarBurgInput = {
    name: burg.name,
    population: burg.population,
    // All seven are always present: settlemaker's decoder validates only name and
    // population, so an omitted boolean silently becomes false.
    port: burg.port,
    citadel: burg.citadel,
    walls: burg.walls,
    plaza: burg.plaza,
    temple: burg.temple,
    shanty: burg.shanty,
    capital: burg.capital,
    // [] means "genuinely no roads"; omitting would make settlemaker invent gates.
    roadBearings: ctx.approaches
      .filter(a => LAND_ROUTE_GROUPS.has(a.group))
      .map(a => ({ bearing_deg: a.bearingDeg, route_id: String(a.routeId), kind: a.group }))
  };

  if (hydrology.oceanBearingDeg !== undefined) input.oceanBearing = hydrology.oceanBearingDeg;
  if (hydrology.harbourSize) input.harbourSize = hydrology.harbourSize;
  if (climate.biome) input.biome = climate.biome;
  if (burg.culture) input.culture = burg.culture;
  input.elevation = terrain.elevationM;
  input.temperature = climate.temperatureC;
  if (opts.urbanDensity && opts.urbanDensity > 0) input.urbanDensity = opts.urbanDensity;
  if (opts.trade) input.trade = true;

  return input;
}
