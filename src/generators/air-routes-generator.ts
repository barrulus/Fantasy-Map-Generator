import type { Burg } from "./burgs-generator";
import type { Route } from "./routes-generator";

// Air routes are direct point-to-point lines between sky ports (flying ignores
// terrain). Edges are an Urquhart graph over sky-port positions, computed by the
// caller so this stays a pure, testable transform. `i` is assigned later in
// createRoutesData.
export function buildAirRoutes(skyPorts: Burg[], urquhartEdges: number[][]): Route[] {
  if (skyPorts.length < 2) return [];

  const airRoutes: Route[] = [];
  for (const [fromId, toId] of urquhartEdges) {
    const from = skyPorts[fromId];
    const to = skyPorts[toId];
    airRoutes.push({
      i: 0,
      group: "airroutes",
      feature: 0,
      points: [
        [from.x, from.y, from.cell],
        [to.x, to.y, to.cell]
      ]
    });
  }
  return airRoutes;
}
