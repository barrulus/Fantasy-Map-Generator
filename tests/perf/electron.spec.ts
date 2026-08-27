import fs from "fs";
import os from "os";
import path from "path";
import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";
import { applyZoomExtent, denseTarget, generateAt, gestures, measureScenario, record, ZOOM_MAX } from "./metrics";

/**
 * Desktop-app timing: what the Electron build does that the web build cannot be asked about —
 * cold start through its own app:// scheme, gesture smoothness on the real GPU, and the memory
 * footprint of the whole process tree.
 *
 * Generation timing is deliberately absent: it is the same renderer JS on the same V8, so
 * generation.spec.ts already covers it with less setup and less variance.
 *
 * Point PERF_ELECTRON_BIN at a packaged launcher (a Nix build, an unpacked AppImage) to measure
 * that. With nothing set, it runs the repo's own `dist-electron/`, which is what `npm run electron
 * build` produces and what ab.mjs builds for each side.
 */

// PERF_CELLS generates a map at that density instead of loading a fixture: the fixtures are small,
// and gesture cost on a 1.5K-cell map says nothing about a 500K one
const CELLS = process.env.PERF_CELLS ? Number(process.env.PERF_CELLS.split(",").pop()) : 0;
const SEED = process.env.PERF_SEEDS?.split(",")[0] || "123456789";
const FIXTURE = process.env.PERF_MAP || "1.139.4.map";
const SUBJECT = CELLS ? `${CELLS / 1000}K generated cells` : FIXTURE;
const RUNTIME = "electron";
const LAYERS = ["borders", "burgIcons", "ice", "labels", "lakes", "rivers", "routes", "scaleBar", "states", "vignette"];

// The canvas drives both render cost and point placement, so it is pinned exactly as the browser
// config pins its viewport. main.ts restores this file, and would otherwise open full screen on a
// first run and at the previous size on later ones — neither is comparable across machines.
const WINDOW = { width: 1280, height: 720, x: 0, y: 0, maximized: false, fullscreen: false };

function launchProfile() {
  // main.ts derives userData from appData, which on Linux follows XDG_CONFIG_HOME. A private one
  // both pins the window and dodges the single-instance lock: launching while another copy is
  // running otherwise hands off to that window and exits, measuring nothing.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fmg-perf-"));
  const userData = path.join(root, "fantasy-map-generator");
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, "window-state.json"), JSON.stringify(WINDOW));
  return root;
}

function launchTarget() {
  const packaged = process.env.PERF_ELECTRON_BIN;
  if (packaged) {
    if (!fs.existsSync(packaged)) throw new Error(`PERF_ELECTRON_BIN does not exist: ${packaged}`);
    return { executablePath: packaged, args: [] as string[] };
  }

  const repoRoot = path.join(__dirname, "../..");
  let electronBinary: string;
  try {
    electronBinary = require("electron") as unknown as string;
  } catch {
    throw new Error(
      "No Electron to launch. Either point PERF_ELECTRON_BIN at a packaged launcher, or run " +
        "`npm ci` in this checkout so the electron dependency and its binary are present."
    );
  }
  if (!fs.existsSync(path.join(repoRoot, "dist-electron", "main.js"))) {
    throw new Error("dist-electron/main.js is missing — run `npm run electron build` first.");
  }
  return { executablePath: electronBinary, args: [repoRoot] };
}

async function launch(): Promise<{ app: ElectronApplication; page: Page; startedAt: number }> {
  const { executablePath, args } = launchTarget();
  const startedAt = Date.now();
  let app: ElectronApplication;
  try {
    app = await electron.launch({
      executablePath,
      args,
      env: { ...process.env, XDG_CONFIG_HOME: launchProfile() },
    });
  } catch (cause) {
    // npm ships a prebuilt Electron linked against FHS paths, which will not start on NixOS
    throw new Error(
      `Electron failed to launch from ${executablePath}. If this is NixOS, that binary cannot run ` +
        "unpatched — build the app with `nix build` and set PERF_ELECTRON_BIN to " +
        "result/bin/fantasy-map-generator.",
      { cause }
    );
  }
  const page = await app.firstWindow();
  return { app, page, startedAt };
}

