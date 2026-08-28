import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "playwright/test";

/**
 * Dedicated config for the stale-snapshot page-performance scenarios (T7-04).
 * Seeds a throwaway home (temp dir) with a stale usage + skills snapshot in
 * SQLite, then starts a Vite dev server with `AITRACKER_USAGE_HOME` pointing at
 * it. Pages must render the stale snapshot immediately (last-known-good)
 * instead of blocking on a re-scan or falling into the load-failed boundary.
 *
 * The seeded skills snapshot keeps the /agents read path from triggering a
 * background `skills.refresh` (which would scan the real machine and write into
 * the throwaway home).
 *
 * Run: `npx playwright test -c playwright.config.stale-home.ts performance-stale-offline.spec.ts`
 */

// Port differs from the default config (41737) and empty-home (41738) so the
// dedicated configs can run side by side without port collisions.
const port = 41739;
const seedScript = join(
  dirname(fileURLToPath(import.meta.url)),
  "scripts",
  "e2e",
  "seed-stale-home.mjs",
);
const staleHome = mkdtempSync(join(tmpdir(), "aitracker-stale-home-"));
execFileSync(process.execPath, [seedScript, staleHome], { stdio: "inherit" });

// The env vars must also reach the test process (specs read them to decide
// whether to skip), not just the web server.
process.env.AITRACKER_USAGE_HOME = staleHome;
process.env.AITRACKER_E2E_STALE_HOME = staleHome;

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
      AITRACKER_USAGE_HOME: staleHome,
      AITRACKER_E2E_STALE_HOME: staleHome,
      // Keep the test dev server deterministic: no background scheduler.
      AITRACKER_ENABLE_BACKGROUND_TASKS: "false",
    },
  },
});
