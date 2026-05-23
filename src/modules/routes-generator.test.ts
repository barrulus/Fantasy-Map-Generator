import { beforeAll, describe, expect, it } from "vitest";

let Routes: any;

beforeAll(async () => {
  const g = globalThis as any;
  g.window = g.window ?? {};
  g.Node =
    g.Node ??
    class {
      addEventListener() {}
      removeEventListener() {}
    };
  g.document = g.document ?? {
    readyState: "complete",
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null
  };
  g.pack = {};
  g.TIME = false;
  g.WARN = false;
  g.ERROR = false;

  await import("./routes-generator");
  Routes = g.window.Routes;
});

function buildPack(routeCount: number, groupCycle: string[] = ["roads", "trails", "searoutes"]) {
  const routes: any[] = [0];
  const cellRoutes: Record<number, Record<number, number>> = {};

  for (let i = 1; i <= routeCount; i++) {
    const group = groupCycle[(i - 1) % groupCycle.length];
    routes.push({ i, group });
    if (!cellRoutes[i]) cellRoutes[i] = {};
    cellRoutes[i][i + 1] = i;
    if (!cellRoutes[i + 1]) cellRoutes[i + 1] = {};
    cellRoutes[i + 1][i] = i;
  }

  (globalThis as any).pack = {
    routes,
    cells: { routes: cellRoutes }
  };
}

describe("Routes.getRoute", () => {
  it("returns the route object for a connected cell pair", () => {
    buildPack(5);
    const route = Routes.getRoute(3, 4);
    expect(route).not.toBeNull();
    expect(route.i).toBe(3);
    expect(route.group).toBe("searoutes");
  });

  it("returns null for cell pairs with no connection", () => {
    buildPack(5);
    expect(Routes.getRoute(1, 99)).toBeNull();
    expect(Routes.getRoute(50, 51)).toBeNull();
  });

  it("returns null when from cell has no entries", () => {
    buildPack(5);
    expect(Routes.getRoute(999, 1000)).toBeNull();
  });
});

describe("Routes.hasRoad", () => {
  it("returns true when the cell has any road connection", () => {
    (globalThis as any).pack = {
      routes: [0, { i: 1, group: "roads" }],
      cells: { routes: { 10: { 11: 1 }, 11: { 10: 1 } } }
    };
    expect(Routes.hasRoad(10)).toBe(true);
  });

  it("returns false when the cell only has non-road connections", () => {
    (globalThis as any).pack = {
      routes: [0, { i: 1, group: "trails" }, { i: 2, group: "searoutes" }],
      cells: { routes: { 10: { 11: 1, 12: 2 } } }
    };
    expect(Routes.hasRoad(10)).toBe(false);
  });

  it("returns false when the cell has no connections", () => {
    (globalThis as any).pack = { routes: [0], cells: { routes: {} } };
    expect(Routes.hasRoad(9999)).toBe(false);
  });
});

describe("Routes.isCrossroad", () => {
  it("returns true when a cell has 4+ route connections", () => {
    (globalThis as any).pack = {
      routes: [
        0,
        { i: 1, group: "roads" },
        { i: 2, group: "roads" },
        { i: 3, group: "roads" },
        { i: 4, group: "roads" }
      ],
      cells: { routes: { 100: { 101: 1, 102: 2, 103: 3, 104: 4 } } }
    };
    expect(Routes.isCrossroad(100)).toBe(true);
  });

  it("returns true when a cell has 3+ road connections", () => {
    (globalThis as any).pack = {
      routes: [0, { i: 1, group: "roads" }, { i: 2, group: "roads" }, { i: 3, group: "roads" }],
      cells: { routes: { 100: { 101: 1, 102: 2, 103: 3 } } }
    };
    expect(Routes.isCrossroad(100)).toBe(true);
  });

  it("returns false when a cell has 2 connections", () => {
    (globalThis as any).pack = {
      routes: [0, { i: 1, group: "roads" }, { i: 2, group: "roads" }],
      cells: { routes: { 100: { 101: 1, 102: 2 } } }
    };
    expect(Routes.isCrossroad(100)).toBe(false);
  });
});

describe("Routes lookup performance", () => {
  it("getRoute lookup time does not scale with total route count", () => {
    // 50,000 routes — about the scale that triggers the bug in real maps
    buildPack(50_000);

    // Realistic mixed-id lookup pattern (10K lookups spread across the id range).
    // With O(n) array.find: ~10K × ~25K avg scan = ~250M ops → 200–800ms in v8.
    // With O(1) Map.get: ~10K × O(1) → typically <30ms.
    const start = performance.now();
    let found = 0;
    for (let i = 0; i < 10_000; i++) {
      const id = ((i * 4999) % 50_000) + 1;
      const route = Routes.getRoute(id, id + 1);
      if (route) found++;
    }
    const elapsed = performance.now() - start;

    expect(found).toBe(10_000); // sanity: every lookup hits
    // Threshold is generous: a Map should finish in <50ms, but we allow 150ms
    // for slow CI hardware. The current O(n) impl typically takes 250ms+.
    expect(elapsed).toBeLessThan(150);
  });
});
