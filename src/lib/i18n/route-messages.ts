import { LOCALES, type Locale } from "./locale";
import { catalogFor } from "./messages";
import type { Translations } from "./schema";

export type RouteCatalog = Record<string, string>;

/** Flatten a nested locale dictionary into dotted keys (route head keys). */
function flattenRouteCatalog(dictionary: Translations): RouteCatalog {
  const out: RouteCatalog = {};
  const visit = (value: unknown, prefix: string): void => {
    if (typeof value === "string") {
      out[prefix] = value;
      return;
    }
    if (value == null || typeof value !== "object") return;
    // Skip {one, other} plural leaves — route head keys are plain strings.
    if (
      typeof (value as { one?: unknown }).one === "string" &&
      typeof (value as { other?: unknown }).other === "string"
    ) {
      return;
    }
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      visit(childValue, prefix ? `${prefix}.${childKey}` : childKey);
    }
  };
  visit(dictionary, "");
  return out;
}

const routeCatalogCache = new Map<Locale, RouteCatalog>();

function routeCatalogFor(locale: Locale): RouteCatalog {
  const cached = routeCatalogCache.get(locale);
  if (cached !== undefined) return cached;
  const source = catalogFor(locale);
  // Do not cache a zh-CN fallback for a locale whose chunk has not loaded yet;
  // once the real catalog is primed the next access rebuilds and caches it.
  const isFallback = locale !== "zh-CN" && source === catalogFor("zh-CN");
  const catalog = flattenRouteCatalog(source);
  if (!isFallback) routeCatalogCache.set(locale, catalog);
  return catalog;
}

/**
 * Route `head()` catalogs, resolved from the active locale dictionaries
 * (P2-15). SSR: the root loader loads the active locale before route head()
 * runs, so the first frame already carries the right language. Client:
 * hydration primes the catalog. ja-JP/ko-KR therefore render their own
 * language instead of falling back to English, and every locale stays
 * consistent with the `useI18n` catalog — the SSR title equals the hydrated
 * `document.title`. Locale chunks stay lazy (no static import here).
 */
export const catalogs: Record<Locale, RouteCatalog> = new Proxy(
  {} as Record<Locale, RouteCatalog>,
  {
    get: (_target, property) =>
      typeof property === "string" &&
      (LOCALES as readonly string[]).includes(property)
        ? routeCatalogFor(property as Locale)
        : undefined,
    ownKeys: () => [...LOCALES],
    getOwnPropertyDescriptor: (_target, property) =>
      typeof property === "string" &&
      (LOCALES as readonly string[]).includes(property)
        ? { configurable: true, enumerable: true }
        : undefined,
  },
);

export function getMessage(
  catalog: RouteCatalog,
  key: string,
  params?: Record<string, string | number>,
): string {
  const template = catalog[key];
  if (template == null) return key;
  if (params == null) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
