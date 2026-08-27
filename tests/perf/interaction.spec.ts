import path from "path";
import { test, expect, type Page } from "@playwright/test";
import { applyZoomExtent, denseTarget, domNodes, gestures, measureScenario, record, ZOOM_MAX } from "./metrics";

/**
 * Interaction timing on a fixture map: real wheel/drag gestures (never the zoom API — programmatic
 * zoom ends synchronously and skips the rAF/zoom-end path, which is exactly where regressions
 * hide), with an rAF sampler recording frame timestamps. Reported per scenario:
 *   - median / p95 frame gap and long-frame count during the gesture (jank)
 *   - settle time: last input event until the first run of 5 consecutive frames under 33ms
 *   - SVG node count under #map (a culling regression shows up here before it shows up in time)
 * Plus a one-shot redraw timing per heavy layer — the real-data equivalent of renderer benchmarks.
 */

const FIXTURE = process.env.PERF_MAP || "1.139.4.map";

const PRESETS: Record<string, string[]> = {
  political: ["borders", "burgIcons", "ice", "labels", "lakes", "rivers", "routes", "scaleBar", "states", "vignette"],
  heavy: ["biomes", "borders", "burgIcons", "heightmap", "ice", "labels", "lakes", "military", "provinces",
    "relief", "religions", "rivers", "routes", "scaleBar", "states", "zones"],
};

const DRAW_LAYERS = ["heightmap", "biomes", "cultures", "religions", "provinces", "states", "rivers",
  "borders", "routes", "labels", "burgIcons", "military", "zones", "relief"];

async function loadFixture(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.waitForFunction(() => (window as any).mapId !== undefined, { timeout: 180_000 });
  const previousMapId = await page.evaluate(() => (window as any).mapId);
  await page.locator("#mapToLoad").setInputFiles(path.join(__dirname, "../fixtures", FIXTURE));
  await page.waitForFunction(
    previous => (window as any).mapId !== undefined && (window as any).mapId !== previous,
    previousMapId,
    { timeout: 180_000 }
  );
  await page.waitForTimeout(2000);
}

for (const [preset, layerIds] of Object.entries(PRESETS)) {
  test(`gestures on ${FIXTURE} with ${preset} layers`, async ({ page }) => {
    await loadFixture(page);
    await page.evaluate(ids => (window as any).Layers.set(ids), layerIds);
    await applyZoomExtent(page);
    await page.waitForTimeout(1500);

    const target = await denseTarget(page);

    const tag = { runtime: "browser", preset, fixture: FIXTURE, zoomMax: ZOOM_MAX };
    await measureScenario(page, "zoom-in", gestures.zoomIn(page, target), tag);
    await measureScenario(page, "pan", gestures.pan(page, 640, 360), tag);
    await measureScenario(page, "zoom-out", gestures.zoomOut(page, 640, 360), tag);
  });
}

test(`layer redraw timings on ${FIXTURE}`, async ({ page }) => {
  await loadFixture(page);
  for (const id of DRAW_LAYERS) {
    const drawMs = await page.evaluate(layerId => {
      const Layers = (window as any).Layers;
      if (!Layers.state.active.includes(layerId)) Layers.show(layerId);
      const t0 = performance.now();
      Layers.draw(layerId);
      return performance.now() - t0; // async draw internals (e.g. relief icons) under-report
    }, id);
    record({ kind: "layer-draw", fixture: FIXTURE, layer: id, drawMs: Math.round(drawMs * 100) / 100 });
  }
});
