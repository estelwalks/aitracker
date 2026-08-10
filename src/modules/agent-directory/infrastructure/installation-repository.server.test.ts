import assert from "node:assert/strict";
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

test("linux planned status never probes and is represented as unsupported", async () => {
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
  assert.equal(calls, 0);
  assert.ok(
    snapshot.installations.every((item) => item.status === "unsupported"),
  );
  assert.ok(snapshot.health.every((item) => item.status === "unavailable"));
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
