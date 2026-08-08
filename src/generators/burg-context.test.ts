import { describe, expect, it } from "vitest";
import {
  type Approach,
  collectWindow,
  compassBearing,
  elevationMetres,
  hashSeedToInt,
  kmToWorldUnits,
  LARGE_HARBOUR_MIN_POPULATION,
  type RouteGroup,
  readApproaches,
  readHydrology,
  scaledPopulation
} from "./burg-context";

describe("compassBearing", () => {
  // SVG coordinates: y grows DOWNWARD, so north is negative dy
  it("maps the four cardinals with the y-down sign convention", () => {
    expect(compassBearing(0, -1)).toBe(0); // north
    expect(compassBearing(1, 0)).toBe(90); // east
    expect(compassBearing(0, 1)).toBe(180); // south
    expect(compassBearing(-1, 0)).toBe(270); // west
  });

  it("returns a value in [0, 360)", () => {
    expect(compassBearing(-1, -1)).toBeCloseTo(315, 6);
    expect(compassBearing(0, 0)).toBe(0); // degenerate: no displacement
  });
});

describe("elevationMetres", () => {
  it("uses the land formula above sea level", () => {
    expect(elevationMetres(20, 2)).toBe(4); // (20-18)^2
    expect(elevationMetres(30, 2)).toBe(144); // (30-18)^2
  });

  it("uses the depth formula below sea level", () => {
    expect(elevationMetres(10, 2)).toBe(-50); // ((10-20)/10)*50
  });

  it("returns the deep-water sentinel at or below zero height", () => {
    expect(elevationMetres(0, 2)).toBe(-990);
  });
});

describe("kmToWorldUnits", () => {
  it("divides by the km-per-world-unit scale", () => {
    expect(kmToWorldUnits(12, 3)).toBe(4);
  });

  it("falls back to a scale of 1 when distanceScale is zero or missing", () => {
    expect(kmToWorldUnits(12, 0)).toBe(12);
  });
});

