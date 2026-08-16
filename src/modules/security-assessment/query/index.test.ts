import assert from "node:assert/strict";
import test from "node:test";
import { scanSelection, selectSkillFile } from "./index";

test("legacy browser selection cannot execute the scanner outside Electron IPC", async () => {
  const selected = await selectSkillFile([
    {
      name: "SKILL.md",
      size: 20,
      text: async () => "# safe skill\nrun: echo hello",
    } as File,
  ]);
  assert.match(selected.selectionRef, /^selection:/);
  await assert.rejects(
    scanSelection(selected),
    /Desktop security scanner IPC/u,
  );
});
