import assert from "node:assert/strict";
import test from "node:test";

import { AI_TOOLS, usageLogParsingFor } from "../../tools/catalog.ts";
import { SKILL_AGENT_RULES } from "../../local-skills/skill-rules.server.ts";
import { BUILTIN_USAGE_ADAPTERS } from "../../local-usage/adapters/catalog.ts";
import {
  buildResumeCommand,
  isResumeSafeId,
} from "../../local-sessions/resume-id.ts";
import {
  BASELINE_SESSION_SOURCES,
  BASELINE_SKILL_AGENTS,
  BASELINE_TOOLS,
  BASELINE_USAGE_ADAPTERS,
  BASELINE_USAGE_PARSING,
} from "./baseline.ts";

// Pricing baseline parity (BASELINE_MODEL_PRICES reproduced via the offline
// rule-pack resolver) lives in src/lib/pricing/parity.test.ts - model prices
// are no longer a static `MODEL_PRICES` catalog.

test("baseline tools match the live AI_TOOLS catalog (27 tools)", () => {
  assert.equal(AI_TOOLS.length, BASELINE_TOOLS.length);
  for (const expected of BASELINE_TOOLS) {
    const live = AI_TOOLS.find((tool) => tool.id === expected.id);
    assert.ok(live, `baseline tool "${expected.id}" missing from AI_TOOLS`);
    assert.equal(live.nameZh, expected.nameZh);
    assert.deepEqual([...live.detectRoots], [...expected.detectRoots]);
  }
  // No extra live tools beyond the baseline.
  assert.equal(AI_TOOLS.length, 27);
});

test("baseline usage parsing matches usageLogParsingFor for every tool", () => {
  for (const tool of BASELINE_TOOLS) {
    assert.equal(
      usageLogParsingFor(tool.id),
      BASELINE_USAGE_PARSING[tool.id],
      `usageLogParsingFor("${tool.id}")`,
    );
  }
});

test("baseline skill agents match the live SKILL_AGENT_RULES (9 agents)", () => {
  assert.equal(SKILL_AGENT_RULES.length, BASELINE_SKILL_AGENTS.length);
  for (const expected of BASELINE_SKILL_AGENTS) {
    const live = SKILL_AGENT_RULES.find(
      (rule) => rule.toolId === expected.toolId,
    );
    assert.ok(live, `baseline skill agent "${expected.toolId}" missing`);
    assert.deepEqual([...live.roots], [...expected.roots]);
    assert.equal(live.envHome, expected.envHome);
    assert.deepEqual(
      [...(live.markers ?? ["SKILL.md", "skill.md"])],
      [...expected.markers],
    );
    assert.equal(live.maxDepth ?? 3, expected.maxDepth);
  }
});

test("baseline usage adapters match the live BUILTIN_USAGE_ADAPTERS (12 sources)", () => {
  assert.equal(BUILTIN_USAGE_ADAPTERS.length, BASELINE_USAGE_ADAPTERS.length);
  for (const expected of BASELINE_USAGE_ADAPTERS) {
    const live = BUILTIN_USAGE_ADAPTERS.find(
      (adapter) => adapter.source === expected.source,
    );
    assert.ok(live, `baseline adapter "${expected.source}" missing`);
    assert.deepEqual(
      live.paths.map((path) => ({
        root: path.root,
        glob: path.glob,
        format: path.format,
      })),
      expected.paths.map((path) => ({
        root: path.root,
        glob: path.glob,
        format: path.format,
      })),
    );
    const customMapping =
      expected.source === "aipy" || expected.source === "workbuddy";
    assert.equal(customMapping, expected.customMapping);
    assert.equal(
      "query" in live && live.query != null,
      expected.hasSqliteQuery,
    );
    assert.equal(live.maxFileSizeBytes, expected.maxFileSizeBytes);
  }
});

test("baseline session sources match the live resume command templates", () => {
  for (const expected of BASELINE_SESSION_SOURCES) {
    // A safe id is accepted and yields the template + id; an unsafe id yields null.
    assert.equal(
      buildResumeCommand(expected.source, "abc123"),
      `${expected.resumeCommandTemplate} abc123`,
    );
    assert.equal(buildResumeCommand(expected.source, "foo; rm -rf /"), null);
  }
  // The three sources are exactly the supported set.
  assert.deepEqual(
    BASELINE_SESSION_SOURCES.map((source) => source.source).sort(),
    ["claude-code", "codex", "grok"],
  );
  // isResumeSafeId is the guard referenced by the baseline.
  assert.equal(isResumeSafeId("abc123"), true);
  assert.equal(isResumeSafeId("foo; rm -rf /"), false);
});
