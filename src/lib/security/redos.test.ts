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
 * ReDoS 防护 gate（偏差问题清单 P1 / F4-T1..T4）。
 *
 * 覆盖：危险形态负向测试、内建 26 规则全过 gate、用户规则保存/解析校验、
 * 扫描预算截断、builtin-15 改写等价性。
 */

// ---------------------------------------------------------------------------
// F4-T1：detectReDoS / isSafeSecurityPattern 负向与正向测试
// ---------------------------------------------------------------------------

const DANGEROUS_PATTERNS: string[] = [
  "(a+)+", // 嵌套量词：无界 × 无界
  "(a*)*",
  "(a+)*",
  "(a*)+",
  "(a|aa)+", // 多重交替加量词：分支长度不同 → 歧义
  "([a-z]+)*",
  "(a?)+", // 嵌套可选加量词
  "(ab?)+",
  "(ab|bc|cd)*", // 多重交替加量词（任务要求覆盖形态）
  "([^\n]+)*",
  "((a+)+)", // 深层嵌套
  "(a{1,3})+", // 无界外量词 × 有界内量词
  "(a{0,100})+",
  "(a+){2}", // 有界外量词 × 无界内量词
  "(a*){3}",
  "(\\d|\\w)+", // 交替分支字符集相交
  "(a|a)+",
  "(a)\\1+", // 反向引用
  "(?<x>a)\\k<x>+",
  "((?:the\\s+)?)+", // 可选分组被外层重复
];

const SAFE_PATTERNS: string[] = [
  "(a|b)+", // 单字符不相交交替 + 量词：线性安全
  "(a|b|c){1,2}",
  "(a|b|c){2,}",
  "(a{2})+", // 定数量词：确定性分块
  "(a|b)?", // 单次出现
  "(a*)?",
  "(?:the\\s+)?", // 单次出现的可选分组
  "(?:sudo\\s+)?",
  "(?:\\.\\w+)?",
  "(?:\\d{1,3}\\.){3}\\d{1,3}\\b", // 有界 × 有界（内建 builtin-24 形态）
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
  // 量词紧跟量词（这些在 JS 下多为编译错误，检测器作编译前兜底）
  assert.ok(detectReDoS("a*+") !== null);
  assert.ok(detectReDoS("a++") !== null);
  assert.ok(detectReDoS("a{2}*") !== null);
  // 反向引用
  assert.ok(detectReDoS("(a)\\1+") !== null);
  assert.ok(detectReDoS("\\k<name>") !== null);
  // 惰性修饰符合法且不触发
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
  assert.equal(isSafeSecurityPattern("a++"), false); // 编译不过
});

// ---------------------------------------------------------------------------
// F4-T2：用户规则校验与持久化解析复用同一 gate
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
// F4-T3：扫描预算截断
// ---------------------------------------------------------------------------

test("scan aborts the dimension on an over-long single line and marks truncated", () => {
  const overLong = "a".repeat(MAX_REGEX_STEPS_PER_RULE_LINE + 1);
  const report = scanSecurityFiles([{ name: "huge.md", content: overLong }]);
  assert.equal(report.truncated, true);
  assert.equal(report.filesScanned, 1);
});

test("scan aborts the dimension when cumulative regex steps exceed the total budget", () => {
  // 100 行 × 100k 字符：单行未超每行预算，但累计估算步进远超总预算
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
// builtin-15 改写等价性（F4-T1 说明：旧规则含 `\s*` 在量化分组内，被 gate
// 判定为嵌套量词；新规则去掉组内量词并把分组重复改为有界 `{4,32}`——后者
// 消除均匀输入上的二次回溯（`\x65` 长行曾使单次 test() 达分钟级），且对
// test() 布尔语义等价：无锚点扫描会在任意窗口找到「4-32 组 + 尾随执行调用」，
// 超长链仍命中。语义在「相邻十六进制链 + 尾随空白/换行 + 60 字符内执行
// 调用」上与旧规则一致）。
// ---------------------------------------------------------------------------

const OLD_BUILTIN_15 =
  "(?:\\\\x[0-9a-f]{2}\\s*){4,}[^\\n]{0,60}?(?:eval|exec|Function\\s*\\()";
const NEW_BUILTIN_15 =
  "(?:\\\\x[0-9a-f]{2}){4,32}\\s*[^\\n]{0,60}?(?:eval|exec|Function\\s*\\()";

test("builtin-15 rewrite keeps the original intent on sample inputs", () => {
  assert.equal(detectReDoS(OLD_BUILTIN_15) !== null, true); // 旧规则确实被拒
  assert.equal(detectReDoS(NEW_BUILTIN_15), null); // 新规则通过 gate

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

  // 文档化的行为差异：十六进制组之间带空白时旧规则命中、新规则不命中
  // （空白间隔的十六进制链极少见；连续链是实际混淆代码的主流形态）
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
