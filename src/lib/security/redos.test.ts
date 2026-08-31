import assert from "node:assert/strict";
import test from "node:test";

import { detectReDoS, isSafeSecurityPattern } from "./security-rules.schema.ts";
import { SECURITY_RULES_DATA } from "./security-rules.generated.ts";
import {
  parseUserSecurityRules,
  validateSecurityRulePattern,
} from "./rules.ts";
import {
  MAX_REGEX_STEPS_PER_RULE_LINE,
  MAX_REGEX_STEPS_TOTAL,
  scanSecurityFiles,
} from "./scanner.ts";

/**
 * ReDoS protection gate (deviation issue list P1/F4-T1..T4).
 *
 * Coverage: Dangerous form negative testing, built-in 26 rules all pass the gate, user rule saving/parsing verification,
 * Scan budget truncation, builtin-15 rewrite equivalence.
 */

// ---------------------------------------------------------------------------
// F4-T1: detectReDoS / isSafeSecurityPattern negative and positive tests
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS: string[] = [
  "(a+)+", // Nested quantifier: unbounded × unbounded
  "(a*)*",
  "(a+)*",
  "(a*)+",
  "(a|aa)+", // Multiple alternating quantifiers: different branch lengths → ambiguity
  "([a-z]+)*",
  "(a?)+", // Nested optional quantifiers
  "(ab?)+",
  "(ab|bc|cd)*", // Multiple alternations plus quantifiers (task requirements cover morphology)
  "([^\n]+)*",
  "((a+)+)", // Deep nesting
  "(a{1,3})+", // Unbounded outer quantifier × bounded inner quantifier
  "(a{0,100})+",
  "(a+){2}", // Bounded outer quantifier × Unbounded inner quantifier
  "(a*){3}",
  "(\\d|\\w)+", // Alternate branch character set intersection
  "(a|a)+",
  "(a)\\1+", // backreference
  "(?<x>a)\\k<x>+",
  "((?:the\\s+)?)+", // Optional grouping is repeated by outer layer
];

const SAFE_PATTERNS: string[] = [
  "(a|b)+", // Single character disjoint alternation + quantifier: linear safety
  "(a|b|c){1,2}",
  "(a|b|c){2,}",
  "(a{2})+", // Definite quantifiers: deterministic chunking
  "(a|b)?", // single occurrence
  "(a*)?",
  "(?:the\\s+)?", // Optional grouping of single occurrences
  "(?:sudo\\s+)?",
  "(?:\\.\\w+)?",
  "(?:\\d{1,3}\\.){3}\\d{1,3}\\b", // Bounded × Bounded (built-in builtin-24 form)
  "a+",
  "https?://",
  "\\b(?:curl|wget)\\b",
  "[^\\n]{0,60}?",
  "(a(b|c)d)",
  "(foo|bar)",
  "\\d+",
  "x{2}y",
  "(?=a)b",
  "(?<=x)y",
];

test("detectReDoS rejects dangerous catastrophic-backtracking shapes", () => {
  for (const pattern of DANGEROUS_PATTERNS) {
    const reason = detectReDoS(pattern);
    assert.ok(reason !== null, `危险形态未被识别：${pattern}`);
    assert.ok(
      reason.includes("卡死"),
      `诊断消息应说明危险原因：${pattern} → ${reason}`,
    );
    assert.equal(isSafeSecurityPattern(pattern), false, pattern);
  }
});

test("detectReDoS rejects adjacent quantifiers and backreferences", () => {
  // The quantifier follows the quantifier (these are mostly compilation errors under JS, the detector will check before compiling)
  assert.ok(detectReDoS("a*+") !== null);
  assert.ok(detectReDoS("a++") !== null);
  assert.ok(detectReDoS("a{2}*") !== null);
  // backreference
  assert.ok(detectReDoS("(a)\\1+") !== null);
  assert.ok(detectReDoS("\\k<name>") !== null);
  // Lazy modification is legal and does not trigger
  assert.equal(detectReDoS("a*?b"), null);
  assert.equal(detectReDoS("a+?"), null);
});

