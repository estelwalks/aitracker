import { zh } from "./locales/zh-CN";
import { en } from "./locales/en-US";
import { ja } from "./locales/ja-JP";
import { ko } from "./locales/ko-KR";
import type { Locale } from "./locale";

/**
 * Typed message layer. The zh dictionary is the single source of truth for
 * keys, shapes and parameter names; en/ja/ko must `satisfies Translations`,
 * so missing/extra keys or placeholder drift fail compilation. Runtime
 * lookups fall back to zh-CN and never throw to the UI.
 */

export type PluralMessage = { one: string; other: string };
export type MessageLeaf = string | PluralMessage;

type DeepWiden<T> = T extends string
  ? string
  : T extends PluralMessage
    ? { one: string; other: string }
    : T extends readonly unknown[]
      ? { [K in keyof T]: DeepWiden<T[K]> }
      : T extends object
        ? { [K in keyof T]: DeepWiden<T[K]> }
        : T;

/** Widened zh shape — the constraint applied to every other locale. */
export type Translations = DeepWiden<typeof zh>;

/** Dot-path union of all translation keys, e.g. "settings.languages.zhCN". */
export type MessageKey = Paths<typeof zh>;

type Paths<T, P extends string = ""> = {
  [K in keyof T]: T[K] extends MessageLeaf
    ? `${P}${K & string}`
    : Paths<T[K], `${P}${K & string}.`>;
}[keyof T];

/** Look up the leaf type at a dot path. */
type At<T, K extends string> = K extends `${infer Head}.${infer Tail}`
  ? Head extends keyof T
    ? At<T[Head], Tail>
    : never
  : K extends keyof T
    ? T[K]
    : never;

/** Extract `{name}` placeholders from a zh literal. */
type Placeholders<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;

/**
 * Parameter object required for a key. Derived from the zh literal, so a key
 * without placeholders accepts no params (`undefined`).
 */
export type MessageParams<K extends MessageKey> = [
  Placeholders<At<typeof zh, K>>,
] extends [never]
  ? undefined
  : Record<Placeholders<At<typeof zh, K>>, string | number>;

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
