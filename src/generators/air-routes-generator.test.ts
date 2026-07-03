import { describe, expect, it } from "vitest";
import { buildAirRoutes } from "./air-routes-generator";

describe("buildAirRoutes", () => {
  const skyPorts = [
    { i: 1, x: 0, y: 0, cell: 10 },
    { i: 2, x: 100, y: 0, cell: 20 },
    { i: 3, x: 50, y: 80, cell: 30 }
  ] as any[];

  it("emits one direct point-line route per Urquhart edge", () => {
    const edges = [
      [0, 1],
      [1, 2]
    ];
    const routes = buildAirRoutes(skyPorts, edges);
    expect(routes.length).toBe(2);
    expect(routes[0].group).toBe("airroutes");
    expect(routes[0].points).toEqual([
      [0, 0, 10],
      [100, 0, 20]
    ]);
  });

  it("returns no routes when there are fewer than 2 sky ports", () => {
    expect(buildAirRoutes([skyPorts[0]], []).length).toBe(0);
  });
});
