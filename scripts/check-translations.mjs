#!/usr/bin/env node
/**
 * Runtime dictionary completeness check (runs under tsx so it can import the
 * TS locale modules):
 *
 *   1. key sets identical across zh-CN / en-US / ja-JP / ko-KR
 *   2. `{var}` placeholder sets identical per key (translation must not drop
 *      or invent parameters — `satisfies` cannot catch this)
 *   3. no empty / whitespace-only values
 *   4. reports ja-JP / ko-KR "AI 翻译稿待审校" markers (informational — human
 *      review is the release gate, not this script)
 *
 * Run via `npm run check:i18n` or directly: node --import tsx scripts/check-translations.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { catalogs } = await import("../src/lib/i18n/messages.ts");

const LOCALES = ["zh-CN", "en-US", "ja-JP", "ko-KR"];

function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value != null && typeof value === "object") {
      const isPlural =
        typeof value.one === "string" && typeof value.other === "string";
      if (isPlural) out[path] = value;
      else Object.assign(out, flatten(value, path));
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

function textOf(leaf) {
  return typeof leaf === "string" ? leaf : `${leaf.one}${leaf.other}`;
}

function placeholders(text) {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

const failures = [];
const zh = flatten(catalogs["zh-CN"]);
const zhKeys = Object.keys(zh).sort();

for (const locale of LOCALES) {
  const flat = flatten(catalogs[locale]);
  const keys = Object.keys(flat).sort();
  if (JSON.stringify(keys) !== JSON.stringify(zhKeys)) {
    const missing = zhKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !zhKeys.includes(k));
    failures.push(
      `${locale}: key 集合不一致 (缺少 ${missing.length}: ${missing.slice(0, 5).join(", ")}; 多余 ${extra.length}: ${extra.slice(0, 5).join(", ")})`,
    );
  }
  for (const [key, value] of Object.entries(flat)) {
    const text = textOf(value);
    if (text.trim().length === 0) {
      failures.push(`${locale}: key "${key}" 为空字符串`);
    }
    const got = placeholders(text);
    const expected = placeholders(textOf(zh[key]));
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(
        `${locale}: key "${key}" 占位符不一致 (期望 {${expected.join(", ")}}, 实际 {${got.join(", ")}})`,
      );
    }
  }
}

// 审校标记检查:ja/ko 字典文件头应保留 "待审校" 注释直到人工审校完成。
let unreviewed = 0;
for (const locale of ["ja-JP", "ko-KR"]) {
  const dir = join(root, "src/lib/i18n/locales", locale);
  const files = readFileSync(join(dir, "index.ts"), "utf8");
  if (
    files.includes("待审校") ||
    files.includes("審校待ち") ||
    files.includes("검토 대기")
  ) {
    unreviewed += 1;
  }
}

if (failures.length) {
  console.error("check-translations: 字典完整性问题\n");
  for (const f of failures) console.error(`  ✖ ${f}`);
  process.exit(1);
}

console.log(
  `check-translations: 四语言 ${zhKeys.length} 个 key 一致,占位符/空值校验通过`,
);
if (unreviewed > 0) {
  console.warn(
    `  ⚠ 尚有 ${unreviewed}/2 个语言包标注"待审校"(ja-JP/ko-KR AI 翻译稿) — 发布前须人工审校并清除标记`,
  );
}
