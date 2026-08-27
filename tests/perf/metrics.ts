import fs from "fs";
import type { Page } from "@playwright/test";

/**
 * Measurement helpers shared by the perf specs. Everything here is renderer-agnostic: it drives a
 * Playwright Page, so the same code measures the web build in a browser and the desktop build in
 * Electron, and their numbers stay comparable.
 */

const OUT = process.env.PERF_OUT || "";

export function record(result: Record<string, unknown>) {
  const line = JSON.stringify(result);
  console.log("PERF_RESULT " + line);
  if (OUT) fs.appendFileSync(OUT, line + "\n");
}

export const startFrames = (page: Page) =>
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

export const stopFrames = (page: Page) =>
  page.evaluate(() => {
    (window as any).__framesOn = false;
    return (window as any).__frames as number[];
  });

export const now = (page: Page) => page.evaluate(() => performance.now());

export const domNodes = (page: Page) =>
  page.evaluate(() => document.getElementById("map")!.querySelectorAll("*").length);

/** Screen position of the burg-densest area — the map centre is typically open ocean */
export const denseTarget = (page: Page) =>
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
      const key =
        Math.min(BINS - 1, Math.floor(((b.x - minX) / (maxX - minX + 1e-9)) * BINS)) * BINS +
        Math.min(BINS - 1, Math.floor(((b.y - minY) / (maxY - minY + 1e-9)) * BINS));
      const bin = counts.get(key) || { n: 0, x: 0, y: 0 };
      counts.set(key, { n: bin.n + 1, x: bin.x + b.x, y: bin.y + b.y });
    }
    const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
    const t = (window as any).d3.zoomTransform(document.getElementById("map"));
    return { x: t.applyX(best.x / best.n), y: t.applyY(best.y / best.n) };
  });

/**
 * The app resets the zoom extent to [1, 20] on every load and never stores it, so a perf run that
 * wants to exercise deep zoom has to widen it each time. This is a measurement setting only — it
 * changes nothing about what users get.
 */
export const ZOOM_MAX = Number(process.env.PERF_ZOOM_MAX || 90);

export const applyZoomExtent = (page: Page) =>
  page.evaluate(max => (window as any).setZoomExtent(1, max), ZOOM_MAX);

/**
 * Regenerate at a chosen density. The fixtures are ~1.5K-cell maps, so gesture numbers taken on
 * them say nothing about how the app behaves on a dense one — which is the case that hurts.
 */
export async function generateAt(page: Page, cells: number, seed: string) {
  await page.evaluate(n => {
    // a stored "points" key stops randomizeOptions() resetting the density mid-generate, and the
    // dataset value is what generateGrid actually reads — so any cell count works
    localStorage.setItem("points", "4");
    document.getElementById("pointsInput")!.dataset.cells = String(n);
  }, cells);

  await page.evaluate(config => {
    (window as any).__regenerated = new Promise<void>(resolve =>
      window.addEventListener("map:generated", () => resolve(), { once: true })
    );
    (0, eval)(`regenerateMap(${config})`);
  }, JSON.stringify({ seed }));
  await page.evaluate(() => (window as any).__regenerated);
}

export function gaps(frames: number[], from: number, to: number): number[] {
  const result: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i] > from && frames[i] <= to) result.push(frames[i] - frames[i - 1]);
  }
  return result;
}

export const quantile = (sorted: number[], q: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];

export function settleMs(frames: number[], gestureEnd: number): number | null {
  for (let i = 0; i < frames.length - 5; i++) {
    if (frames[i] < gestureEnd) continue;
    let calm = true;
    for (let j = i + 1; j <= i + 5; j++) if (frames[j] - frames[j - 1] >= 33) calm = false;
    if (calm) return Math.max(0, frames[i] - gestureEnd);
  }
  return null;
}

/** Real wheel/drag gestures, never the zoom API: programmatic zoom ends synchronously and skips
 * the rAF/zoom-end path, which is exactly where regressions hide */
export const gestures = {
  zoomIn: (page: Page, target: { x: number; y: number }) => async () => {
    await page.mouse.move(target.x, target.y);
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, -120);
      await page.waitForTimeout(30);
    }
  },
  pan: (page: Page, cx: number, cy: number) => async () => {
    for (const [dx, dy] of [
      [-12, -4],
      [10, 8],
      [4, -10],
    ]) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 0; i < 25; i++) {
        await page.mouse.move(cx + dx * i, cy + dy * i);
        await page.waitForTimeout(16);
      }
      await page.mouse.up();
    }
  },
  zoomOut: (page: Page, cx: number, cy: number) => async () => {
    await page.mouse.move(cx, cy);
    for (let i = 0; i < 24; i++) {
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(30);
    }
  },
};

/** Frame stats for one gesture, tagged with `extra` so callers can name the runtime and preset */
export async function measureScenario(
  page: Page,
  scenario: string,
  gesture: () => Promise<void>,
  extra: Record<string, unknown> = {}
) {
  const start = await startFrames(page);
  await gesture();
  const gestureEnd = await now(page);
  await page.waitForTimeout(2500);
  const frames = await stopFrames(page);

  const gestureGaps = gaps(frames, start, gestureEnd).sort((a, b) => a - b);
  record({
    kind: "interaction",
    scenario,
    ...extra,
    frames: gestureGaps.length,
    medianFrameMs: quantile(gestureGaps, 0.5),
    p95FrameMs: quantile(gestureGaps, 0.95),
    longFrames: gestureGaps.filter(g => g > 50).length,
    settleMs: settleMs(frames, gestureEnd),
    domNodes: await domNodes(page),
  });
  return gestureGaps.length;
}
