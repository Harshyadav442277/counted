import { defineConfig } from "vitest/config";

/**
 * The health tests import the whole app after `vi.resetModules()`, which on a cold
 * disk cache (a fresh clone, right after `npm install`) can take longer than the
 * 5 s default and fail the suite for no product reason. Give every test room.
 */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
