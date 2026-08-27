import { beforeAll, describe, expect, it } from "vitest";
import { rw } from "../utils/probabilityUtils";
import { heightmapTemplates } from "./heightmap-templates";

let HeightmapGenerator: any;

beforeAll(async () => {
  const g = globalThis as any;
  g.TIME = false;
  g.WARN = false;
  g.ERROR = false;
  g.graphWidth = 100;
  g.graphHeight = 100;

  await import("../generators/heightmap-generator");
  HeightmapGenerator = g.window.HeightmapGenerator;
});

function buildSquareGrid(cellsX: number, cellsY: number, cellsDesired: number) {
  const totalCells = cellsX * cellsY;
  const c: number[][] = new Array(totalCells);
  const points: [number, number][] = new Array(totalCells);

  for (let y = 0; y < cellsY; y++) {
    for (let x = 0; x < cellsX; x++) {
      const idx = y * cellsX + x;
      points[idx] = [x, y];
      const neibs: number[] = [];
      if (x > 0) neibs.push(idx - 1);
      if (x < cellsX - 1) neibs.push(idx + 1);
      if (y > 0) neibs.push(idx - cellsX);
      if (y < cellsY - 1) neibs.push(idx + cellsX);
      c[idx] = neibs;
    }
  }

  return { cellsDesired, spacing: 1, cellsX, cellsY, points, cells: { c, h: new Uint8Array(totalCells) } };
}

describe("blank heightmap template", () => {
  it("is registered but never picked by weighted random selection", () => {
    expect(heightmapTemplates.blank?.name).toBe("Blank");
    expect(heightmapTemplates.blank?.probability).toBe(0);

    const weights: Record<string, number> = {};
    for (const key in heightmapTemplates) {
      weights[key] = heightmapTemplates[key].probability || 0;
    }
    for (let i = 0; i < 500; i++) {
      expect(rw(weights)).not.toBe("blank");
    }
  });

  it("produces an all-ocean map: every cell height is 0", () => {
    const grid = buildSquareGrid(100, 100, 10000);
    const heights = HeightmapGenerator.fromTemplate(grid, "blank");
    expect(heights).toHaveLength(10000);
    expect(heights.every((h: number) => h === 0)).toBe(true);
  });
});
