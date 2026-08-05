import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_TOOLS,
  AI_TOOL_IDS,
  SKILL_TOOL_NAMES,
  usageLogParsingFor,
} from "./catalog.ts";

test("AI_TOOLS catalogs all 27 tools with stable ids", () => {
  assert.equal(AI_TOOLS.length, 27);
  assert.equal(AI_TOOL_IDS.length, 27);
  // ids are unique, lowercase-kebab.
  assert.equal(new Set(AI_TOOL_IDS).size, 27);
  for (const id of AI_TOOL_IDS) {
    assert.match(id, /^[a-z][a-z0-9-]*$/u);
  }
});

test("SKILL_TOOL_NAMES covers the five verified skill installation targets", () => {
  assert.equal(SKILL_TOOL_NAMES.length, 5);
  for (const name of [
    "Claude Code",
    "Codex CLI",
    "Cursor",
    "Gemini CLI",
    "OpenCode",
  ]) {
    assert.ok(
      SKILL_TOOL_NAMES.includes(name),
      `expected ${name} to be a Skill / Market agent`,
    );
  }
});

test("unverified skill roots remain unavailable as installation targets", () => {
  const byId = new Map(AI_TOOLS.map((tool) => [tool.id, tool]));
  assert.equal(byId.get("grok")?.skillRootSuffix, null);
  assert.equal(byId.get("antigravity")?.skillRootSuffix, null);
  assert.equal(byId.get("hermes")?.skillRootSuffix, null);
  assert.equal(byId.get("openclaw")?.skillRootSuffix, null);
});

test("usage parser capability is distinct from catalog installation roots", () => {
  assert.equal(usageLogParsingFor("codex"), "native");
  assert.equal(usageLogParsingFor("grok"), "adapter");
  assert.equal(usageLogParsingFor("openclaw"), "unsupported");
});

test("tools without a verified skills directory stay null", () => {
  const byId = new Map(AI_TOOLS.map((tool) => [tool.id, tool]));
  // zcode and the rest must remain null per NFR-017 Clean Room review.
  assert.equal(byId.get("zcode")?.skillRootSuffix, null);
  assert.equal(byId.get("kiro")?.skillRootSuffix, null);
  assert.equal(byId.get("github-copilot")?.skillRootSuffix, null);
});

test("each skill-enabled tool has a HOME-relative skill root suffix", () => {
  for (const tool of AI_TOOLS) {
    if (tool.skillRootSuffix === null) continue;
    // suffixes are HOME-relative directory paths, never absolute.
    assert.ok(
      !tool.skillRootSuffix.startsWith("/"),
      `${tool.id}: skill root suffix must be HOME-relative`,
    );
    assert.ok(
      tool.skillRootSuffix.length > 0,
      `${tool.id}: skill root suffix must be non-empty`,
    );
  }
});
