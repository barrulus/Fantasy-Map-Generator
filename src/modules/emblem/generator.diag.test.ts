/**
 * Diagnostic measurement (not a regression test).
 *
 * Goal: quantify COA.generate per-call cost. specifyBurgs runs it once per
 * burg with population > 0.5 or capital/port flags; on dense maps (~80k
 * burgs) the emblem phase is the prime suspect for the ~11s specifyBurgs
 * wall time. This bench gives the per-call cost for the two real call
 * shapes (parentless, and child-of-state-COA as defineEmblem uses), so the
 * in-browser phase breakdown can be decomposed into COA cost vs getType
 * cost.
 *
 * Thresholds are deliberately loose (CI hardware varies); the point is the
 * logged numbers, not the assertion.
 */
import { beforeAll, describe, expect, it } from "vitest";

let COA: any;

beforeAll(async () => {
  const g = globalThis as any;
  g.window = g.window ?? {};
  g.TIME = false;
  g.WARN = false;
  g.ERROR = false;
  await import("./generator");
  COA = (g.window as any).COA;
});

describe("COA.generate cost (diagnostic)", () => {
  const N = 20_000;

  it(`parentless generate x${N}`, () => {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) COA.generate(null, 0, 0, "City");
    const elapsed = performance.now() - t0;
    console.log(`  COA.generate(null) x${N}: ${elapsed.toFixed(0)}ms (${((elapsed / N) * 1000).toFixed(1)}us each)`);
    expect(elapsed).toBeLessThan(60_000);
  });

  it(`child-of-parent generate x${N} (defineEmblem shape)`, () => {
    const parent = COA.generate(null, 0, 0, "State");
    const t0 = performance.now();
    for (let i = 0; i < N; i++) COA.generate(parent, 0.25, null, "City");
    const elapsed = performance.now() - t0;
    console.log(`  COA.generate(parent) x${N}: ${elapsed.toFixed(0)}ms (${((elapsed / N) * 1000).toFixed(1)}us each)`);
    expect(elapsed).toBeLessThan(60_000);
  });
});
