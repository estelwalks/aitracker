import assert from "node:assert/strict";
import test from "node:test";
import { dispatchApprovalAction } from "./api.server.ts";
import type { FileSystemPort, InstallPlan } from "./contracts.ts";
import type { SkillPackage } from "../skill-catalog/contracts.ts";

const plan = {
  planRef: "install-plan:demo",
  packageRef: "package:demo",
  packageHash: "sha256-demo",
  skillRef: "skill:demo",
  targetRefs: ["target:demo"],
  approval: { proposalRef: "change-proposal:demo", status: "pending" },
  createdAt: "2026-08-07T00:00:00.000Z",
  status: "ready",
} as unknown as InstallPlan;
const pkg = {
  packageRef: plan.packageRef,
  skillRef: plan.skillRef,
  hash: plan.packageHash,
  name: "demo",
  version: "1",
  source: { kind: "local", ref: "skill-source:demo" },
  verdict: "clean",
  installability: "installable",
  capabilities: [],
  refs: [],
} as SkillPackage;

function fs(writes: { value: number }): FileSystemPort {
  return {
    async inspect(targetRef) {
      return {
        targetRef,
        agentId: "demo",
        platform: "macos",
        support: "supported",
        skills: "read-write",
        installedSkills: [],
      };
    },
    async stage(input) {
      writes.value++;
      return {
        stagingRef: "staging:demo",
        targetRef: input.targetRef,
        packageRef: input.packageRef,
        packageHash: input.packageHash,
      };
    },
    async backup(input) {
      return {
        backupRef: "backup:demo",
        targetRef: input.targetRef,
        skillRef: input.skillRef,
        existed: false,
      };
    },
    async replace() {
      writes.value++;
    },
    async restore() {},
    async remove() {
      return {
        backupRef: "backup:demo",
        targetRef: "target:demo",
        skillRef: plan.skillRef,
        existed: false,
      };
    },
  };
}

test("confirmation API does not write for an unapproved preview", async () => {
  const writes = { value: 0 };
  const result = await dispatchApprovalAction({
    action: "confirm",
    plan,
    package: pkg,
    handlers: { fileSystem: fs(writes) },
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.error.code, "errors.skillDistribution.notApproved");
  assert.equal(writes.value, 0);
});

test("confirmation API writes only after approved action", async () => {
  const writes = { value: 0 };
  const result = await dispatchApprovalAction({
    action: "confirm",
    plan: { ...plan, approval: { ...plan.approval, status: "approved" } },
    package: pkg,
    handlers: {
      fileSystem: fs(writes),
      distributionOptions: {
        clock: { now: () => new Date("2026-08-07T00:00:00.000Z") },
        dispatcherEnabled: true,
      },
    },
  });
  assert.equal(result.ok, true);
  assert.equal(writes.value, 2);
});

test("rollback is stable-code gated and never exposes adapter errors", async () => {
  const result = await dispatchApprovalAction({
    action: "rollback",
    plan,
    handlers: {},
  });
  assert.equal(result.ok, false);
  if (!result.ok)
    assert.equal(result.error.code, "errors.rollback-unavailable");
});