describe("hashSeedToInt", () => {
  it("is deterministic", () => {
    expect(hashSeedToInt("1234560007")).toBe(hashSeedToInt("1234560007"));
  });

  it("separates burgs on the same map and the same burg across maps", () => {
    expect(hashSeedToInt("1234560007")).not.toBe(hashSeedToInt("1234560008"));
    expect(hashSeedToInt("1234560007")).not.toBe(hashSeedToInt("9999990007"));
  });

  it("returns a non-negative 32-bit integer", () => {
    const h = hashSeedToInt("anything");
    expect(Number.isInteger(h)).toBe(true);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});

describe("scaledPopulation", () => {
  it("applies the same population scaling the watabou builders use", () => {
    expect(scaledPopulation(10, 1000, 0.5)).toBe(5000);
  });

  it("rounds to a whole number of people", () => {
    expect(scaledPopulation(0.0031, 1000, 0.5)).toBe(2);
  });
});

describe("collectWindow", () => {
  // A straight chain of 5 cells spaced 1 world unit apart on the x axis:
  // 0 -- 1 -- 2 -- 3 -- 4
  const cellsC = [[1], [0, 2], [1, 3], [2, 4], [3]];
  const cellsP = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [4, 0]
  ] as [number, number][];

  it("includes the centre and every cell inside the radius", () => {
    // radiusKm 2 at distanceScale 1 => 2 world units => cells 0,1,2,3 from centre 2... within 2 of x=2
    const w = collectWindow(2, cellsC, cellsP, 2, 1);
    expect(w.center).toBe(2);
    expect([...w.cellIds].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(w.radiusKm).toBe(2);
  });

  it("excludes cells beyond the radius", () => {
    const w = collectWindow(0, cellsC, cellsP, 2, 1);
    expect([...w.cellIds].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("converts km to world units via distanceScale", () => {
    // radiusKm 6 at distanceScale 3 => 2 world units, same as above
    const w = collectWindow(0, cellsC, cellsP, 6, 3);
    expect([...w.cellIds].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("returns just the centre for an isolated cell", () => {
    const w = collectWindow(0, [[]], [[0, 0]] as [number, number][], 5, 1);
    expect(w.cellIds).toEqual([0]);
  });

  it("does not revisit cells in a cyclic graph", () => {
    const ringC = [
      [1, 2],
      [0, 2],
      [0, 1]
    ];
    const ringP = [
      [0, 0],
      [1, 0],
      [0, 1]
    ] as [number, number][];
    const w = collectWindow(0, ringC, ringP, 5, 1);
    expect(w.cellIds).toHaveLength(3);
  });
});

describe("readApproaches", () => {
  //        7 (north)
  //        |
  //  4 --- 5 --- 6      (5 is the burg cell)
  const cellsP = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
    [-1, 0], // 4, west of 5
    [0, 0], // 5, the burg
    [1, 0], // 6, east of 5
    [0, -1] // 7, north of 5
  ] as [number, number][];

  const routeById = new Map<number, { group: RouteGroup; type?: string; name?: string }>([
    [1, { group: "roads", type: "highway", name: "Kings Road" }],
    [2, { group: "trails", type: "trail" }]
  ]);

  it("emits one approach per connected neighbour, sorted by bearing", () => {
    const cellsRoutes = { 5: { 4: 1, 6: 1, 7: 2 } };
    const approaches = readApproaches(5, cellsRoutes, cellsP, routeById);
    expect(approaches.map(a => a.bearingDeg)).toEqual([0, 90, 270]);
    expect(approaches.map(a => a.routeId)).toEqual([2, 1, 1]);
  });

  it("marks a route reaching the cell from two sides as through, and a single-sided one as terminating", () => {
    const cellsRoutes = { 5: { 4: 1, 6: 1, 7: 2 } };
    const approaches = readApproaches(5, cellsRoutes, cellsP, routeById);
    const road = approaches.filter(a => a.routeId === 1);
    expect(road).toHaveLength(2);
    expect(road.every(a => a.through)).toBe(true);
    const trail = approaches.find(a => a.routeId === 2)!;
    expect(trail.through).toBe(false);
  });

  it("carries group, type and name through from the route", () => {
    const approaches = readApproaches(5, { 5: { 6: 1 } }, cellsP, routeById);
    expect(approaches[0]).toMatchObject({ group: "roads", type: "highway", name: "Kings Road" });
  });

  it("returns an empty array for a burg with no routes — never undefined", () => {
    expect(readApproaches(5, {}, cellsP, routeById)).toEqual([]);
    expect(readApproaches(5, { 5: {} }, cellsP, routeById)).toEqual([]);
  });

  it("skips connections whose route is missing from the index", () => {
    expect(readApproaches(5, { 5: { 6: 99 } }, cellsP, routeById)).toEqual([]);
  });
});

describe("readHydrology", () => {
  const cellsP = [
    [0, 0], // 0, the burg
    [0, -1], // 1, haven to the north
    [5, 5] // 2, elsewhere
  ] as [number, number][];

  const base = {
    window: { center: 0, cellIds: [0, 1, 2], radiusKm: 12 },
    cellsHaven: [1, 0, 0],
    cellsHarbor: [1, 0, 0],
    cellsF: [1, 2, 3],
    cellsP,
    featureTypeById: (id: number) => ({ 1: "island", 2: "ocean", 3: "lake" })[id],
    approaches: [] as Approach[],
    isPort: true,
    population: 100
  };

  it("bearings toward the haven cell in compass degrees", () => {
    expect(readHydrology(base).oceanBearingDeg).toBe(0); // haven is due north
  });

  it("omits ocean bearing and harbour size for a landlocked burg", () => {
    const h = readHydrology({ ...base, isPort: false, cellsHaven: [0, 0, 0], cellsHarbor: [0, 0, 0] });
    expect(h.oceanBearingDeg).toBeUndefined();
    expect(h.harbourSize).toBeUndefined();
    expect(h.coastal).toBe(false);
  });

  it("calls a harbour large only with a sea/trade route AND enough population", () => {
    const seaRoute: Approach[] = [{ routeId: 1, group: "searoutes", bearingDeg: 90, through: false }];
    expect(readHydrology({ ...base, approaches: seaRoute, population: LARGE_HARBOUR_MIN_POPULATION }).harbourSize).toBe(
      "large"
    );
    // route but too small
    expect(readHydrology({ ...base, approaches: seaRoute, population: 100 }).harbourSize).toBe("small");
    // big but no sea route
    expect(readHydrology({ ...base, population: 100000 }).harbourSize).toBe("small");
  });

  it("detects a lake in the window", () => {
    expect(readHydrology(base).lakeside).toBe(true);
    expect(readHydrology({ ...base, cellsF: [1, 2, 2] }).lakeside).toBe(false);
  });

  it("treats a harbor cell as coastal even without the port flag", () => {
    expect(readHydrology({ ...base, isPort: false }).coastal).toBe(true);
  });
});
