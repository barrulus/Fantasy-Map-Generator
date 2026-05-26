/**
 * Diagnostic measurement (not a regression test).
 *
 * Goal: quantify how much of the map each heightmap operation covers
 * (as a percentage of total cells) at varying cell counts. If
 * Hill/Pit scale proportionally with cells but Range/Trough don't,
 * that confirms the asymmetry hypothesis in the bced5944 fix's blind
 * spot.
 *
 * Setup: regular 4-connected square grid; Math.random stubbed to a
 * fixed return so the comparison across cell counts is deterministic
 * (only cell density changes between runs).
 */
import { beforeAll, describe, it } from "vitest";

let HeightmapGenerator: any;
let mulberryState = 0x9e3779b9;
const resetRandom = () => {
  mulberryState = 0x9e3779b9;
};
const mulberry32 = () => {
  mulberryState += 0x6d2b79f5;
  let t = mulberryState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

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
  g.TIME = false;
  g.WARN = false;
  g.ERROR = false;
  Math.random = mulberry32;

  // Provide template registry the generator reads from
  (globalThis as any).heightmapTemplates = {
    shattered: {
      id: 10,
      name: "Shattered",
      template: `Hill 8 35-40 15-85 30-70\nTrough 10-20 40-50 5-95 5-95\nRange 5-7 30-40 10-90 20-80\nPit 12-20 30-40 15-85 20-80`,
      probability: 7
    },
    continents: {
      id: 3,
      name: "Continents",
      template: `Hill 1 80-85 60-80 40-60\nHill 1 80-85 20-30 40-60\nHill 6-7 15-30 25-75 15-85\nMultiply 0.6 land 0 0\nHill 8-10 5-10 15-85 20-80\nRange 1-2 30-60 5-15 25-75\nRange 1-2 30-60 80-95 25-75\nRange 0-3 30-60 80-90 20-80\nSmooth 3 0 0 0\nTrough 3-4 15-20 15-85 20-80\nTrough 3-4 5-10 45-55 45-55\nPit 3-4 10-20 15-85 20-80\nMask 4 0 0 0`,
      probability: 16
    },
    // Anchor-only templates: every op uses count<4. Without the
    // anchor-scale exception, these collapse to ~8% of the central
    // hill's reach at 500K vs ~25% at 10K — atoll's ring shrinks and
    // volcano's caldera loses substance.
    atoll: {
      id: 5,
      name: "Atoll",
      template: `Hill 1 75-80 50-60 45-55\nHill 1.5 30-50 25-75 30-70\nHill .5 30-50 25-35 30-70\nSmooth 1 0 0 0\nMultiply 0.2 25-100 0 0\nHill 0.5 10-20 50-55 48-52`,
      probability: 1
    },
    volcano: {
      id: 0,
      name: "Volcano",
      template: `Hill 1 90-100 44-56 40-60\nMultiply 0.8 50-100 0 0\nRange 1.5 30-55 45-55 40-60\nSmooth 3 0 0 0\nHill 1.5 35-45 25-30 20-75\nHill 1 35-55 75-80 25-75\nHill 0.5 20-25 10-15 20-25\nMask 3 0 0 0`,
      probability: 3
    },
    // Saturation suspect: Hill 2-4 / Hill 3-4 on every edge scales to ~32
    // hills at 500K, overwhelming the central depression.
    taklamakan: {
      id: 11,
      name: "Taklamakan",
      template: `Hill 1-3 20-30 30-70 30-70\nHill 2-4 60-85 0-5 0-100\nHill 2-4 60-85 95-100 0-100\nHill 3-4 60-85 20-80 0-5\nHill 3-4 60-85 20-80 95-100\nSmooth 3 0 0 0`,
      probability: 1
    },
    fractious: {
      id: 13,
      name: "Fractious",
      template: `Hill 12-15 50-80 5-95 5-95\nMask -1.5 0 0 0\nMask 3 0 0 0\nAdd -20 30-100 0 0\nRange 6-8 40-50 5-95 10-90`,
      probability: 3
    }
  };

  await import("./heightmap-generator");
  HeightmapGenerator = g.window.HeightmapGenerator;
});

function buildSquareGrid(cellsX: number, cellsY: number, cellsDesired: number) {
  const spacing = 1;
  const totalCells = cellsX * cellsY;
  const c: number[][] = new Array(totalCells);
  const points: [number, number][] = new Array(totalCells);

  for (let y = 0; y < cellsY; y++) {
    for (let x = 0; x < cellsX; x++) {
      const idx = y * cellsX + x;
      points[idx] = [x * spacing, y * spacing];
      const neibs: number[] = [];
      if (x > 0) neibs.push(idx - 1);
      if (x < cellsX - 1) neibs.push(idx + 1);
      if (y > 0) neibs.push(idx - cellsX);
      if (y < cellsY - 1) neibs.push(idx + cellsX);
      c[idx] = neibs;
    }
  }

  // cellsDesired drives the blob/linePower lookup — must match a slider value
  // (10000, 100000, 500000) for the table to hit. Real FMG passes the slider
  // value here regardless of how many points were actually placed.
  return {
    cellsDesired,
    spacing,
    cellsX,
    cellsY,
    points,
    cells: { c, h: null }
  };
}

