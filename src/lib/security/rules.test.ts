import assert from "node:assert/strict";
import test from "node:test";

import {
  parseUserSecurityRules,
  validateSecurityRulePattern,
} from "./rules.ts";

test("validates regular expression before saving", () => {
  assert.equal(
    validateSecurityRulePattern("https?://evil\\.example").valid,
    true,
  );
  assert.equal(validateSecurityRulePattern("[").valid, false);
  assert.equal(validateSecurityRulePattern("").valid, false);
});

test("filters malformed, duplicated and invalid persisted rules", () => {
  const rules = parseUserSecurityRules([
    {
      id: "one",
      name: "有效规则",
      kind: "恶意 URL",
      pattern: "evil",
      enabled: true,
    },
    {
      id: "one",
      name: "重复标识",
      kind: "危险命令",
      pattern: "rm",
      enabled: true,
    },
    {
      id: "broken",
      name: "无效正则",
      kind: "敏感信息",
      pattern: "[",
      enabled: true,
    },
  ]);

  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.name, "有效规则");
});
