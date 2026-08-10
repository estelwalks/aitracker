import assert from "node:assert/strict";
import test from "node:test";
import { createMigrationConfirmationViewModel } from "./index.ts";
import type { SkillPackage } from "../../skill-catalog/contracts.ts";
import type { InstallPlan, TargetCapability } from "../contracts.ts";

const pkg = {
  verdict: "clean",
  installability: "installable",
  name: "demo",
  version: "1.0.0",
} satisfies Pick<
  SkillPackage,
  "verdict" | "installability" | "name" | "version"
>;

const plan = {
  planRef: "install-plan:demo",
  packageRef: "package:demo",
  packageHash: "sha256-demo",
  skillRef: "skill:demo",
  targetRefs: ["target:mac", "target:linux"],
  approval: { proposalRef: "change-proposal:demo", status: "pending" },
  createdAt: "2026-08-07T00:00:00.000Z",
  status: "ready",
} as unknown as InstallPlan;

function target(
  targetRef: `target:${string}`,
  overrides: Partial<TargetCapability> = {},
): TargetCapability {
  return {
    targetRef,
    agentId: targetRef.slice(7),
    platform: "macos",
    support: "supported",
    skills: "read-write",
    installedSkills: [],
    ...overrides,
  };
}

test("preview is read-only, opaque and summarizes multi-target capability", () => {
  const model = createMigrationConfirmationViewModel({
    plan,
    package: pkg,
    targets: [
      target("target:mac", { agentId: "claude-code" }),
      target("target:linux", { platform: "linux", support: "planned" }),
    ],
    diff: [
      {
        kind: "change",
        label: "skill metadata",
        before: "old",
        after: "new",
      },
    ],
  });
  assert.equal(model.status, "preview");
  assert.equal(model.targetSummaries.length, 2);
  assert.equal(model.targetSummaries[0]?.capability, "ready");
  assert.equal(model.targetSummaries[1]?.status, "planned");
  assert.equal(model.approval, "pending");
  assert.match(model.targetSummaries[0]!.targetRef, /^target:/);
});

test("unsupported target and unsafe package are blocked before confirmation", () => {
  const model = createMigrationConfirmationViewModel({
    plan,
    package: { ...pkg, verdict: "suspicious" },
    targets: [
      target("target:bad", { support: "unsupported", skills: "unsupported" }),
    ],
    diff: [
      {
        kind: "change",
        label: "/Users/alice/.config/agent/skill.json",
        before: "Bearer sk-secret-token",
        after: "npm install demo",
      },
    ],
  });
  assert.equal(model.status, "preview");
  assert.equal(model.targetSummaries[0]?.status, "blocked");
  assert.deepEqual(model.diff[0], {
    kind: "change",
    label: "[redacted]",
    before: "[redacted]",
    after: "[redacted]",
  });
  assert.doesNotMatch(JSON.stringify(model), /Users|npm install|Bearer|token/i);
});

test("run and rollback states are exposed without raw errors", () => {
  const run = {
    runRef: "distribution-run:demo",
    planRef: plan.planRef,
    status: "rolled-back",
    targets: [{ targetRef: "target:mac", status: "rolled-back" }],
    startedAt: plan.createdAt,
    finishedAt: plan.createdAt,
  } as const;
  const model = createMigrationConfirmationViewModel({
    plan: { ...plan, approval: { ...plan.approval, status: "approved" } },
    package: pkg,
    targets: [target("target:mac")],
    run,
    errorCode: "errors.skillDistribution.rollbackFailed",
  });
  assert.equal(model.status, "rolled-back");
  assert.equal(model.rollback, "succeeded");
  assert.equal(model.errorCode, "errors.skillDistribution.rollbackFailed");
  assert.doesNotMatch(JSON.stringify(model), /stack|Error:|\/Users|\\Windows/i);
});
