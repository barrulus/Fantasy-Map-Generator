import { buildBurgContext } from "@/generators/burg-context";
import type { Burg } from "@/generators/burgs-generator";
import { surveyBurgWater } from "./burg-water-survey";
import { type AzgaarBurgInput, buildSettlemakerUrl, SETTLEMAKER_BASE_URL } from "./settlemaker";

/** Override the supporting production renderer for local testing or another deployment. */
export const MEASURED_WATER_RENDERER =
  (import.meta.env.VITE_SETTLEMAKER_WATER_CONTEXT_URL as string | undefined) || SETTLEMAKER_BASE_URL;

export function waterSurveyRadius(population: number, override?: number): number {
  const configured = import.meta.env.VITE_SETTLEMAKER_WATER_SURVEY_RADIUS_M as string | undefined;
  // Reserve coverage for waterfront alignment and development across both river banks.
  const cityRadius = Math.max(4000, Math.ceil((Math.sqrt(population * 240) + 1500) / 1000) * 1000);
  const radius = override ?? (configured ? Number(configured) : population > 1000 ? cityRadius * 2 : 6000);
  if (!Number.isFinite(radius) || radius < 3000)
    throw new Error("The measured water survey radius must be at least 3000 metres");
  return radius;
}

export function burgWaterfront(burg: Burg): AzgaarBurgInput["waterfront"] {
  const { cells, features } = pack;
  const neighbours = cells.c?.[burg.cell] ?? [];
  const ownRiver = cells.r[burg.cell];
  const riverCell = ownRiver
    ? burg.cell
    : neighbours
        .filter(cell => cells.r[cell])
        .sort((a, b) => {
          const distance = (cell: number) => Math.hypot(cells.p[cell][0] - burg.x, cells.p[cell][1] - burg.y);
          return distance(a) - distance(b) || a - b;
        })[0];
  const shore = cells.harbor[burg.cell] > 0 ? features[cells.f[cells.haven[burg.cell]]] : undefined;
  const shoreKind = shore?.type === "ocean" || shore?.type === "lake" ? shore.type : undefined;
  if (riverCell === undefined && !shoreKind) return undefined;
  return {
    ...(riverCell !== undefined && { riverId: String(cells.r[riverCell]) }),
    ...(shoreKind && { shoreKind, shoreFeatureId: String(cells.f[cells.haven[burg.cell]]) })
  };
}

export function harbourWaterKind(burg: Burg): AzgaarBurgInput["harbourWaterKind"] {
  if (!burg.port) return undefined;
  const waterfront = burgWaterfront(burg);
  return waterfront?.shoreKind ?? (waterfront?.riverId ? "river" : undefined);
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
  const waterfront = burgWaterfront(burg);
  const waterKind = burg.port ? (waterfront?.shoreKind ?? (waterfront?.riverId ? "river" : undefined)) : undefined;
  return buildSettlemakerUrl(ctx, {
    ...opts,
    harbourWaterKind: waterKind,
    waterfront,
    ...(waterKind === "river" ? { harbourRiverId: waterfront!.riverId } : {}),
    baseUrl: endpoint.toString(),
    waterSurvey: surveyBurgWater(
      burg,
      ctx.hydrology.rivers.map(river => river.id),
      waterSurveyRadius(ctx.burg.population, surveyOptions.surveyRadiusM),
      waterfront?.riverId,
      waterfront?.shoreKind ? { kind: waterfront.shoreKind, featureId: waterfront.shoreFeatureId } : undefined
    )
  });
}
