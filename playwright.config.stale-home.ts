import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "playwright/test";

/**
 * Dedicated config for the stale-snapshot page-performance scenarios (T7-04).
 * Starts a Vite dev server with `TRUSTTOOLS_USAGE_HOME` pointing at the
 * committed fixture home (`tests/fixtures/e2e/stale-home`) that contains a
 * pre-seeded, 7-day-old usage snapshot envelope — pages must render the stale
 * snapshot immediately (last-known-good) instead of blocking on a re-scan or
 * falling into the load-failed boundary.
 *
 * The fixture home also ships an empty skill-snapshot envelope so the /agents
 * read path never triggers a background `skills.refresh` (which would scan the
 * real machine and write into the committed fixture).
 *
 * Run: `npx playwright test -c playwright.config.stale-home.ts performance-stale-offline.spec.ts`
 */

// Port differs from the default config (41737) and empty-home (41738) so the
// dedicated configs can run side by side without port collisions.
const port = 41739;
const staleHome = join(
  dirname(fileURLToPath(import.meta.url)),
  "tests",
  "fixtures",
  "e2e",
  "stale-home",
);

// The env vars must also reach the test process (specs read them to decide
// whether to skip), not just the web server.
process.env.TRUSTTOOLS_USAGE_HOME = staleHome;
process.env.TRUSTTOOLS_E2E_STALE_HOME = staleHome;

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
    // 120s is the empty-home baseline; bumped to 180s because two Vite dev
    // servers sharing node_modules/.vite can contend during cold start on a
    // loaded machine (observed on this repo's Windows harness).
    timeout: 180_000,
    env: {
      TRUSTTOOLS_USAGE_HOME: staleHome,
      TRUSTTOOLS_E2E_STALE_HOME: staleHome,
    },
  },
});
