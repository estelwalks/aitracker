import assert from "node:assert/strict";
import test from "node:test";
import { brandColorOf } from "../../components/BrandIcon.helpers.ts";
import { PUBLIC_TOOL_MANIFEST } from "./public-manifest.generated.ts";

test("brandColorOf prefers the registry display.color over name heuristics", () => {
  // 配置值（definitions/*.tool.json 的 display.color），按 id 或展示名命中
  assert.equal(brandColorOf("claude-code"), "#d97757");
  assert.equal(brandColorOf("Claude Code"), "#d97757");
  assert.equal(brandColorOf("kimi-code"), "#7c5cff");
  // 未在注册表配置的工具回退到启发式
  assert.equal(brandColorOf("windsurf"), "#09b6a2");
  // 模型名等未知字符串回退 currentColor
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
