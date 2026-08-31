import assert from "node:assert/strict";
import test from "node:test";
import { brandColorOf } from "../../components/BrandIcon.helpers.ts";
import { PUBLIC_TOOL_MANIFEST } from "./public-manifest.generated.ts";

test("brandColorOf prefers the registry display.color over name heuristics", () => {
  // Configuration value (display.color of definitions/*.tool.json), hit by id or display name
  assert.equal(brandColorOf("claude-code"), "#d97757");
  assert.equal(brandColorOf("Claude Code"), "#d97757");
  assert.equal(brandColorOf("kimi-code"), "#7c5cff");
  // Tools not configured in the registry fall back to heuristics
  assert.equal(brandColorOf("windsurf"), "#09b6a2");
  // Unknown strings such as model names fall back to currentColor
  assert.equal(brandColorOf("gpt-4o-unknown-model"), "#10a37f");
});

test("public tool icons are offline registry kinds", () => {
  for (const tool of PUBLIC_TOOL_MANIFEST.tools) {
    assert.ok(
      tool.icon == null || !/^https?:\/\//i.test(tool.icon),
      `${tool.id} must not use a remote icon URL`,
    );
  }
});
