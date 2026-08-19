import assert from "node:assert/strict";
import test from "node:test";
import { catalogs, getMessage } from "../../../lib/i18n/messages.ts";
import type { Translations } from "../../../lib/i18n/schema.ts";
import { INSIGHT_SURFACE_IDS } from "./contracts.ts";
import { PAGE_RULE_IDS } from "./rule-ids.ts";

const CATALOGS: readonly { locale: string; catalog: Translations }[] = [
  { locale: "zh-CN", catalog: catalogs["zh-CN"] },
  { locale: "en-US", catalog: catalogs["en-US"] },
  { locale: "ja-JP", catalog: catalogs["ja-JP"] },
  { locale: "ko-KR", catalog: catalogs["ko-KR"] },
];

function lookupLeaf(catalog: unknown, key: string): string | null {
  let current: unknown = catalog;
  for (const part of key.split(".")) {
    if (current == null || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === "string") return current;
  if (current != null && typeof current === "object") {
    const plural = current as { one?: unknown };
    if (typeof plural.one === "string") return plural.one;
  }
  return null;
}

test("every surface declares at least one rule id", () => {
  for (const surface of INSIGHT_SURFACE_IDS) {
    assert.ok(PAGE_RULE_IDS[surface].length >= 1, surface);
  }
});

test("every rule fact key resolves in zh-CN via getMessage", () => {
  for (const surface of INSIGHT_SURFACE_IDS) {
    for (const id of PAGE_RULE_IDS[surface]) {
      const key = `insights.page.${surface}.${id}`;
      assert.notEqual(
        getMessage(catalogs["zh-CN"], key),
        key,
        `zh-CN missing: ${key}`,
      );
    }
  }
});

test("every rule fact key exists in en/ja/ko dictionaries (no fallback)", () => {
  for (const surface of INSIGHT_SURFACE_IDS) {
    for (const id of PAGE_RULE_IDS[surface]) {
      const key = `insights.page.${surface}.${id}`;
      for (const { locale, catalog } of CATALOGS) {
        const leaf = lookupLeaf(catalog, key);
        assert.ok(
          leaf !== null && leaf.length > 0,
          `${locale} missing: ${key}`,
        );
      }
    }
  }
});
