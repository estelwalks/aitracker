import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "playwright/test";

/**
 * Warm-cache offline scenario config (tests/e2e/offline-market-rates.spec.ts).
 *
 * Emulates a PC with NO internet while the renderer still reaches the local
 * server: the Vite dev server is started with scripts/e2e/net-block-hook.mjs
 * (via NODE_OPTIONS --import), which makes every non-loopback fetch in the
 * server process fail immediately. The seeded home carries recent http-cache
 * rows (Security Market list + exchange rates), so the pages must keep
 * serving from cache with correct offline labeling instead of crashing.
 *
 * Run: `npx playwright test -c playwright.config.offline-warm.ts offline-market-rates.spec.ts`
 */
const port = 41741;
const seedScript = join(
  dirname(fileURLToPath(import.meta.url)),
  "scripts",
  "e2e",
  "seed-offline-home.mjs",
);
const hookScript = join(
  dirname(fileURLToPath(import.meta.url)),
  "scripts",
  "e2e",
  "net-block-hook.mjs",
);
const offlineHome = mkdtempSync(join(tmpdir(), "aitracker-offline-warm-"));
execFileSync(process.execPath, [seedScript, offlineHome, "--mode", "warm"], {
  stdio: "inherit",
});

process.env.AITRACKER_USAGE_HOME = offlineHome;
process.env.AITRACKER_E2E_OFFLINE_WARM = "1";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
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
    timeout: 180_000,
    env: {
      AITRACKER_USAGE_HOME: offlineHome,
      AITRACKER_E2E_OFFLINE_WARM: "1",
      AITRACKER_ENABLE_BACKGROUND_TASKS: "false",
      // Block every non-loopback fetch inside the dev-server process.
      NODE_OPTIONS: `--import=${hookScript}`,
    },
  },
});
