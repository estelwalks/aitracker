/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { createBoundFormatters, type BoundFormatters } from "./format";
import {
  mapSystemCurrency,
  mapSystemLocale,
  normalizeCurrency,
  normalizeLocale,
  type Currency,
  type Locale,
  type PreferenceMode,
  type PreferenceSource,
} from "./locale";
import { zh } from "./locales/zh-CN";
import {
  catalogs,
  getMessage,
  type MessageKey,
  type MessageParams,
} from "./messages";
import { BUILTIN_RATES, formatMoney as pricingFormatMoney } from "../pricing";
import { getRatesSnapshot, type RatesSnapshot } from "../pricing/server-fns";
import { brandParams } from "../app-config";

const LOCALE_STORAGE_KEY = "tt-locale";
const LOCALE_MODE_STORAGE_KEY = "tt-locale-mode";
const CURRENCY_STORAGE_KEY = "tt-display-currency";
const CURRENCY_MODE_STORAGE_KEY = "tt-currency-mode";
const LOCALE_SEARCH_PARAM = "locale";
const CURRENCY_SEARCH_PARAM = "currency";

/**
 * Local preferences are only available after hydration.  Apply them in a
 * layout effect so a browser session does not leave the SSR fallback locale
 * visible while the dashboard's client queries are settling.
 */
const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Route-path → meta title key, used to update `document.title` immediately
 * when the language switches (route `head()` re-runs only on navigation).
 */
const ROUTE_TITLE_KEYS: Array<[string, MessageKey]> = [
  ["/agents", "meta.titles.agents"],
  ["/security", "meta.titles.security"],
  ["/sources", "meta.titles.sources"],
  ["/reports", "meta.titles.reports"],
  ["/distill", "meta.titles.distill"],
  ["/settings", "meta.titles.settings"],
  ["/skills", "meta.titles.skills"],
  ["/", "meta.titles.dashboard"],
];

export interface I18nContextValue {
  locale: Locale;
  localeMode: PreferenceMode;
  localeSource: PreferenceSource;
  /** Switch the language preference: "system" follows the OS, "manual" pins a locale. */
  setLocaleMode: (mode: PreferenceMode, locale?: Locale) => void;
  displayCurrency: Currency;
  currencyMode: PreferenceMode;
  currencySource: PreferenceSource;
  /** Switch the display-currency preference, independent of the language. */
  setCurrencyMode: (mode: PreferenceMode, currency?: Currency) => void;
  /** Latest exchange-rate snapshot (one shared snapshot for all amounts). */
  rates: RatesSnapshot | null;
  ratesLoading: boolean;
  /** Force a network refresh (silent on failure — cache/built-in fallback). */
  refreshRates: () => Promise<void>;
  /** Type-safe lookup; key and params are checked at compile time. */
  t: <K extends MessageKey>(key: K, params?: MessageParams<K>) => string;
  /** Formatters bound to the current locale/currency/rate snapshot. */
  format: BoundFormatters & {
    /** Format a USD amount in the display currency with the shared rate. */
    formatUsd: (amountUsd: number, currency?: Currency) => string;
  };
}

const fallbackT = <K extends MessageKey>(
  key: K,
  params?: MessageParams<K>,
): string =>
  getMessage(zh, key, params as Record<string, string | number> | undefined);

/**
 * Default value uses the zh-CN catalog directly, so `t()` still works outside
 * the provider (e.g. the root `ErrorComponent` boundary) — it degrades to
 * Chinese instead of returning a raw key path.
 */
const I18nContext = createContext<I18nContextValue>({
  locale: "zh-CN",
  localeMode: "system",
  localeSource: "fallback",
  setLocaleMode: () => {},
  displayCurrency: "USD",
  currencyMode: "system",
  currencySource: "fallback",
  setCurrencyMode: () => {},
  rates: null,
  ratesLoading: false,
  refreshRates: async () => {},
  t: fallbackT,
  format: { ...createBoundFormatters("zh-CN"), formatUsd: () => "—" },
});

function readStoredLocale(): Locale | null {
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readStoredCurrency(): Currency | null {
  try {
    return normalizeCurrency(window.localStorage.getItem(CURRENCY_STORAGE_KEY));
  } catch {
    return null;
  }
}

function readStoredMode(key: string): PreferenceMode | null {
  try {
    const value = window.localStorage.getItem(key);
    return value === "system" || value === "manual" ? value : null;
  } catch {
    return null;
  }
}

function persistValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage unavailable — preference is best-effort
  }
}

