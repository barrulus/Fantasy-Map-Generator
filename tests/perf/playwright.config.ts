import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PERF_PORT || 4199);
const skipBuild = !!process.env.SKIP_BUILD;

// Perf runs are sequential on purpose: parallel workers contend for CPU and poison the timings.
// The viewport is fixed because graphWidth/graphHeight feed point placement — the same seed on a
// different canvas generates a different map, so numbers across viewport sizes are not comparable.
export default defineConfig({
  testDir: ".",
  // the desktop spec launches Electron and has no dev server to point at: it runs under
  // electron.config.ts, and would fail here simply for being in the same directory
  testIgnore: "electron.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "off",
    video: "off",
    viewport: { width: 1280, height: 720 },
    launchOptions: process.env.PERF_BROWSER_PATH
      ? { executablePath: process.env.PERF_BROWSER_PATH, args: ["--no-sandbox"] }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: skipBuild ? `npm run preview -- --port ${port}` : `npm run build && npm run preview -- --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
