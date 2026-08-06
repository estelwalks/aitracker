import assert from "node:assert/strict";
import test from "node:test";

import { TOOL_DEFINITIONS } from "./index.ts";
import { compileToolRegistry } from "../registry.ts";
import {
  BASELINE_TOOLS,
  BASELINE_USAGE_PARSING,
} from "../__baseline__/baseline.ts";

/** Legacy collection sources: real usage sources hidden from the product catalog. */
const LEGACY_HIDDEN_IDS = new Set(["aipy", "cline"]);

test("the registry compiles all 29 tool configs (27 visible + 2 legacy) with no diagnostics", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  const errors = registry.diagnostics.filter((d) => d.severity === "error");
  assert.deepEqual(errors, []);
  assert.equal(registry.definitions.length, 29);
});

test("registry tools match the frozen baseline (TC-REG-001)", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  // The 27 visible catalog tools match the frozen baseline exactly.
  const visible = registry.definitions.filter(
    (def) => def.catalogVisible !== false,
  );
  assert.deepEqual(
    visible.map((def) => def.id),
    BASELINE_TOOLS.map((t) => t.id),
  );
  for (const expected of BASELINE_TOOLS) {
    const def = registry.byId.get(expected.id);
    assert.ok(def, `tool "${expected.id}" missing from registry`);
    assert.equal(def.display.nameZh, expected.nameZh);
    assert.deepEqual([...def.detection.roots], [...expected.detectRoots]);
  }
  // The 2 legacy sources are present and hidden.
  for (const id of LEGACY_HIDDEN_IDS) {
    const def = registry.byId.get(id);
    assert.ok(def, `legacy source "${id}" missing from registry`);
    assert.equal(def?.catalogVisible, false);
  }
});

test("each config id equals its filename stem", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  const ids = registry.ids;
  assert.equal(new Set(ids).size, ids.length, "config ids must be unique");
  // 27 visible ids match the baseline; aipy/cline are the extra legacy ids.
  assert.deepEqual(
    [...ids].filter((id) => !LEGACY_HIDDEN_IDS.has(id)).sort(),
    BASELINE_TOOLS.map((t) => t.id).sort(),
  );
  for (const id of LEGACY_HIDDEN_IDS) assert.ok(ids.includes(id));
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
  // 12 tools carry a usage capability: 3 native + 7 catalog adapter + 2 legacy adapter.
  const BASELINE_USAGE_NATIVE = new Set(["claude-code", "codex", "workbuddy"]);
  const BASELINE_USAGE_ADAPTER = new Set([
    "cursor",
    "gemini-cli",
    "kimi-code",
    "opencode",
    "grok",
    "github-copilot",
    "roo-code",
    "aipy",
    "cline",
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

test("public manifest mirrors the 27 visible tools (legacy hidden)", () => {
  const registry = compileToolRegistry(TOOL_DEFINITIONS);
  assert.equal(registry.publicManifest.tools.length, 27);
  assert.deepEqual(
    registry.publicManifest.tools.map((t) => t.id),
    BASELINE_TOOLS.map((t) => t.id),
  );
  // Legacy sources must not leak into the browser-safe manifest.
  for (const id of LEGACY_HIDDEN_IDS) {
    assert.ok(
      !registry.publicManifest.tools.some((t) => t.id === id),
      `legacy source "${id}" leaked into public manifest`,
    );
  }
});

// Silence unused-import warning for the baseline parsing map when this file is
// type-checked in isolation.
void BASELINE_USAGE_PARSING;