/** Keep the URL `?locale=`/`?currency=` in sync so reloads/SSR match. */
function updateSearchParams(locale: Locale, currency: Currency): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (url.searchParams.get(LOCALE_SEARCH_PARAM) !== locale) {
    url.searchParams.set(LOCALE_SEARCH_PARAM, locale);
  }
  if (url.searchParams.get(CURRENCY_SEARCH_PARAM) !== currency) {
    url.searchParams.set(CURRENCY_SEARCH_PARAM, currency);
  }
  window.history.replaceState(null, "", url);
}

function titleForPath(locale: Locale, pathname: string): string {
  const match = ROUTE_TITLE_KEYS.find(([prefix]) =>
    pathname.startsWith(prefix),
  );
  return getMessage(
    catalogs[locale],
    match?.[1] ?? "meta.titles.notFound",
    brandParams,
  );
}

function rateFor(rates: RatesSnapshot | null, currency: Currency): number {
  return rates?.rates[currency] ?? BUILTIN_RATES[currency];
}

export interface I18nProviderProps {
  /** Locale resolved by the root route loader (SSR `?locale=` etc.). */
  initialLocale?: Locale;
  /** Display currency resolved by the root route loader (SSR `?currency=`). */
  initialDisplayCurrency?: Currency;
  /** Exchange rates read server-side (cache/built-in) for the first frame. */
  initialRates?: RatesSnapshot | null;
  children: ReactNode;
}

