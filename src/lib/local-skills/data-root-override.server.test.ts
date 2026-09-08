import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { APP_DATA_DIR } from "../app-config.ts";
import { SKILL_AGENT_RULES } from "./skill-rules.server.ts";
import { resolveAgentRoots, scanLocalSkills } from "./scanner.server.ts";
import { SKILL_AGENTS } from "./types.ts";
import type { SkillStateRepository } from "./scanner.server.ts";

const testState: SkillStateRepository = {
  async readOrigins() {
    return { version: 1, installations: {} };
  },
  async writeOrigins() {},
  async readBlacklist() {
    return [];
  },
  async writeBlacklist() {},
};

/**
 * Hermes (and every other skill agent) follows the per-tool data-directory
 * override: when the user points a tool at a custom directory on the Sources
 * page, its skill roots move to `<dir>/<last-segment>` (`.hermes/skills` ->
 * `<dir>/skills`). Discovery, sync targets and security scanning all share
 * `resolveAgentRoots`, so this single seam covers them.
 */

const labelOf = (toolId: string): string => {
  const index = SKILL_AGENT_RULES.findIndex((rule) => rule.toolId === toolId);
  assert.ok(index >= 0, `rule ${toolId}`);
  return SKILL_AGENTS[index]!;
};

test("resolveAgentRoots rebases Hermes skills under its override directory", () => {
  const roots = resolveAgentRoots(
    "/home/alice",
    {},
    new Map([["hermes", "/data/hermes"]]),
  );
  assert.deepEqual(roots[labelOf("hermes")], ["/data/hermes/skills"]);
});

test("resolveAgentRoots honours envHome only when no override exists", () => {
  const home = "/home/alice";
  const env = { CODEX_HOME: "/env/codex", GROK_HOME: "/env/grok" };
  const overrides = new Map([["codex", "/override/codex"]]);
  const roots = resolveAgentRoots(home, env, overrides);
  assert.deepEqual(roots[labelOf("codex")], ["/override/codex/skills"]);
  assert.deepEqual(roots[labelOf("grok")], ["/env/grok/skills"]);
  assert.deepEqual(roots[labelOf("hermes")], ["/home/alice/.hermes/skills"]);
});

test("skill discovery reads Hermes skills from the override directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-skill-root-"));
  try {
    const dataDirectory = join(root, APP_DATA_DIR);
    const overrideDir = join(root, "hermes-data");
    const skillPath = join(overrideDir, "skills", "hermes-notes");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: Hermes Notes\n---\n",
    );

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      now: new Date(),
      platform: "darwin",
      stateRepository: testState,
      dataRootOverrides: new Map([["hermes", overrideDir]]),
    });

    const hermesSkill = snapshot.skills.find(
      (skill) => skill.name === "Hermes Notes",
    );
    assert.ok(hermesSkill, "skill under the override dir must be discovered");
    assert.ok(
      hermesSkill.installations.some((installation) =>
        installation.path.startsWith(`${overrideDir}/skills/`),
      ),
      "installation must live under the override directory",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
