import assert from "node:assert/strict";
import test from "node:test";

import { MAX_SKILL_FILE_SIZE, readLocalSkillFile } from "./input-validation.ts";

function fakeFile(
  name: string,
  content: string,
  options: { size?: number; relativePath?: string } = {},
) {
  return {
    name,
    size: options.size ?? content.length,
    webkitRelativePath: options.relativePath ?? "",
    text: async () => content,
  } as File;
}

test("accepts SKILL.md case-insensitively and returns only its local text", async () => {
  const selected = await readLocalSkillFile([fakeFile("skill.MD", "# local")]);
  assert.equal(selected.name, "skill.MD");
  assert.equal(selected.targetName, "skill.MD");
  assert.equal(selected.content, "# local");
});

test("accepts a directory only when it contains SKILL.md", async () => {
  const selected = await readLocalSkillFile([
    fakeFile("README.md", "ignored", { relativePath: "demo/README.md" }),
    fakeFile("SKILL.md", "# skill", { relativePath: "demo/SKILL.md" }),
  ]);
  assert.equal(selected.name, "demo/SKILL.md");
  assert.equal(selected.targetName, "demo/");
  assert.equal(selected.content, "# skill");
});

test("invalid input and oversized SKILL.md reject before a caller can consume quota", async () => {
  await assert.rejects(
    readLocalSkillFile([fakeFile("README.md", "# no")]),
    /errors\.security\.fileTypeInvalid/,
  );
  await assert.rejects(
    readLocalSkillFile([
      fakeFile("SKILL.md", "# big", { size: MAX_SKILL_FILE_SIZE + 1 }),
    ]),
    /errors\.security\.fileTooLarge/,
  );
});
