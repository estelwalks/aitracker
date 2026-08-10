/**
 * Locale identity, system-language mapping and resolution priority.
 *
 * Priority (per the docs/plan task list): explicit user choice
 * > system language > zh-CN fallback. Unknown locales always fall back to
 * zh-CN. Pure functions, no runtime dependencies — shared by the renderer
 * (browser/dev) and testable in isolation.
 */

export const LOCALES = ["zh-CN", "en-US", "ja-JP", "ko-KR"] as const;

export type Locale = (typeof LOCALES)[number];

/** Exact-match a raw value against the four supported locales. */
export function normalizeLocale(raw: string | null | undefined): Locale | null {
  if (raw == null) return null;
  return (LOCALES as readonly string[]).includes(raw) ? (raw as Locale) : null;
}

/**
 * Display currencies (docs/plan v1.2). USD is the internal pricing baseline;
 * the other three are user-selectable display currencies.
 */
export const CURRENCIES = ["CNY", "USD", "JPY", "KRW"] as const;

export type Currency = (typeof CURRENCIES)[number];

/** Each preference can either follow the system or be pinned manually. */
export type PreferenceMode = "system" | "manual";

/** Where a resolved value came from — surfaced in the settings page. */
export type PreferenceSource = "system" | "manual" | "fallback";

/** Exact-match a raw value against the four display currencies. */
export function normalizeCurrency(raw: unknown): Currency | null {
  return typeof raw === "string" &&
    (CURRENCIES as readonly string[]).includes(raw)
    ? (raw as Currency)
    : null;
}

/**
 * Map a system locale's region to a display currency (v1.2: 货币跟随系统以
 * locale 地区为权威映射). Unmapped regions safely fall back to USD.
 */
export function mapSystemCurrency(raw: string | null | undefined): Currency {
  if (raw == null) return "USD";
  const primary = raw.toLowerCase().split(/[-_]/)[0];
  switch (primary) {
    case "zh":
      return "CNY";
    case "ja":
      return "JPY";
    case "ko":
      return "KRW";
    case "en":
      return "USD";
    default:
      return "USD";
  }
}

/**
 * Resolve the display currency from a route's parsed search params
 * (`?currency=`), falling back to the locale-derived default.
 */
export function resolveCurrencyFromSearch(
  search: Record<string, unknown>,
  fallback: Currency,
): Currency {
  return normalizeCurrency(search.currency) ?? fallback;
}

/**
 * Map an OS/browser language tag to a supported locale. Accepts both
 * `app.getLocale()`-style tags ("zh-CN", "en-US", "ja") and full BCP-47
 * tags ("zh-Hans-CN", "en-GB"). Matches on the primary language subtag;
 * anything unknown falls back to zh-CN.
 */
export function mapSystemLocale(raw: string | null | undefined): Locale {
  if (raw == null) return "zh-CN";
  const primary = raw.toLowerCase().split(/[-_]/)[0];
  switch (primary) {
    case "zh":
      return "zh-CN";
    case "en":
      return "en-US";
    case "ja":
      return "ja-JP";
    case "ko":
      return "ko-KR";
    default:
      return "zh-CN";
  }
}

/** User preference wins when present; otherwise the resolved system locale. */
export function resolveLocale(
  preference: Locale | null | undefined,
  system: Locale,
): Locale {
  return preference ?? system;
}

/**
 * Validate a `?locale=` URL parameter. Unknown or malformed values return
 * null (the caller falls back to system/zh-CN) — the parameter only ever
 * controls display language, never data.
 */
export function resolveLocaleFromSearchParam(raw: unknown): Locale | null {
  return typeof raw === "string" ? normalizeLocale(raw) : null;
}

/**
 * Resolve the locale from a route's parsed search params. Route loaders
 * receive `location.search` typed `{}` when no search schema is declared, so
 * this narrows the record once and falls back to zh-CN.
 */
export function resolveLocaleFromSearch(
  search: Record<string, unknown>,
): Locale {
  return resolveLocaleFromSearchParam(search.locale) ?? "zh-CN";
}
