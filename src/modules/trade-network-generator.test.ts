import { describe, expect, it } from "vitest";
import type { Burg } from "./burgs-generator";
import { assignTradeRoles } from "./trade-network-generator";

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
