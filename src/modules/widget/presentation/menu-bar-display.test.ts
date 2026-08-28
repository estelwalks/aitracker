import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMenuBarInsights,
  buildMenuBarTitle,
  MAX_MENU_BAR_TITLE_LENGTH,
} from "./menu-bar-display";

const summary = {
  tokens: "12.8M",
  tool: "Codex",
  detail: "87% cache",
};

test("动态栏关闭时菜单栏仍展示 Token 消耗", () => {
  assert.equal(buildMenuBarTitle({ dynamic: false, ...summary }), "12.8M");
});

test("动态栏开启时保留丰富摘要作为未来洞察占位", () => {
  assert.equal(
    buildMenuBarTitle({ dynamic: true, ...summary }),
    "12.8M · Codex · 87% cache",
  );
});

test("动态栏优先展示已整理的短洞察", () => {
  assert.equal(
    buildMenuBarTitle({
      dynamic: true,
      ...summary,
      insight: "Codex",
    }),
    "12.8M · Codex",
  );
});

test("洞察候选会移除空值并去重", () => {
  assert.deepEqual(
    buildMenuBarInsights(["  缓存命中 87% ", "", undefined, "缓存命中 87%"]),
    ["缓存命中 87%"],
  );
});

test("菜单栏标题限制在原生标题长度以内", () => {
  const title = buildMenuBarTitle({
    dynamic: true,
    ...summary,
    insight: "x".repeat(MAX_MENU_BAR_TITLE_LENGTH + 20),
  });
  assert.equal(title.length, MAX_MENU_BAR_TITLE_LENGTH);
  assert.equal(title.endsWith("…"), true);
});
