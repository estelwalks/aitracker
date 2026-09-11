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
      expected.id === "gemini-cli"
        ? [".gemini/tmp"]
        : // Expected diff (CodeBuddy detection tightened): the legacy
          // ~/.codebuddy home is shared with the WorkBuddy family's CLI core
          // and can no longer prove a CodeBuddy install; see the canonical
          // note in __baseline__/baseline.test.ts.
          expected.id === "codebuddy"
          ? [
              "AppData/Local/CodeBuddyExtension/Logs",
              "Library/Application Support/CodeBuddyExtension/Logs",
            ]
          : expected.detectRoots;
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
    // Deliberate post-baseline addition: WorkBuddy stores user skills under
    // ~/.workbuddy/skills and is a market install target like the others.
    "workbuddy",
    // Deliberate post-baseline addition: ZCode discovers user skills under
    // ~/.zcode/skills (SKILL.md format) and is a market install target.
    "zcode",
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
    // Deliberate post-baseline addition: pi and oh-my-pi (same harness) gained
    // native readers over their ~/.pi and ~/.omp session logs.
    "pi",
    "omp",
    // Deliberate post-baseline addition: Zed Agent gained a native threads.db
    // usage reader.
    "zed",
    // Deliberate post-baseline additions (TokenTracker-sourced, native readers):
    // Droid (settings.json, mtime timestamps) and CodeBuddy (projects JSONL with
    // per-message usage arithmetic).
    "droid",
    "codebuddy",
    // Deliberate post-baseline addition (TokenTracker-sourced): Every Code
    // shares the Codex rollout family (~/.code/sessions rollout-*.jsonl).
    "every-code",
    // Deliberate post-baseline addition (TokenTracker-sourced): Kilo Code
    // tasks ui_messages.json (Cline family) native reader.
    "kilocode",
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
    // Issue #31 companion: Hermes Agent gained a generic-sqlite usage adapter
    // (sessions in state.db; default DB plus profiles/<name>/state.db).
    "hermes",
    // Deliberate post-baseline addition: ZCode gained a generic-sqlite usage
    // adapter over model_usage rows in ~/.zcode/cli/db/db.sqlite.
    "zcode",
    // Deliberate post-baseline additions (TokenTracker-sourced): Goose and
    // Qoder CN gained generic-sqlite usage adapters over sessions.db /
    // QoderCN local.db.
    "goose",
    "qodercn",
    // Deliberate post-baseline addition (TokenTracker-sourced): AnythingLLM
    // Desktop gained a generic-sqlite usage adapter over its anythingllm.db.
    "anythingllm",
    // Deliberate post-baseline addition (TokenTracker-sourced): Kiro gained a
    // generic-sqlite usage adapter over its tokens_generated table.
    "kiro",
    // Deliberate post-baseline addition (TokenTracker-sourced): Mimo Code
    // gained a generic-sqlite usage adapter over its mimocode.db messages.
    "mimo",
    // Deliberate post-baseline addition (TokenTracker-sourced): Craft Agents
    // exposes session-header cumulative snapshots via generic-jsonl.
    "craft",
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
    // agents/security unsupported for every tool; sessions include the
    // read-only AiPy, pi, Hermes, WorkBuddy, ZCode and dsh sources in
    // addition to the three resumable tools.
    assert.equal(def.capabilities.agents.mode, "unsupported");
    assert.equal(
      def.capabilities.sessions.mode,
      BASELINE_SESSIONS_RESUME.has(def.id)
        ? "resume"
        : // Deliberate post-baseline additions: Hermes Agent and WorkBuddy
          // gained read-only session support (state.db / projects JSONL);
          // ZCode sessions are read from its SQLite session database; dsh
          // sessions are listed read-only because current harnesses ship no
          // resume entry point to launch.
          def.id === "aipy" ||
            def.id === "pi" ||
            def.id === "omp" ||
            def.id === "hermes" ||
            def.id === "workbuddy" ||
            def.id === "zcode" ||
            def.id === "dsh"
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
