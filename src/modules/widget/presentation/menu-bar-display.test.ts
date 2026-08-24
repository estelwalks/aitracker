import assert from "node:assert/strict";
import test from "node:test";

import { buildMenuBarTitle } from "./menu-bar-display";

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
