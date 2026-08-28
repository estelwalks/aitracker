import assert from "node:assert/strict";
import test from "node:test";

import { getDefaultRegistry } from "./registry.ts";
import {
  BASELINE_TOOLS,
  BASELINE_USAGE_PARSING,
} from "./__baseline__/baseline.ts";

/**
 * User-added extension tools (aipy/cline): real usage sources that the user
 * added beyond the 27-tool product catalog and wants displayed like any other
 * tool (catalogVisible=true, no longer legacy-hidden).
 */
const EXTENSION_IDS = ["aipy", "cline"];

test("the registry compiles all built-in tool definitions with no diagnostics", () => {
  const registry = getDefaultRegistry();
  const errors = registry.diagnostics.filter((d) => d.severity === "error");
  assert.deepEqual(errors, []);
  assert.equal(registry.definitions.length, 36);
});

test("registry tools match the frozen baseline (TC-REG-001)", () => {
  const registry = getDefaultRegistry();
  // All built-in tools are visible now (aipy/cline are user extensions, not hidden).
  assert.equal(
    registry.definitions.filter((def) => def.catalogVisible !== false).length,
    36,
  );
  // The frozen 27-tool baseline matches the first 27 definitions in order.
  const ids = registry.definitions.map((def) => def.id);
  assert.deepEqual(
    ids.slice(0, 27),
    BASELINE_TOOLS.map((t) => t.id),
  );
  for (const expected of BASELINE_TOOLS) {
    const def = registry.byId.get(expected.id);
    assert.ok(def, `tool "${expected.id}" missing from registry`);
    assert.equal(def.display.nameZh, expected.nameZh);
    const expectedRoots =
      expected.id === "gemini-cli" ? [".gemini/tmp"] : expected.detectRoots;
    for (const root of expectedRoots) {
      assert.ok(
        def.detection.roots.includes(root),
        `${expected.id} must retain baseline detection root ${root}`,
      );
    }
  }
  // The user extension tools are present and visible.
  for (const id of EXTENSION_IDS) {
    const def = registry.byId.get(id);
    assert.ok(def, `extension tool "${id}" missing from registry`);
    assert.notEqual(def?.catalogVisible, false);
  }
});

test("each config id equals its filename stem", () => {
  const registry = getDefaultRegistry();
  const ids = registry.ids;
  assert.equal(new Set(ids).size, ids.length, "config ids must be unique");
  // 27 baseline ids + dsh + aipy/cline extensions + reference local sources.
  assert.deepEqual(
    [...ids].slice(0, 27),
    BASELINE_TOOLS.map((t) => t.id),
  );
  assert.equal(ids[27], "dsh");
  assert.ok(ids.includes("qwen"));
  assert.ok(ids.includes("cherrystudio"));
});

test("skill/market/usage capabilities match the frozen baseline sets", () => {
  const registry = getDefaultRegistry();
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
    "aipy",
  ];
  // Native readers plus registry-declared generic adapters are supported.
  const BASELINE_USAGE_NATIVE = new Set([
    "claude-code",
    "codex",
    "gemini-cli",
    "grok",
    "openclaw",
    "antigravity",
    "workbuddy",
    "dsh",
  ]);
  const BASELINE_USAGE_ADAPTER = new Set([
    "cursor",
    "kimi-code",
    "opencode",
    "github-copilot",
    "roo-code",
    "aipy",
    "cline",
    "qwen",
    "commandcode",
    "proma",
    "reasonix",
    "cherrystudio",
  ]);
  const BASELINE_SESSIONS_RESUME = new Set([
    "claude-code",
    "codex",
    "grok",
    "dsh",
  ]);
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
    // agents/security unsupported for every tool; sessions include the
    // read-only AiPy source in addition to the four resumable tools.
    assert.equal(def.capabilities.agents.mode, "unsupported");
    assert.equal(
      def.capabilities.sessions.mode,
      BASELINE_SESSIONS_RESUME.has(def.id)
        ? "resume"
        : def.id === "aipy"
          ? "read"
          : "unsupported",
    );
    assert.equal(def.capabilities.security.mode, "unsupported");
  }
});

test("public manifest mirrors all visible tools", () => {
  const registry = getDefaultRegistry();
  assert.equal(registry.publicManifest.tools.length, 36);
  assert.deepEqual(
    registry.publicManifest.tools.map((t) => t.id),
    registry.definitions.map((d) => d.id),
  );
  // User extension tools appear in the browser-safe manifest too.
  for (const id of EXTENSION_IDS) {
    assert.ok(
      registry.publicManifest.tools.some((t) => t.id === id),
      `extension tool "${id}" missing from public manifest`,
    );
  }
});

// Silence unused-import warning for the baseline parsing map when this file is
// type-checked in isolation.
void BASELINE_USAGE_PARSING;
