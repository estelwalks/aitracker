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

test("baseline tools remain present in the expanded AI_TOOLS catalog", () => {
  // The frozen baseline is the 27-tool product catalog captured pre-migration.
  // aipy/cline are user-added extension tools (catalogVisible=true) and now
  // appear in AI_TOOLS after the 27 baseline tools.
  assert.ok(AI_TOOLS.length >= BASELINE_TOOLS.length);
  for (const expected of BASELINE_TOOLS) {
    const live = AI_TOOLS.find((tool) => tool.id === expected.id);
    assert.ok(live, `baseline tool "${expected.id}" missing from AI_TOOLS`);
    assert.equal(live.nameZh, expected.nameZh);
    const expectedRoots =
      expected.id === "gemini-cli" ? [".gemini/tmp"] : expected.detectRoots;
    for (const root of expectedRoots) {
      assert.ok(
        live.detectRoots.includes(root),
        `${expected.id} must retain baseline detection root ${root}`,
      );
    }
  }
  // The 27 baseline tools remain first in canonical order; later additions are
  // appended so the frozen migration parity stays meaningful.
  assert.deepEqual(
    AI_TOOLS.slice(0, 27).map((t) => t.id),
    BASELINE_TOOLS.map((t) => t.id),
  );
  assert.equal(AI_TOOLS.length, 36);
});

test("baseline usage parsing matches usageLogParsingFor for every tool", () => {
  for (const tool of BASELINE_TOOLS) {
    // Expected diff (P4-T1, see tool-registry-expected-diff.md D-E): workbuddy
    // was labeled "adapter" by the frozen catalog constants but its declared
    // usage mode is native (`workbuddy-native`); the registry-derived value is
    // the correction.
    if (
      tool.id === "workbuddy" ||
      tool.id === "gemini-cli" ||
      tool.id === "grok" ||
      tool.id === "openclaw"
    ) {
      assert.equal(usageLogParsingFor(tool.id), "native");
      continue;
    }
    assert.equal(
      usageLogParsingFor(tool.id),
      BASELINE_USAGE_PARSING[tool.id],
      `usageLogParsingFor("${tool.id}")`,
    );
  }
});

test("baseline skill agents remain present in the live Skill rules", () => {
  // Preserve the frozen nine-agent baseline while allowing supported
  // extensions to be appended.
  assert.ok(SKILL_AGENT_RULES.length >= BASELINE_SKILL_AGENTS.length);
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

test("baseline usage adapters remain represented (native sources included)", () => {
  // The baseline now reflects the registry post-migration: OpenClaw and
  // Antigravity contribute native usage adapters inside the frozen set, so the
  // live catalog matches it one-for-one (no extra "+1 extension"). dsh is a
  // deliberate post-baseline addition and is asserted separately below.
  assert.ok(BUILTIN_USAGE_ADAPTERS.length >= BASELINE_USAGE_ADAPTERS.length);
  for (const expected of BASELINE_USAGE_ADAPTERS) {
    const live = BUILTIN_USAGE_ADAPTERS.find(
      (adapter) => adapter.source === expected.source,
    );
    assert.ok(live, `baseline adapter "${expected.source}" missing`);
    const actualPaths = live.paths.map((path) => ({
      root: path.root,
      glob: path.glob,
      format: path.format,
    }));
    if (expected.source === "gemini-cli") {
      assert.deepEqual(actualPaths, [
        {
          root: ".gemini/tmp",
          glob: "**/chats/session-*.json",
          format: "json",
        },
      ]);
    } else if (expected.source === "grok") {
      assert.deepEqual(actualPaths, [
        {
          root: ".grok/sessions",
          glob: "**/updates.jsonl",
          format: "jsonl",
        },
      ]);
    } else {
      const baselinePaths = expected.paths.map((path) => ({
        root: path.root,
        glob: path.glob,
        format: path.format,
      }));
      assert.deepEqual(
        actualPaths.slice(0, baselinePaths.length),
        baselinePaths,
      );
    }
    const customMapping =
      expected.source === "aipy" || expected.source === "workbuddy";
    assert.equal(customMapping, expected.customMapping);
    assert.equal(
      "query" in live && live.query != null,
      expected.hasSqliteQuery,
    );
    assert.equal(live.maxFileSizeBytes, expected.maxFileSizeBytes);
  }
  assert.equal(
    BUILTIN_USAGE_ADAPTERS.find((adapter) => adapter.source === "openclaw")
      ?.reader,
    "openclaw-session-v1",
  );
  // Deliberate post-baseline addition: dsh (DeepSeek Harness) contributes a
  // native reader over its zstd session logs.
  const dsh = BUILTIN_USAGE_ADAPTERS.find(
    (adapter) => adapter.source === "dsh",
  );
  assert.ok(dsh, "dsh usage adapter missing");
  assert.equal(dsh.reader, "dsh-session-v1");
  assert.deepEqual(
    dsh.paths.map((path) => ({
      root: path.root,
      glob: path.glob,
      format: path.format,
    })),
    [
      { root: ".dsh/sessions", glob: "**/session.jsonl.zstd", format: "jsonl" },
      { root: ".dsh/sessions", glob: "**/session.jsonl", format: "jsonl" },
    ],
  );
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
