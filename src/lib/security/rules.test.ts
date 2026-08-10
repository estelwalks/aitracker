import assert from "node:assert/strict";
import test from "node:test";

import {
  isSecurityRuleKind,
  parseUserSecurityRules,
  SECURITY_RULE_KINDS,
  SECURITY_RULES_VERSION,
  validateSecurityRulePattern,
} from "./rules.ts";

test("exposes the 11-dimension rule taxonomy in fixed order", () => {
  assert.deepEqual(SECURITY_RULE_KINDS, [
    "远程命令执行",
    "数据泄露",
    "密钥泄露",
    "持久化",
    "破坏性操作",
    "代码混淆",
    "注入攻击",
    "权限提升",
    "文件访问",
    "网络外联",
    "提示注入",
  ]);
});

test("rule library carries a version string", () => {
  assert.ok(typeof SECURITY_RULES_VERSION === "string");
  assert.ok(SECURITY_RULES_VERSION.length > 0);
});

test("validates regular expression before saving", () => {
  assert.equal(
    validateSecurityRulePattern("https?://evil\\.example").valid,
    true,
  );
  assert.equal(validateSecurityRulePattern("[").valid, false);
  assert.equal(validateSecurityRulePattern("").valid, false);
});

test("isSecurityRuleKind accepts the 11 dimensions and rejects others", () => {
  for (const kind of SECURITY_RULE_KINDS) {
    assert.equal(isSecurityRuleKind(kind), true);
  }
  assert.equal(isSecurityRuleKind("危险命令"), false);
  assert.equal(isSecurityRuleKind("恶意 URL"), false);
  assert.equal(isSecurityRuleKind("敏感信息"), false);
  assert.equal(isSecurityRuleKind(undefined), false);
});

test("filters malformed, duplicated and invalid persisted rules", () => {
  const rules = parseUserSecurityRules([
    {
      id: "one",
      name: "有效规则",
      kind: "密钥泄露",
      pattern: "evil",
      enabled: true,
    },
    {
      id: "one",
      name: "重复标识",
      kind: "远程命令执行",
      pattern: "rm",
      enabled: true,
    },
    {
      id: "broken",
      name: "无效正则",
      kind: "密钥泄露",
      pattern: "[",
      enabled: true,
    },
  ]);

  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.name, "有效规则");
});

test("silently drops legacy 3-kind persisted rules", () => {
  const rules = parseUserSecurityRules([
    {
      id: "legacy-url",
      name: "旧 URL 规则",
      kind: "恶意 URL",
      pattern: "evil",
      enabled: true,
    },
    {
      id: "legacy-cmd",
      name: "旧命令规则",
      kind: "危险命令",
      pattern: "rm",
      enabled: true,
    },
    {
      id: "legacy-info",
      name: "旧敏感信息规则",
      kind: "敏感信息",
      pattern: "secret",
      enabled: true,
    },
  ]);

  assert.equal(rules.length, 0);
});

import { describe, test as it } from "node:test";

describe("TC-SEC-001: built-in rule boundary (user rules never alter built-ins)", () => {
  it("user rules are parsed into an isolated list; built-in version is untouched", () => {
    const versionBefore = SECURITY_RULES_VERSION;
    const userRules = parseUserSecurityRules([
      {
        id: "user-1",
        name: "自定义规则",
        kind: "数据泄露",
        pattern: "API_KEY",
        enabled: true,
      },
    ]);
    assert.equal(userRules.length, 1);
    // The built-in library version is derived from the built-in JSON only.
    assert.equal(SECURITY_RULES_VERSION, versionBefore);
    // The user list is a distinct data flow - no global state mutation.
    assert.equal(parseUserSecurityRules(null).length, 0);
    assert.equal(
      parseUserSecurityRules([{ id: "", name: "", kind: "x", pattern: "" }])
        .length,
      0,
    );
  });

  it("an invalid user pattern is rejected without touching built-ins", () => {
    const validation = validateSecurityRulePattern("([a-z]+");
    assert.equal(validation.valid, false);
    assert.equal(SECURITY_RULES_VERSION.length > 0, true);
  });
});