export function I18nProvider({
  initialLocale,
  initialDisplayCurrency,
  initialRates = null,
  children,
}: I18nProviderProps) {
  const [localeMode, setLocaleModeState] = useState<PreferenceMode>(
    () => readStoredMode(LOCALE_MODE_STORAGE_KEY) ?? "system",
  );
  const [manualLocale, setManualLocale] = useState<Locale | null>(() =>
    readStoredLocale(),
  );
  const [currencyMode, setCurrencyModeState] = useState<PreferenceMode>(
    () => readStoredMode(CURRENCY_MODE_STORAGE_KEY) ?? "system",
  );
  const [manualCurrency, setManualCurrency] = useState<Currency | null>(() =>
    readStoredCurrency(),
  );
  const [systemLocale, setSystemLocale] = useState<Locale>(
    () => initialLocale ?? "zh-CN",
  );
  const [rates, setRates] = useState<RatesSnapshot | null>(initialRates);
  const [ratesLoading, setRatesLoading] = useState(false);

  const systemCurrency = mapSystemCurrency(systemLocale);
  const locale =
    localeMode === "manual" ? (manualLocale ?? systemLocale) : systemLocale;
  const displayCurrency =
    currencyMode === "manual"
      ? (manualCurrency ?? systemCurrency)
      : systemCurrency;

  const localeSource: PreferenceSource =
    localeMode === "manual"
      ? "manual"
      : systemLocale === "zh-CN" && initialLocale == null
        ? "fallback"
        : "system";
  const currencySource: PreferenceSource =
    currencyMode === "manual"
      ? "manual"
      : displayCurrency === "USD" && initialDisplayCurrency == null
        ? "fallback"
        : "system";

  const localeRef = useRef(locale);
  const currencyRef = useRef(displayCurrency);
  const converged = useRef(false);

  useEffect(() => {
    localeRef.current = locale;
    currencyRef.current = displayCurrency;
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.title = titleForPath(locale, window.location.pathname);
  }, [locale, displayCurrency]);

  /**
   * Browser development mode: converge the SSR-initial locale/currency to the
   * local preference (localStorage > navigator) once, then mirror both into
   * the URL. In Electron the main process is the single source of truth (it
   * resolved via prefs > system and passed `?locale=&currency=` to SSR), so we
   * never override it here — a stale localStorage mirror must not win.
   */
  useBrowserLayoutEffect(() => {
    if (converged.current) return;
    if (typeof window === "undefined") return;
    if (window.desktopApi) {
      converged.current = true;
      return;
    }
    converged.current = true;
    const storedLocale = readStoredLocale();
    const storedCurrency = readStoredCurrency();
    const storedLocaleMode = readStoredMode(LOCALE_MODE_STORAGE_KEY);
    const storedCurrencyMode = readStoredMode(CURRENCY_MODE_STORAGE_KEY);
    const browserSystemLocale = mapSystemLocale(navigator.language);
    const browserSystemCurrency = mapSystemCurrency(navigator.language);

    let nextLocale = localeRef.current;
    if (storedLocaleMode === "manual" && storedLocale) {
      setManualLocale(storedLocale);
      setLocaleModeState("manual");
      nextLocale = storedLocale;
    } else if (browserSystemLocale !== localeRef.current) {
      setSystemLocale(browserSystemLocale);
      nextLocale = browserSystemLocale;
    }
    let nextCurrency = currencyRef.current;
    if (storedCurrencyMode === "manual" && storedCurrency) {
      setManualCurrency(storedCurrency);
      setCurrencyModeState("manual");
      nextCurrency = storedCurrency;
    } else if (browserSystemCurrency !== currencyRef.current) {
      setSystemLocale(browserSystemLocale);
      nextCurrency = browserSystemCurrency;
    }
    updateSearchParams(nextLocale, nextCurrency);
  }, []);

  /** Main-process initiated changes (tray/menu or future flows). */
  useEffect(() => {
    const api = typeof window !== "undefined" ? window.desktopApi : undefined;
    if (!api?.onPreferencesChanged) return;
    return api.onPreferencesChanged((next) => {
      if (next.locale !== localeRef.current) {
        if (next.localeSource === "manual") {
          setManualLocale(next.locale);
          setLocaleModeState("manual");
        } else {
          setSystemLocale(next.locale);
          setLocaleModeState("system");
        }
      }
      if (next.displayCurrency !== currencyRef.current) {
        if (next.currencySource === "manual") {
          setManualCurrency(next.displayCurrency);
          setCurrencyModeState("manual");
        } else {
          setCurrencyModeState("system");
          setManualCurrency(null);
        }
      }
    });
  }, []);

  /**
   * Startup silent rate read — cache-only (T3-05/T3-11): automatic network
   * refreshes belong to the `exchange.refresh` background task, never to a
   * page-load path. The root loader has already seeded the cache.
   */
  useEffect(() => {
    let cancelled = false;
    void getRatesSnapshot({ data: false })
      .then((snapshot) => {
        if (!cancelled) setRates(snapshot);
      })
      .catch(() => {
        // keep the initial (cache/built-in) rates
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocaleMode = useCallback(
    (mode: PreferenceMode, locale?: Locale) => {
      if (mode === "manual" && locale != null) {
        setManualLocale(locale);
        persistValue(LOCALE_STORAGE_KEY, locale);
      }
      setLocaleModeState(mode);
      persistValue(LOCALE_MODE_STORAGE_KEY, mode);
      updateSearchParams(
        mode === "manual" ? (locale ?? systemLocale) : systemLocale,
        currencyRef.current,
      );
      if (typeof window !== "undefined" && window.desktopApi) {
        void window.desktopApi.setLocaleMode(mode, locale).catch(() => {});
      }
    },
    [systemLocale],
  );

  const setCurrencyMode = useCallback(
    (mode: PreferenceMode, currency?: Currency) => {
      if (mode === "manual" && currency != null) {
        setManualCurrency(currency);
        persistValue(CURRENCY_STORAGE_KEY, currency);
      } else if (mode === "system") {
        setManualCurrency(null);
      }
      setCurrencyModeState(mode);
      persistValue(CURRENCY_MODE_STORAGE_KEY, mode);
      updateSearchParams(
        localeRef.current,
        mode === "manual"
          ? (currency ?? mapSystemCurrency(systemLocale))
          : mapSystemCurrency(systemLocale),
      );
      if (typeof window !== "undefined" && window.desktopApi) {
        void window.desktopApi.setCurrencyMode(mode, currency).catch(() => {});
      }
    },
    [systemLocale],
  );

  const refreshRates = useCallback(async () => {
    setRatesLoading(true);
    try {
      // T3-11: the manual refresh goes through the unified `exchange.refresh`
      // task (single-flight, policy timeout, run record) and waits for it.
      const { refreshExchangeRates } = await import("../pricing/server-fns");
      const snapshot = await refreshExchangeRates();
      setRates(snapshot);
    } finally {
      setRatesLoading(false);
    }
  }, []);

  const t = useCallback(
    <K extends MessageKey>(key: K, params?: MessageParams<K>): string =>
      getMessage(
        catalogs[locale],
        key,
        params as Record<string, string | number> | undefined,
      ),
    [locale],
  );

  const format = useMemo(() => {
    const bound = createBoundFormatters(locale);
    return {
      ...bound,
      formatUsd: (amountUsd: number, currency: Currency = displayCurrency) =>
        pricingFormatMoney(
          locale,
          amountUsd,
          currency,
          rateFor(rates, currency),
        ),
    };
  }, [locale, displayCurrency, rates]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      localeMode,
      localeSource,
      setLocaleMode,
      displayCurrency,
      currencyMode,
      currencySource,
      setCurrencyMode,
      rates,
      ratesLoading,
      refreshRates,
      t,
      format,
    }),
    [
      locale,
      localeMode,
      localeSource,
      setLocaleMode,
      displayCurrency,
      currencyMode,
      currencySource,
      setCurrencyMode,
      rates,
      ratesLoading,
      refreshRates,
      t,
      format,
    ],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
