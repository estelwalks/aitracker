import assert from "node:assert/strict";
import test from "node:test";

import type { LocalSkill } from "../query/contracts.ts";
import {
  formatSkillDisplayName,
  primarySkillDirectoryName,
  skillIdentityNames,
} from "./skill-identity.ts";

function skill(name: string, directoryName?: string): LocalSkill {
  return {
    id: name,
    name,
    description: null,
    form: null,
    lastUsedAt: null,
    sizeBytes: 0,
    tokenEstimate: 0,
    installations: [
      {
        installationRef: "installation:test",
        agent: "AiPy",
        installedAt: new Date(0).toISOString(),
        modifiedAt: new Date(0).toISOString(),
        version: null,
        source: null,
        ...(directoryName ? { directoryName } : {}),
        updateStatus: "unknown",
        updateReason: "",
      },
    ],
  };
}

test("uses the directory as primary and appends a differing manifest name", () => {
  const value = skill("bundle", "binary-payload");

  assert.equal(primarySkillDirectoryName(value), "binary-payload");
  assert.equal(formatSkillDisplayName(value), "binary-payload (bundle)");
  assert.deepEqual(skillIdentityNames(value), ["binary-payload", "bundle"]);
});

test("does not duplicate an identical manifest name", () => {
  const value = skill("binary-payload", "binary-payload");

  assert.equal(formatSkillDisplayName(value), "binary-payload");
  assert.deepEqual(skillIdentityNames(value), ["binary-payload"]);
});
