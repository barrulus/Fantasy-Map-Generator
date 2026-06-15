import { describe, expect, it } from "vitest";
import { collectGlyphs, edt1d } from "./sdf-glyph-atlas";

describe("collectGlyphs", () => {
  it("returns the distinct, non-space characters across all burg names", () => {
    const burgs = [{}, { i: 1, name: "Aba", removed: false }, { i: 2, name: "Cab", removed: false }] as any;
    const set = collectGlyphs(burgs);
    expect([...set].sort()).toEqual(["A", "C", "a", "b"]);
  });

  it("skips removed burgs and the index-0 placeholder", () => {
    const burgs = [{}, { i: 1, name: "Zz", removed: true }, { i: 2, name: "Q", removed: false }] as any;
    expect([...collectGlyphs(burgs)]).toEqual(["Q"]);
  });
});

describe("edt1d", () => {
  it("computes squared distance to the nearest zero along a 1-D row", () => {
    // f: 0 at index 2, +inf elsewhere => squared distance to index 2
    const INF = 1e20;
    const f = [INF, INF, 0, INF, INF];
    const d = edt1d(f);
    expect(Array.from(d)).toEqual([4, 1, 0, 1, 4]);
  });
});
