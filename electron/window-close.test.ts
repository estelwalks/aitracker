import assert from "node:assert/strict";
import test from "node:test";

import { shouldHideWindowOnClose } from "./window-close.js";

test("普通关闭走隐藏到托盘路径", () => {
  assert.equal(shouldHideWindowOnClose(false), true);
});

test("托盘退出设置 isQuitting 后允许窗口真正关闭", () => {
  assert.equal(shouldHideWindowOnClose(true), false);
});
