import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // One shared database: migrate once, then run files sequentially so
    // cross-file interference is impossible. Fixtures never collide (unique
    // users/groups per test), so tests within a file may still run in order.
    globalSetup: "./helpers/setup.ts",
    setupFiles: ["./helpers/hooks.ts"],
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
