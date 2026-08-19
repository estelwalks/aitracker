import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "playwright/test";

/**
 * Dedicated config for the offline-exchange-rate resilience scenario (T7-04).
 *
 * The test loads the app first (Playwright's offline emulation also blocks
 * requests to 127.0.0.1 — verified in this repo's harness — so the initial
 * navigation cannot happen while offline), then drops the network and asserts
 * the app keeps rendering: exchange rates come from the cache/built-in fallback
 * ("内置基准" source, never a network round-trip on the page path) and no
 * white screen / load-failed boundary appears.
 *
 * The server reuses a seeded throwaway stale home as `TRUSTTOOLS_USAGE_HOME`
 * (stale usage + skills snapshot in SQLite) so first paint is deterministic and
 * fast (a present snapshot never triggers a background re-scan on the read path).
 *
 * Run: `npx playwright test -c playwright.config.offline.ts performance-stale-offline.spec.ts`
 */

// Port differs from default (41737), empty-home (41738) and stale-home (41739).
const port = 41740;
const seedScript = join(
  dirname(fileURLToPath(import.meta.url)),
  "scripts",
  "e2e",
  "seed-stale-home.mjs",
);
const offlineHome = mkdtempSync(join(tmpdir(), "tt-stale-home-"));
execFileSync(process.execPath, [seedScript, offlineHome], { stdio: "inherit" });

process.env.TRUSTTOOLS_USAGE_HOME = offlineHome;
process.env.TRUSTTOOLS_E2E_OFFLINE = "1";

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
      TRUSTTOOLS_USAGE_HOME: offlineHome,
      TRUSTTOOLS_E2E_OFFLINE: "1",
    },
  },
});
