import { buildBurgContext } from "@/generators/burg-context";
import type { Burg } from "@/generators/burgs-generator";
import { surveyBurgWater } from "./burg-water-survey";
import { type AzgaarBurgInput, buildSettlemakerUrl, SETTLEMAKER_BASE_URL } from "./settlemaker";

/** Override the supporting production renderer for local testing or another deployment. */
export const MEASURED_WATER_RENDERER =
  (import.meta.env.VITE_SETTLEMAKER_WATER_CONTEXT_URL as string | undefined) || SETTLEMAKER_BASE_URL;

export function waterSurveyRadius(population: number, override?: number): number {
  const configured = import.meta.env.VITE_SETTLEMAKER_WATER_SURVEY_RADIUS_M as string | undefined;
  // Allow for the city's cultivated envelope, its diagonal and a navigation margin.
  const cityRadius = Math.max(4000, Math.ceil((Math.sqrt(population * 240) + 1500) / 1000) * 1000);
  const radius = override ?? (configured ? Number(configured) : population > 1000 ? cityRadius : 3000);
  if (!Number.isFinite(radius) || radius < 3000)
    throw new Error("The measured water survey radius must be at least 3000 metres");
  return radius;
}

export function harbourWaterKind(burg: Burg): AzgaarBurgInput["harbourWaterKind"] {
  if (!burg.port) return undefined;
  const haven = pack.cells.haven[burg.cell];
  const local = pack.cells.harbor[burg.cell] > 0 ? pack.features[pack.cells.f[haven]] : undefined;
  if (local?.type === "ocean" || local?.type === "lake") return local.type;
  if (pack.cells.r[burg.cell]) return "river";
  return undefined;
}

export async function createSettlemakerPreview(
  burg: Burg,
  surveyOptions: { surveyRadiusM?: number } = {}
): Promise<{ link: string; preview: string }> {
  const ctx = buildBurgContext(burg);
  const opts = {
    urbanDensity: options.map.units.population.urbanization.density,
    trade: burg.tradeRole === "hub"
  };
  if (ctx.burg.population < 1) return buildSettlemakerUrl(ctx, opts);
  const endpoint = new URL(MEASURED_WATER_RENDERER);
  if (
    endpoint.search ||
    endpoint.hash ||
    endpoint.pathname !== "/fmg" ||
    (endpoint.protocol !== "https:" &&
      !(endpoint.protocol === "http:" && ["localhost", "127.0.0.1"].includes(endpoint.hostname)))
  ) {
    throw new Error("The measured water preview renderer address is invalid");
  }
  const waterKind = harbourWaterKind(burg);
  return buildSettlemakerUrl(ctx, {
    ...opts,
    harbourWaterKind: waterKind,
    ...(waterKind === "river" ? { harbourRiverId: String(pack.cells.r[burg.cell]) } : {}),
    baseUrl: endpoint.toString(),
    waterSurvey: surveyBurgWater(
      burg,
      ctx.hydrology.rivers.map(river => river.id),
      waterSurveyRadius(ctx.burg.population, surveyOptions.surveyRadiusM)
    )
  });
}