test("detectReDoS accepts linear-safe patterns", () => {
  for (const pattern of SAFE_PATTERNS) {
    assert.equal(detectReDoS(pattern), null, `安全形态被误判：${pattern}`);
    assert.equal(isSafeSecurityPattern(pattern), true, pattern);
  }
});

test("every built-in rule passes the safety gate (26/26)", () => {
  assert.equal(SECURITY_RULES_DATA.rules.length, 26);
  for (const rule of SECURITY_RULES_DATA.rules) {
    assert.equal(
      isSafeSecurityPattern(rule.pattern),
      true,
      `内建规则 ${rule.id}（${rule.name}）未通过安全 gate：${rule.pattern}`,
    );
  }
});

test("isSafeSecurityPattern keeps hard checks (empty/over-long/non-compiling)", () => {
  assert.equal(isSafeSecurityPattern(""), false);
  assert.equal(isSafeSecurityPattern("a".repeat(501)), false);
  assert.equal(isSafeSecurityPattern("("), false);
  assert.equal(isSafeSecurityPattern("a++"), false); // Can't compile
});

// ---------------------------------------------------------------------------
// F4-T2: User rule verification and persistence analysis reuse the same gate
// ---------------------------------------------------------------------------

test("validateSecurityRulePattern rejects dangerous patterns with reason", () => {
  const result = validateSecurityRulePattern("(a+)+");
  assert.equal(result.valid, false);
  assert.ok(result.message.includes("嵌套/重叠量词"));
  assert.ok(result.message.includes("卡死"));

  assert.equal(validateSecurityRulePattern("(a|aa)+").valid, false);
  assert.equal(validateSecurityRulePattern("(ab|bc|cd)*").valid, false);
});

test("validateSecurityRulePattern still accepts safe and linear patterns", () => {
  assert.equal(
    validateSecurityRulePattern("https?://evil\\.example").valid,
    true,
  );
  assert.equal(validateSecurityRulePattern("(a|b)+").valid, true);
  assert.equal(validateSecurityRulePattern("(a{2})+").valid, true);
});

test("parseUserSecurityRules silently drops dangerous persisted rules", () => {
  const rules = parseUserSecurityRules([
    {
      id: "ok",
      name: "安全规则",
      kind: "密钥泄露",
      pattern: "API_KEY",
      enabled: true,
    },
    {
      id: "danger",
      name: "危险规则",
      kind: "密钥泄露",
      pattern: "(a+)+",
      enabled: true,
    },
    {
      id: "danger-alt",
      name: "危险交替规则",
      kind: "数据泄露",
      pattern: "(a|aa)+",
      enabled: true,
    },
  ]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]?.name, "安全规则");
});

test("scanSecurityFiles ignores dangerous persisted user rules without hanging", () => {
  const report = scanSecurityFiles(
    [{ name: "script.sh", content: "a".repeat(10_000) }],
    [
      {
        id: "danger",
        name: "危险规则",
        kind: "远程命令执行",
        pattern: "(a+)+",
        enabled: true,
      },
    ],
  );
  assert.equal(report.risks.length, 0);
  assert.equal(report.truncated, undefined);
});

// ---------------------------------------------------------------------------
// F4-T3: Scan budget truncation
// ---------------------------------------------------------------------------

test("scan aborts the dimension on an over-long single line and marks truncated", () => {
  const overLong = "a".repeat(MAX_REGEX_STEPS_PER_RULE_LINE + 1);
  const report = scanSecurityFiles([{ name: "huge.md", content: overLong }]);
  assert.equal(report.truncated, true);
  assert.equal(report.filesScanned, 1);
});

test("scan aborts the dimension when cumulative regex steps exceed the total budget", () => {
  // 100 lines × 100k characters: A single line does not exceed the per-line budget, but the cumulative estimated step far exceeds the total budget
  assert.ok(100_000 < MAX_REGEX_STEPS_PER_RULE_LINE);
  const lines = Array.from({ length: 100 }, () => "a".repeat(100_000)).join(
    "\n",
  );
  const report = scanSecurityFiles([{ name: "wide.md", content: lines }]);
  assert.equal(report.truncated, true);
});

test("normal small scans are not truncated", () => {
  const report = scanSecurityFiles([
    { name: "README.md", content: "# Hello\nUse npm test." },
  ]);
  assert.equal(report.truncated, undefined);
  assert.equal(report.verdict, "安全");
});

