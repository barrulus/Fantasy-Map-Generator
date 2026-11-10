import { expect, it } from "vitest";
import { Markets } from "@/model/economy/markets-generator";
import { Production } from "@/model/economy/production-generator";
import { Burgs } from "@/model/political/burgs-generator";
import { generateMap } from "./real-map.testing";

it("keeps shared-cell skyburgs independent through economy and locked burg regeneration", async () => {
  options.generation.burgs.limit = 50;
  await generateMap({ seed: "bazgaars-upstream-skyburgs", points: 3000 });
  const ground = pack.burgs.find(burg => burg.i && !burg.removed && !burg.flying && Markets.ofBurg(burg));
  expect(ground).toBeDefined();
  const { cell } = ground!;
  const [x, y] = pack.cells.p[cell];
  const first = Burgs.add(x, y, { flying: true, altitude: 900 });
  const second = Burgs.add(x, y, { flying: true, altitude: 1200 });
  expect(pack.cells.burg[cell]).toBe(ground!.i);
  expect(pack.burgs[first].cell).toBe(cell);
  expect(pack.burgs[second].cell).toBe(cell);
  expect(Markets.ofBurg(pack.burgs[first])).toBe(Markets.ofBurg(ground!));
  pack.burgs[first].adjustments = [{ name: "Sky trade", value: 100 }];
  Production.produce();
  expect(Production.getWorkers(pack.burgs[first])).toBe(0);
  expect(pack.burgs[first].production).toEqual([]);
  expect(Number.isFinite(pack.burgs[first].treasury)).toBe(true);
  expect(pack.markets.every(market => !pack.burgs[market.centerBurgId].flying)).toBe(true);
  const skyburgs = [pack.burgs[first], pack.burgs[second]];
  for (const burg of [ground!, ...skyburgs]) burg.lock = true;
  Burgs.regenerate();
  for (const sky of skyburgs) {
    expect(pack.burgs[sky.i]).toBe(sky);
    expect(sky.cell).toBe(cell);
    expect(sky.flying).toBe(1);
  }
  expect(pack.cells.burg[cell]).toBe(ground!.i);
  expect(pack.burgs[pack.cells.burg[cell]].flying).toBeFalsy();
}, 30000);
