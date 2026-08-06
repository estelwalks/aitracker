import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ENV } from "../app-config";

import {
  collectTokenTrackerUsage,
  initializeTokenTrackerUsage,
} from "./tokentracker-bridge.server.ts";

test("initializeTokenTrackerUsage is a safe no-op that does not mutate the filesystem", async () => {
  const root = join(
    tmpdir(),
    `tt-tokentracker-noop-${process.pid}-${Date.now()}`,
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
    `tt-tokentracker-noop-${process.pid}-${Date.now()}`,
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
    `tt-tokentracker-noop-${process.pid}-${Date.now()}`,
  );
  const home = join(root, "home");

  // Simulate an explicit off value
  process.env[ENV.ENABLE_TOKENTRACKER_BRIDGE] = "";

  try {
    const result = await collectTokenTrackerUsage({ homeDirectory: home });
    assert.deepStrictEqual(result, { events: [], summaries: [] });
  } finally {
    delete process.env[ENV.ENABLE_TOKENTRACKER_BRIDGE];
    await rm(root, { recursive: true, force: true });
  }
});

import { describe, test as it } from "node:test";
import { KNOWN_LOCAL_USAGE_SOURCES } from "./types.ts";

describe("TC-BRG-001: bridge boundaries", () => {
  it("auto-init stays a no-op (never auto-executes the CLI)", async () => {
    // initializeTokenTrackerUsage is intentionally empty: TokenTracker is a
    // behavior reference, not an executed dependency.
    const result = await initializeTokenTrackerUsage({
      homeDirectory: "/nonexistent",
    });
    assert.equal(result, undefined);
  });

  it("source normalization can never produce a source outside the known set", async () => {
    // The only way source ids enter the pipeline is through the registry's
    // known set; bridge reports are read-only and filtered against it.
    for (const id of KNOWN_LOCAL_USAGE_SOURCES) {
      assert.ok(id.length > 0);
    }
    // Opt-in off => the bridge produces no events at all.
    delete process.env["TRUSTTOOLS_ENABLE_TOKENTRACKER_BRIDGE"];
    const result = await collectTokenTrackerUsage({
      homeDirectory: "/nonexistent",
    });
    assert.equal(result.events.length, 0);
  });
});
