import assert from "node:assert/strict";
import test from "node:test";
import { ENV } from "../lib/app-config";

import { PUBLIC_MODULE_CATALOG } from "../app/module-catalog.generated.ts";
import {
  createNodeRuntimeIdentity,
  resolveRuntimeIdentity,
} from "./runtime/index.ts";
import {
  getDefaultRegistry,
  resolvePlatformPaths,
  resolvePlatformPlan,
} from "../lib/tool-registry/registry.ts";

/**
 * P8-03 contract matrix. These tests deliberately inject platform facts and
 * synthetic environment values: a CI host must never determine the result or
 * cause a real user directory to be scanned.
 */
const platformMatrix = [
  { target: "macos", os: "macos" as const, node: "darwin" as const },
  { target: "windows10", os: "windows" as const, node: "win32" as const },
  { target: "windows11", os: "windows" as const, node: "win32" as const },
] as const;

test("platform support matrix keeps macOS and Windows 10/11 supported", () => {
  for (const { target } of platformMatrix) {
    const statuses = PUBLIC_MODULE_CATALOG.modules.map(
      (module) => module.platforms[target],
    );
    assert.ok(
      statuses.every((status) => status === "supported"),
      `${target} must remain supported in the public module contract`,
    );
  }
});

test("Linux is visible as planned and runtime startup remains disabled", () => {
  assert.ok(
    PUBLIC_MODULE_CATALOG.modules.every(
      (module) => module.platforms.linux === "planned",
    ),
  );
  const identity = resolveRuntimeIdentity({
    kind: "desktop",
    platform: "linux",
    enableBackgroundTasks: true,
  });
  assert.equal(identity.backgroundTasksEnabled, false);
  assert.equal(identity.backgroundTasksReason, "linux-planned");
});

test("Node runtime mapping is deterministic for supported platform targets", () => {
  for (const { node, os } of platformMatrix) {
    const identity = createNodeRuntimeIdentity({
      env: { [ENV.RUNTIME]: "desktop" },
      platform: node,
    });
    assert.equal(identity.platform, os === "windows" ? "windows" : "macos");
    assert.equal(identity.backgroundTasksEnabled, true);
  }
});

test("platform path plans are pure data and never execute filesystem access", () => {
  const registry = getDefaultRegistry();
  const toolIds = ["codex", "claude-code"];
  const capabilities = ["detection", "usage", "skills", "sessions"] as const;

  for (const toolId of toolIds) {
    for (const capability of capabilities) {
      for (const os of ["macos", "windows", "linux"] as const) {
        const plan = resolvePlatformPlan(toolId, capability, os, registry);
        const resolved = resolvePlatformPaths(
          toolId,
          capability,
          os,
          {
            HOME: "/synthetic/home",
            XDG_CONFIG_HOME: "/synthetic/config",
            XDG_DATA_HOME: "/synthetic/data",
          },
          registry,
        );
        assert.ok(plan, `missing plan for ${toolId}/${capability}/${os}`);
        assert.ok(
          resolved,
          `missing resolution for ${toolId}/${capability}/${os}`,
        );
        if (os === "linux") {
          assert.equal(plan.status, "planned");
          assert.deepEqual(plan.paths, []);
          assert.deepEqual(resolved.paths, []);
        }
        // A plan is only a declarative projection. It may contain synthetic
        // absolute env paths, but never a HOME-derived real user directory.
        assert.equal(JSON.stringify(plan).includes("/Users/"), false);
        assert.equal(JSON.stringify(plan).includes("\\Users\\"), false);
      }
    }
  }
});

test("Windows 10 and Windows 11 share one path-plan parity group", () => {
  const registry = getDefaultRegistry();
  for (const toolId of ["codex", "claude-code"]) {
    for (const capability of [
      "detection",
      "usage",
      "skills",
      "sessions",
    ] as const) {
      const plan = resolvePlatformPlan(toolId, capability, "windows", registry);
      assert.ok(plan);
      assert.equal(plan.os, "windows");
      assert.ok(plan.status === "supported" || plan.status === "planned");
    }
  }
});
