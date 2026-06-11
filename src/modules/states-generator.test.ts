import FlatQueue from "flatqueue";
import { beforeAll, describe, expect, it } from "vitest";

let States: any;

beforeAll(async () => {
  const g = globalThis as any;
  g.window = g.window ?? {};
  g.document = g.document ?? {
    readyState: "complete",
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null
  };
  g.FlatQueue = FlatQueue;
  g.TIME = false;
  g.WARN = false;
  g.ERROR = false;
  g.pack = g.pack ?? {};
  await import("./states-generator");
  States = (g.window as any).States;
});

// 5x5 all-land grid. State 1 (ground) capital at cell 0; state 2 (sky) capital
// burg flies over cell 12. document.getElementById -> null keeps growthRate
// tiny ((25/2)*1*1 = 12.5), so expansion stays near the seeds — the test only
// cares about seeding and burg assignment, not spread.
const N = 5;

function buildPack() {
  const n = N * N;
  const c: number[][] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const id = y * N + x;
      const neibs: number[] = [];
      if (x > 0) neibs.push(id - 1);
      if (x < N - 1) neibs.push(id + 1);
      if (y > 0) neibs.push(id - N);
      if (y < N - 1) neibs.push(id + N);
      c.push(neibs);
    }
  }
  const cells = {
    i: Uint32Array.from({ length: n }, (_, k) => k),
    c,
    h: new Uint8Array(n).fill(30),
    s: new Int16Array(n).fill(10),
    r: new Uint16Array(n),
    t: new Int8Array(n).fill(2),
    f: new Uint16Array(n).fill(1),
    biome: new Uint8Array(n).fill(5),
    culture: new Uint16Array(n).fill(1),
    fl: new Uint16Array(n),
    state: new Uint16Array(n)
  };
  const burgs: any[] = [
    0,
    { i: 1, capital: 1, cell: 0, x: 0, y: 0, culture: 1 }, // ground capital
    { i: 2, capital: 1, flying: 1, cell: 12, x: 50, y: 50, culture: 1 }, // sky capital
    { i: 3, flying: 1, cell: 7, x: 40, y: 20, culture: 1 }, // ordinary skyburg
    { i: 4, cell: 24, x: 90, y: 90, culture: 1 } // far ground burg (stays neutral)
  ];
  const states: any[] = [
    { i: 0, name: "Neutrals" },
    { i: 1, name: "Ground", capital: 1, center: 0, culture: 1, type: "Generic", expansionism: 1 },
    { i: 2, name: "Sky", capital: 2, center: 12, culture: 1, type: "Generic", expansionism: 1 }
  ];
  const cultures = [{ center: 0 }, { center: 0 }];
  (globalThis as any).pack = { cells, burgs, states, cultures, features: [0, { type: "island" }] };
  (globalThis as any).biomesData = { cost: new Array(13).fill(10) };
}

describe("createStates", () => {
  it("keeps state.i equal to the array index when a capital burg has a high id (sky capital)", () => {
    const g = globalThis as any;
    g.Names = { getCultureShort: () => "Test", getState: () => "Testland" };
    g.COA = { generate: () => ({}), getShield: () => "heater" };
    const prevGetEl = g.document.getElementById;
    // createStates reads ensureEl("sizeVariety").valueAsNumber
    g.document.getElementById = () => ({ valueAsNumber: 1, value: "1" });
    try {
      g.pack = {
        cultures: [{ type: "Generic" }, { type: "Generic" }],
        burgs: [
          0,
          { i: 1, capital: 1, cell: 0, culture: 1, name: "Alpha" }, // ground capital
          { i: 2, cell: 1, culture: 1, name: "Beta" }, // ordinary burg
          { i: 9, capital: 1, flying: 1, cell: 2, culture: 1, name: "Sky" } // sky capital, non-contiguous id
        ]
      };
      const states = (States as any).createStates();
      expect(states).toHaveLength(3); // neutrals + ground + sky
      for (let index = 0; index < states.length; index++) {
        expect(states[index].i).toBe(index); // pack.states is indexed by id
      }
      expect(states[2].capital).toBe(9); // capital field keeps the burg reference
    } finally {
      g.document.getElementById = prevGetEl;
    }
  });
});

describe("expandStates with a sky state", () => {
  it("never seeds or claims territory for the flying-capital state", () => {
    buildPack();
    States.expandStates();
    const pack = (globalThis as any).pack;
    expect(pack.cells.state[12]).not.toBe(2); // sky capital cell unclaimed
    expect(Array.from(pack.cells.state)).not.toContain(2); // no cell anywhere
    expect(pack.cells.state[0]).toBe(1); // ground capital seeded normally
  });

  it("assigns flying burgs to the sky state and ground burgs by territory", () => {
    buildPack();
    States.expandStates();
    const { burgs } = (globalThis as any).pack;
    expect(burgs[2].state).toBe(2); // sky capital
    expect(burgs[3].state).toBe(2); // ordinary skyburg, regardless of ground below
    expect(burgs[1].state).toBe(1); // ground capital on its seed cell
    expect(burgs[4].state).toBe(0); // out of expansion range -> neutral
  });

  it("falls back to ground assignment for flying burgs when no sky state exists", () => {
    buildPack();
    const pack = (globalThis as any).pack;
    pack.states.pop(); // remove the sky state
    pack.burgs[2].capital = 0;
    States.expandStates();
    expect(pack.burgs[2].state).toBe(0); // neutral, not some ground state
    expect(pack.burgs[3].state).toBe(0);
  });
});
