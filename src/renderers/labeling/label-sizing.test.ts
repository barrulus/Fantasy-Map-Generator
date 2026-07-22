import { describe, expect, it } from "vitest";
import { effectiveLabelPx, effectiveLabelPxForGroup, entryPxExceedsCeiling, svgLabelFontSize } from "./label-sizing";
import { CEIL_PX, MIN_ZOOM } from "./tier-table";

describe("effectiveLabelPx", () => {
  it("grows with the map between the floor and the ceiling", () => {
    expect(effectiveLabelPx(4, 5, 6, 60)).toBe(20);
  });

  it("raises a label to the floor instead of dropping it", () => {
    expect(effectiveLabelPx(4, 1, 6, 60)).toBe(6);
  });

  it("stops growing at the ceiling instead of dropping it", () => {
    expect(effectiveLabelPx(4, 100, 6, 60)).toBe(60);
  });

  it("never returns a size that signals a cull", () => {
    for (const scale of [0.1, 1, 10, 1000]) expect(effectiveLabelPx(2.49, scale, 11, 96)).toBeGreaterThan(0);
  });
});

describe("effectiveLabelPxForGroup", () => {
  // Regression: Nomia's preset sets the capital font to 2.49 map units. Under the old
  // `px = d*scale < 6 -> cull` rule capitals were invisible below scale 2.41 even though
  // MIN_ZOOM.capital is 1. See the brief section 7.
  it("keeps a small-font capital legible at scale 1", () => {
    expect(effectiveLabelPxForGroup("capital", 2.49, 1)).toBe(11);
  });

  it("hands back to natural growth once the capital outgrows its floor", () => {
    expect(effectiveLabelPxForGroup("capital", 2.49, 10)).toBeCloseTo(24.9, 5);
  });

  it("leaves the default preset's capital unclamped once zoomed in", () => {
    expect(effectiveLabelPxForGroup("capital", 4.98, 5)).toBeCloseTo(24.9, 5);
  });
});

describe("svgLabelFontSize", () => {
  // SVG <text> lives inside the zoom-transformed #viewbox, so rendered size is attr * scale.
  it("returns the attribute that renders at the requested on-screen size", () => {
    const px = 24;
    const scale = 3;
    expect(svgLabelFontSize(px, scale) * scale).toBeCloseTo(px, 10);
  });

  it("is the authored size when the label is inside its band", () => {
    const d = 4;
    const scale = 5;
    expect(svgLabelFontSize(effectiveLabelPx(d, scale, 6, 60), scale)).toBeCloseTo(d, 10);
  });

  it("survives a zero scale without dividing by zero", () => {
    expect(Number.isFinite(svgLabelFontSize(12, 0))).toBe(true);
  });
});

describe("entryPxExceedsCeiling", () => {
  it("flags a tier whose ceiling is below its own entry size", () => {
    // hamlet enters at scale 14; a 5 map-unit font enters at 70px, above the 56px ceiling
    expect(entryPxExceedsCeiling("hamlet", 5)).toBe(true);
  });

  // Spec invariant: ceil(tier) > d * minZoom(tier), else the tier is born clamped and never scales.
  it("holds for every tier on the default preset's font sizes", () => {
    const defaultPreset: Record<string, number> = {
      capital: 4.98,
      city: 4.15,
      town: 3.32,
      village: 2.49,
      hamlet: 1.66
    };
    for (const [group, d] of Object.entries(defaultPreset)) {
      expect(entryPxExceedsCeiling(group, d)).toBe(false);
      expect(CEIL_PX[group]).toBeGreaterThan(d * MIN_ZOOM[group]);
    }
  });
});