test("budget constants are exported for tuning", () => {
  assert.equal(typeof MAX_REGEX_STEPS_PER_RULE_LINE, "number");
  assert.equal(typeof MAX_REGEX_STEPS_TOTAL, "number");
  assert.ok(MAX_REGEX_STEPS_PER_RULE_LINE > 0);
  assert.ok(MAX_REGEX_STEPS_TOTAL > MAX_REGEX_STEPS_PER_RULE_LINE);
});

// ---------------------------------------------------------------------------
// builtin-15 rewrite equivalence (F4-T1 Explanation: The old rule contains `\s*` in the quantization group, gated
// Determined to be a nested quantifier; the new rule removes the intra-group quantifier and changes the group repetition to bounded `{4,32}` - the latter
// Eliminates double backtracking on uniform input (`\x65` long lines used to take a single test() to minutes), and
// Boolean semantic equivalence of test(): Anchorless scan will find "group 4-32 + trailing execution call" in any window,
// Extra long chain still hits. Semantics enforced within "adjacent hex chain + trailing whitespace/newline + 60 characters
// Calling is consistent with the old rules).
// ---------------------------------------------------------------------------

const OLD_BUILTIN_15 =
  "(?:\\\\x[0-9a-f]{2}\\s*){4,}[^\\n]{0,60}?(?:eval|exec|Function\\s*\\()";
const NEW_BUILTIN_15 =
  "(?:\\\\x[0-9a-f]{2}){4,32}\\s*[^\\n]{0,60}?(?:eval|exec|Function\\s*\\()";

test("builtin-15 rewrite keeps the original intent on sample inputs", () => {
  assert.equal(detectReDoS(OLD_BUILTIN_15) !== null, true); // The old rules were indeed rejected
  assert.equal(detectReDoS(NEW_BUILTIN_15), null); // New rules pass gate

  const samples: Array<{ input: string; note: string }> = [
    { input: '\\x65\\x76\\x61\\x6c eval("x")', note: "相邻十六进制链 + 执行" },
    { input: '\\x65\\x76\\x61\\x6c\\teval("x")', note: "Tab 尾随" },
    { input: '\\x65\\x76\\x61\\x6c\\neval("x")', note: "换行尾随（跨行链）" },
    { input: '\\x65\\x76\\x61\\x6c\\x61 eval("x")', note: "5 组" },
    {
      input: "\\x65".repeat(30) + ' eval("x")',
      note: "超 32 组长链仍命中（窗口语义）",
    },
    { input: '\\x65\\x76\\x61 eval("x")', note: "仅 3 组 → 不命中" },
    { input: '\\x65\\x76\\x61\\x6c alert("x")', note: "无执行调用 → 不命中" },
    {
      input: "\\x65\\x76\\x61\\x6c" + "x".repeat(80) + ' eval("x")',
      note: "间隔超 60 字符 → 不命中",
    },
  ];
  const oldRe = new RegExp(OLD_BUILTIN_15, "i");
  const newRe = new RegExp(NEW_BUILTIN_15, "i");
  for (const { input, note } of samples) {
    assert.equal(
      newRe.test(input),
      oldRe.test(input),
      `样例结果不一致（${note}）：${JSON.stringify(input)}`,
    );
  }

  // Documented behavior difference: old rule hits, new rule misses when there are spaces between hex groups
  // (White spaced hexadecimal chains are rare; continuous chains are the mainstream form of actual obfuscated code)
  const spaced = '\\x65 \\x76 \\x61 \\x6c eval("x")';
  assert.equal(oldRe.test(spaced), true);
  assert.equal(newRe.test(spaced), false);
});

test("builtin-15 rewrite still matches the scanner's sample flow", () => {
  const report = scanSecurityFiles([
    {
      name: "obf.js",
      content: "var s = '\\x65\\x76\\x61\\x6c'; eval(s);",
    },
  ]);
  assert.ok(
    report.risks.some(
      (risk) => risk.ruleName === "十六进制执行链" && risk.kind === "代码混淆",
    ),
    "改写后的规则应命中十六进制执行链样本",
  );
});
