import { describe, expect, it } from "vitest";
import { selectNonOverlapping } from "./label-collision";

describe("selectNonOverlapping", () => {
  it("returns an empty set for empty input", () => {
    expect(selectNonOverlapping([])).toEqual(new Set());
  });

  it("keeps a single box", () => {
    const kept = selectNonOverlapping([{ id: "a", left: 0, top: 0, right: 10, bottom: 10, weight: 1 }]);
    expect(kept).toEqual(new Set(["a"]));
  });

  it("keeps both boxes when they do not overlap", () => {
    const kept = selectNonOverlapping([
      { id: "a", left: 0, top: 0, right: 10, bottom: 10, weight: 1 },
      { id: "b", left: 100, top: 100, right: 110, bottom: 110, weight: 1 }
    ]);
    expect(kept).toEqual(new Set(["a", "b"]));
  });

  it("does not treat touching-but-not-overlapping edges as a collision", () => {
    // b's left edge exactly equals a's right edge - they share a border, not an area.
    const kept = selectNonOverlapping([
      { id: "a", left: 0, top: 0, right: 10, bottom: 10, weight: 1 },
      { id: "b", left: 10, top: 0, right: 20, bottom: 10, weight: 1 }
    ]);
    expect(kept).toEqual(new Set(["a", "b"]));
  });

  it("higher weight wins a contested spot", () => {
    const kept = selectNonOverlapping([
      { id: "low", left: 0, top: 0, right: 10, bottom: 10, weight: 1 },
      { id: "high", left: 5, top: 5, right: 15, bottom: 15, weight: 100 }
    ]);
    expect(kept).toEqual(new Set(["high"]));
  });

  it("drops the middle of a chain of three but keeps the third when it clears the first", () => {
    // a and b overlap, b and c overlap, but a and c do not.
    const boxes = [
      { id: "a", left: 0, top: 0, right: 10, bottom: 10, weight: 3 },
      { id: "b", left: 8, top: 0, right: 18, bottom: 10, weight: 2 },
      { id: "c", left: 16, top: 0, right: 26, bottom: 10, weight: 1 }
    ];
    const kept = selectNonOverlapping(boxes);
    expect(kept).toEqual(new Set(["a", "c"]));
  });

  it("resolves identical weights deterministically regardless of input order", () => {
    const boxes = [
      { id: "x", left: 0, top: 0, right: 10, bottom: 10, weight: 5 },
      { id: "y", left: 5, top: 5, right: 15, bottom: 15, weight: 5 }
    ];
    const forward = selectNonOverlapping(boxes);
    const reversed = selectNonOverlapping([...boxes].reverse());
    expect(forward).toEqual(reversed);
    // ties break by ascending id, so "x" wins over "y"
    expect(forward).toEqual(new Set(["x"]));
  });
});
