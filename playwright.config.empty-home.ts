import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "playwright/test";

/**
 * Dedicated config for the page-performance resilience scenarios (T7-04).
 * Starts a Vite dev server with `AITRACKER_USAGE_HOME` pointing at an empty
 * temp directory so the app boots with no snapshots — pages must render the
 * shell/empty state, never a white screen or the load-failed boundary.
 *
 * Run: `npx playwright test -c playwright.config.empty-home.ts performance-scenarios.spec.ts`
 */

const port = 41738;
const emptyHome = mkdtempSync(join(tmpdir(), "aitracker-empty-home-"));

// The env vars must also reach the test process (specs read them to decide
// whether to skip), not just the web server.
process.env.AITRACKER_USAGE_HOME = emptyHome;
process.env.AITRACKER_E2E_EMPTY_HOME = emptyHome;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      AITRACKER_USAGE_HOME: emptyHome,
      AITRACKER_E2E_EMPTY_HOME: emptyHome,
    },
  },
});
