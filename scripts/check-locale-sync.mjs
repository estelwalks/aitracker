#!/usr/bin/env node
/**
 * Guard that the four-locale union stays in sync across the tsconfig boundary:
 *
 *   src/lib/i18n/locale.ts      — renderer (LOCALES array)
 *   electron/contracts.ts       — IPC contract (DesktopLocale union)
 *   electron/i18n.ts            — main-process catalog (DESKTOP_LOCALES array)
 *
 * The electron and app tsconfigs cannot safely cross-import, so this script
 * textually extracts each declaration and compares them. Run via
 * `npm run check:i18n` (or directly: node scripts/check-locale-sync.mjs).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Extract `"zh-CN" | "en-US" | ...` style string literals from a fragment. */
function extractLocales(text, regex) {
  const matches = text.match(regex);
  if (!matches) return null;
  const literals = [...matches[0].matchAll(/["']([\w-]+)["']/g)].map(
    (m) => m[1],
  );
  return literals.length ? literals : null;
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const src = read("src/lib/i18n/locale.ts");
const contracts = read("electron/contracts.ts");
const electron = read("electron/i18n.ts");

const rendererLocales = extractLocales(src, /LOCALES = \[[^\]]*\] as const/);
const contractLocales = extractLocales(
  contracts,
  /type DesktopLocale = ["'][\w-]+["']( \| ["'][\w-]+["'])+;/,
);
const desktopLocales = extractLocales(
  electron,
  /DESKTOP_LOCALES: readonly DesktopLocale\[\] = \[[^\]]*\]/,
);
const rendererCurrencies = extractLocales(
  src,
  /CURRENCIES = \[[^\]]*\] as const/,
);
const contractCurrencies = extractLocales(
  contracts,
  /type DesktopCurrency = ["'][\w-]+["']( \| ["'][\w-]+["'])+;/,
);
const desktopCurrencies = extractLocales(
  electron,
  /DESKTOP_CURRENCIES: readonly DesktopCurrency\[\] = \[[^\]]*\]/,
);

const expectedLocales = ["zh-CN", "en-US", "ja-JP", "ko-KR"];
const expectedCurrencies = ["CNY", "USD", "JPY", "KRW"];
const failures = [];

for (const [name, got, expected] of [
  ["src/lib/i18n/locale.ts (LOCALES)", rendererLocales, expectedLocales],
  ["electron/contracts.ts (DesktopLocale)", contractLocales, expectedLocales],
  ["electron/i18n.ts (DESKTOP_LOCALES)", desktopLocales, expectedLocales],
  [
    "src/lib/i18n/locale.ts (CURRENCIES)",
    rendererCurrencies,
    expectedCurrencies,
  ],
  [
    "electron/contracts.ts (DesktopCurrency)",
    contractCurrencies,
    expectedCurrencies,
  ],
  [
    "electron/i18n.ts (DESKTOP_CURRENCIES)",
    desktopCurrencies,
    expectedCurrencies,
  ],
]) {
  if (!got) {
    failures.push(`${name}: unable to extract declaration`);
  } else if (JSON.stringify(got) !== JSON.stringify(expected)) {
    failures.push(
      `${name}: ${got.join(", ")} ≠ expected ${expected.join(", ")}`,
    );
  }
}

if (failures.length) {
  console.error(
    "check-locale-sync: locale/currency declarations out of sync\n",
  );
  for (const f of failures) console.error(`  ✖ ${f}`);
  console.error(
    "\nAdding a locale/currency requires updating all declarations (renderer/contracts/main-process catalog) together.",
  );
  process.exit(1);
}

console.log(
  "check-locale-sync: locale/currency declarations in sync (zh-CN/en-US/ja-JP/ko-KR × CNY/USD/JPY/KRW)",
);
