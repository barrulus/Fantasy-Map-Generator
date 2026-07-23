import { beforeEach, describe, expect, it } from "vitest";
import { readBurgLabelStyles } from "./label-style";
import { REST_PX, START_PX } from "./tier-table";

function shell(id: string, attrs: Record<string, string>): string {
  const a = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  return `<g id="${id}" ${a}></g>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

function mount(inner: string): void {
  document.body.innerHTML = `<svg><g id="burgLabels">${inner}</g></svg>`;
}

describe("readBurgLabelStyles", () => {
  it("reads the authored size from data-size, not the live font-size", () => {
    // font-size is overwritten on every zoom when rescaleLabels is on; data-size is the authored value
    mount(shell("capital", { "data-size": "4.98", "font-size": "1.2" }));
    expect(readBurgLabelStyles().capital.fontSize).toBeCloseTo(4.98, 5);
  });

  it("falls back to the font-size attribute when data-size is absent", () => {
    mount(shell("capital", { "font-size": "3.5" }));
    expect(readBurgLabelStyles().capital.fontSize).toBeCloseTo(3.5, 5);
  });

  it("takes rank, min-zoom and size bounds from the tier table", () => {
    // 4.98 is capital's reference d (factor 1); 1 is far below hamlet's reference (1.66), clamped
    // to the 0.75 factor floor, but capital's startPx is still far larger in absolute terms.
    mount(shell("capital", { "data-size": "4.98" }) + shell("hamlet", { "data-size": "1" }));
    const s = readBurgLabelStyles();
    expect(s.capital.rank).toBeLessThan(s.hamlet.rank);
    expect(s.capital.minZoom).toBe(1);
    expect(s.hamlet.minZoom).toBe(14);
    expect(s.capital.startPx).toBeGreaterThan(s.hamlet.startPx);
    expect(s.capital.restPx).toBeGreaterThan(s.hamlet.restPx);
  });

  it("honours a data-min-zoom override", () => {
    mount(shell("capital", { "data-size": "4", "data-min-zoom": "7" }));
    expect(readBurgLabelStyles().capital.minZoom).toBe(7);
  });

  it("multiplies startPx/restPx by the authored-size factor, clamped", () => {
    // huge authored size clamps the factor at 1.5. Derived from the tier table rather than
    // hardcoded so that tuning START_PX/REST_PX doesn't fail this test for the wrong reason —
    // what is under test is the clamped multiplication, not the constants themselves.
    mount(shell("capital", { "data-size": "1000" }));
    const s = readBurgLabelStyles();
    expect(s.capital.startPx).toBeCloseTo(START_PX.capital * 1.5, 10);
    expect(s.capital.restPx).toBeCloseTo(REST_PX.capital * 1.5, 10);
  });

  it("reads fill and halo, and falls back to a modest default halo width when no stroke is set", () => {
    // No preset sets a `stroke` on a burg-label shell, so a 0-width fallback here would silently
    // disable the halo everywhere — a small capital label needs it to stay readable over a big
    // state name (see webgl-burg-labels.ts's uHaloEdge).
    mount(
      shell("capital", { "data-size": "4", fill: "#112233", stroke: "#ffffff", "stroke-width": "2" }) +
        shell("hamlet", { "data-size": "1", fill: "#445566" })
    );
    const s = readBurgLabelStyles();
    expect(s.capital.fill).toBe("#112233");
    expect(s.capital.halo).toBe("#ffffff");
    expect(s.capital.haloWidth).toBe(2);
    expect(s.hamlet.haloWidth).toBeGreaterThan(0);
  });

  it("records a display:none group as hidden", () => {
    mount(shell("capital", { "data-size": "4", style: "display:none" }) + shell("hamlet", { "data-size": "1" }));
    const s = readBurgLabelStyles();
    expect(s.capital.hidden).toBe(true);
    expect(s.hamlet.hidden).toBe(false);
  });

  it("returns an empty map when there are no shells", () => {
    mount("");
    expect(readBurgLabelStyles()).toEqual({});
  });

  // Moved from webgl-burg-labels.test.ts, which tested this against the now-deleted
  // readGroupStyles. Regression: shells are appended in SVG paint order (least important first,
  // so capitals paint on top), which is the exact inverse of collision priority. Deriving rank
  // from DOM index once let hamlets outrank capitals and monopolise the screen.
  it("ranks groups by importance, not by DOM order", () => {
    mount(["hamlet", "village", "city", "capital"].map(id => shell(id, { "data-size": "2" })).join(""));
    const s = readBurgLabelStyles();
    expect(s.capital.rank).toBeLessThan(s.city.rank);
    expect(s.city.rank).toBeLessThan(s.village.rank);
    expect(s.village.rank).toBeLessThan(s.hamlet.rank);
  });
});
