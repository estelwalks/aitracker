import assert from "node:assert/strict";
import test from "node:test";

import type { SecurityHistoryView } from "../../security-assessment/index.ts";
import type { LocalSkill } from "../../skill-catalog/index.ts";
import { projectSkillSecurityView } from "./skill-security-view.ts";

const skill = {
  id: "bundle",
  name: "bundle",
  description: null,
  form: null,
  lastUsedAt: null,
  sizeBytes: 0,
  tokenEstimate: 0,
  installations: [{ directoryName: "binary-payload" }],
} as unknown as LocalSkill;

function history(input: {
  skillName: string;
  finishedAt: string;
  findings: number;
}): SecurityHistoryView {
  return {
    skillName: input.skillName,
    finishedAt: input.finishedAt,
    report: {
      findings: Array.from({ length: input.findings }, () => ({})),
    },
  } as unknown as SecurityHistoryView;
}

test("maps directory-keyed security history back to the manifest identity", () => {
  const view = projectSkillSecurityView(
    [skill],
    [
      history({
        skillName: "binary-payload",
        finishedAt: "2026-08-27T10:00:00.000Z",
        findings: 2,
      }),
    ],
  );

  assert.equal(view.byName.get("bundle"), 2);
  assert.equal(view.byName.has("binary-payload"), false);
});

test("keeps only the newest history entry across directory and manifest aliases", () => {
  const view = projectSkillSecurityView(
    [skill],
    [
      history({
        skillName: "binary-payload",
        finishedAt: "2026-08-27T10:00:00.000Z",
        findings: 2,
      }),
      history({
        skillName: "bundle",
        finishedAt: "2026-08-27T11:00:00.000Z",
        findings: 0,
      }),
    ],
  );

  assert.equal(view.byName.get("bundle"), 0);
});
