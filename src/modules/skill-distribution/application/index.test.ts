import assert from "node:assert/strict";
import test from "node:test";
import {
  createInstallPlan,
  createUninstallPlan,
  executeInstallPlan,
} from "./index.ts";
import type {
  FileSystemPort,
  ProposalApproval,
  TargetCapability,
} from "../contracts.ts";
import type { SkillPackage } from "../../skill-catalog/contracts.ts";
import { packageHash } from "../../skill-catalog/domain.ts";

const hash = packageHash(`sha256-${"a".repeat(64)}`);
const skill: SkillPackage = {
  packageRef: "package:demo-1-aaaaaaaaaaaa",
  skillRef: "skill:demo",
  name: "demo",
  version: "1",
  source: { kind: "local", ref: "skill-source:local" },
  hash,
  verdict: "clean",
  installability: "installable",
  capabilities: ["read"],
  refs: [],
};
const approval = {
  proposalRef: "change-proposal:demo",
  status: "approved",
  approvedAt: "2026-08-07T00:00:00.000Z",
} satisfies ProposalApproval;
const target = (
  targetRef: `target:${string}`,
  platform: TargetCapability["platform"] = "macos",
): TargetCapability => ({
  targetRef,
  agentId: "agent-a",
  platform,
  support: "supported",
  skills: "read-write",
  installedSkills: [],
});
const clock = { now: () => new Date("2026-08-07T00:00:00.000Z") };

function fakeFs(
  failTarget?: string,
): FileSystemPort & { writes: number; restored: number } {
  const state = { writes: 0, restored: 0 };
  return {
    get writes() {
      return state.writes;
    },
    get restored() {
      return state.restored;
    },
    async inspect(targetRef) {
      return target(targetRef);
    },
    async stage(input) {
      state.writes++;
      return {
        stagingRef:
          `staging:${input.targetRef.slice(7)}` as `staging:${string}`,
        targetRef: input.targetRef,
        packageRef: input.packageRef,
        packageHash: input.packageHash,
      };
    },
    async backup(input) {
      return {
        backupRef: `backup:${input.targetRef.slice(7)}` as `backup:${string}`,
        targetRef: input.targetRef,
        skillRef: input.skillRef,
        existed: true,
      };
    },
    async replace(input) {
      if (input.targetRef === failTarget) throw new Error("failure");
      state.writes++;
    },
    async restore(input) {
      state.restored++;
      if (input.targetRef === "target:restore-fail") throw new Error("restore");
    },
    async remove(input) {
      state.writes++;
      return {
        backupRef: `backup:${input.targetRef.slice(7)}` as `backup:${string}`,
        targetRef: input.targetRef,
        skillRef: input.skillRef,
        existed: true,
      };
    },
  };
}

test("multi-target plan is confirmation gated and executes with rollback", async () => {
  const fs = fakeFs("target:b");
  const plan = createInstallPlan(
    {
      package: skill,
      targetRefs: ["target:a", "target:b"],
      approval,
      createdAt: "2026-08-07T00:00:00.000Z",
    },
    [target("target:a"), target("target:b")],
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.doesNotMatch(
    JSON.stringify(plan.value),
    /(?:[A-Za-z]:\\|\/|command|token|prompt)/i,
  );
  const run = await executeInstallPlan({
    plan: plan.value,
    package: skill,
    fileSystem: fs,
    options: { clock, dispatcherEnabled: true },
  });
  assert.equal(run.ok, true);
  if (run.ok) {
    assert.equal(run.value.status, "rolled-back");
    assert.equal(fs.restored, 2);
  }
});

test("unapproved, blocked and unsupported targets fail before writes", async () => {
  const fs = fakeFs();
  const pending = createInstallPlan(
    {
      package: skill,
      targetRefs: ["target:a"],
      approval: { ...approval, status: "pending" } satisfies ProposalApproval,
      createdAt: "x",
    },
    [target("target:a")],
  );
  assert.equal(pending.ok, false);
  const linux = createInstallPlan(
    { package: skill, targetRefs: ["target:l"], approval, createdAt: "y" },
    [{ ...target("target:l", "linux"), support: "planned" }],
  );
  assert.equal(linux.ok, false);
  assert.equal(fs.writes, 0);
});

test("dispatcher is disabled unless explicitly enabled", async () => {
  const fs = fakeFs();
  const plan = createInstallPlan(
    {
      package: skill,
      targetRefs: ["target:a"],
      approval,
      createdAt: "default-disabled",
    },
    [target("target:a")],
  );
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const result = await executeInstallPlan({
    plan: plan.value,
    package: skill,
    fileSystem: fs,
    options: { clock },
  });
  assert.equal(result.ok, false);
  assert.equal(fs.writes, 0);
});

test("hash mismatch and conflicts are rejected", () => {
  const conflict = createInstallPlan(
    { package: skill, targetRefs: ["target:a"], approval, createdAt: "z" },
    [
      {
        ...target("target:a"),
        installedSkills: [
          {
            skillRef: "skill:demo",
            packageHash: packageHash(`sha256-${"b".repeat(64)}`),
          },
        ],
      },
    ],
  );
  assert.equal(conflict.ok, false);
  const blocked = createInstallPlan(
    {
      package: { ...skill, verdict: "unknown", installability: "blocked" },
      targetRefs: ["target:a"],
      approval,
      createdAt: "q",
    },
    [target("target:a")],
  );
  assert.equal(blocked.ok, false);
});

test("batch uninstall plan is also approval gated", () => {
  const result = createUninstallPlan(
    {
      skillRef: "skill:demo",
      targetRefs: ["target:a", "target:b"],
      approval,
      createdAt: "2026-08-07",
    },
    [target("target:a"), target("target:b")],
  );
  assert.equal(result.ok, true);
});

test("linux planned capability never becomes installable", () => {
  const result = createInstallPlan(
    { package: skill, targetRefs: ["target:l"], approval, createdAt: "linux" },
    [{ ...target("target:l", "linux"), support: "planned" }],
  );
  assert.equal(result.ok, false);
});
