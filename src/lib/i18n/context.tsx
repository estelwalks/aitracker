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
import {
  catalogFor,
  getMessage,
  loadCatalog,
  primeCatalog,
  type MessageKey,
  type MessageParams,
  type Translations,
} from "./messages";
import {
  applyDesktopLocaleEvent,
  applyDesktopPreferences,
  type DesktopI18nState,
} from "./desktop-sync";
import { BUILTIN_RATES, formatMoney as pricingFormatMoney } from "../pricing";
import { getRatesSnapshot, type RatesSnapshot } from "../pricing/server-fns";
import { brandParams } from "../app-config";
import { STORAGE_KEY_PREFIX } from "../app-config";
import { listPreferences, setPreference } from "../preferences/client.ts";

const LOCALE_STORAGE_KEY = `${STORAGE_KEY_PREFIX}locale`;
const LOCALE_MODE_STORAGE_KEY = `${STORAGE_KEY_PREFIX}localeMode`;
const CURRENCY_STORAGE_KEY = `${STORAGE_KEY_PREFIX}displayCurrency`;
const CURRENCY_MODE_STORAGE_KEY = `${STORAGE_KEY_PREFIX}currencyMode`;
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
  /**
   * Switch the display-currency preference. A language change synchronizes
   * the currency to its matching locale; a later manual currency choice stays
   * independent until the next language change.
   */
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
  getMessage(
    catalogFor("zh-CN"),
    key,
    params as Record<string, string | number> | undefined,
  );

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

