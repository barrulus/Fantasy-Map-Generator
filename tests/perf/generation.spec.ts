import path from "path";
import { test, expect, type Page } from "@playwright/test";
import { record } from "./metrics";

/**
 * Generation timing: regenerate the map at fixed (seed, cells) points and record the total time,
 * the per-stage TIME log, the JS heap after generation, and a checksum of the generated data.
 *
 * The checksum is the correctness half of the A/B check: if base and head produce different
 * checksums for the same seed, the branches generate different maps and their timings must not be
 * compared. ab.mjs enforces that.
 *
 * One measurement per test invocation — ab.mjs provides repetition by re-running the suite in
 * alternating base/head rounds.
 */

const SEEDS = (process.env.PERF_SEEDS || "123456789,987654321").split(",");
// 500K is where the fork's own maps live and where generation cost stops being linear; drop back
// to "10000,100000" via PERF_CELLS for a quick run, since it roughly triples a round
const CELLS = (process.env.PERF_CELLS || "10000,100000,500000").split(",").map(Number);
const FIXTURES = (process.env.PERF_FIXTURES || "1.112.1.map,1.139.4.map").split(",");
/** Collects `console.timeEnd` lines ("stage: 12.3ms") and the "TOTAL: 1.23s" warn line */
function captureStages(page: Page) {
  const capture = { stages: {} as Record<string, number>, totalMs: 0, lastMessageAt: Date.now() };
  page.on("console", msg => {
    capture.lastMessageAt = Date.now();
    const text = msg.text();
    const stage = /^([A-Za-z][\w]*): ([\d.]+)\s*ms$/.exec(text);
    if (stage) capture.stages[stage[1]] = Number(stage[2]);
    const total = /^TOTAL: ([\d.]+)s$/.exec(text);
    if (total) capture.totalMs = Number(total[1]) * 1000;
  });
  return capture;
}

/** An in-flight auto-generation interleaves its TIME lines with the measured run — wait it out */
async function waitForConsoleQuiesce(page: Page, capture: { lastMessageAt: number }, silenceMs = 800) {
  const deadline = Date.now() + 30_000;
  while (Date.now() - capture.lastMessageAt < silenceMs) {
    if (Date.now() > deadline) throw new Error("console never went quiet");
    await page.waitForTimeout(100);
  }
}

async function openApp(page: Page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.waitForFunction(() => (window as any).mapId !== undefined, { timeout: 180_000 });
}

/** regenerateMap is a debounced lexical global; completion is signalled by the map:generated event */
async function regenerate(page: Page, seed: string) {
  await page.evaluate(config => {
    (window as any).__regenerated = new Promise<void>(resolve =>
      window.addEventListener("map:generated", () => resolve(), { once: true })
    );
    (0, eval)(`regenerateMap(${config})`);
  }, JSON.stringify({ seed }));
  await page.evaluate(() => (window as any).__regenerated);
}

/** FNV-1a over the pack arrays that would diverge if generation logic or RNG consumption changed */
const checksum = () => {
  const { cells, burgs, states, cultures, religions, provinces, rivers, routes } = (window as any).pack;
  let h = 0x811c9dc5;
  const add = (x: number) => {
    h ^= x & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (x >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  const addArray = (a: ArrayLike<number>) => {
    for (let i = 0; i < a.length; i++) add(a[i]);
  };
  addArray(cells.h);
  addArray(cells.t);
  addArray(cells.biome);
  addArray(cells.state);
  addArray(cells.burg);
  for (const b of burgs) if (b?.i) [b.x, b.y, b.population].forEach(v => add(Math.round(v * 100)));
  const counts = {
    gridCells: (window as any).grid.cells.i.length, // pack cells are culled, grid reflects the requested density
    cells: cells.i.length,
    burgs: burgs.length - 1,
    states: states.length - 1,
    cultures: cultures.length - 1,
    religions: religions.length - 1,
    provinces: provinces.length - 1,
    rivers: rivers.length,
    routes: routes.length,
  };
  return { hash: h.toString(16), counts };
};

async function heapMB(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("Performance.enable");
  const { metrics } = await cdp.send("Performance.getMetrics");
  const used = metrics.find(m => m.name === "JSHeapUsedSize")?.value ?? 0;
  await cdp.detach();
  return Math.round(used / 1048576);
}

for (const cells of CELLS) {
  for (const seed of SEEDS) {
    test(`generate ${cells} cells, seed ${seed}`, async ({ page }) => {
      const capture = captureStages(page);
      await openApp(page);
      await waitForConsoleQuiesce(page, capture);

      await page.evaluate(n => {
        // a stored "points" key stops randomizeOptions() from resetting the density mid-generate,
        // and the dataset value is what generateGrid actually reads — so any cell count works
        localStorage.setItem("points", "4");
        document.getElementById("pointsInput")!.dataset.cells = String(n);
      }, cells);

      capture.stages = {};
      capture.totalMs = 0;
      const t0 = Date.now();
      await regenerate(page, seed);
      const wallMs = Date.now() - t0;

      const sum = await page.evaluate(checksum);
      expect(sum.counts.gridCells).toBeGreaterThan(cells * 0.9);

      record({
        kind: "generation",
        seed,
        cells,
        totalMs: capture.totalMs || wallMs,
        wallMs,
        heapMB: await heapMB(page),
        checksum: sum,
        stages: capture.stages,
      });
    });
  }
}

for (const fixture of FIXTURES) {
  test(`load fixture ${fixture}`, async ({ page }) => {
    const capture = captureStages(page);
    await openApp(page);
    await waitForConsoleQuiesce(page, capture);

    const previousMapId = await page.evaluate(() => (window as any).mapId);
    const t0 = Date.now();
    await page.locator("#mapToLoad").setInputFiles(path.join(__dirname, "../fixtures", fixture));
    await page.waitForFunction(
      previous => (window as any).mapId !== undefined && (window as any).mapId !== previous,
      previousMapId,
      { timeout: 180_000 }
    );
    const wallMs = Date.now() - t0;

    record({ kind: "load", fixture, wallMs });
  });
}
