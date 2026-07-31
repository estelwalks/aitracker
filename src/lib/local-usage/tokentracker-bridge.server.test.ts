import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  collectTokenTrackerUsage,
  initializeTokenTrackerUsage,
} from "./tokentracker-bridge.server.ts";

test("initializeTokenTrackerUsage is a safe no-op that does not mutate the filesystem", async () => {
  const root = join(
    tmpdir(),
    `trusttools-tokentracker-noop-${process.pid}-${Date.now()}`,
  );
  const home = join(root, "home");

  try {
    // The no-op must resolve without throwing.
    await initializeTokenTrackerUsage({ homeDirectory: home });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectTokenTrackerUsage returns empty results when the opt-in env var is not set", async () => {
  const root = join(
    tmpdir(),
    `trusttools-tokentracker-noop-${process.pid}-${Date.now()}`,
  );
  const home = join(root, "home");

  try {
    const result = await collectTokenTrackerUsage({ homeDirectory: home });
    assert.deepStrictEqual(result, { events: [], summaries: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("collectTokenTrackerUsage returns empty results when the opt-in env var is set to a falsy value", async () => {
  const root = join(
    tmpdir(),
    `trusttools-tokentracker-noop-${process.pid}-${Date.now()}`,
  );
  const home = join(root, "home");

  // Simulate an explicit off value
  process.env.TRUSTTOOLS_ENABLE_TOKENTRACKER_BRIDGE = "";

  try {
    const result = await collectTokenTrackerUsage({ homeDirectory: home });
    assert.deepStrictEqual(result, { events: [], summaries: [] });
  } finally {
    delete process.env.TRUSTTOOLS_ENABLE_TOKENTRACKER_BRIDGE;
    await rm(root, { recursive: true, force: true });
  }
});
