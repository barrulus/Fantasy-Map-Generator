import { describe, expect, it } from "vitest";
import {
  findMegalopolises,
  groupedMemberIds,
  megalopolisName,
  pooledPopulation
} from "./megalopolis";

const burg = (i: number, cell: number, extra: Record<string, unknown> = {}) =>
  ({ i, cell, x: 0, y: 0, name: `b${i}`, population: 1, ...extra }) as any;

describe("findMegalopolises", () => {
  const cellsBurg = new Uint32Array(20);

  it("groups 2+ burgs sharing a cell, anchor first", () => {
    cellsBurg.fill(0);
    cellsBurg[5] = 2;
    const burgs = [burg(0, 0), burg(1, 3), burg(2, 5, { population: 2 }), burg(3, 5, { population: 1 })];
    const megas = findMegalopolises(burgs, cellsBurg);
    expect(megas.size).toBe(1);
    const m = megas.get(5)!;
    expect(m.anchor.i).toBe(2);
    expect(m.members.map(b => b.i)).toEqual([2, 3]);
    expect(m.population).toBe(3);
  });

  it("includes flying members in the group and its population", () => {
    cellsBurg.fill(0);
    cellsBurg[5] = 2;
    const burgs = [burg(0, 0), burg(2, 5, { population: 2 }), burg(4, 5, { flying: 1, population: 0.5 })];
    const m = findMegalopolises(burgs, cellsBurg).get(5)!;
    expect(m.members.map(b => b.i)).toEqual([2, 4]);
    expect(m.population).toBe(2.5);
  });

  it("ignores single-burg cells, removed burgs, and sky-only cells", () => {
    cellsBurg.fill(0);
    cellsBurg[5] = 2;
    const burgs = [
      burg(0, 0),
      burg(1, 3), // lone
      burg(2, 5),
      burg(3, 5, { removed: true }), // dead co-resident -> cell 5 back to lone
      burg(4, 9, { flying: 1 }),
      burg(5, 9, { flying: 1 }) // sky-only cell 9: no ground anchor
    ];
    expect(findMegalopolises(burgs, cellsBurg).size).toBe(0);
  });
});

describe("helpers", () => {
  it("groupedMemberIds excludes anchors; pooledPopulation keys anchors", () => {
    const cellsBurg = new Uint32Array(10);
    cellsBurg[5] = 2;
    const burgs = [burg(0, 0), burg(2, 5, { population: 2 }), burg(3, 5), burg(6, 5, { flying: 1 })];
    const megas = findMegalopolises(burgs, cellsBurg);
    expect([...groupedMemberIds(megas)].sort()).toEqual([3, 6]);
    expect(pooledPopulation(megas).get(2)).toBe(4);
    expect(pooledPopulation(megas).has(3)).toBe(false);
  });

  it("megalopolisName derives from the anchor", () => {
    expect(megalopolisName(burg(2, 5, { name: "Varenne" }))).toBe("Greater Varenne");
  });
});
