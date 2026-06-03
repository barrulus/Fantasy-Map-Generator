import { beforeAll, describe, expect, it } from "vitest";
import { isWrapEnabled, portImportance, wrapDeltaX, wrapDistanceSquared } from "./routes-generator";

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

describe("buildSeaAdjacency", () => {
  it("links west-edge water cells to the nearest east-edge water cell by latitude", () => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    // cells: 0 west-water(y10), 1 east-water(y12), 2 interior-water, 3 west-LAND, 4 east-water(y82), 5 west-water(y78)
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1, 2, 3, 4, 5]),
        h: [0, 0, 0, 30, 0, 0],
        p: [
          [10, 10],
          [90, 12],
          [50, 50],
          [10, 80],
          [88, 82],
          [12, 78]
        ] as [number, number][],
        c: [[], [], [], [], [], []] as number[][]
      }
    };

    const adj = (Routes as any).buildSeaAdjacency();

    expect(adj[0]).toContain(1); // west(y10) -> east(y12)
    expect(adj[1]).toContain(0); // bidirectional
    expect(adj[5]).toContain(4); // west(y78) -> east(y82)
    expect(adj[4]).toContain(5);
    expect(adj[3]).toEqual([]); // land edge cell untouched
    expect(g.pack.cells.c[0]).toEqual([]); // global graph NOT mutated
  });
});

describe("wrap helpers", () => {
  it("wrapDeltaX returns the shorter cylinder gap", () => {
    expect(wrapDeltaX(10, 100)).toBe(10); // direct is shorter
    expect(wrapDeltaX(90, 100)).toBe(10); // around the seam is shorter
    expect(wrapDeltaX(-90, 100)).toBe(10); // sign-independent
    expect(wrapDeltaX(50, 100)).toBe(50); // exactly half
  });

  it("wrapDistanceSquared wraps X only when enabled", () => {
    const a: [number, number] = [5, 40];
    const b: [number, number] = [95, 40];
    expect(wrapDistanceSquared(a, b, false, 100)).toBe(90 * 90); // flat: far
    expect(wrapDistanceSquared(a, b, true, 100)).toBe(10 * 10); // wrapped: close
  });

  it("isWrapEnabled is true only at lonT === 360", () => {
    const g = globalThis as any;
    g.mapCoordinates = { lonT: 360 };
    expect(isWrapEnabled()).toBe(true);
    g.mapCoordinates = { lonT: 359.9 };
    expect(isWrapEnabled()).toBe(false);
    g.mapCoordinates = undefined;
    expect(isWrapEnabled()).toBe(false);
  });
});

describe("calculateUrquhartEdges wrap", () => {
  const hasEdge = (edges: number[][], a: number, b: number) =>
    edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

  it("connects points across the seam only when wrap is enabled", () => {
    // 0 & 1 hug opposite edges at the same latitude; 2 & 3 are interior anchors
    const points: [number, number][] = [
      [5, 50], // 0 west edge
      [95, 50], // 1 east edge
      [40, 10], // 2
      [60, 90] // 3
    ];

    const flat = (Routes as any).calculateUrquhartEdges(points, false, 100);
    const wrapped = (Routes as any).calculateUrquhartEdges(points, true, 100);

    expect(hasEdge(flat, 0, 1)).toBe(false); // far apart on the flat map
    expect(hasEdge(wrapped, 0, 1)).toBe(true); // close across the seam
  });
});

describe("getPath seam split", () => {
  beforeAll(() => {
    const g = globalThis as any;
    g.graphWidth = 1000;
    g.mapCoordinates = { lonT: 360 };
  });

  const countMoves = (d: string) => (d.match(/M/g) || []).length;

  it("splits a seam-crossing route into two stubs reaching both frame edges", () => {
    // crosses the seam: x jumps from 980 to 20 (|dx| = 960 > 500)
    const points = [
      [940, 300, 0],
      [980, 305, 1],
      [20, 310, 2],
      [60, 315, 3]
    ];
    const d = (Routes as any).getPath({ group: "searoutes", points });
    expect(countMoves(d)).toBe(2); // two sub-paths
    expect(d).toContain("1000"); // one stub runs to the east frame (x=graphWidth)
    expect(/M\s*0[ ,]/.test(d) || d.includes("M0")).toBe(true); // other stub starts at x=0
  });

  it("leaves a normal (non-crossing) route as a single path", () => {
    const points = [
      [100, 300, 0],
      [200, 305, 1],
      [300, 310, 2]
    ];
    const d = (Routes as any).getPath({ group: "searoutes", points });
    expect(countMoves(d)).toBe(1);
  });
});

