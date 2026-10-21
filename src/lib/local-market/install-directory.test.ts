import assert from "node:assert/strict";
import test from "node:test";

import { marketSkillInstallDirectory } from "./install-directory.ts";

test("the install folder is the parent of the SKILL.md path", () => {
  assert.equal(
    marketSkillInstallDirectory("skills/github/SKILL.md", "github"),
    "github",
  );
  // Catalog slug and repository folder intentionally differ for some entries.
  assert.equal(
    marketSkillInstallDirectory(
      ".claude/skills/create-pr/SKILL.md",
      "antd-create-pr",
    ),
    "create-pr",
  );
  assert.equal(
    marketSkillInstallDirectory("agent_reach/skill/SKILL.md", "agent-reach"),
    "skill",
  );
});

test("a nested or Windows-style path still yields the leaf folder", () => {
  assert.equal(
    marketSkillInstallDirectory(".agents/skills/deep/nested/SKILL.md", "slug"),
    "nested",
  );
  assert.equal(
    marketSkillInstallDirectory("skills\\github\\SKILL.md", "github"),
    "github",
  );
});

test("a repo-root SKILL.md falls back to the catalog slug", () => {
  assert.equal(
    marketSkillInstallDirectory("SKILL.md", "root-skill"),
    "root-skill",
  );
  assert.equal(
    marketSkillInstallDirectory("./SKILL.md", "root-skill"),
    "root-skill",
  );
  assert.equal(marketSkillInstallDirectory("", "root-skill"), "root-skill");
  assert.equal(marketSkillInstallDirectory(null, "root-skill"), "root-skill");
});
