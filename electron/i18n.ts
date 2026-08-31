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
    dashboard: string;
    settings: string;
    widget: string;
    openBrowser: string;
    autoLaunch: string;
    quit: string;
  };
  dialog: {
    startupFailure: {
      title: string;
      message: string;
      diagnosticCode: string; // {code}
      details: Record<
        | "database.access-denied"
        | "database.already-open"
        | "database.busy"
        | "database.capability-mismatch"
        | "database.corrupt"
        | "database.integrity-check-failed"
        | "database.io-failure"
        | "database.journal-not-wal"
        | "database.migration-checksum"
        | "database.migration-reverted"
        | "startup.unavailable",
        string
      >;
    };
    dataIncompat: {
      title: string;
      message: string; // {oldVer} {curVer}
      quit: string;
      clearAndContinue: string;
    };
    releaseDataReset: {
      title: string;
      body: string; // {dataDir}
      confirm: string;
      cancel: string;
    };
  };
}

const rawElectronMessages: Record<DesktopLocale, ElectronMessages> = {
  "zh-CN": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "打开 {appName}",
      dashboard: "打开仪表盘",
      settings: "进入设置",
      widget: "小组件",
      openBrowser: "在浏览器中打开",
      autoLaunch: "开机自动启动",
      quit: "退出",
    },
    dialog: {
      startupFailure: {
        title: "启动失败",
        message: "{appName} 无法初始化本地运行环境。",
        diagnosticCode: "诊断代码：{code}",
        details: {
          "database.access-denied":
            "当前 Windows 帐户没有本地数据的读写权限，请检查安全软件或受控文件夹访问设置。",
          "database.already-open":
            "本地数据正被另一个 AITracker 实例或开发服务器使用。请关闭占用者后重试。",
          "database.busy":
            "本地数据仍被占用。请关闭其他 AITracker 实例后重试。",
          "database.capability-mismatch":
            "本机 SQLite 运行环境不满足当前版本要求。请重新安装此版本的 AITracker。",
          "database.corrupt":
            "本地数据库已损坏。请先备份数据，再清除应用数据并重新启动。",
          "database.integrity-check-failed":
            "本地数据库完整性校验失败。请先备份数据，再清除应用数据并重新启动。",
          "database.io-failure":
            "无法创建或打开本地数据文件。请检查系统盘空间和安全软件限制。",
          "database.journal-not-wal":
            "当前数据位置不支持所需的本地数据库文件锁定方式。请勿将应用数据放在网络或同步磁盘。",
          "database.migration-checksum":
            "本地数据版本不匹配。请先备份数据，再清除应用数据并重新启动。",
          "database.migration-reverted":
            "本地数据版本不兼容。请先备份数据，再清除应用数据并重新启动。",
          "startup.unavailable":
            "无法确定具体原因。请将诊断代码提供给技术支持。",
        },
      },
      dataIncompat: {
        title: "数据版本不兼容",
        message:
          "检测到旧版本数据格式 (v{oldVer})，与当前版本 ({curVer}) 不兼容。建议备份 ~/{dataDir}/ 目录后清除数据重新启动。",
        quit: "退出",
        clearAndContinue: "清除数据并继续",
      },
      releaseDataReset: {
        title: "需要清除旧版本数据",
        body: "检测到 {dataDir} 下的数据来自不兼容的旧版本。为正常启动，{appName} 需要删除这些数据（建议先备份）。是否继续？",
        confirm: "清除数据并继续",
        cancel: "保留数据",
      },
    },
  },
  "en-US": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "Open {appName}",
      dashboard: "Open Dashboard",
      settings: "Open Settings",
      widget: "Widgets",
      openBrowser: "Open in Browser",
      autoLaunch: "Launch at Login",
      quit: "Quit",
    },
    dialog: {
      startupFailure: {
        title: "Startup failed",
        message: "{appName} could not initialize its local runtime.",
        diagnosticCode: "Diagnostic code: {code}",
        details: {
          "database.access-denied":
            "Your Windows account cannot read or write the local data. Check security software or Controlled Folder Access.",
          "database.already-open":
            "Another AITracker instance or development server is using the local data. Close it and try again.",
          "database.busy":
            "The local data is still in use. Close other AITracker instances and try again.",
          "database.capability-mismatch":
            "The bundled SQLite runtime is incompatible. Reinstall this AITracker version.",
          "database.corrupt":
            "The local database is damaged. Back up the data, then clear the application data and restart.",
          "database.integrity-check-failed":
            "The local database integrity check failed. Back up the data, then clear the application data and restart.",
          "database.io-failure":
            "The local data files cannot be created or opened. Check free disk space and security software restrictions.",
          "database.journal-not-wal":
            "This data location does not support required database locking. Do not place application data on a network or synced drive.",
          "database.migration-checksum":
            "The local data version does not match. Back up the data, then clear the application data and restart.",
          "database.migration-reverted":
            "The local data version is incompatible. Back up the data, then clear the application data and restart.",
          "startup.unavailable":
            "The precise cause is unavailable. Provide the diagnostic code to support.",
        },
      },
      dataIncompat: {
        title: "Incompatible data version",
        message:
          "Detected an older data format (v{oldVer}) that is incompatible with the current version ({curVer}). Back up the ~/{dataDir}/ directory, then clear the data and restart.",
        quit: "Quit",
        clearAndContinue: "Clear data and continue",
      },
      releaseDataReset: {
        title: "Clear old-version data",
        body: "Data under {dataDir} comes from an incompatible older version. To start normally, {appName} needs to delete it (back it up first). Continue?",
        confirm: "Clear data and continue",
        cancel: "Keep data",
      },
    },
  },
  "ja-JP": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "{appName} を開く",
      dashboard: "ダッシュボードを開く",
      settings: "設定を開く",
      widget: "ウィジェット",
      openBrowser: "ブラウザーで開く",
      autoLaunch: "ログイン時に起動",
      quit: "終了",
    },
    dialog: {
      startupFailure: {
        title: "起動に失敗しました",
        message: "{appName} はローカル実行環境を初期化できませんでした。",
        diagnosticCode: "診断コード：{code}",
        details: {
          "database.access-denied":
            "Windows アカウントにローカルデータの読み書き権限がありません。セキュリティソフトまたは保護されたフォルダーアクセスを確認してください。",
          "database.already-open":
            "別の AITracker または開発サーバーがローカルデータを使用しています。終了してから再試行してください。",
          "database.busy":
            "ローカルデータはまだ使用中です。他の AITracker を終了してから再試行してください。",
          "database.capability-mismatch":
            "同梱の SQLite 実行環境に互換性がありません。このバージョンの AITracker を再インストールしてください。",
          "database.corrupt":
            "ローカルデータベースが破損しています。データをバックアップしてからアプリデータを消去し、再起動してください。",
          "database.integrity-check-failed":
            "ローカルデータベースの整合性チェックに失敗しました。データをバックアップしてからアプリデータを消去し、再起動してください。",
          "database.io-failure":
            "ローカルデータファイルを作成または開くことができません。空き容量とセキュリティソフトの制限を確認してください。",
          "database.journal-not-wal":
            "現在のデータ保存先は必要なデータベースロックをサポートしていません。ネットワークまたは同期ドライブにアプリデータを置かないでください。",
          "database.migration-checksum":
            "ローカルデータのバージョンが一致しません。データをバックアップしてからアプリデータを消去し、再起動してください。",
          "database.migration-reverted":
            "ローカルデータのバージョンに互換性がありません。データをバックアップしてからアプリデータを消去し、再起動してください。",
          "startup.unavailable":
            "詳細な原因を取得できません。診断コードを技術サポートへ共有してください。",
        },
      },
      dataIncompat: {
        title: "データバージョン非互換",
        message:
          "旧バージョンのデータ形式 (v{oldVer}) を検出しました。現在のバージョン ({curVer}) とは互換性がありません。~/{dataDir}/ ディレクトリをバックアップしてから、データを消去して再起動してください。",
        quit: "終了",
        clearAndContinue: "データを消去して続行",
      },
      releaseDataReset: {
        title: "旧バージョンのデータを削除",
        body: "{dataDir} のデータは互換性のない旧バージョンのものです。正常に起動するには {appName} がこのデータを削除する必要があります（先にバックアップしてください）。続行しますか？",
        confirm: "データを削除して続行",
        cancel: "データを保持",
      },
    },
  },
  "ko-KR": {
    tray: { tooltip: "{appName}" },
    menu: {
      open: "{appName} 열기",
      dashboard: "대시보드 열기",
      settings: "설정 열기",
      widget: "위젯",
      openBrowser: "브라우저에서 열기",
      autoLaunch: "로그인 시 실행",
      quit: "종료",
    },
    dialog: {
      startupFailure: {
        title: "시작 실패",
        message: "{appName}에서 로컬 런타임을 초기화할 수 없습니다.",
        diagnosticCode: "진단 코드: {code}",
        details: {
          "database.access-denied":
            "현재 Windows 계정에 로컬 데이터 읽기 또는 쓰기 권한이 없습니다. 보안 소프트웨어나 제어된 폴더 액세스를 확인하세요.",
          "database.already-open":
            "다른 AITracker 인스턴스 또는 개발 서버가 로컬 데이터를 사용 중입니다. 종료한 뒤 다시 시도하세요.",
          "database.busy":
            "로컬 데이터가 아직 사용 중입니다. 다른 AITracker 인스턴스를 종료한 뒤 다시 시도하세요.",
          "database.capability-mismatch":
            "번들 SQLite 런타임이 호환되지 않습니다. 이 버전의 AITracker를 다시 설치하세요.",
          "database.corrupt":
            "로컬 데이터베이스가 손상되었습니다. 데이터를 백업한 뒤 앱 데이터를 지우고 다시 시작하세요.",
          "database.integrity-check-failed":
            "로컬 데이터베이스 무결성 검사에 실패했습니다. 데이터를 백업한 뒤 앱 데이터를 지우고 다시 시작하세요.",
          "database.io-failure":
            "로컬 데이터 파일을 만들거나 열 수 없습니다. 디스크 여유 공간과 보안 소프트웨어 제한을 확인하세요.",
          "database.journal-not-wal":
            "현재 데이터 위치는 필요한 데이터베이스 잠금 방식을 지원하지 않습니다. 네트워크 또는 동기화 드라이브에 앱 데이터를 두지 마세요.",
          "database.migration-checksum":
            "로컬 데이터 버전이 일치하지 않습니다. 데이터를 백업한 뒤 앱 데이터를 지우고 다시 시작하세요.",
          "database.migration-reverted":
            "로컬 데이터 버전이 호환되지 않습니다. 데이터를 백업한 뒤 앱 데이터를 지우고 다시 시작하세요.",
          "startup.unavailable":
            "정확한 원인을 확인할 수 없습니다. 진단 코드를 기술 지원팀에 전달하세요.",
        },
      },
      dataIncompat: {
        title: "데이터 버전 비호환",
        message:
          "이전 버전의 데이터 형식(v{oldVer})을 감지했습니다. 현재 버전({curVer})과 호환되지 않습니다. ~/{dataDir}/ 디렉터리를 백업한 후 데이터를 삭제하고 다시 시작하세요.",
        quit: "종료",
        clearAndContinue: "데이터 삭제 후 계속",
      },
      releaseDataReset: {
        title: "이전 버전 데이터 삭제",
        body: "{dataDir}의 데이터가 호환되지 않는 이전 버전에서 온 것입니다. 정상적으로 시작하려면 {appName}에서 이 데이터를 삭제해야 합니다(먼저 백업하세요). 계속하시겠습니까?",
        confirm: "데이터 삭제 후 계속",
        cancel: "데이터 유지",
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
 * Currency following systems map authoritatively to locale regions; unmapped regions fall back to USD).
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
}

export interface TrayTemplateCallbacks {
  onToggleAutoLaunch(checked: boolean): void;
  onQuit(): void;
}

export interface MacWidgetTrayTemplateCallbacks {
  onOpenDashboard(): void;
  onOpenSettings(): void;
  onQuit(): void;
}

/** macOS menu bar widget right-click menu: only page entry and exit are retained. */
export function createMacWidgetTrayTemplate(
  locale: DesktopLocale,
  callbacks: MacWidgetTrayTemplateCallbacks,
): TrayTemplateItem[] {
  const t = electronMessages[locale];
  return [
    { label: t.menu.dashboard, click: callbacks.onOpenDashboard },
    { label: t.menu.settings, click: callbacks.onOpenSettings },
    { type: "separator" },
    { label: t.menu.quit, click: callbacks.onQuit },
  ];
}

/** Build the tray context-menu template in the current locale. */
export function createTrayTemplate(
  locale: DesktopLocale,
  state: TrayTemplateState,
  callbacks: TrayTemplateCallbacks,
): TrayTemplateItem[] {
  const t = electronMessages[locale];
  return [
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
