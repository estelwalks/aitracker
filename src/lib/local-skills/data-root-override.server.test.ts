import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import test from "node:test";

import { APP_DATA_DIR } from "../app-config.ts";
import { SKILL_AGENT_RULES } from "./skill-rules.server.ts";
import {
  chooseSkillWriteRoot,
  resolveAgentRoots,
  scanLocalSkills,
} from "./scanner.server.ts";
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
  assert.deepEqual(roots[labelOf("hermes")], [join("/data/hermes", "skills")]);
});

test("resolveAgentRoots honours envHome only when no override exists", () => {
  const home = "/home/alice";
  const env = { CODEX_HOME: "/env/codex", GROK_HOME: "/env/grok" };
  const overrides = new Map([["codex", "/override/codex"]]);
  const roots = resolveAgentRoots(home, env, overrides);
  assert.deepEqual(roots[labelOf("codex")], [
    join("/override/codex", "skills"),
  ]);
  assert.deepEqual(roots[labelOf("grok")], [join("/env/grok", "skills")]);
  // Hermes keeps its home root plus the Windows LocalAppData arm
  // (AppData/Local/hermes/skills, flattened as an AppData/ suffix).
  assert.deepEqual(roots[labelOf("hermes")], [
    join(home, ".hermes/skills"),
    join(home, "AppData/Local/hermes/skills"),
  ]);
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
    const skillsRootPrefix = `${join(overrideDir, "skills")}${sep}`;
    assert.ok(
      hermesSkill.installations.some((installation) =>
        installation.path.startsWith(skillsRootPrefix),
      ),
      "installation must live under the override directory",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skill discovery reads Hermes skills from the Windows LocalAppData layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-hermes-win-skills-"));
  try {
    const dataDirectory = join(root, APP_DATA_DIR);
    const skillRoot = join(root, "AppData", "Local", "hermes", "skills");
    const skillPath = join(skillRoot, "apple-notes");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: Hermes Apple Notes\n---\n",
    );

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      now: new Date(),
      platform: "win32",
      stateRepository: testState,
    });

    const hermesSkill = snapshot.skills.find(
      (skill) => skill.name === "Hermes Apple Notes",
    );
    assert.ok(
      hermesSkill,
      "Hermes skill under LocalAppData must be discovered",
    );
    const prefix = `${join(skillRoot)}${sep}`;
    assert.ok(
      hermesSkill.installations.some((installation) =>
        installation.path.startsWith(prefix),
      ),
      "installation must live under the Hermes LocalAppData skills root",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skill discovery reads WorkBuddy skills from ~/.workbuddy/skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-workbuddy-skills-"));
  try {
    const dataDirectory = join(root, APP_DATA_DIR);
    const skillRoot = join(root, ".workbuddy", "skills");
    const skillPath = join(skillRoot, "meeting-notes");
    await mkdir(skillPath, { recursive: true });
    await writeFile(
      join(skillPath, "SKILL.md"),
      "---\nname: Meeting Notes\n---\n",
    );

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      now: new Date(),
      stateRepository: testState,
    });

    const workbuddySkill = snapshot.skills.find(
      (skill) => skill.name === "Meeting Notes",
    );
    assert.ok(workbuddySkill, "WorkBuddy skill must be discovered");
    const installation = workbuddySkill.installations.find(
      (candidate) => candidate.agent === "WorkBuddy",
    );
    assert.ok(installation, "installation must be attributed to WorkBuddy");
    assert.ok(
      installation.path.startsWith(`${skillRoot}${sep}`),
      "installation must live under ~/.workbuddy/skills",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("skill discovery reads WorkBuddy plugin-store skills from plugins/cache", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-workbuddy-plugins-"));
  try {
    const dataDirectory = join(root, APP_DATA_DIR);
    const cacheRoot = join(root, ".workbuddy", "plugins", "cache");
    // Plugin with a root-level SKILL.md at <version> (agent-browser layout).
    const agentBrowserSkill = join(
      cacheRoot,
      "codebuddy-plugins-official",
      "agent-browser",
      "1.3.0",
    );
    await mkdir(agentBrowserSkill, { recursive: true });
    await writeFile(
      join(agentBrowserSkill, "SKILL.md"),
      "---\nname: Agent Browser\n---\n",
    );
    // Plugin exposing nested skills/<name>/SKILL.md (finance-data layout).
    const nestedSkill = join(
      cacheRoot,
      "cb_teams_marketplace",
      "finance-data",
      "1.5.0",
      "skills",
      "westock-data",
    );
    await mkdir(nestedSkill, { recursive: true });
    await writeFile(
      join(nestedSkill, "SKILL.md"),
      "---\nname: Westock Data\n---\n",
    );
    // Marketplace/metadata JSON files must never become skills.
    await writeFile(join(cacheRoot, ".cache-marker"), "{}");

    const snapshot = await scanLocalSkills({
      homeDirectory: root,
      dataDirectory,
      now: new Date(),
      stateRepository: testState,
    });

    const workbuddySkills = snapshot.skills.filter((skill) =>
      skill.installations.some(
        (installation) => installation.agent === "WorkBuddy",
      ),
    );
    const names = workbuddySkills.map((skill) => skill.name).sort();
    assert.deepEqual(names, ["Agent Browser", "Westock Data"]);
    for (const skill of workbuddySkills) {
      assert.ok(
        skill.installations.some((installation) =>
          installation.path.startsWith(`${cacheRoot}${sep}`),
        ),
        `installation for ${skill.name} must live under plugins/cache`,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chooseSkillWriteRoot keeps roots[0] and prefers the primary root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-write-root-"));
  try {
    const homeRoot = join(root, ".hermes", "skills");
    const appDataRoot = join(root, "AppData", "Local", "hermes", "skills");
    // Single-root agents resolve without any filesystem access.
    assert.equal(await chooseSkillWriteRoot([homeRoot]), homeRoot);
    assert.equal(await chooseSkillWriteRoot([]), "");
    // Only the LocalAppData-style root exists: on Windows it receives the
    // write (the real Hermes Agent layout); elsewhere the primary root is
    // created under the home directory.
    await mkdir(appDataRoot, { recursive: true });
    if (process.platform === "win32") {
      assert.equal(
        await chooseSkillWriteRoot([homeRoot, appDataRoot], root),
        appDataRoot,
      );
    } else {
      assert.equal(
        await chooseSkillWriteRoot([homeRoot, appDataRoot], root),
        homeRoot,
      );
    }
    // When the primary (user-managed) root exists it always wins, so writes
    // never land in a discovery-only store such as WorkBuddy's plugins/cache.
    await mkdir(homeRoot, { recursive: true });
    assert.equal(
      await chooseSkillWriteRoot([homeRoot, appDataRoot], root),
      homeRoot,
    );
    const storeRoot = join(root, ".workbuddy", "plugins", "cache");
    await mkdir(storeRoot, { recursive: true });
    const workbuddySkillsRoot = join(root, ".workbuddy", "skills");
    assert.equal(
      await chooseSkillWriteRoot([workbuddySkillsRoot, storeRoot], root),
      workbuddySkillsRoot,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
