import assert from "node:assert/strict";
import test from "node:test";

import type { LocalSkill } from "../query";
import type { SecuritySkillView } from "../../security-assessment/index.ts";
import { findSecurityTargetForSkill } from "./security-target.ts";

function localSkill(input: {
  name: string;
  directoryNames: readonly string[];
}): LocalSkill {
  return {
    id: input.name,
    name: input.name,
    description: null,
    form: null,
    lastUsedAt: null,
    sizeBytes: 0,
    tokenEstimate: 0,
    installations: input.directoryNames.map((directoryName, index) => ({
      installationRef: `installation:${index}`,
      agent: "AiPy",
      installedAt: new Date(0).toISOString(),
      modifiedAt: new Date(0).toISOString(),
      version: null,
      source: null,
      directoryName,
      updateStatus: "unknown",
      updateReason: "",
    })),
  };
}

function target(name: string, skillRef: string): SecuritySkillView {
  return {
    skillRef,
    name,
    agents: ["AiPy"],
    modifiedAt: new Date(0).toISOString(),
    source: "discovered",
  };
}

test("resolves a security target by directory when the manifest name differs", () => {
  const skill = localSkill({
    name: "bundle",
    directoryNames: ["binary-payload"],
  });
  const expected = target("binary-payload", `skill:${"a".repeat(64)}`);

  assert.equal(findSecurityTargetForSkill(skill, [expected]), expected);
});

test("checks every installation directory before falling back to display name", () => {
  const skill = localSkill({
    name: "bundle",
    directoryNames: ["renamed-copy", "binary-payload"],
  });
  const displayNameCollision = target("bundle", `skill:${"b".repeat(64)}`);
  const expected = target("binary-payload", `skill:${"c".repeat(64)}`);

  assert.equal(
    findSecurityTargetForSkill(skill, [displayNameCollision, expected]),
    expected,
  );
});

test("falls back to the catalog display name for legacy snapshots", () => {
  const skill = localSkill({ name: "bundle", directoryNames: [] });
  const expected = target("bundle", `skill:${"d".repeat(64)}`);

  assert.equal(findSecurityTargetForSkill(skill, [expected]), expected);
});
