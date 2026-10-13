import assert from "node:assert/strict";
import { PUBLIC_TOOL_MANIFEST } from "../../../lib/tool-registry/public-manifest.generated.ts";
import {
  getDefaultRegistry,
  resolvePlatformPlan,
} from "../../../lib/tool-registry/registry.ts";
import test from "node:test";

import { findDtoDisclosureViolations } from "../../../test-support/privacy-contract.ts";
import {
  AgentInstallationRepositoryError,
  createAgentInstallationRepository,
  type InstallationProbeFileSystem,
} from "./installation-repository.server.ts";

const HOME = "/synthetic/home";

function fakeFileSystem(
  outcome: "present" | "missing" | "inaccessible" = "missing",
): InstallationProbeFileSystem {
  return {
    async probe(path, signal) {
      assert.ok(path.startsWith(`${HOME}/`));
      if (signal?.aborted) {
        throw new AgentInstallationRepositoryError("cancelled");
      }
      return outcome;
    },
  };
}

test("installation repository exposes a safe DTO and detects a synthetic install", async () => {
  const repository = createAgentInstallationRepository({
    homeDirectory: HOME,
    fileSystem: {
      async probe(path) {
        return path.endsWith("/.codex") ? "present" : "missing";
      },
    },
    clock: () => "2026-01-01T00:00:00.000Z",
  });

  const snapshot = await repository.inspect({ platform: "macos" });
  assert.equal(
    snapshot.installations.find((item) => item.agentId === "codex")?.status,
    "installed",
  );
  assert.equal(
    snapshot.installations.find((item) => item.agentId === "claude-code")
      ?.status,
    "not-detected",
  );
  assert.deepEqual(findDtoDisclosureViolations(snapshot), []);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    HOME,
    ".codex",
    "Library/Application Support",
    "lstat",
  ]) {
    assert.ok(!serialized.includes(forbidden), `DTO leaked ${forbidden}`);
  }
});

test("windows 10 and windows 11 use the same registry parity group", async () => {
  const repository = createAgentInstallationRepository({
    homeDirectory: HOME,
    fileSystem: fakeFileSystem(),
    clock: () => "2026-01-01T00:00:00.000Z",
  });
  const win10 = await repository.inspect({ platform: "windows10" });
  const win11 = await repository.inspect({ platform: "windows11" });
  assert.deepEqual(
    win10.installations.map(({ agentId, status }) => ({ agentId, status })),
    win11.installations.map(({ agentId, status }) => ({ agentId, status })),
  );
});

test("linux probes only linux-supported tools; planned tools are unsupported", async () => {
  let calls = 0;
  const repository = createAgentInstallationRepository({
    homeDirectory: HOME,
    fileSystem: {
      async probe() {
        calls += 1;
        return "present";
      },
    },
  });
  const snapshot = await repository.inspect({ platform: "linux" });
  // Derived rather than hardcoded: the Linux launch promoted 21 tools to
  // supported, so a fixed list and a fixed probe count would both be wrong.
  // The expectation is the tools that actually resolve at least one Linux
  // detection path — a tool can be marked supported yet declare no Linux
  // detection location, and such a tool is correctly never probed.
  const registry = getDefaultRegistry();
  const linuxProbed = PUBLIC_TOOL_MANIFEST.tools
    .filter((tool) => tool.platforms.linux === "supported")
    .map((tool) => tool.id)
    .filter(
      (id) =>
        (resolvePlatformPlan(id, "detection", "linux", registry)?.paths
          .length ?? 0) > 0,
    );
  const linuxSupported = linuxProbed;
  assert.ok(linuxSupported.length > 0, "linux has probed tools");
  assert.equal(calls, linuxSupported.length);
  for (const id of linuxSupported) {
    assert.equal(
      snapshot.installations.find((item) => item.agentId === id)?.status,
      "installed",
    );
    assert.equal(
      snapshot.health.find((item) => item.agentId === id)?.status,
      "healthy",
    );
  }
  assert.ok(
    snapshot.installations
      .filter((item) => !linuxSupported.includes(item.agentId))
      .every((item) => item.status === "unsupported"),
  );
  assert.ok(
    snapshot.health
      .filter((item) => !linuxSupported.includes(item.agentId))
      .every((item) => item.status === "unavailable"),
  );
});

test("permission failures become unknown/degraded without leaking the path", async () => {
  const snapshot = await createAgentInstallationRepository({
    homeDirectory: HOME,
    fileSystem: fakeFileSystem("inaccessible"),
  }).inspect({ platform: "macos" });
  assert.ok(snapshot.installations.some((item) => item.status === "unknown"));
  assert.ok(
    snapshot.health.some(
      (item) =>
        item.status === "degraded" &&
        item.issueCode === "errors.installation-access-denied",
    ),
  );
  assert.ok(!JSON.stringify(snapshot).includes(HOME));
});

test("inspection honors cancellation with a stable non-path error", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      createAgentInstallationRepository({
        homeDirectory: HOME,
        fileSystem: fakeFileSystem(),
      }).inspect({ platform: "macos", signal: controller.signal }),
    (error: unknown) =>
      error instanceof AgentInstallationRepositoryError &&
      error.code === "cancelled" &&
      !String(error).includes(HOME),
  );
});
