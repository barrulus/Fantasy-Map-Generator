import { describe, expect, it } from "vitest";
import {
  authoredSizeFactor,
  effectiveLabelPx,
  labelIconOffsetPx,
  labelPxForGroup,
  svgLabelFontSize
} from "./label-sizing";
import { groupRestPx, groupStartPx } from "./tier-table";

describe("effectiveLabelPx", () => {
  it("equals startPx at scale 1", () => {
    expect(effectiveLabelPx(1, 32, 15)).toBe(32);
  });

  it("approaches restPx as scale grows", () => {
    // capital: startPx=32, restPx=15
    expect(effectiveLabelPx(1, 32, 15)).toBe(32);
    expect(effectiveLabelPx(2, 32, 15)).toBeCloseTo(15 + 17 / 2, 10); // 23.5
    expect(effectiveLabelPx(5, 32, 15)).toBeCloseTo(15 + 17 / 5, 10); // 18.4
    expect(effectiveLabelPx(20, 32, 15)).toBeCloseTo(15 + 17 / 20, 10); // 15.85
  });

  it("decreases strictly as scale increases", () => {
    const scales = [1, 2, 5, 10, 20, 50];
    const sizes = scales.map(s => effectiveLabelPx(s, 32, 15));
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeLessThan(sizes[i - 1]);
  });

  it("never returns a size that signals a cull", () => {
    for (const scale of [0.1, 1, 10, 1000]) expect(effectiveLabelPx(scale, 32, 15)).toBeGreaterThan(0);
  });

  it("returns startPx for a zero or negative scale", () => {
    expect(effectiveLabelPx(0, 32, 15)).toBe(32);
    expect(effectiveLabelPx(-1, 32, 15)).toBe(32);
  });

  it("returns startPx for a non-finite scale", () => {
    expect(effectiveLabelPx(Number.NaN, 32, 15)).toBe(32);
    expect(effectiveLabelPx(Number.POSITIVE_INFINITY, 32, 15)).toBe(32);
  });
});

describe("capitals vs hamlets", () => {
  it("stays larger than a hamlet at every tested scale", () => {
    const capStart = groupStartPx("capital");
    const capRest = groupRestPx("capital");
    const hamStart = groupStartPx("hamlet");
    const hamRest = groupRestPx("hamlet");
    for (const scale of [1, 2, 5, 10, 20]) {
      expect(effectiveLabelPx(scale, capStart, capRest)).toBeGreaterThan(effectiveLabelPx(scale, hamStart, hamRest));
    }
  });
});

describe("authoredSizeFactor", () => {
  it("is 1 when d is absent (NaN)", () => {
    expect(authoredSizeFactor("capital", Number.NaN)).toBe(1);
  });

  it("is 1 at the tier's reference size", () => {
    expect(authoredSizeFactor("capital", 4.98)).toBeCloseTo(1, 10);
  });

  it("clamps to 0.75 for a tiny authored size", () => {
    expect(authoredSizeFactor("capital", 0.01)).toBe(0.75);
  });

  it("clamps to 1.5 for a huge authored size", () => {
    expect(authoredSizeFactor("capital", 1000)).toBe(1.5);
  });
});

describe("labelPxForGroup", () => {
  it("scales the curve by the authored-size factor", () => {
    // hamlet reference is 1.66; doubling it should clamp at the 1.5x factor ceiling
    const px = labelPxForGroup("hamlet", 1.66 * 10, 1);
    expect(px).toBeCloseTo(groupStartPx("hamlet") * 1.5, 10);
  });

  it("matches the plain curve when d is absent", () => {
    expect(labelPxForGroup("capital", Number.NaN, 5)).toBeCloseTo(
      effectiveLabelPx(5, groupStartPx("capital"), groupRestPx("capital")),
      10
    );
  });
});

describe("labelIconOffsetPx", () => {
  it("matches the icon shader's floor at scale 1 for a capital (d=2)", () => {
    expect(labelIconOffsetPx(2, 1)).toBeCloseTo(4.5, 10); // max(2,3)/2 + 3
  });

  it("grows with scale once the icon exceeds the 3px floor", () => {
    expect(labelIconOffsetPx(2, 5)).toBeCloseTo(8, 10); // max(10,3)/2 + 3
  });

  it("floors small icons at the shader's 3px minimum (hamlet d=0.5 at scale 1)", () => {
    expect(labelIconOffsetPx(0.5, 1)).toBeCloseTo(4.5, 10); // max(0.5,3)/2 + 3
  });

  it("increases as diameter or scale increases", () => {
    expect(labelIconOffsetPx(4, 5)).toBeGreaterThan(labelIconOffsetPx(2, 5));
    expect(labelIconOffsetPx(2, 10)).toBeGreaterThan(labelIconOffsetPx(2, 5));
  });

  it("does not produce NaN or Infinity at scale 0", () => {
    const px = labelIconOffsetPx(2, 0);
    expect(Number.isFinite(px)).toBe(true);
  });
});

describe("svgLabelFontSize", () => {
  // SVG <text> lives inside the zoom-transformed #viewbox, so rendered size is attr * scale.
  it("returns the attribute that renders at the requested on-screen size", () => {
    const px = 24;
    const scale = 3;
    expect(svgLabelFontSize(px, scale) * scale).toBeCloseTo(px, 10);
  });

  it("is the authored size when the label sits exactly at startPx (scale 1)", () => {
    expect(svgLabelFontSize(effectiveLabelPx(1, 32, 15), 1)).toBeCloseTo(32, 10);
  });

  it("survives a zero scale without dividing by zero", () => {
    expect(Number.isFinite(svgLabelFontSize(12, 0))).toBe(true);
  });
});
