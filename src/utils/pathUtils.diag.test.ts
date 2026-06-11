/**
 * Diagnostic measurement (not a regression test).
 *
 * Goal: quantify findPathTree cost on an open-water grid, the shape of the
 * sea-trade feeder tier (one multi-target Dijkstra per source port). On the
 * 500k-point continents map the feeder tier runs ~1,500 trees over big-ocean
 * regions and costs ~3.9s; this bench isolates the search itself so frontier
 * work (e.g. stale queue pops) can be measured before/after changes.
 *
 * Grid: 300x300 4-connected uniform-cost "water"; 8 targets on a ring ~100
 * cells from the center source. Cost mimics the feeder evaluator: linear
 * distance with a mild deterministic modifier (so relaxations actually
 * compete and stale entries exist, unlike a pure unit grid).
 */
import FlatQueue from "flatqueue";
import { beforeAll, describe, expect, it } from "vitest";
import { findPathTree } from "./pathUtils";

const N = 300;

function buildGraph() {
  const c: number[][] = [];
  const p: [number, number][] = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const id = y * N + x;
      p.push([x, y]);
      const neibs: number[] = [];
      if (x > 0) neibs.push(id - 1);
      if (x < N - 1) neibs.push(id + 1);
      if (y > 0) neibs.push(id - N);
      if (y < N - 1) neibs.push(id + N);
      c.push(neibs);
    }
  }
  return { cells: { i: new Uint32Array(N * N), c, p } };
}

beforeAll(() => {
  (globalThis as any).window = (globalThis as any).window ?? {};
  (globalThis as any).window.FlatQueue = FlatQueue;
});

describe("findPathTree cost (diagnostic)", () => {
  it("multi-target tree over open water, 200 trees", () => {
    const graph = buildGraph();
    const start = Math.floor(N / 2) * N + Math.floor(N / 2);
    const R = 100;
    const targets: number[] = [];
    for (let k = 0; k < 8; k++) {
      const angle = (k / 8) * 2 * Math.PI;
      const tx = Math.floor(N / 2 + Math.cos(angle) * R);
      const ty = Math.floor(N / 2 + Math.sin(angle) * R);
      targets.push(ty * N + tx);
    }
    // deterministic per-cell cost wobble so relaxations compete
    const getCost = (_current: number, next: number) => 1 + ((next * 2654435761) % 7) / 10;

    const t0 = performance.now();
    let found = 0;
    for (let run = 0; run < 200; run++) {
      const paths = findPathTree(start, targets, getCost, graph);
      found += paths.size;
    }
    const elapsed = performance.now() - t0;

    expect(found).toBe(200 * 8); // sanity: every target reached every run
    console.log(`  findPathTree x200 (90k cells, 8 targets@r=${R}): ${elapsed.toFixed(0)}ms (${(elapsed / 200).toFixed(2)}ms per tree)`);
    expect(elapsed).toBeLessThan(60_000);
  });
});
