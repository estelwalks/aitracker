import assert from "node:assert/strict";
import test from "node:test";

import { createStartupDocument } from "./startup-screen.js";

test("startup screen follows the resolved desktop locale before renderer i18n loads", () => {
  const darkLogo = "data:image/png;base64,dark-logo";
  const english = decodeURIComponent(
    createStartupDocument("en-US", "dark", darkLogo),
  );
  assert.match(english, /lang="en-US"/);
  assert.match(english, /<title>AITracker<\/title>/);
  assert.match(english, /src="data:image\/png;base64,dark-logo"/);
  assert.match(english, /color-scheme:dark/);
  assert.match(english, /Preparing your local workspace/);
  assert.doesNotMatch(english, /正在准备本地工作区/);

  const chinese = decodeURIComponent(
    createStartupDocument("zh-CN", "light", "data:image/png;base64,light-logo"),
  );
  assert.match(chinese, /正在准备本地工作区/);
  assert.match(chinese, /src="data:image\/png;base64,light-logo"/);
  assert.match(chinese, /color-scheme:light/);
});
