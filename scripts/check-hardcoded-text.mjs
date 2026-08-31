#!/usr/bin/env node
/**
 * Block new hardcoded Chinese UI strings in routes/components/module
 * presentation layers (I18N-003-3).
 *
 * Strategy: scan `src/routes/**`, `src/components/**` and the presentation
 * sub-directories of every feature module (e.g. `src/modules/feature/
 * presentation`, `src/modules/feature/query/presentation`) for CJK characters
 * inside string literals / JSX text. False-positive guards:
 *   - comments (`//`, `/* * /`, `/** * /`) are stripped before scanning;
 *   - backtick template literals (generated artifacts/document templates) are
 *     treated as data — UI copy must use t("…") or JSX text;
 *   - whitelisted files (data-bearing modules with untranslated values) are skipped;
 *   - whitelisted patterns (tool names, product names, tech terms) pass;
 *   - Chinese inside an existing `t("…")` call is fine (it's the zh-CN
 *     dictionary source — but dictionaries live in src/lib/i18n/locales,
 *     which is not scanned).
 *
 * English UI literals are intentionally NOT flagged (commands/fields/log
 * fields are too noisy) — key parity is guarded by `satisfies Translations`
 * and human review.
 *
 * Run via `npm run check:i18n` or directly: node scripts/check-hardcoded-text.mjs [--report]
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const reportOnly = process.argv.includes("--report");

// Files whose Chinese values are data (rule names/kinds, statuses) per the
// "No translation" principle — display labels map through the dictionaries instead.
const WHITELISTED_FILES = new Set([
  // Security rule name/kind remains in Chinese (scanning rule identifiers are not translated)
  "src/routes/security.tsx", // Retain: rules data is displayed directly; the rest of the copy should be migrated
]);

// Pass-through phrases (tool names, tech terms, punctuation). The app's own
// product name is intentionally absent — it must come from app-config.
const WHITELIST_PATTERNS = [
  "Claude Code",
  "Codex",
  "Aipy",
  "WorkBuddy",
  "Gemini CLI",
  "Kimi Code",
  "Grok",
  "Copilot",
  "Cline",
  "Roo Code",
  "Token",
  "Skill",
  "README",
  "SKILL.md",
  "CSV",
  "JSON",
  "——",
  "—",
];

/**
 * "Chinese is data" value - according to the document principle (the original value remains unchanged, the display layer is translated through label mapping),
 * These strings are retained in Chinese as data values/comparison keys and will not be migrated to the UI.
 * When adding such data values, they must be registered here and equipped with label mapping.
 */
const DATA_VALUES = [
  "通用",
  "外观",
  "关于",
  "正在读取",
  "桌面端可用",
  "正在保存",
  "浏览器不可用",
  "系统不支持",
  "读取失败",
  "空闲",
  "扫描中",
  "已完成",
  "全部",
  "安全",
  "可疑",
  "危险",
  "高危",
  "中危",
  "低危",
  "内置规则",
  "用户规则",
  // The source tag of the distillation product package generation template (generated Skill file content, not UI copywriting)
  "近期素材",
];

const CJK_RE = /[一-鿿぀-ヿ가-힯]/;

function stripComments(source) {
  // Block-comment opener must not be preceded by a word character — a `/*`
  // inside a string/template (e.g. generated content like `scripts/*`) is not
  // a comment start, and matching it would swallow the rest of the file.
  return source
    .replace(/(^|[^A-Za-z0-9_])\/\*[\s\S]*?\*\//g, "$1")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

/** label mapping line: Chinese value is used as object key, value is dictionary key (such as high risk: "security.severity.high") */
const LABEL_MAP_LINE_RE =
  /^\s*["'“”]?[一-鿿぀-ヿ가-힯]+["'“”]?\s*:\s*["'][a-z][\w.]*["'],?\s*$/;

/** Data value comparison/assignment/union type declaration line (such as category === "general", type X = "safe" | ...) */
function isDataValueLine(line) {
  const quoted = [
    ...line.matchAll(/["']([^"']*[一-鿿぀-ヿ가-힯][^"']*)["']/g),
  ].map((m) => m[1]);
  return quoted.length > 0 && quoted.every((v) => DATA_VALUES.includes(v));
}

function listFiles() {
  // Node-native recursive walk — cross-platform. The previous `find -name`
  // approach relied on a Unix shell that is not available on Windows, where
  // Git Bash's find.exe mangles the `*.tsx` glob (MSYS argument conversion).
  const files = [];
  for (const dir of ["src/routes", "src/components", "src/modules"]) {
    let entries;
    try {
      entries = readdirSync(join(root, dir), {
        recursive: true,
        encoding: "utf8",
      });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.endsWith(".tsx") || entry.endsWith(".ts")) {
        files.push(`${dir}/${entry.replaceAll("\\", "/")}`);
      }
    }
  }
  return files.filter((f) => {
    if (f.endsWith(".test.ts") || f.endsWith(".test.tsx")) return false;
    // Feature modules are only scanned at their presentation layer
    // (`src/modules/*/presentation`, `src/modules/*/query/presentation`, …).
    // Application/domain layers may legitimately hold CJK data values.
    if (f.startsWith("src/modules/")) {
      return f.split("/").includes("presentation");
    }
    return true;
  });
}

const violations = [];
for (const file of listFiles()) {
  if (WHITELISTED_FILES.has(file)) continue;
  const source = stripComments(readFileSync(join(root, file), "utf8"));
  const lines = source.split("\n");
  // Backtick template literals carry generated artifacts / document templates
  // (e.g. distilled Skill pack files). Their CJK content is product data, not
  // UI copy — UI strings must use t("…") or JSX text. Track a depth counter so
  // multi-line (and nested) templates are skipped as data.
  let templateDepth = 0;
  lines.forEach((line, index) => {
    // Only unescaped backticks open/close a template literal (generated
    // content embeds escaped `` \` `` markers).
    const backticks = (line.match(/(?<!\\)`/g) ?? []).length;
    const lineStartsInsideTemplate = templateDepth > 0;
    const lineOpensTemplate = templateDepth === 0 && backticks > 0;
    // Odd unescaped backtick count toggles one open/close boundary.
    if (backticks % 2 === 1) {
      templateDepth += templateDepth === 0 ? 1 : -1;
    }
    if (lineStartsInsideTemplate || lineOpensTemplate) return;
    if (!CJK_RE.test(line)) return;
    // Migrated rows: t("...") or t( cross-row calls and dictionary key references are not violations.
    if (/\bt\(\s*["']/.test(line)) return;
    if (LABEL_MAP_LINE_RE.test(line)) return;
    if (isDataValueLine(line)) return;
    const visible = line.replace(/^[\s]*/, "").slice(0, 120);
    violations.push(`${file}:${index + 1}: ${visible}`);
  });
}

if (violations.length) {
  console.error(
    `check-hardcoded-text: ${violations.length} possibly unmigrated CJK UI string(s) found\n`,
  );
  for (const v of violations.slice(0, 40)) console.error(`  ✖ ${v}`);
  if (violations.length > 40) {
    console.error(`  … ${violations.length - 40} more (truncated)`);
  }
  if (reportOnly) {
    console.error(
      "\n(report-only mode — no failure; whitelist in scripts/check-hardcoded-text.mjs)",
    );
    process.exit(0);
  }
  process.exit(1);
}

console.log(
  "check-hardcoded-text: no hardcoded CJK UI text in routes/components",
);