describe("getLength wrapped", () => {
  it("measures a seam route by wrapped distance, not the screen gap", () => {
    const g = globalThis as any;
    g.graphWidth = 1000;
    g.mapCoordinates = { lonT: 360 };
    g.pack = {
      routes: [
        {
          i: 7,
          group: "searoutes",
          points: [
            [980, 300, 0],
            [20, 300, 1]
          ]
        } // |dx|=960 seam crossing
      ]
    };

    const len = Routes.getLength(7);
    // wrapped horizontal gap is 40, not 960
    expect(len).toBeCloseTo(40, 5);
  });
});

describe("portImportance", () => {
  const port = (population: number, settlementType: string, capital = 0) =>
    ({ population, settlementType, capital }) as any;

  it("ranks roles capital > largePort > regionalCenter > marketTown > village > hamlet at equal population", () => {
    const cap = portImportance(port(1, "capital"));
    const lp = portImportance(port(1, "largePort"));
    const rc = portImportance(port(1, "regionalCenter"));
    const mt = portImportance(port(1, "marketTown"));
    const vil = portImportance(port(1, "largeVillage"));
    const ham = portImportance(port(1, "hamlet"));
    expect(cap).toBeGreaterThan(lp);
    expect(lp).toBeGreaterThan(rc);
    expect(rc).toBeGreaterThan(mt);
    expect(mt).toBeGreaterThan(vil);
    expect(vil).toBeGreaterThan(ham);
  });

  it("scales with population within a role", () => {
    expect(portImportance(port(2, "marketTown"))).toBeGreaterThan(portImportance(port(1, "marketTown")));
  });

  it("treats the capital flag as the capital role regardless of settlementType", () => {
    expect(portImportance(port(1, "hamlet", 1))).toBe(portImportance(port(1, "capital")));
  });

  it("defaults unknown roles to a 1.0 multiplier and missing population to 0", () => {
    expect(portImportance(port(2, "mystery"))).toBe(2);
    expect(portImportance({} as any)).toBe(0);
  });
});

describe("collectSeamLinks", () => {
  it("pairs each west-edge water cell with the nearest east-edge water cell by latitude", () => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1, 2, 3, 4, 5]),
        h: [0, 0, 0, 30, 0, 0],
        p: [
          [10, 10],
          [90, 12],
          [50, 50],
          [10, 80],
          [88, 82],
          [12, 78]
        ] as [number, number][],
        c: [[], [], [], [], [], []] as number[][]
      }
    };

    const links = (Routes as any).collectSeamLinks() as Array<[number, number]>;
    const has = (a: number, b: number) => links.some(([w, e]) => w === a && e === b);
    expect(has(0, 1)).toBe(true); // west(y10) -> east(y12)
    expect(has(5, 4)).toBe(true); // west(y78) -> east(y82)
    expect(links.length).toBe(2); // only the two west water cells produce links
  });

  it("returns no links when an edge has no water", () => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1]),
        h: [0, 0],
        p: [
          [10, 10],
          [50, 50]
        ] as [number, number][],
        c: [[], []] as number[][]
      }
    };
    expect((Routes as any).collectSeamLinks()).toEqual([]);
  });
});

