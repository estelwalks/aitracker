import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ENV } from "./lib/app-config.ts";
import serverEntry, { markDynamicResponseNoStore } from "./server.ts";

test("dynamic server responses are never reused from browser cache", () => {
  for (const response of [
    new Response("<html></html>", {
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
    Response.json({ boards: { project: { rows: [] } } }),
  ]) {
    assert.equal(
      markDynamicResponseNoStore(response).headers.get("cache-control"),
      "no-store",
    );
  }
});

test("desktop warmup receives a safe database failure code", async () => {
  const dataRoot = await mkdtemp(
    join(tmpdir(), "aitracker-server-startup-error-"),
  );
  const previousRuntime = process.env[ENV.RUNTIME];
  const previousUsageHome = process.env[ENV.USAGE_HOME];
  const previousBrokerToken = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.RUNTIME] = "desktop";
  process.env[ENV.USAGE_HOME] = dataRoot;
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "startup-test-token";
  try {
    const databaseDirectory = join(dataRoot, ".aitracker", "data");
    await mkdir(databaseDirectory, { recursive: true });
    await writeFile(
      join(databaseDirectory, "aitracker.v1.db.writer.lock"),
      `${JSON.stringify({
        pid: process.pid,
        token: "test-owner",
        createdAtMs: Date.now(),
      })}\n`,
      "utf8",
    );

    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      const response = await serverEntry.fetch(
        new Request("http://127.0.0.1/api/desktop-state/preferences", {
          headers: { "x-aitracker-desktop-broker": "startup-test-token" },
        }),
        {},
        {},
      );
      assert.equal(response.status, 500);
      assert.equal(
        response.headers.get("x-aitracker-startup-failure-code"),
        "database.already-open",
      );
    } finally {
      console.error = originalConsoleError;
    }
  } finally {
    if (previousRuntime == null) delete process.env[ENV.RUNTIME];
    else process.env[ENV.RUNTIME] = previousRuntime;
    if (previousUsageHome == null) delete process.env[ENV.USAGE_HOME];
    else process.env[ENV.USAGE_HOME] = previousUsageHome;
    if (previousBrokerToken == null)
      delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previousBrokerToken;
    await rm(dataRoot, { recursive: true, force: true });
  }
});
