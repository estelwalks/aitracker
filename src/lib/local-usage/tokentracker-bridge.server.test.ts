import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ENV } from "../app-config";

import {
  collectTokenTrackerUsage,
  initializeTokenTrackerUsage,
  knownSource,
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

describe("TC-BRG-001: bridge boundaries", () => {
  it("auto-init stays a no-op (never auto-executes the CLI)", async () => {
    // initializeTokenTrackerUsage is intentionally empty: TokenTracker is a
    // behavior reference, not an executed dependency.
    const result = await initializeTokenTrackerUsage({
      homeDirectory: "/nonexistent",
    });
    assert.equal(result, undefined);
  });

  it("source ids pass through verbatim — aliases are never rewritten", () => {
    // P1-4: the bridge must not reattribute tool sources. Legacy queue ids
    // are no longer mapped to canonical ids; they are rejected as unknown.
    assert.equal(knownSource("claude"), undefined);
    assert.equal(knownSource("copilot"), undefined);
    assert.equal(knownSource("gemini"), undefined);
    assert.equal(knownSource("roocode"), undefined);
    // Canonical ids pass through unchanged.
    assert.equal(knownSource("claude-code"), "claude-code");
    assert.equal(knownSource("github-copilot"), "github-copilot");
    assert.equal(knownSource("gemini-cli"), "gemini-cli");
    assert.equal(knownSource("roo-code"), "roo-code");
    // Non-strings, empty values, and unknown ids are rejected.
    assert.equal(knownSource(undefined), undefined);
    assert.equal(knownSource(""), undefined);
    assert.equal(knownSource("not-a-tool"), undefined);
  });

  it("opt-in off => the bridge produces no events at all", async () => {
    delete process.env["TRUSTTOOLS_ENABLE_TOKENTRACKER_BRIDGE"];
    const result = await collectTokenTrackerUsage({
      homeDirectory: "/nonexistent",
    });
    assert.equal(result.events.length, 0);
  });
});
