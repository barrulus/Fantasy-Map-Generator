import { fileURLToPath, URL } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: "./src",
    setupFiles: ["./test-setup.ts"],
    // the fork's editor and dialog tests need a DOM; test-setup.ts only stubs one when it is absent
    environment: "jsdom",
    // *.dom.test.ts needs a real browser DOM - those run only under vitest.browser.config.ts
    exclude: [...configDefaults.exclude, "**/*.dom.test.ts"]
  },
  // keep in sync with vite.config.ts, or an `@/…` import resolves in the app but not under test
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  }
});
