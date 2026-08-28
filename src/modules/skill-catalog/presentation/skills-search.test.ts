import assert from "node:assert/strict";
import test from "node:test";

import { withSkillSearch } from "./skills-search.ts";

test("withSkillSearch removes a cleared deep-link filter without dropping preferences", () => {
  assert.deepEqual(
    withSkillSearch(
      {
        skill: "data-exfiltration",
        locale: "zh-CN",
        currency: "CNY",
      },
      "",
    ),
    { locale: "zh-CN", currency: "CNY" },
  );
});

test("withSkillSearch trims and replaces the current filter", () => {
  assert.deepEqual(
    withSkillSearch({ skill: "old", locale: "zh-CN" }, "  next  "),
    { skill: "next", locale: "zh-CN" },
  );
});
