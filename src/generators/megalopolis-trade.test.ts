import { describe, expect, it } from "vitest";
import { findMegalopolises, groupedMemberIds, pooledPopulation } from "./megalopolis";
import { portImportance } from "./routes-generator";

const burg = (i: number, cell: number, extra: Record<string, unknown> = {}) =>
  ({ i, cell, x: 0, y: 0, name: `b${i}`, population: 1, port: 1, ...extra }) as any;

describe("megalopolis trade weighting", () => {
  it("anchor importance uses pooled population; members carry none", () => {
    const cellsBurg = new Uint32Array(10);
    cellsBurg[5] = 1;
    const anchor = burg(1, 5, { population: 2 });
    const member = burg(2, 5, { population: 6 });
    const megas = findMegalopolises([{ i: 0 } as any, anchor, member], cellsBurg);
    const memberIds = groupedMemberIds(megas);
    const pooled = pooledPopulation(megas);

    // the exact wrapper generateTradeNetwork uses:
    const importance = (b: any) => {
      const pop = pooled.get(b.i);
      return pop === undefined ? portImportance(b) : portImportance({ ...b, population: pop });
    };
    expect(importance(anchor)).toBe(portImportance({ ...anchor, population: 8 }));
    expect(importance(anchor)).toBeGreaterThan(portImportance(anchor));
    expect(memberIds.has(member.i)).toBe(true); // member excluded from role assignment
  });
});
