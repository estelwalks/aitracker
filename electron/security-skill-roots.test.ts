import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import { SKILL_AGENT_RULES } from "../src/lib/local-skills/skill-rules.server.ts";
import {
  MANAGED_SKILL_ROOTS,
  parseToolDataRootsEnvForSecurity,
  resolveManagedSkillRoots,
} from "./security-scanner-service.ts";

/**
 * The desktop security scanner keeps a mirrored list of managed skill agents
 * (Electron tsconfig boundary forbids importing the registry). Hermes Agent
 * is part of it; these tests pin the mirror to the registry rules so drift is
 * caught, and cover per-tool data-directory overrides (env/test seam) applied
 * by the main-process scanner.
 */

test("managed security skill roots include Hermes Agent", () => {
  const hermes = MANAGED_SKILL_ROOTS.find(
    (definition) => definition.toolId === "hermes",
  );
  assert.ok(hermes, "Hermes Agent must be a managed security skill root");
  assert.equal(hermes.agent, "Hermes Agent");
  assert.deepEqual([...hermes.suffixes], [".hermes/skills"]);
});

test("managed skill roots stay in sync with the registry skill rules", () => {
  const managed = MANAGED_SKILL_ROOTS.map((definition) => definition.toolId);
  const registry = SKILL_AGENT_RULES.map((rule) => rule.toolId);
  assert.deepEqual([...managed].sort(), [...registry].sort());
  for (const definition of MANAGED_SKILL_ROOTS) {
    const rule = SKILL_AGENT_RULES.find(
      (candidate) => candidate.toolId === definition.toolId,
    );
    assert.ok(rule, `registry rule for ${definition.toolId}`);
    assert.deepEqual(
      [...definition.suffixes].sort(),
      [...rule.roots].sort(),
      `roots for ${definition.toolId} must match the registry`,
    );
  }
});

test("security scanner resolves Hermes skills under an override directory", () => {
  const roots = resolveManagedSkillRoots(
    "/home/alice",
    {},
    new Map([["hermes", "/data/hermes"]]),
  );
  assert.ok(
    roots.some(
      ({ agent, root }) =>
        agent === "Hermes Agent" && root === join("/data/hermes", "skills"),
    ),
    JSON.stringify(roots),
  );
});

test("security scanner honours the env seam including drive-letter paths", () => {
  const map = parseToolDataRootsEnvForSecurity("hermes=D:/hermes,broken");
  assert.deepEqual([...map.entries()], [["hermes", "D:/hermes"]]);
  const roots = resolveManagedSkillRoots("/home/alice", {
    AITRACKER_TOOL_DATA_DIRS: "hermes=D:/hermes",
  });
  const hermes = roots.find((entry) => entry.agent === "Hermes Agent");
  assert.equal(hermes?.root, "D:/hermes/skills");
});

test("per-tool override wins over envHome, defaults unchanged otherwise", () => {
  const env = {
    CODEX_HOME: "/env/codex",
    GROK_HOME: "/env/grok",
    AITRACKER_TOOL_DATA_DIRS: "codex=/override/codex",
  };
  const roots = resolveManagedSkillRoots("/home/alice", env);
  const codex = roots.filter((entry) => entry.agent === "Codex");
  assert.deepEqual(
    codex.map((entry) => entry.root),
    [join("/override/codex", "skills")],
  );
  const grok = roots.find((entry) => entry.agent === "Grok Build");
  assert.equal(grok?.root, join("/env/grok", "skills"));
  const claude = roots.find((entry) => entry.agent === "Claude Code");
  assert.equal(claude?.root, join("/home/alice", ".claude/skills"));
});
