import { zh } from "./locales/zh-CN";
import { en } from "./locales/en-US";
import { ja } from "./locales/ja-JP";
import { ko } from "./locales/ko-KR";
import type { Locale } from "./locale";
import type { MessageLeaf, PluralMessage, Translations } from "./schema";
export type { MessageKey, MessageParams, Translations } from "./schema";

/**
 * Typed message layer. The zh dictionary is the single source of truth for
 * keys, shapes and parameter names; en/ja/ko must `satisfies Translations`,
 * so missing/extra keys or placeholder drift fail compilation. Runtime
 * lookups fall back to zh-CN and never throw to the UI.
 */

/** The schema is defined separately so locale dictionaries do not import this resolver. */

export const catalogs: Record<Locale, Translations> = {
  "zh-CN": zh,
  "en-US": en,
  "ja-JP": ja,
  "ko-KR": ko,
};

function atPath(catalog: Translations, key: string): MessageLeaf | undefined {
  const value = key.split(".").reduce<unknown>((acc, part) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[part];
  }, catalog);
  return typeof value === "string" || isPluralMessage(value)
    ? (value as MessageLeaf)
    : undefined;
}

function isPluralMessage(value: unknown): value is PluralMessage {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as PluralMessage).one === "string" &&
    typeof (value as PluralMessage).other === "string"
  );
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (params == null) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function resolveLeaf(
  leaf: MessageLeaf,
  params?: Record<string, string | number>,
): string {
  if (typeof leaf === "string") return interpolate(leaf, params);
  // Plural form: only en-US dictionaries use {one, other} leaves.
  return interpolate(params?.count === 1 ? leaf.one : leaf.other, params);
}

/**
 * Resolve a message for the current catalog. Missing keys log an error and
 * fall back to zh-CN; a key missing even from zh returns the key path itself
 * (never throws into the UI).
 */
export function getMessage(
  catalog: Translations,
  key: string,
  params?: Record<string, string | number>,
): string {
  const leaf = atPath(catalog, key);
  if (leaf != null) return resolveLeaf(leaf, params);

  const zhLeaf = atPath(zh, key);
  if (zhLeaf == null) {
    console.error(`[i18n] missing translation key in zh-CN: ${key}`);
    return key;
  }
  console.error(
    `[i18n] missing translation for current locale, falling back to zh-CN: ${key}`,
  );
  return resolveLeaf(zhLeaf, params);
}
