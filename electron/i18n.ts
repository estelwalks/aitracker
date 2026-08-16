import type {
  DesktopCurrency,
  DesktopLocale,
  DesktopPreferenceMode,
  DesktopPreferenceSource,
  LocalePreferences,
} from "./contracts.js";
import {
  CURRENCY_PREF_KEY,
  CURRENCY_MODE_PREF_KEY,
  LOCALE_MODE_PREF_KEY,
  LOCALE_PREF_KEY,
} from "./prefs.js";
import { APP_DATA_DIR, APP_NAME } from "./app-config.js";

/**
 * Main-process message catalog and preference resolution — deliberately free
 * of any `electron` import so it is unit-testable under plain node:test.
 *
 * The locale/currency unions must stay in sync with `src/lib/i18n/locale.ts`
 * (guarded by `scripts/check-locale-sync.mjs`); the tsconfig boundary between
 * `electron/` and `src/` prevents a safe cross-import.
 */

export type {
  DesktopCurrency,
  DesktopLocale,
  DesktopPreferenceMode,
  DesktopPreferenceSource,
  LocalePreferences,
};

export const DESKTOP_LOCALES: readonly DesktopLocale[] = [
  "zh-CN",
  "en-US",
  "ja-JP",
  "ko-KR",
];

export const DESKTOP_CURRENCIES: readonly DesktopCurrency[] = [
  "CNY",
  "USD",
  "JPY",
  "KRW",
];

export interface ElectronMessages {
  tray: {
    tooltip: string;
  };
  menu: {
    open: string;
    openBrowser: string;
    autoLaunch: string;
    quit: string;
  };
  dialog: {
    closeHint: {
      message: string;
      ok: string;
    };
    dataIncompat: {
      title: string;
      message: string; // {oldVer} {curVer}
      quit: string;
      clearAndContinue: string;
    };
  };
}

const rawElectronMessages: Record<DesktopLocale, ElectronMessages> = {
  "zh-CN": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "打开 {appName}",
      openBrowser: "在浏览器中打开",
      autoLaunch: "开机自动启动",
      quit: "退出",
    },
    dialog: {
      closeHint: {
        message: "{appName} 将继续在菜单栏运行，可通过托盘图标重新打开",
        ok: "知道了",
      },
      dataIncompat: {
        title: "数据版本不兼容",
        message:
          "检测到旧版本数据格式 (v{oldVer})，与当前版本 ({curVer}) 不兼容。建议备份 ~/{dataDir}/ 目录后清除数据重新启动。",
        quit: "退出",
        clearAndContinue: "清除数据并继续",
      },
    },
  },
  "en-US": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "Open {appName}",
      openBrowser: "Open in Browser",
      autoLaunch: "Launch at Login",
      quit: "Quit",
    },
    dialog: {
      closeHint: {
        message:
          "{appName} will keep running in the menu bar — reopen it from the tray icon",
        ok: "Got it",
      },
      dataIncompat: {
        title: "Incompatible data version",
        message:
          "Detected an older data format (v{oldVer}) that is incompatible with the current version ({curVer}). Back up the ~/{dataDir}/ directory, then clear the data and restart.",
        quit: "Quit",
        clearAndContinue: "Clear data and continue",
      },
    },
  },
  "ja-JP": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "{appName} を開く",
      openBrowser: "ブラウザーで開く",
      autoLaunch: "ログイン時に起動",
      quit: "終了",
    },
    dialog: {
      closeHint: {
        message:
          "{appName} はメニューバーで実行を続けます。トレイアイコンから再度開けます",
        ok: "了解しました",
      },
      dataIncompat: {
        title: "データバージョン非互換",
        message:
          "旧バージョンのデータ形式 (v{oldVer}) を検出しました。現在のバージョン ({curVer}) とは互換性がありません。~/{dataDir}/ ディレクトリをバックアップしてから、データを消去して再起動してください。",
        quit: "終了",
        clearAndContinue: "データを消去して続行",
      },
    },
  },
  "ko-KR": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "{appName} 열기",
      openBrowser: "브라우저에서 열기",
      autoLaunch: "로그인 시 실행",
      quit: "종료",
    },
    dialog: {
      closeHint: {
        message:
          "{appName}는 메뉴 막대에서 계속 실행됩니다. 트레이 아이콘으로 다시 열 수 있습니다",
        ok: "확인",
      },
      dataIncompat: {
        title: "데이터 버전 비호환",
        message:
          "이전 버전의 데이터 형식(v{oldVer})을 감지했습니다. 현재 버전({curVer})과 호환되지 않습니다. ~/{dataDir}/ 디렉터리를 백업한 후 데이터를 삭제하고 다시 시작하세요.",
        quit: "종료",
        clearAndContinue: "데이터 삭제 후 계속",
      },
    },
  },
};

/**
 * Resolve the `{appName}` / `{dataDir}` placeholders from the central config.
 * The raw catalog stays a pure data module (no `electron` import), so the
 * interpolation happens once at module init and the result is exported.
 */
function applyBrand<T>(value: T): T {
  if (typeof value === "string") {
    return value
      .replaceAll("{appName}", APP_NAME)
      .replaceAll("{dataDir}", `~/${APP_DATA_DIR}`) as T;
  }
  if (Array.isArray(value)) return value.map(applyBrand) as T;
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, applyBrand(child)]),
    ) as T;
  }
  return value;
}

