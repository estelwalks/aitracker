import assert from "node:assert/strict";
import test from "node:test";
import { nav as en } from "./en-US/nav.ts";
import { nav as zh } from "./zh-CN/nav.ts";
import { nav as ja } from "./ja-JP/nav.ts";
import { nav as ko } from "./ko-KR/nav.ts";

const requiredNavigation = [
  "home",
  "agents",
  "distill",
  "reports",
  "memoryHub",
  "guard",
  "tracker",
  "skillHub",
  "market",
  "resume",
  "widget",
  "sources",
  "settings",
  "collapse",
  "search",
  "agentActive",
] as const;

test("all locales expose the shared navigation contract", () => {
  for (const locale of [en, zh, ja, ko]) {
    assert.deepEqual(
      Object.keys(locale).sort(),
      [...requiredNavigation].sort(),
    );
    for (const key of requiredNavigation) assert.notEqual(locale[key], "");
  }
});