describe("buildNavigableComponents", () => {
  // Two edge water cells (feature 1 west, feature 2 east) + ports on each feature.
  const setup = (lonT: number) => {
    const g = globalThis as any;
    g.graphWidth = 100;
    g.grid = { spacing: 20 };
    g.mapCoordinates = { lonT };
    g.pack = {
      cells: {
        i: new Uint32Array([0, 1]),
        h: [0, 0],
        f: [1, 2],
        p: [
          [10, 50],
          [90, 50]
        ] as [number, number][],
        c: [[], []] as number[][]
      },
      burgs: [{}, { i: 1, port: 1, cell: 0 }, { i: 2, port: 2, cell: 1 }]
    };
  };

  it("keeps each port-feature its own component on a non-360 map", () => {
    setup(180);
    const comp = (Routes as any).buildNavigableComponents() as Map<number, number>;
    expect(comp.get(1)).not.toBe(comp.get(2));
  });

  it("unions seam-joined features into one component on a 360 map", () => {
    setup(360);
    const comp = (Routes as any).buildNavigableComponents() as Map<number, number>;
    expect(comp.get(1)).toBe(comp.get(2));
  });
});

describe("selectSeaTradeEdges", () => {
  // Each capital sits on its own landmass (10/20/30); the hamlet cluster shares a
  // fourth landmass (40). cells.f is indexed by burg.cell, which the trunk tier
  // reads to keep only inter-landmass crossings.
  const landmass = [10, 20, 30, 40, 40, 40];

  beforeAll(() => {
    const g = globalThis as any;
    g.graphWidth = 1000;
    g.graphHeight = 1000; // mapScale = 1 -> km == pixel distance
    g.mapCoordinates = { lonT: 180 }; // wrap off
    g.pack = { cells: { f: landmass } };
  });

  // Three high-importance capital hubs (0,1,2) on three separate landmasses,
  // surrounding a tight low-importance hamlet cluster (3,4,5) on a fourth. The hubs
  // dominate every hamlet's gravity top-3, so the short hamlet-hamlet Urquhart edges
  // fall out of the feeder tier and survive only as coastal edges; the capitals on
  // distinct landmasses produce the inter-landmass trunk crossings.
  const ports = [
    { x: 200, y: 400, population: 100, settlementType: "capital", capital: 1, cell: 0, port: 1 },
    { x: 200, y: 700, population: 100, settlementType: "capital", capital: 1, cell: 1, port: 1 },
    { x: 600, y: 550, population: 100, settlementType: "capital", capital: 1, cell: 2, port: 1 },
    { x: 340, y: 530, population: 1, settlementType: "hamlet", cell: 3, port: 1 },
    { x: 370, y: 555, population: 1, settlementType: "hamlet", cell: 4, port: 1 },
    { x: 345, y: 580, population: 1, settlementType: "hamlet", cell: 5, port: 1 }
  ] as any[];

  const isCapital = (i: number) => i <= 2;
  const km = (a: any, b: any) => Math.hypot(a.x - b.x, a.y - b.y);

  it("emits all three tiers, links every port, dedupes pairs, and respects caps", () => {
    const edges = (Routes as any).selectSeaTradeEdges(ports) as Array<{
      from: number;
      to: number;
      tier: string;
    }>;

    // every port participates in at least one edge
    const touched = new Set<number>();
    edges.forEach(e => {
      touched.add(e.from);
      touched.add(e.to);
    });
    expect(touched.size).toBe(ports.length);

    // no duplicate unordered pair
    const keys = edges.map(e => `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}`);
    expect(new Set(keys).size).toBe(keys.length);

    // at least one trunk edge exists and every trunk edge crosses between landmasses
    const trunk = edges.filter(e => e.tier === "trunk");
    expect(trunk.length).toBeGreaterThan(0);
    expect(trunk.every(e => landmass[e.from] !== landmass[e.to])).toBe(true);

    // at least one feeder and one coastal edge exist
    expect(edges.some(e => e.tier === "feeder")).toBe(true);
    expect(edges.some(e => e.tier === "coastal")).toBe(true);

    // coastal edges are the short hamlet-hamlet pairs (same landmass, non-capital)
    expect(edges.every(e => e.tier !== "coastal" || (!isCapital(e.from) && !isCapital(e.to)))).toBe(true);

    // coastal edges stay within the coastal cap; the trunk safety cap is generous
    edges.forEach(e => {
      if (e.tier === "coastal") expect(km(ports[e.from], ports[e.to])).toBeLessThanOrEqual(120);
      expect(km(ports[e.from], ports[e.to])).toBeLessThanOrEqual(1500);
    });
  });
});
