import fs from "fs";
import path from "path";
import { test, expect, type Page } from "@playwright/test";

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
const OUT = process.env.PERF_OUT || "";

const PRESETS: Record<string, string[]> = {
  political: ["borders", "burgIcons", "ice", "labels", "lakes", "rivers", "routes", "scaleBar", "states", "vignette"],
  heavy: ["biomes", "borders", "burgIcons", "heightmap", "ice", "labels", "lakes", "military", "provinces",
    "relief", "religions", "rivers", "routes", "scaleBar", "states", "zones"],
};

const DRAW_LAYERS = ["heightmap", "biomes", "cultures", "religions", "provinces", "states", "rivers",
  "borders", "routes", "labels", "burgIcons", "military", "zones", "relief"];

function record(result: Record<string, unknown>) {
  const line = JSON.stringify(result);
  console.log("PERF_RESULT " + line);
  if (OUT) fs.appendFileSync(OUT, line + "\n");
}

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

const startFrames = (page: Page) =>
  page.evaluate(() => {
    const frames: number[] = [];
    (window as any).__frames = frames;
    (window as any).__framesOn = true;
    const loop = (t: number) => {
      frames.push(t);
      if ((window as any).__framesOn) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return performance.now();
  });

const stopFrames = (page: Page) =>
  page.evaluate(() => {
    (window as any).__framesOn = false;
    return (window as any).__frames as number[];
  });

const now = (page: Page) => page.evaluate(() => performance.now());

const domNodes = (page: Page) => page.evaluate(() => document.getElementById("map")!.querySelectorAll("*").length);

/** Screen position of the burg-densest area — the map centre is typically open ocean */
const denseTarget = (page: Page) =>
  page.evaluate(() => {
    const pack = (window as any).pack;
    const burgs = pack.burgs.filter((b: any) => b && b.i && !b.removed);
    const xs = burgs.map((b: any) => b.x);
    const ys = burgs.map((b: any) => b.y);
    const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
    const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
    const BINS = 8;
    const counts = new Map<number, { n: number; x: number; y: number }>();
    for (const b of burgs) {
      const key = Math.min(BINS - 1, Math.floor(((b.x - minX) / (maxX - minX + 1e-9)) * BINS)) * BINS +
        Math.min(BINS - 1, Math.floor(((b.y - minY) / (maxY - minY + 1e-9)) * BINS));
      const bin = counts.get(key) || { n: 0, x: 0, y: 0 };
      counts.set(key, { n: bin.n + 1, x: bin.x + b.x, y: bin.y + b.y });
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    const t = (window as any).d3.zoomTransform(document.getElementById("map"));
    return { x: t.applyX(best.x / best.n), y: t.applyY(best.y / best.n) };
  });

function gaps(frames: number[], from: number, to: number): number[] {
  const result: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i] > from && frames[i] <= to) result.push(frames[i] - frames[i - 1]);
  }
  return result;
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

function settleMs(frames: number[], gestureEnd: number): number | null {
  for (let i = 0; i < frames.length - 5; i++) {
    if (frames[i] < gestureEnd) continue;
    let calm = true;
    for (let j = i + 1; j <= i + 5; j++) if (frames[j] - frames[j - 1] >= 33) calm = false;
    if (calm) return Math.max(0, frames[i] - gestureEnd);
  }
  return null;
}

async function measureScenario(page: Page, preset: string, scenario: string, gesture: () => Promise<void>) {
  const start = await startFrames(page);
  await gesture();
  const gestureEnd = await now(page);
  await page.waitForTimeout(2500);
  const frames = await stopFrames(page);

  const gestureGaps = gaps(frames, start, gestureEnd).sort((a, b) => a - b);
  record({
    kind: "interaction",
    preset,
    scenario,
    frames: gestureGaps.length,
    medianFrameMs: quantile(gestureGaps, 0.5),
    p95FrameMs: quantile(gestureGaps, 0.95),
    longFrames: gestureGaps.filter(g => g > 50).length,
    settleMs: settleMs(frames, gestureEnd),
    domNodes: await domNodes(page),
  });
  expect(gestureGaps.length).toBeGreaterThan(0);
}

for (const [preset, layerIds] of Object.entries(PRESETS)) {
  test(`gestures on ${FIXTURE} with ${preset} layers`, async ({ page }) => {
    await loadFixture(page);
    await page.evaluate(ids => (window as any).Layers.set(ids), layerIds);
    await page.waitForTimeout(1500);

    const target = await denseTarget(page);

    await measureScenario(page, preset, "zoom-in", async () => {
      await page.mouse.move(target.x, target.y);
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(0, -120);
        await page.waitForTimeout(30);
      }
    });

    await measureScenario(page, preset, "pan", async () => {
      for (const [dx, dy] of [[-12, -4], [10, 8], [4, -10]]) {
        await page.mouse.move(640, 360);
        await page.mouse.down();
        for (let i = 0; i < 25; i++) {
          await page.mouse.move(640 + dx * i, 360 + dy * i);
          await page.waitForTimeout(16);
        }
        await page.mouse.up();
      }
    });

    await measureScenario(page, preset, "zoom-out", async () => {
      await page.mouse.move(640, 360);
      for (let i = 0; i < 24; i++) {
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(30);
      }
    });
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
