#!/usr/bin/env node
/**
 * Runtime dictionary completeness check (runs under tsx so it can import the
 * TS locale modules):
 *
 *   1. key sets identical across zh-CN / en-US / ja-JP / ko-KR
 *   2. `{var}` placeholder sets identical per key (translation must not drop
 *      or invent parameters — `satisfies` cannot catch this)
 *   3. no empty / whitespace-only values
 * Run via `npm run check:i18n` or directly: node --import tsx scripts/check-translations.mjs
 */
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
      `${locale}: key-set mismatch (missing ${missing.length}: ${missing.slice(0, 5).join(", ")}; extra ${extra.length}: ${extra.slice(0, 5).join(", ")})`,
    );
  }
  for (const [key, value] of Object.entries(flat)) {
    const text = textOf(value);
    if (text.trim().length === 0) {
      failures.push(`${locale}: key "${key}" is empty`);
    }
    const got = placeholders(text);
    const expected = placeholders(textOf(zh[key]));
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failures.push(
        `${locale}: key "${key}" placeholder mismatch (expected {${expected.join(", ")}}, got {${got.join(", ")}})`,
      );
    }
  }
}

if (failures.length) {
  console.error("check-translations: dictionary completeness issues\n");
  for (const f of failures) console.error(`  ✖ ${f}`);
  process.exit(1);
}

console.log(
  `check-translations: ${zhKeys.length} keys consistent across all locales; placeholder/empty checks passed`,
);
