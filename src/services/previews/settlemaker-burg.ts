import { buildBurgContext } from "@/generators/burg-context";
import type { Burg } from "@/generators/burgs-generator";
import { surveyBurgWater } from "./burg-water-survey";
import { buildSettlemakerUrl } from "./settlemaker";

/** Set only for a deployed renderer explicitly supporting the village water-context-v1 contract. */
export const MEASURED_WATER_RENDERER = import.meta.env.VITE_SETTLEMAKER_WATER_CONTEXT_URL as string | undefined;

export async function createSettlemakerPreview(burg: Burg): Promise<{ link: string; preview: string }> {
  const ctx = buildBurgContext(burg);
  const measured = MEASURED_WATER_RENDERER && ctx.burg.population >= 1 && ctx.burg.population <= 1000;
  const opts = {
    urbanDensity: options.map.units.population.urbanization.density,
    trade: burg.tradeRole === "hub"
  };
  if (!measured) return buildSettlemakerUrl(ctx, opts);
  const endpoint = new URL(MEASURED_WATER_RENDERER!);
  if (
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/fmg" ||
    (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname)))
  ) {
    throw new Error("The measured water preview renderer address is invalid");
  }
  return buildSettlemakerUrl(ctx, {
    ...opts,
    baseUrl: endpoint.toString(),
    waterSurvey: surveyBurgWater(
      burg,
      ctx.hydrology.rivers.map(river => river.id)
    )
  });
}
