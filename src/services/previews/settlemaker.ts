import type { BurgContext, Corridor } from "@/generators/burg-context";
import { hashSeedToInt } from "@/generators/burg-context";
import type { RiverSurvey, WaterContext, WaterSurvey } from "./water-context-types";

type LandRouteClass = "royal" | "main" | "market" | "town" | "local" | "trail" | "footpath";

export interface SettlemakerRoadBearing {
  bearing_deg: number;
  route_id: string;
  kind: LandRouteClass;
  group: "roads" | "trails";
  through: boolean;
  relief?: Corridor["relief"];
  followsRiver?: boolean;
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
  harbourWaterKind?: "ocean" | "lake" | "river";
  harbourRiverId?: string;
  waterfront?: { riverId?: string; shoreKind?: "ocean" | "lake"; shoreFeatureId?: string };
  urbanDensity?: number;
  coreCapacity?: number;
  coastlineGeometry?: Array<Array<{ x: number; y: number }>>;
  rivers?: RiverSurvey[];
  waterContext?: WaterContext;
  biome?: string;
  trade?: boolean;
}

/**
 * routes-generator emits exactly settlemaker's RouteType vocabulary, so a route's type is its
 * settlemaker class verbatim. Legacy "road"/"foot" are deliberately not used: they take a
 * different path through the engine than the seven classes, which made the two tiers disagree.
 */
const ROUTE_CLASSES = new Set(["royal", "main", "market", "town", "local", "trail", "footpath"]);

/**
 * Land groups, and the class to assume for a route carrying no type or a custom one. Anything
 * outside this map is dropped: settlemaker's classRank returns -1 for an unknown class and
 * -1 <= classRank("local"), so an unrecognised value is silently drawn as a road, never rejected.
 * traderoutes are maritime lanes in this fork, not land roads — see SEA_TRADE_GROUPS.
 */
export const LAND_ROUTE_KINDS: Record<string, "main" | "trail"> = { roads: "main", trails: "trail" };

/**
 * Project the available burg context onto the URL API 2.4.0 contract.
 * Context has no filled water polygons, so use the supported oceanBearing fallback.
 */
export function toSettlemakerInput(
  ctx: BurgContext,
  opts: {
    urbanDensity?: number;
    trade?: boolean;
    harbourWaterKind?: AzgaarBurgInput["harbourWaterKind"];
    harbourRiverId?: string;
    waterfront?: AzgaarBurgInput["waterfront"];
  }
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
    roadBearings: ctx.approaches.flatMap(a => {
      const fallback = LAND_ROUTE_KINDS[a.group];
      if (!fallback) return [];
      return [
        {
          bearing_deg: a.bearingDeg,
          route_id: String(a.routeId),
          kind: a.type && ROUTE_CLASSES.has(a.type) ? (a.type as LandRouteClass) : fallback,
          group: a.group as "roads" | "trails",
          through: a.through,
          ...(a.corridor && { relief: a.corridor.relief, followsRiver: a.corridor.followsRiver })
        }
      ];
    })
  };

  if (hydrology.oceanBearingDeg !== undefined) input.oceanBearing = hydrology.oceanBearingDeg;
  if (burg.port && hydrology.harbourSize) input.harbourSize = hydrology.harbourSize;
  if (burg.port && opts.harbourWaterKind) input.harbourWaterKind = opts.harbourWaterKind;
  if (burg.port && opts.harbourWaterKind === "river" && opts.harbourRiverId) input.harbourRiverId = opts.harbourRiverId;
  if (opts.waterfront) input.waterfront = opts.waterfront;
  if (climate.biome) input.biome = climate.biome;
  if (burg.culture) input.culture = burg.culture;
  input.elevation = terrain.elevationM;
  input.temperature = climate.temperatureC;
  if (Number.isFinite(opts.urbanDensity) && opts.urbanDensity! > 0) input.urbanDensity = opts.urbanDensity;
  if (opts.trade) input.trade = true;

  return input;
}

export const SETTLEMAKER_BASE_URL = "https://settlemaker.com/fmg";
export const URL_PAYLOAD_VERSION = 1;
/** Larger payloads use a fragment, which is not sent through HTTP proxies. */
export const MAX_ENCODED_PAYLOAD_BYTES = 8192;

/** JSON → UTF-8 → deflate-raw → base64url, per url-api.md §3. */
export async function encodeJsonParam(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = "";
  for (const b of packed) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function buildSettlemakerUrl(
  ctx: BurgContext,
  opts: {
    urbanDensity?: number;
    trade?: boolean;
    harbourWaterKind?: AzgaarBurgInput["harbourWaterKind"];
    harbourRiverId?: string;
    waterfront?: AzgaarBurgInput["waterfront"];
    waterSurvey?: WaterSurvey;
    baseUrl?: string;
  }
): Promise<{ link: string; preview: string }> {
  const input = toSettlemakerInput(ctx, opts);
  if (opts.waterSurvey) {
    if (!Number.isFinite(ctx.burg.population) || ctx.burg.population < 1)
      throw new Error("Measured water requires a positive settlement population");
    Object.assign(input, opts.waterSurvey);
  }
  const seed = hashSeedToInt(ctx.burg.seedKey);

  const compact = Boolean(input.coastlineGeometry || input.rivers);
  const burg = compact
    ? {
        ...input,
        ...(input.coastlineGeometry && {
          coastlineGeometry: input.coastlineGeometry.map(polygon => polygon.map(({ x, y }) => [x, y]))
        }),
        ...(input.rivers && {
          rivers: input.rivers.map(river => ({
            ...river,
            centreline: river.centreline.map(({ x, y }) => [x, y])
          }))
        })
      }
    : input;
  const encoded = await encodeJsonParam({
    v: URL_PAYLOAD_VERSION,
    ...(compact && { geometryEncoding: "xy-tuples" }),
    burg,
    seed
  });
  const separator = encoded.length > MAX_ENCODED_PAYLOAD_BYTES ? "#" : "?";
  const link = `${opts.baseUrl ?? SETTLEMAKER_BASE_URL}${separator}i=${encoded}`;
  return { link, preview: link };
}
