import assert from "node:assert/strict";
import test from "node:test";

import { createStartupDocument } from "./startup-screen.js";

test("startup screen follows the resolved desktop locale before renderer i18n loads", () => {
  const english = decodeURIComponent(createStartupDocument("en-US"));
  assert.match(english, /lang="en-US"/);
  assert.match(english, /<title>AITracker<\/title>/);
  assert.match(english, /<svg viewBox="0 0 18 18">/);
  assert.match(english, /Preparing your local workspace/);
  assert.doesNotMatch(english, /正在准备本地工作区/);

  const chinese = decodeURIComponent(createStartupDocument("zh-CN"));
  assert.match(chinese, /正在准备本地工作区/);
});
