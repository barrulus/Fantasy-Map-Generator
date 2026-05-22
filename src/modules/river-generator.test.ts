import { beforeAll, beforeEach, describe, expect, it } from "vitest";

let Rivers: any;

beforeAll(async () => {
  // utils/index.ts and river-generator.ts both write into DOM-shaped globals
  // at module top-level, so we must stub the DOM surface they touch before
  // the dynamic import.
  const g = globalThis as any;
  g.window = g.window ?? {};
  g.Node = g.Node ?? class { addEventListener() {} removeEventListener() {} };
  g.document = g.document ?? {
    readyState: "complete",
    getElementById: () => null,
    addEventListener: () => {},
    querySelector: () => null
  };
  g.pack = { rivers: [] };
  g.TIME = false;
  g.WARN = false;
  g.ERROR = false;

  await import("./river-generator");
  Rivers = g.window.Rivers;
});

describe("Rivers.getParent / Rivers.getBasin", () => {
  beforeEach(() => {
    (globalThis as any).pack.rivers = [
      { i: 1, parent: 1, basin: 1, length: 100 },
      { i: 2, parent: 1, basin: 1, length: 50 },
      { i: 3, parent: 2, basin: 1, length: 25 },
      { i: 4, parent: 4, basin: 4, length: 80 }
    ];
  });

  it("returns the river itself for top-level basins", () => {
    expect(Rivers.getParent(1)).toBe(1);
    expect(Rivers.getParent(4)).toBe(4);
  });

  it("returns immediate parent for tributaries", () => {
    expect(Rivers.getParent(2)).toBe(1);
    expect(Rivers.getParent(3)).toBe(2);
  });

  it("returns the basin (root ancestor) for deep tributaries", () => {
    expect(Rivers.getBasin(3)).toBe(1);
    expect(Rivers.getBasin(2)).toBe(1);
    expect(Rivers.getBasin(1)).toBe(1);
    expect(Rivers.getBasin(4)).toBe(4);
  });

  it("returns river id itself if parent reference is missing", () => {
    (globalThis as any).pack.rivers = [{ i: 1, parent: 99 }];
    expect(Rivers.getParent(1)).toBe(1);
    expect(Rivers.getBasin(1)).toBe(1);
  });

  it("getNextId returns 1 for an empty list", () => {
    expect(Rivers.getNextId([])).toBe(1);
  });

  it("getNextId returns max id + 1", () => {
    expect(Rivers.getNextId([{ i: 1 }, { i: 5 }, { i: 3 }])).toBe(6);
  });
});
