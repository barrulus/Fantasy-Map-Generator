import { describe, expect, it } from "vitest";
import type { Burg } from "./burgs-generator";
import { assignTradeRoles, buildLegGraph, type TradeNode } from "./trade-network-generator";

// importance = population (simple, deterministic for tests)
const imp = (b: any) => b.population ?? 0;
const isLarge = (b: any) => b.settlementType === "largePort";
const dist2 = (ax: number, ay: number, bx: number, by: number) => (ax - bx) ** 2 + (ay - by) ** 2;

describe("assignTradeRoles", () => {
  it("makes each state's capital-nearest qualifying port a hub", () => {
    const cap1 = { i: 1, state: 1, capital: 1, cell: 0, x: 0, y: 0, population: 50 } as Burg;
    const near = { i: 2, state: 1, cell: 0, x: 10, y: 0, population: 30, port: 1, settlementType: "largePort" } as Burg;
    const far = { i: 3, state: 1, cell: 0, x: 200, y: 0, population: 99, port: 1, settlementType: "largePort" } as Burg;
    const burgs = [cap1, near, far];

    assignTradeRoles(burgs, {
      importance: imp,
      isLargePort: isLarge,
      minHubSize: 10,
      capitalByState: new Map([[1, cap1]]),
      dist2
    });

    expect(near.tradeRole).toBe("hub"); // nearest the capital, clears min size
    expect(far.tradeRole).toBe("waystation"); // large port, but not the hub
  });

  it("skips ports below minHubSize and states with no qualifying port", () => {
    const cap2 = { i: 4, state: 2, capital: 1, cell: 0, x: 0, y: 0, population: 50, port: 1 } as Burg;
    const tiny = { i: 5, state: 2, cell: 0, x: 5, y: 0, population: 2, port: 1 } as Burg;
    const burgs = [cap2, tiny];

    assignTradeRoles(burgs, {
      importance: imp,
      isLargePort: isLarge,
      minHubSize: 10,
      capitalByState: new Map([[2, cap2]]),
      dist2
    });

    expect(tiny.tradeRole).toBeUndefined(); // below min size, no hub for state 2
  });

  it("never overrides a manually-set role", () => {
    const manual = {
      i: 6,
      state: 3,
      cell: 0,
      x: 100,
      y: 0,
      population: 99,
      port: 1,
      settlementType: "largePort",
      tradeRole: "hub" as const,
      tradeRoleManual: true
    } as Burg;
    const cap3 = {
      i: 7,
      state: 3,
      capital: 1,
      cell: 0,
      x: 0,
      y: 0,
      population: 50,
      port: 1,
      settlementType: "largePort"
    } as Burg;
    const burgs = [manual, cap3];

    assignTradeRoles(burgs, {
      importance: imp,
      isLargePort: isLarge,
      minHubSize: 10,
      capitalByState: new Map([[3, cap3]]),
      dist2
    });

    expect(manual.tradeRole).toBe("hub"); // manual role preserved
    expect(cap3.tradeRole).toBe("hub"); // auto hub for the state (capital is itself a port)
  });
});

describe("buildLegGraph", () => {
  // four nodes on a line; component A = {0,1,2}, component B = {3}
  const nodes: TradeNode[] = [
    { index: 0, x: 0, y: 0, component: 1, burg: {} as any },
    { index: 1, x: 10, y: 0, component: 1, burg: {} as any },
    { index: 2, x: 30, y: 0, component: 1, burg: {} as any },
    { index: 3, x: 12, y: 0, component: 2, burg: {} as any }
  ];
  const d2 = (a: TradeNode, b: TradeNode) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;

  it("links nodes within range R in the same component, both directions", () => {
    const g = buildLegGraph(nodes, 15 * 15, d2); // R = 15
    expect(g[0].sort()).toEqual([1]); // 0-1 (10) yes; 0-2 (30) no
    expect(g[1].sort()).toEqual([0]); // 1-2 (20) > 15 no
  });

  it("never links across navigable components even when within range", () => {
    const g = buildLegGraph(nodes, 15 * 15, d2);
    // node 3 (comp 2) is 2px from node 1 (comp 1) but different ocean -> no edge
    expect(g[3]).toEqual([]);
    expect(g[1]).not.toContain(3);
  });
});
