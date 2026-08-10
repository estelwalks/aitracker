import assert from "node:assert/strict";
import test from "node:test";
import { scanSelection, selectSkillFile } from "./index";

test("assessment query returns selection refs and never renderer source details", async () => {
  const selected = await selectSkillFile([
    {
      name: "SKILL.md",
      size: 20,
      text: async () => "# safe skill\nrun: echo hello",
    } as File,
  ]);
  const report = await scanSelection(selected);
  const serialized = JSON.stringify(report);
  assert.match(report.selectionRef, /^selection:/);
  assert.equal(report.targetLabel, "SKILL.md");
  assert.doesNotMatch(
    serialized,
    /\/Users|C:\\\\|excerpt|command|prompt|content|rawError/i,
  );
  for (const risk of report.risks) {
    assert.equal("file" in risk, false);
    assert.equal("line" in risk, false);
    assert.equal("excerpt" in risk, false);
  }
});
