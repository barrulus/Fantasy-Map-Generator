import type { BurgContext } from "@/generators/burg-context";
import { hashSeedToInt } from "@/generators/burg-context";

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

/** traderoutes are maritime lanes in this fork, not land roads — see SEA_TRADE_GROUPS. */
export const LAND_ROUTE_GROUPS = new Set<string>(["roads", "trails"]);

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

export const SETTLEMAKER_BASE_URL = "https://settlemaker.com/fmg";
export const URL_PAYLOAD_VERSION = 1;
/** url-api.md §3: keep the encoded i= value under ~8KB for margin against proxy limits. */
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

/** url-api.md §4. Used when CompressionStream is unavailable; cannot express roadBearings. */
export function buildFlatTierUrl(input: AzgaarBurgInput, seed: number): string {
  const params = new URLSearchParams({
    name: input.name,
    pop: String(input.population),
    seed: String(seed),
    port: input.port ? "1" : "0",
    citadel: input.citadel ? "1" : "0",
    walls: input.walls ? "1" : "0",
    plaza: input.plaza ? "1" : "0",
    temple: input.temple ? "1" : "0",
    shanty: input.shanty ? "1" : "0",
    capital: input.capital ? "1" : "0"
  });
  if (input.oceanBearing !== undefined) params.set("oceanBearing", String(input.oceanBearing));
  if (input.harbourSize) params.set("harbourSize", input.harbourSize);
  if (input.biome) params.set("biome", input.biome);
  if (input.urbanDensity !== undefined) params.set("urbanDensity", String(input.urbanDensity));
  if (input.trade) params.set("trade", "1"); // only present at all when true
  return `${SETTLEMAKER_BASE_URL}?${params.toString()}`;
}

export async function buildSettlemakerUrl(
  ctx: BurgContext,
  opts: { urbanDensity?: number; trade?: boolean }
): Promise<{ link: string; preview: string }> {
  const input = toSettlemakerInput(ctx, opts);
  const seed = hashSeedToInt(ctx.burg.seedKey);

  if (typeof CompressionStream === "undefined") {
    const link = buildFlatTierUrl(input, seed);
    return { link, preview: link };
  }

  const encoded = await encodeJsonParam({ v: URL_PAYLOAD_VERSION, burg: input, seed });
  if (encoded.length > MAX_ENCODED_PAYLOAD_BYTES) {
    WARN && console.warn(`settlemaker payload ${encoded.length}B exceeds budget; falling back to flat tier`);
    const link = buildFlatTierUrl(input, seed);
    return { link, preview: link };
  }

  // /fmg is already chrome-free, so there is no separate preview variant.
  const link = `${SETTLEMAKER_BASE_URL}?i=${encoded}`;
  return { link, preview: link };
}
