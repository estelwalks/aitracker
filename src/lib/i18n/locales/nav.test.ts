import assert from "node:assert/strict";
import test from "node:test";
import { nav as en } from "./en-US/nav.ts";
import { nav as zh } from "./zh-CN/nav.ts";
import { nav as ja } from "./ja-JP/nav.ts";
import { nav as ko } from "./ko-KR/nav.ts";

const requiredV3Navigation = [
  "tier1",
  "tier2",
  "tier3",
  "home",
  "agents",
  "distill",
  "reports",
  "memoryHub",
  "guard",
  "tracker",
  "skillHub",
  "resume",
  "widget",
  "settings",
  "collapse",
  "search",
  "agentActive",
] as const;

test("all locales expose the shared V3 navigation contract", () => {
  for (const locale of [en, zh, ja, ko]) {
    assert.deepEqual(
      Object.keys(locale).sort(),
      [...requiredV3Navigation].sort(),
    );
    for (const key of requiredV3Navigation) assert.notEqual(locale[key], "");
  }
});
