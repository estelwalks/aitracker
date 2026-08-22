import { zh } from "./locales/zh-CN";
import { LOCALES, type Locale } from "./locale";
import type { MessageLeaf, PluralMessage, Translations } from "./schema";
export type { MessageKey, MessageParams, Translations } from "./schema";

/**
 * Typed message layer. The zh dictionary is the single source of truth for
 * keys, shapes and parameter names; en/ja/ko must `satisfies Translations`,
 * so missing/extra keys or placeholder drift fail compilation. Runtime
 * lookups fall back to zh-CN and never throw to the UI.
 */

/** The schema is defined separately so locale dictionaries do not import this resolver. */

const loadedCatalogs: Partial<Record<Locale, Translations>> = {
  "zh-CN": zh,
};

/**
 * Loads only the active UI language. Chinese remains embedded as the safe
 * offline fallback; the other three catalogs become route-independent chunks.
 */
export async function loadCatalog(locale: Locale): Promise<Translations> {
  const cached = loadedCatalogs[locale];
  if (cached) return cached;

  const catalog =
    locale === "en-US"
      ? (await import("./locales/en-US")).en
      : locale === "ja-JP"
        ? (await import("./locales/ja-JP")).ja
        : (await import("./locales/ko-KR")).ko;
  loadedCatalogs[locale] = catalog;
  return catalog;
}

/** Seeds the browser cache with the catalog serialized by the root SSR loader. */
export function primeCatalog(locale: Locale, catalog: Translations): void {
  loadedCatalogs[locale] = catalog;
}

/** Synchronous readers always have a Chinese fallback while a chunk loads. */
export function catalogFor(locale: Locale): Translations {
  return loadedCatalogs[locale] ?? zh;
}

/**
 * Compatibility view for existing synchronous server/domain consumers. Its
 * values resolve from the active cache, never causing every locale to be
 * imported by the initial browser graph.
 */
export const catalogs: Record<Locale, Translations> = new Proxy(
  {} as Record<Locale, Translations>,
  {
    get: (_target, property) =>
      typeof property === "string" &&
      (LOCALES as readonly string[]).includes(property)
        ? catalogFor(property as Locale)
        : undefined,
    ownKeys: () => [...LOCALES],
    getOwnPropertyDescriptor: (_target, property) =>
      typeof property === "string" &&
      (LOCALES as readonly string[]).includes(property)
        ? { configurable: true, enumerable: true }
        : undefined,
  },
);

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
