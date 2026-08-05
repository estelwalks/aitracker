import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_DEFINITIONS } from "./index.ts";
import { compileToolRegistry } from "../registry.ts";
import {
  BASELINE_TOOLS,
  BASELINE_USAGE_PARSING,
} from "../__baseline__/baseline.ts";

test("the registry compiles all 27 tool configs with no diagnostics", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  const errors = registry.diagnostics.filter((d) => d.severity === "error");
  assert.deepEqual(errors, []);
  assert.equal(registry.definitions.length, 27);
});

test("registry tools match the frozen baseline (TC-REG-001)", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  assert.deepEqual(
    registry.ids,
    BASELINE_TOOLS.map((t) => t.id),
  );
  for (const expected of BASELINE_TOOLS) {
    const def = registry.byId.get(expected.id);
    assert.ok(def, `tool "${expected.id}" missing from registry`);
    assert.equal(def.display.nameZh, expected.nameZh);
    assert.deepEqual([...def.detection.roots], [...expected.detectRoots]);
  }
});

test("each config id equals its filename stem", () => {
  // The 27 ids are known to match `<id>.config.ts` filenames (generated from
  // baseline). Asserting the id set equals the baseline id set guarantees no
  // config was mis-named or duplicated.
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  const ids = registry.ids;
  assert.equal(new Set(ids).size, ids.length, "config ids must be unique");
  assert.deepEqual([...ids].sort(), BASELINE_TOOLS.map((t) => t.id).sort());
});

test("skill/market/usage capabilities match the frozen baseline sets", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  const BASELINE_SKILL_IDS = [
    "claude-code",
    "codex",
    "cursor",
    "gemini-cli",
    "opencode",
    "grok",
    "hermes",
    "openclaw",
    "antigravity",
  ];
  // 10 tools carry a usage capability (claude/codex/workbuddy native; 7 adapter).
  const BASELINE_USAGE_NATIVE = new Set(["claude-code", "codex", "workbuddy"]);
  const BASELINE_USAGE_ADAPTER = new Set([
    "cursor",
    "gemini-cli",
    "kimi-code",
    "opencode",
    "grok",
    "github-copilot",
    "roo-code",
  ]);
  const BASELINE_SESSIONS_RESUME = new Set(["claude-code", "codex", "grok"]);
  for (const def of registry.definitions) {
    const isSkill = BASELINE_SKILL_IDS.includes(def.id);
    assert.equal(
      def.capabilities.skills.mode,
      isSkill ? "read-write" : "unsupported",
    );
    assert.equal(
      def.capabilities.market.mode,
      isSkill ? "install-target" : "unsupported",
    );
    const expectedUsage = BASELINE_USAGE_NATIVE.has(def.id)
      ? "native"
      : BASELINE_USAGE_ADAPTER.has(def.id)
        ? "adapter"
        : "unsupported";
    assert.equal(def.capabilities.usage.mode, expectedUsage);
    // agents/security unsupported for every tool; sessions resume for the 3
    // resume-capable tools (claude-code/codex/grok).
    assert.equal(def.capabilities.agents.mode, "unsupported");
    assert.equal(
      def.capabilities.sessions.mode,
      BASELINE_SESSIONS_RESUME.has(def.id) ? "resume" : "unsupported",
    );
    assert.equal(def.capabilities.security.mode, "unsupported");
  }
});

test("public manifest mirrors the 27 tools", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  assert.equal(registry.publicManifest.tools.length, 27);
  assert.deepEqual(
    registry.publicManifest.tools.map((t) => t.id),
    BASELINE_TOOLS.map((t) => t.id),
  );
});

// Silence unused-import warning for the baseline parsing map when this file is
// type-checked in isolation.
void BASELINE_USAGE_PARSING;