function setupHeightmap(grid: any, gw: number, gh: number) {
  (globalThis as any).graphWidth = gw;
  (globalThis as any).graphHeight = gh;
  HeightmapGenerator.setGraph(grid);
  // Reset heights to a known baseline so each op starts fresh
  HeightmapGenerator.heights = new Uint8Array(grid.cellsDesired);
}

function countAbove(threshold: number): number {
  const h = HeightmapGenerator.heights as Uint8Array;
  let n = 0;
  for (let i = 0; i < h.length; i++) if (h[i] > threshold) n++;
  return n;
}

function countBelow(threshold: number): number {
  const h = HeightmapGenerator.heights as Uint8Array;
  let n = 0;
  for (let i = 0; i < h.length; i++) if (h[i] < threshold) n++;
  return n;
}

const CONFIGURATIONS = [
  { name: "10k", cellsX: 100, cellsY: 100, cellsDesired: 10000 },
  { name: "100k", cellsX: 316, cellsY: 316, cellsDesired: 100000 },
  { name: "500k", cellsX: 707, cellsY: 707, cellsDesired: 500000 }
];

describe("heightmap operation coverage by cell count", () => {
  it("measures Hill coverage across cell counts", () => {
    console.log("\n=== addHill: h=40 single hill at center ===");
    console.log("cells       blobPower    cells>0       pct");
    for (const { name, cellsX, cellsY, cellsDesired } of CONFIGURATIONS) {
      const grid = buildSquareGrid(cellsX, cellsY, cellsDesired);
      setupHeightmap(grid, cellsX, cellsY);
      // Pre-fill heights to 0 so addHill effect is clean
      HeightmapGenerator.addHill("1", "40", "50-50", "50-50");
      const total = grid.cellsDesired;
      const raised = countAbove(0);
      const pct = ((raised / total) * 100).toFixed(2);
      console.log(
        `${name.padEnd(12)}${HeightmapGenerator.blobPower.toFixed(5).padEnd(13)}${String(raised).padEnd(14)}${pct}%`
      );
    }
  });

  it("measures Pit coverage across cell counts", () => {
    console.log("\n=== addPit: h=40 single pit at center, on h=50 plateau ===");
    console.log("cells       blobPower    cells<50      pct");
    for (const { name, cellsX, cellsY, cellsDesired } of CONFIGURATIONS) {
      const grid = buildSquareGrid(cellsX, cellsY, cellsDesired);
      setupHeightmap(grid, cellsX, cellsY);
      // Pre-fill to 50 so pit (which targets h>=20) can land anywhere
      HeightmapGenerator.heights.fill(50);
      HeightmapGenerator.addPit("1", "40", "50-50", "50-50");
      const total = grid.cellsDesired;
      const lowered = countBelow(50);
      const pct = ((lowered / total) * 100).toFixed(2);
      console.log(
        `${name.padEnd(12)}${HeightmapGenerator.blobPower.toFixed(5).padEnd(13)}${String(lowered).padEnd(14)}${pct}%`
      );
    }
  });

  it("measures Range coverage across cell counts", () => {
    console.log("\n=== addRange: h=40 single range across center ===");
    console.log("cells       linePower    cells>0       pct");
    for (const { name, cellsX, cellsY, cellsDesired } of CONFIGURATIONS) {
      const grid = buildSquareGrid(cellsX, cellsY, cellsDesired);
      setupHeightmap(grid, cellsX, cellsY);
      // Use explicit start/end cells across map diagonal for determinism
      HeightmapGenerator.addRange("1", "40", "", "", 0, cellsX * cellsY - 1);
      const total = grid.cellsDesired;
      const raised = countAbove(0);
      const pct = ((raised / total) * 100).toFixed(2);
      console.log(
        `${name.padEnd(12)}${HeightmapGenerator.linePower.toFixed(5).padEnd(13)}${String(raised).padEnd(14)}${pct}%`
      );
    }
  });

  it("runs full templates end-to-end at multiple cell counts", () => {
    console.log("\n=== Full template runs (land = h >= 20) ===");
    console.log("template     cells       land cells    land pct   largest region   regions");
    for (const template of ["shattered", "continents", "atoll", "volcano", "taklamakan", "fractious"]) {
      for (const { name, cellsX, cellsY, cellsDesired } of CONFIGURATIONS) {
        const grid = buildSquareGrid(cellsX, cellsY, cellsDesired);
        setupHeightmap(grid, cellsX, cellsY);
        // Reset randomness deterministically so each run is comparable
        resetRandom();
        HeightmapGenerator.fromTemplate(grid, template);

        const h = HeightmapGenerator.heights as Uint8Array;
        let land = 0;
        for (let i = 0; i < h.length; i++) if (h[i] >= 20) land++;

        // Connected-component analysis on land cells
        const visited = new Uint8Array(h.length);
        const regionSizes: number[] = [];
        for (let i = 0; i < h.length; i++) {
          if (h[i] < 20 || visited[i]) continue;
          let size = 0;
          const stack = [i];
          visited[i] = 1;
          while (stack.length) {
            const q = stack.pop()!;
            size++;
            for (const n of grid.cells.c[q]) {
              if (visited[n] || h[n] < 20) continue;
              visited[n] = 1;
              stack.push(n);
            }
          }
          regionSizes.push(size);
        }
        const largest = regionSizes.length ? Math.max(...regionSizes) : 0;
        const pct = ((land / cellsDesired) * 100).toFixed(2);
        const largestPct = ((largest / cellsDesired) * 100).toFixed(2);

        console.log(
          `${template.padEnd(13)}${name.padEnd(12)}${String(land).padEnd(14)}${pct.padEnd(11)}${(`${largest} (${largestPct}%)`).padEnd(17)}${regionSizes.length}`
        );
      }
    }
  });

  it("sweeps count-scaling formula on both templates", { timeout: 30_000 }, () => {
    // The override receives (baseCount, cellsDesired) — formulas here ignore
    // baseCount, so each formula is applied uniformly. This is useful for
    // exploring "what would consistent scaling look like" but the chosen
    // production formula in heightmap-generator.ts gates by baseCount>=4.
    const formulas: { name: string; fn: (count: number, c: number) => number }[] = [
      { name: "1.0 (no scale)", fn: () => 1 },
      { name: "(c/10K)^0.25", fn: (_n, c) => (c / 10000) ** 0.25 },
      { name: "(c/10K)^0.35", fn: (_n, c) => (c / 10000) ** 0.35 },
      { name: "(c/10K)^0.5", fn: (_n, c) => Math.sqrt(c / 10000) },
      { name: "1+log10(c/10K)", fn: (_n, c) => 1 + Math.log10(Math.max(1, c / 10000)) },
      { name: "1+log10()*1.5", fn: (_n, c) => 1 + 1.5 * Math.log10(Math.max(1, c / 10000)) },
      {
        name: "n>=4 ? log10 : 1",
        fn: (n, c) => (n < 4 ? 1 : 1 + Math.log10(Math.max(1, c / 10000)))
      }
    ];
    for (const template of ["shattered", "continents"]) {
      console.log(`\n=== ${template} land % by (countScale formula × cell count) ===`);
      console.log(`${"formula".padEnd(22) + "10K".padEnd(10) + "100K".padEnd(10)}500K`);
      for (const { name, fn } of formulas) {
        (globalThis as any).__diagCountScale = fn;
        const row: string[] = [name.padEnd(22)];
        for (const { cellsX, cellsY, cellsDesired } of CONFIGURATIONS) {
          const grid = buildSquareGrid(cellsX, cellsY, cellsDesired);
          setupHeightmap(grid, cellsX, cellsY);
          resetRandom();
          HeightmapGenerator.fromTemplate(grid, template);
          const h = HeightmapGenerator.heights as Uint8Array;
          let land = 0;
          for (let i = 0; i < h.length; i++) if (h[i] >= 20) land++;
          const pct = ((land / cellsDesired) * 100).toFixed(2);
          row.push(pct.padEnd(10));
        }
        console.log(row.join(""));
      }
    }
    (globalThis as any).__diagCountScale = undefined;
  });

  it("measures Trough coverage across cell counts", () => {
    console.log("\n=== addTrough: h=40 single trough across center, on h=50 plateau ===");
    console.log("cells       linePower    cells<50      pct");
    for (const { name, cellsX, cellsY, cellsDesired } of CONFIGURATIONS) {
      const grid = buildSquareGrid(cellsX, cellsY, cellsDesired);
      setupHeightmap(grid, cellsX, cellsY);
      HeightmapGenerator.heights.fill(50);
      HeightmapGenerator.addTrough("1", "40", "", "", 0, cellsX * cellsY - 1);
      const total = grid.cellsDesired;
      const lowered = countBelow(50);
      const pct = ((lowered / total) * 100).toFixed(2);
      console.log(
        `${name.padEnd(12)}${HeightmapGenerator.linePower.toFixed(5).padEnd(13)}${String(lowered).padEnd(14)}${pct}%`
      );
    }
  });
});
