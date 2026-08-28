import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig, devices } from "playwright/test";

const port = 41737;
// Never let the default suite open the user's live SQLite database. A single
// temporary home gives the web server one writer for the whole run while
// keeping the run isolated from desktop/other test processes. Dedicated
// resilience configs may still provide their own explicit home.
const e2eHome =
  process.env.AITRACKER_USAGE_HOME ??
  mkdtempSync(join(tmpdir(), "aitracker-e2e-home-"));
process.env.AITRACKER_USAGE_HOME = e2eHome;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Web mode now enables background tasks by default; e2e must stay
    // deterministic, so the test dev server opts out explicitly.
    env: {
      AITRACKER_USAGE_HOME: e2eHome,
      AITRACKER_ENABLE_BACKGROUND_TASKS: "false",
    },
  },
});
