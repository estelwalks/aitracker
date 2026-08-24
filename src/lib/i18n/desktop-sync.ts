import type {
  Currency,
  Locale,
  PreferenceMode,
  PreferenceSource,
} from "./locale";

export interface DesktopPreferenceSnapshot {
  readonly locale: Locale;
  readonly localeSource: PreferenceSource;
  readonly displayCurrency: Currency;
  readonly currencySource: PreferenceSource;
}

export interface DesktopI18nState {
  readonly localeMode: PreferenceMode;
  readonly manualLocale: Locale | null;
  readonly systemLocale: Locale;
  readonly currencyMode: PreferenceMode;
  readonly manualCurrency: Currency | null;
  readonly systemCurrency: Currency;
}

/** Apply the main-process resolved snapshot without writing it back. */
export function applyDesktopPreferences(
  current: DesktopI18nState,
  snapshot: DesktopPreferenceSnapshot,
): DesktopI18nState {
  const localeMode: PreferenceMode =
    snapshot.localeSource === "manual" ? "manual" : "system";
  const currencyMode: PreferenceMode =
    snapshot.currencySource === "manual" ? "manual" : "system";

  return {
    localeMode,
    manualLocale: localeMode === "manual" ? snapshot.locale : null,
    systemLocale:
      localeMode === "system" ? snapshot.locale : current.systemLocale,
    currencyMode,
    manualCurrency: currencyMode === "manual" ? snapshot.displayCurrency : null,
    systemCurrency:
      currencyMode === "system"
        ? snapshot.displayCurrency
        : current.systemCurrency,
  };
}

/** The locale event is intentionally write-free and immediately visible. */
export function applyDesktopLocaleEvent(
  current: DesktopI18nState,
  locale: Locale,
): DesktopI18nState {
  return current.localeMode === "manual"
    ? { ...current, manualLocale: locale }
    : { ...current, systemLocale: locale };
}
