import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "playwright/test";

/**
 * Cold-cache offline scenario config (tests/e2e/offline-market-rates.spec.ts).
 *
 * Same offline emulation as playwright.config.offline-warm.ts (non-loopback
 * fetches inside the dev server fail immediately), but the seeded home has NO
 * http-cache rows at all: the Security Market page and the exchange-rate
 * refresh must degrade to their no-cache fallbacks (error toast + empty
 * state; built-in rates) instead of erroring out or white-screening.
 *
 * Run: `npx playwright test -c playwright.config.offline-cold.ts offline-market-rates.spec.ts`
 */
const port = 41742;
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
const offlineHome = mkdtempSync(join(tmpdir(), "aitracker-offline-cold-"));
execFileSync(process.execPath, [seedScript, offlineHome, "--mode", "cold"], {
  stdio: "inherit",
});

process.env.AITRACKER_USAGE_HOME = offlineHome;
process.env.AITRACKER_E2E_OFFLINE_COLD = "1";

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
      AITRACKER_E2E_OFFLINE_COLD: "1",
      AITRACKER_ENABLE_BACKGROUND_TASKS: "false",
      // Block every non-loopback fetch inside the dev-server process.
      NODE_OPTIONS: `--import=${hookScript}`,
    },
  },
});