function storedMode(value: unknown): PreferenceMode | null {
  return value === "system" || value === "manual" ? value : null;
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

function titleForPath(catalog: Translations, pathname: string): string {
  const match = ROUTE_TITLE_KEYS.find(([prefix]) =>
    pathname.startsWith(prefix),
  );
  return getMessage(catalog, match?.[1] ?? "meta.titles.notFound", brandParams);
}

function rateFor(rates: RatesSnapshot | null, currency: Currency): number {
  return rates?.rates[currency] ?? BUILTIN_RATES[currency];
}

export interface I18nProviderProps {
  /** Locale resolved by the root route loader (SSR `?locale=` etc.). */
  initialLocale?: Locale;
  /** Active catalog serialized by the root loader; never all language packs. */
  initialCatalog?: Translations;
  /** Display currency resolved by the root route loader (SSR `?currency=`). */
  initialDisplayCurrency?: Currency;
  /** Exchange rates read server-side (cache/built-in) for the first frame. */
  initialRates?: RatesSnapshot | null;
  children: ReactNode;
}

export function I18nProvider({
  initialLocale,
  initialCatalog,
  initialDisplayCurrency,
  initialRates = null,
  children,
}: I18nProviderProps) {
  const [localeMode, setLocaleModeState] = useState<PreferenceMode>("system");
  const [manualLocale, setManualLocale] = useState<Locale | null>(null);
  const [currencyMode, setCurrencyModeState] =
    useState<PreferenceMode>("system");
  const [manualCurrency, setManualCurrency] = useState<Currency | null>(null);
  const [systemLocale, setSystemLocale] = useState<Locale>(
    () => initialLocale ?? "zh-CN",
  );
  const [catalog, setCatalog] = useState<Translations>(() => {
    const locale = initialLocale ?? "zh-CN";
    if (initialCatalog) primeCatalog(locale, initialCatalog);
    return initialCatalog ?? catalogFor(locale);
  });
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
  const desktopI18nStateRef = useRef<DesktopI18nState>({
    localeMode,
    manualLocale,
    systemLocale,
    currencyMode,
    manualCurrency,
    systemCurrency,
  });

  useEffect(() => {
    desktopI18nStateRef.current = {
      localeMode,
      manualLocale,
      systemLocale,
      currencyMode,
      manualCurrency,
      systemCurrency,
    };
  }, [
    currencyMode,
    manualCurrency,
    manualLocale,
    localeMode,
    systemCurrency,
    systemLocale,
  ]);

  useEffect(() => {
    localeRef.current = locale;
    currencyRef.current = displayCurrency;
    if (typeof document === "undefined") return;
    document.documentElement.lang = locale;
    document.title = titleForPath(catalog, window.location.pathname);
  }, [catalog, locale, displayCurrency]);

  useEffect(() => {
    let active = true;
    void loadCatalog(locale)
      .then((nextCatalog) => {
        if (active) setCatalog(nextCatalog);
      })
      .catch(() => {
        if (active) setCatalog(catalogFor("zh-CN"));
      });
    return () => {
      active = false;
    };
  }, [locale]);

  /**
   * Converge the SSR values to SQLite preferences once. The same server-owned
   * preference repository is used in browser development and Electron.
   */
  useBrowserLayoutEffect(() => {
    if (converged.current) return;
    if (typeof window === "undefined") return;
    converged.current = true;
    void listPreferences().then((preferences) => {
      const localeValue = preferences[LOCALE_STORAGE_KEY];
      const currencyValue = preferences[CURRENCY_STORAGE_KEY];
      const manualStoredLocale = normalizeLocale(
        typeof localeValue === "string" ? localeValue : null,
      );
      const manualStoredCurrency = normalizeCurrency(
        typeof currencyValue === "string" ? currencyValue : null,
      );
      const storedLocaleMode = storedMode(preferences[LOCALE_MODE_STORAGE_KEY]);
      const storedCurrencyMode = storedMode(
        preferences[CURRENCY_MODE_STORAGE_KEY],
      );
      const browserSystemLocale = mapSystemLocale(navigator.language);
      const browserSystemCurrency = mapSystemCurrency(navigator.language);
      let nextLocale = browserSystemLocale;
      if (storedLocaleMode === "manual" && manualStoredLocale) {
        setManualLocale(manualStoredLocale);
        setLocaleModeState("manual");
        nextLocale = manualStoredLocale;
      } else {
        setSystemLocale(browserSystemLocale);
      }
      let nextCurrency = browserSystemCurrency;
      if (storedCurrencyMode === "manual" && manualStoredCurrency) {
        setManualCurrency(manualStoredCurrency);
        setCurrencyModeState("manual");
        nextCurrency = manualStoredCurrency;
      }
      updateSearchParams(nextLocale, nextCurrency);
    });
  }, []);

  /** Electron main is the preference authority for desktop renderers. */
  useEffect(() => {
    const desktop =
      typeof window === "undefined" ? undefined : window.desktopApi;
    if (!desktop) return;

    const commit = (next: DesktopI18nState) => {
      desktopI18nStateRef.current = next;
      setLocaleModeState(next.localeMode);
      setManualLocale(next.manualLocale);
      setSystemLocale(next.systemLocale);
      setCurrencyModeState(next.currencyMode);
      setManualCurrency(next.manualCurrency);
      const nextLocale =
        next.localeMode === "manual"
          ? (next.manualLocale ?? next.systemLocale)
          : next.systemLocale;
      const nextCurrency =
        next.currencyMode === "manual"
          ? (next.manualCurrency ?? next.systemCurrency)
          : next.systemCurrency;
      localeRef.current = nextLocale;
      currencyRef.current = nextCurrency;
      updateSearchParams(nextLocale, nextCurrency);
    };

    const unsubscribeLocale = desktop.onLocaleChanged((rawLocale) => {
      const nextLocale = normalizeLocale(rawLocale);
      if (!nextLocale) return;
      commit(applyDesktopLocaleEvent(desktopI18nStateRef.current, nextLocale));
    });
    const unsubscribePreferences = desktop.onPreferencesChanged((snapshot) => {
      const nextLocale = normalizeLocale(snapshot.locale);
      const nextCurrency = normalizeCurrency(snapshot.displayCurrency);
      if (!nextLocale || !nextCurrency) return;
      commit(
        applyDesktopPreferences(desktopI18nStateRef.current, {
          locale: nextLocale,
          localeSource: snapshot.localeSource,
          displayCurrency: nextCurrency,
          currencySource: snapshot.currencySource,
        }),
      );
    });

    return () => {
      unsubscribeLocale();
      unsubscribePreferences();
    };
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
      const nextLocale =
        mode === "manual" ? (locale ?? systemLocale) : systemLocale;
      const syncedCurrency = mapSystemCurrency(nextLocale);

      const desktop =
        typeof window === "undefined" ? undefined : window.desktopApi;
      if (desktop) {
        void desktop
          .setLocaleMode(mode, mode === "manual" ? nextLocale : undefined)
          .catch((error: unknown) =>
            console.warn("Electron locale preference sync failed", error),
          );
      } else {
        if (mode === "manual" && locale != null) {
          void setPreference(LOCALE_STORAGE_KEY, locale);
        }
        void setPreference(LOCALE_MODE_STORAGE_KEY, mode);
        void setPreference(CURRENCY_STORAGE_KEY, syncedCurrency);
        void setPreference(CURRENCY_MODE_STORAGE_KEY, "manual");
      }
      if (mode === "manual" && locale != null) setManualLocale(locale);
      setLocaleModeState(mode);

      // A language change is an explicit user action, so synchronize the
      // currency once here. Keeping this in the handler (instead of an effect
      // watching `locale`) lets a later manual currency choice remain stable
      // across unrelated renders.
      setManualCurrency(syncedCurrency);
      setCurrencyModeState("manual");

      localeRef.current = nextLocale;
      currencyRef.current = syncedCurrency;
      updateSearchParams(nextLocale, syncedCurrency);
    },
    [systemLocale],
  );

  const setCurrencyMode = useCallback(
    (mode: PreferenceMode, currency?: Currency) => {
      if (mode === "manual" && currency != null) {
        setManualCurrency(currency);
        void setPreference(CURRENCY_STORAGE_KEY, currency);
      } else if (mode === "system") {
        setManualCurrency(null);
      }
      setCurrencyModeState(mode);
      void setPreference(CURRENCY_MODE_STORAGE_KEY, mode);
      updateSearchParams(
        localeRef.current,
        mode === "manual"
          ? (currency ?? mapSystemCurrency(systemLocale))
          : mapSystemCurrency(systemLocale),
      );
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
        catalog,
        key,
        params as Record<string, string | number> | undefined,
      ),
    [catalog],
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