/**
 * `app.close()` closes the window, which main.ts intercepts with the "Quit the Fantasy Map
 * Generator?" confirmation — the dialog then blocks teardown until Playwright times out.
 * `app.exit()` skips the close handlers entirely, which is what a measurement run wants.
 */
async function quit(app: ElectronApplication) {
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => app.close());
}

/** Total resident memory of every process the app owns, which a browser tab cannot report */
async function memoryMb(app: ElectronApplication) {
  const metrics = await app.evaluate(({ app: electronApp }) => electronApp.getAppMetrics());
  const totalKb = metrics.reduce((sum, m) => sum + (m.memory?.workingSetSize || 0), 0);
  return {
    processes: metrics.length,
    rssMb: Math.round((totalKb / 1024) * 10) / 10,
  };
}

/**
 * Every launch gets a fresh profile, so the app sees no stored version and pops its update dialog
 * six seconds in — on top of whatever is being measured. Recording the current version and
 * reloading starts the measured session with that dialog already settled.
 */
async function silenceUpdateDialog(page: Page) {
  await page.waitForFunction(() => (window as any).VERSION !== undefined, { timeout: 180_000 });
  await page.evaluate(() => localStorage.setItem("version", (window as any).VERSION));
  await page.reload();
}

async function loadMap(page: Page) {
  await silenceUpdateDialog(page);
  await page.waitForFunction(() => (window as any).mapId !== undefined, { timeout: 180_000 });
  if (CELLS) return generateAt(page, CELLS, SEED);

  const previous = await page.evaluate(() => (window as any).mapId);
  await page.locator("#mapToLoad").setInputFiles(path.join(__dirname, "../fixtures", FIXTURE));
  await page.waitForFunction(
    prev => (window as any).mapId !== undefined && (window as any).mapId !== prev,
    previous,
    { timeout: 180_000 }
  );
  await page.waitForTimeout(2000);
}

test("cold start to a rendered map", async () => {
  const { app, page, startedAt } = await launch();

  await page.waitForFunction(() => (window as any).mapId !== undefined, { timeout: 180_000 });
  await page.waitForFunction(() => document.querySelectorAll("#map path").length > 100, { timeout: 180_000 });
  const readyMs = Date.now() - startedAt;

  // Splits the wall clock into "Electron got the renderer running" and "the app drew a map"
  const nav = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return entry ? { domContentLoadedMs: entry.domContentLoadedEventEnd, loadMs: entry.loadEventEnd } : null;
  });

  record({ kind: "startup", runtime: RUNTIME, readyMs, ...nav, ...(await memoryMb(app)) });
  expect(readyMs).toBeGreaterThan(0);
  await quit(app);
});

test(`gestures on ${SUBJECT}`, async () => {
  const { app, page } = await launch();
  await loadMap(page);
  await page.evaluate(ids => (window as any).Layers.set(ids), LAYERS);
  await applyZoomExtent(page);
  await page.waitForTimeout(1500);

  const target = await denseTarget(page);
  const cx = WINDOW.width / 2;
  const cy = WINDOW.height / 2;
  const tag = { runtime: RUNTIME, preset: "political", fixture: SUBJECT, zoomMax: ZOOM_MAX };

  const frames = await measureScenario(page, "zoom-in", gestures.zoomIn(page, target), tag);
  await measureScenario(page, "pan", gestures.pan(page, cx, cy), tag);
  await measureScenario(page, "zoom-out", gestures.zoomOut(page, cx, cy), tag);

  record({ kind: "memory", runtime: RUNTIME, fixture: SUBJECT, phase: "after-gestures", ...(await memoryMb(app)) });
  expect(frames).toBeGreaterThan(0);
  await quit(app);
});
