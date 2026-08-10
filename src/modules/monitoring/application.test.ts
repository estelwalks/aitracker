import assert from "node:assert/strict";
import test from "node:test";

import { createMonitoringRuntime } from "./application.ts";
import type { MonitoringStatus } from "./contracts.ts";

test("records renderer-safe heartbeat and collector outcomes", async () => {
  let stored: MonitoringStatus | undefined;
  let tick = 0;
  const runtime = createMonitoringRuntime({
    store: {
      load: async () => stored,
      save: async (value) => {
        stored = value;
      },
    },
    now: () => new Date(Date.UTC(2026, 7, 10, 8, 0, tick++)),
  });

  await runtime.start();
  await runtime.started("usage");
  let status = await runtime.status();
  assert.equal(status.running, true);
  assert.equal(status.pendingCount, 1);
  assert.equal(
    status.collectors.find((item) => item.id === "usage")?.state,
    "running",
  );

  await runtime.succeeded("usage");
  await runtime.failed("skills", "errors.tasks.executor-failed");
  await runtime.securityCompleted({
    assessedAt: "2026-08-10T08:01:00.000Z",
    discoveredAssetCount: 4,
    assessedAssetCount: 4,
    failedAssetCount: 1,
    cleanCount: 2,
    suspiciousCount: 1,
    dangerousCount: 0,
    unknownCount: 1,
  });
  status = await runtime.status();
  assert.equal(status.pendingCount, 0);
  assert.equal(
    status.collectors.find((item) => item.id === "usage")?.state,
    "healthy",
  );
  const failed = status.collectors.find((item) => item.id === "skills");
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.errorCode, "errors.tasks.executor-failed");
  assert.deepEqual(status.security, {
    assessedAt: "2026-08-10T08:01:00.000Z",
    discoveredAssetCount: 4,
    assessedAssetCount: 4,
    failedAssetCount: 1,
    cleanCount: 2,
    suspiciousCount: 1,
    dangerousCount: 0,
    unknownCount: 1,
  });
  assert.equal(JSON.stringify(status).includes("/Users/"), false);

  await runtime.stop();
  assert.equal((await runtime.status()).running, false);
});
