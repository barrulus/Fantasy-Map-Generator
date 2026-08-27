import { defineConfig } from "@playwright/test";

// The desktop app serves its own renderer over the app:// scheme, so unlike the browser config
// there is no dev server to start and no viewport to set — the window size is pinned by the
// window-state.json the spec writes into a private profile before launching.
export default defineConfig({
  testDir: ".",
  testMatch: "electron.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 600_000,
  reporter: [["list"]],
  use: { trace: "off", video: "off" },
});
