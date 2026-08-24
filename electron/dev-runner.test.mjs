import assert from "node:assert/strict";
import test from "node:test";

import {
  createStaticWarmupUrls,
  desktopDevColdStartTimeoutMs,
  desktopDevProbeTimeoutMs,
  desktopViteWarmupPaths,
  isElectronCompilerInput,
  shouldRebuild,
} from "./dev-runner.mjs";
import { resolveNpmSpawn } from "../scripts/npm-spawn.mjs";

test("incremental prepare rebuilds missing or stale outputs only", () => {
  assert.equal(shouldRebuild(100, []), true);
  assert.equal(shouldRebuild(100, [null, 200]), true);
  assert.equal(shouldRebuild(201, [250, 200]), true);
  assert.equal(shouldRebuild(200, [250, 200]), false);
  assert.equal(shouldRebuild(100, [250, 200]), false);
});

test("static warmup never requests a document route", () => {
  assert.deepEqual(createStaticWarmupUrls("http://127.0.0.1:5173"), [
    "http://127.0.0.1:5173/@vite/client",
    "http://127.0.0.1:5173/src/router.tsx",
    "http://127.0.0.1:5173/src/routeTree.gen.ts",
  ]);
  assert.equal(desktopViteWarmupPaths.includes("/"), false);
});

test("cold desktop development allows Windows dependency optimization to finish", () => {
  assert.equal(desktopDevColdStartTimeoutMs, 300_000);
  assert.equal(desktopDevProbeTimeoutMs, 5_000);
  assert.ok(desktopDevColdStartTimeoutMs > 60_000);
});

test("Electron prepare ignores runner and test harness JavaScript", () => {
  assert.equal(isElectronCompilerInput("main.ts"), true);
  assert.equal(isElectronCompilerInput("preload.cts"), true);
  assert.equal(isElectronCompilerInput("global.d.ts"), true);
  assert.equal(isElectronCompilerInput("dev-runner.mjs"), false);
  assert.equal(isElectronCompilerInput("dev-runner.test.mjs"), false);
});

test("Windows desktop commands use cmd.exe instead of spawning npm.cmd", () => {
  const invocation = resolveNpmSpawn(["exec", "--", "vite"], {
    platform: "win32",
    environment: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
  });
  assert.equal(invocation.executable, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(invocation.argumentsList.slice(0, 4), [
    "/d",
    "/s",
    "/c",
    "npm.cmd",
  ]);
});
