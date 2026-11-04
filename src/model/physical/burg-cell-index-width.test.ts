import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Fork invariant guard — burg cell-index array width
//
// The fork supports >65535 burgs (100K-burg maps), so `pack.cells.burg` MUST be
// a Uint32Array everywhere it is allocated. A Uint16Array silently truncates any
// burg index > 65535 → corrupt cell→burg mapping with no error.
//
// This guard exists because the upstream UI migration (migrate-ui-editors,
// PR #1520) reintroduces `new Uint16Array` for the burg array in the ported
// heightmap-editor.ts. When that branch is merged, this test goes RED and forces
// re-homing the fix. See:
//   docs/superpowers/plans/2026-07-07-upstream-ui-migration-prep.md
//   docs/superpowers/plans/2026-07-07-ui-migration-rehome.patch
// ---------------------------------------------------------------------------

// Raw source text of every bundled + legacy module, read via Vite's glob loader
// (typed by vite/client — no node builtins, works under `types: ["vite/client"]`).
const sources = {
  ...import.meta.glob("/src/**/*.{ts,js}", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob("/public/modules/**/*.{ts,js}", { query: "?raw", import: "default", eager: true })
} as Record<string, string>;

// matches `burg = new Uint16Array(...)` and `burg = Uint16Array.from(...)`
// (with or without a `.` prefix, any whitespace)
const BAD = /\bburg\s*=\s*(new\s+Uint16Array\b|Uint16Array\s*\.\s*from\b)/;

describe("burg cell-index array width (fork 100K-burg invariant)", () => {
  it("never allocates pack.cells.burg as Uint16Array (would truncate indices >65535)", () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      if (path.endsWith(".test.ts")) continue;
      src.split("\n").forEach((line: string, i: number) => {
        if (BAD.test(line)) offenders.push(`${path}:${i + 1}  ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `burg cell-index array must be Uint32Array (see docs/superpowers/plans/2026-07-07-ui-migration-rehome.patch):\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});
