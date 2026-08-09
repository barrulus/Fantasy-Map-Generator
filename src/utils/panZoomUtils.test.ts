import { describe, expect, it } from "vitest";
import { clampPanZoom, MAX_ZOOM, MIN_ZOOM, PAN_ZOOM_IDENTITY, panBy, zoomAt } from "./panZoomUtils";

const viewport = { width: 400, height: 320 };

describe("zoomAt", () => {
  it("keeps the content point under the cursor fixed while zooming", () => {
    const t = zoomAt(PAN_ZOOM_IDENTITY, { x: 100, y: 80 }, 2, viewport);
    expect(t).toEqual({ k: 2, x: -100, y: -80 });
    // content point under the cursor before: (100 - 0) / 1 = 100
    // after: (100 - (-100)) / 2 = 100 — unchanged
  });

  it("compounds zooms toward different points", () => {
    const once = zoomAt(PAN_ZOOM_IDENTITY, { x: 100, y: 80 }, 2, viewport);
    const twice = zoomAt(once, { x: 200, y: 160 }, 2, viewport);
    expect(twice.k).toBe(4);
    // content point under (200,160) at k=2: (200 - (-100)) / 2 = 150
    // must still be there at k=4: (200 - x) / 4 = 150 → x = -400
    expect(twice.x).toBe(-400);
    expect(twice.y).toBe(-320);
  });

  it("clamps scale at MAX_ZOOM and anchors with the clamped factor", () => {
    const t = zoomAt(PAN_ZOOM_IDENTITY, { x: 100, y: 80 }, 1000, viewport);
    expect(t.k).toBe(MAX_ZOOM);
    // offsets must come from the clamped k (ratio 32), not the raw factor (1000):
    // x = 100 - (100 - 0)·32 = -3100, y = 80 - (80 - 0)·32 = -2480
    expect(t.x).toBe(-3100);
    expect(t.y).toBe(-2480);
  });

  it("clamps scale at MIN_ZOOM and recentres to identity", () => {
    const t = zoomAt({ k: 1, x: 0, y: 0 }, { x: 200, y: 160 }, 0.5, viewport);
    expect(t).toEqual({ k: MIN_ZOOM, x: 0, y: 0 });
  });

  it("re-clamps pan when zooming out from a corner", () => {
    // fully panned to the bottom-right corner at k=4
    const cornered = { k: 4, x: -1200, y: -960 };
    const t = zoomAt(cornered, { x: 0, y: 0 }, 0.25, viewport);
    expect(t).toEqual({ k: 1, x: 0, y: 0 });
  });
});

describe("panBy", () => {
  it("moves the content by the pointer delta", () => {
    const zoomed = { k: 2, x: -100, y: -80 };
    const t = panBy(zoomed, -50, 30, viewport);
    expect(t).toEqual({ k: 2, x: -150, y: -50 });
  });

  it("clamps pan at all four edges", () => {
    const zoomed = { k: 2, x: -100, y: -80 };
    // at k=2 the pan range is x ∈ [-400, 0], y ∈ [-320, 0]
    expect(panBy(zoomed, 9999, 9999, viewport)).toEqual({ k: 2, x: 0, y: 0 });
    expect(panBy(zoomed, -9999, -9999, viewport)).toEqual({ k: 2, x: -400, y: -320 });
  });

  it("cannot pan at 1x", () => {
    expect(panBy(PAN_ZOOM_IDENTITY, 40, 40, viewport)).toEqual(PAN_ZOOM_IDENTITY);
  });
});

describe("clampPanZoom", () => {
  it("returns offsets to zero at scale 1", () => {
    expect(clampPanZoom({ k: 1, x: -50, y: 20 }, viewport)).toEqual({ k: 1, x: 0, y: 0 });
  });
});
