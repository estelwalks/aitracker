import assert from "node:assert/strict";
import test from "node:test";

import { AI_TOOLS, AI_TOOL_IDS, usageLogParsingFor } from "./catalog.ts";
import { SKILL_AGENT_RULES } from "../local-skills/skill-rules.server.ts";
import { SKILL_AGENTS } from "../local-skills/agent-rules.ts";

const EXPECTED_SKILL_LABELS = [
  "Claude Code",
  "Codex",
  "Cursor",
  "Gemini CLI",
  "OpenCode",
  "Grok Build",
  "Hermes Agent",
  "OpenClaw",
  "Antigravity",
  "AiPy",
] as const;

const EXPECTED_SKILL_TOOL_IDS = [
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "opencode",
  "grok",
  "hermes",
  "openclaw",
  "antigravity",
  "aipy",
] as const;

test("AI_TOOLS catalogs all built-in tools with stable ids", () => {
  assert.equal(AI_TOOLS.length, 36);
  assert.equal(AI_TOOL_IDS.length, 36);
  // ids are unique, lowercase-kebab.
  assert.equal(new Set(AI_TOOL_IDS).size, 36);
  for (const id of AI_TOOL_IDS) {
    assert.match(id, /^[a-z][a-z0-9-]*$/u);
  }
});

test("SKILL_AGENT_RULES covers the verified skill agents in UI order", () => {
  assert.equal(SKILL_AGENT_RULES.length, 10);
  assert.deepEqual(
    SKILL_AGENT_RULES.map((rule) => rule.toolId),
    [...EXPECTED_SKILL_TOOL_IDS],
  );
  assert.deepEqual([...SKILL_AGENTS], [...EXPECTED_SKILL_LABELS]);
});

test("skill agent rules stay consistent with the catalog", () => {
  const byId = new Map(AI_TOOLS.map((tool) => [tool.id, tool]));
  const derivedLabels = SKILL_AGENT_RULES.map(
    (rule) => byId.get(rule.toolId)?.nameZh,
  );
  // Every rule references a known tool and derives its exact `nameZh` label.
  assert.deepEqual([...SKILL_AGENTS], derivedLabels);

  const labels = new Set<string>();
  for (const rule of SKILL_AGENT_RULES) {
    const tool = byId.get(rule.toolId);
    assert.ok(tool, `rule.toolId "${rule.toolId}" must exist in AI_TOOLS`);
    assert.ok(
      !labels.has(tool.nameZh),
      `derived label "${tool.nameZh}" must be unique`,
    );
    labels.add(tool.nameZh);

    assert.ok(
      rule.roots.length > 0,
      `${rule.toolId}: at least one skill root required`,
    );
    for (const root of rule.roots) {
      assert.ok(root.length > 0, `${rule.toolId}: root must be non-empty`);
      assert.ok(
        !root.startsWith("/"),
        `${rule.toolId}: root "${root}" must be HOME-relative`,
      );
      assert.ok(
        !root.split(/[\\/]+/u).includes(".."),
        `${rule.toolId}: root "${root}" must not traverse`,
      );
    }
  }
});

test("envHome override exists only for codex and grok", () => {
  const envHomeIds = SKILL_AGENT_RULES.filter(
    (rule) => rule.envHome !== undefined,
  )
    .map((rule) => rule.toolId)
    .sort();
  assert.deepEqual(envHomeIds, ["codex", "grok"]);
});

test("usage parser capability is distinct from catalog installation roots", () => {
  assert.equal(usageLogParsingFor("codex"), "native");
  assert.equal(usageLogParsingFor("grok"), "native");
  assert.equal(usageLogParsingFor("openclaw"), "native");
});

import { describe, test as it } from "node:test";

describe("P4-T1 registry-derived parser coverage", () => {
  it("derives native/adapter/unsupported from the usage plan", () => {
    assert.equal(usageLogParsingFor("claude-code"), "native");
    assert.equal(usageLogParsingFor("codex"), "native");
    assert.equal(usageLogParsingFor("workbuddy"), "native");
    assert.equal(usageLogParsingFor("grok"), "native");
    assert.equal(usageLogParsingFor("openclaw"), "native");
    assert.equal(usageLogParsingFor("no-such-tool"), "unsupported");
  });
});