export const electronMessages: Record<DesktopLocale, ElectronMessages> =
  Object.fromEntries(
    DESKTOP_LOCALES.map((locale) => [
      locale,
      applyBrand(rawElectronMessages[locale]),
    ]),
  ) as Record<DesktopLocale, ElectronMessages>;

/** Exact-match a raw prefs/system value against the supported locales. */
export function normalizeDesktopLocale(raw: unknown): DesktopLocale | null {
  return typeof raw === "string" &&
    (DESKTOP_LOCALES as readonly string[]).includes(raw)
    ? (raw as DesktopLocale)
    : null;
}

/**
 * Map an OS language tag (from `app.getLocale()`) to a supported locale.
 * Same rules as `mapSystemLocale` in `src/lib/i18n/locale.ts` — keep both in
 * sync; the sync script compares the locale unions, tests pin the mapping.
 */
export function mapAppLocale(raw: string | null | undefined): DesktopLocale {
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

/**
 * Resolve the display locale for the desktop shell:
 * user preference (locale pref key in prefs) > system language > zh-CN.
 */
export function resolveDesktopLocale(
  prefs: Record<string, unknown>,
  systemLocale: string,
): DesktopLocale {
  return (
    normalizeDesktopLocale(prefs[LOCALE_PREF_KEY]) ?? mapAppLocale(systemLocale)
  );
}

/** Exact-match a raw prefs value against the four display currencies. */
export function normalizeDesktopCurrency(raw: unknown): DesktopCurrency | null {
  return typeof raw === "string" &&
    (DESKTOP_CURRENCIES as readonly string[]).includes(raw)
    ? (raw as DesktopCurrency)
    : null;
}

/**
 * Map an OS locale's region to a display currency (docs/plan v1.2:
 * 货币跟随系统以 locale 地区为权威映射;unmapped regions fall back to USD).
 */
export function mapSystemCurrency(
  raw: string | null | undefined,
): DesktopCurrency {
  if (raw == null) return "USD";
  const primary = raw.toLowerCase().split(/[-_]/)[0];
  switch (primary) {
    case "zh":
      return "CNY";
    case "ja":
      return "JPY";
    case "ko":
      return "KRW";
    default:
      return "USD";
  }
}

/**
 * Resolve the full display preferences (v1.2): each of locale/currency has an
 * independent mode — manual preference wins, then the system mapping, then
 * the fallback (zh-CN / USD).
 */
export function resolveDesktopPreferences(
  prefs: Record<string, unknown>,
  systemLocale: string,
): LocalePreferences {
  const systemLocaleMapped = mapAppLocale(systemLocale);
  const localeMode = normalizeMode(prefs[LOCALE_MODE_PREF_KEY]);
  const manualLocale = normalizeDesktopLocale(prefs[LOCALE_PREF_KEY]);
  const locale: DesktopLocale =
    localeMode === "manual"
      ? (manualLocale ?? systemLocaleMapped)
      : systemLocaleMapped;
  const localeSource: DesktopPreferenceSource =
    localeMode === "manual"
      ? manualLocale != null
        ? "manual"
        : "fallback"
      : "system";

  const currencyMode = normalizeMode(prefs[CURRENCY_MODE_PREF_KEY]);
  const manualCurrency = normalizeDesktopCurrency(prefs[CURRENCY_PREF_KEY]);
  const systemCurrency = mapSystemCurrency(systemLocale);
  const displayCurrency: DesktopCurrency =
    currencyMode === "manual"
      ? (manualCurrency ?? systemCurrency)
      : systemCurrency;
  const currencySource: DesktopPreferenceSource =
    currencyMode === "manual"
      ? manualCurrency != null
        ? "manual"
        : "fallback"
      : "system";

  return { locale, localeSource, displayCurrency, currencySource };
}

function normalizeMode(raw: unknown): DesktopPreferenceMode {
  return raw === "system" || raw === "manual" ? raw : "system";
}

/** Replace `{name}` placeholders — same convention as the renderer's `t()`. */
export function interpolate(
  template: string,
  params: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export interface TrayTemplateItem {
  label?: string;
  type?: "normal" | "separator" | "checkbox";
  checked?: boolean;
  enabled?: boolean;
  click?: () => void;
}

export interface TrayTemplateState {
  autoLaunchEnabled: boolean;
  autoLaunchSupported: boolean;
  browserCompanionSupported: boolean;
}

export interface TrayTemplateCallbacks {
  onOpen(): void;
  onOpenBrowser(): void;
  onToggleAutoLaunch(checked: boolean): void;
  onQuit(): void;
}

/** Build the tray context-menu template in the current locale. */
export function createTrayTemplate(
  locale: DesktopLocale,
  state: TrayTemplateState,
  callbacks: TrayTemplateCallbacks,
): TrayTemplateItem[] {
  const t = electronMessages[locale];
  return [
    { label: t.menu.open, click: callbacks.onOpen },
    {
      label: t.menu.openBrowser,
      enabled: state.browserCompanionSupported,
      click: callbacks.onOpenBrowser,
    },
    { type: "separator" },
    {
      label: t.menu.autoLaunch,
      type: "checkbox",
      checked: state.autoLaunchEnabled,
      enabled: state.autoLaunchSupported,
      click: () => callbacks.onToggleAutoLaunch(!state.autoLaunchEnabled),
    },
    { type: "separator" },
    { label: t.menu.quit, click: callbacks.onQuit },
  ];
}
