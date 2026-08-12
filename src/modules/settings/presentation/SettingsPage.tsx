import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import type {} from "../../../../electron/global";
import {
  Dot,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
  TTButton,
} from "../../../components/tt";
import {
  DEFAULT_SETTINGS,
  useAppSettings,
  type AppSettings,
} from "../../../lib/settings/store";
import { useI18n } from "../../../lib/i18n/context";
import {
  catalogs,
  getMessage,
  type MessageKey,
} from "../../../lib/i18n/messages";
import {
  resolveLocaleFromSearch,
  type Currency,
  type Locale,
} from "../../../lib/i18n/locale";
import { themes, useTheme } from "../../../lib/theme";
import { useVersionCheck } from "../../../lib/version-check";
import {
  APP_VERSION,
  APP_RELEASE_DATE,
  APP_REPO_URL,
  brandParams,
  STORAGE_KEY_PREFIX,
} from "../../../lib/app-config";
import {
  applyRetentionPolicyQuery,
  clearRegenerableCacheQuery,
  getLLMConfigStatus,
  getStorageUsageQuery,
  type LLMConfigStatus,
  type StorageUsage,
} from "../query";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";

// 中文值保持为分类数据(用于比较),展示文案经 labelKeys 映射翻译。
const categories = ["通用", "扫描配置", "模型配置", "外观", "关于"] as const;
type Category = (typeof categories)[number];
const categoryKeys: Record<Category, MessageKey> = {
  通用: "settings.sections.general",
  扫描配置: "settings.sections.scan",
  模型配置: "settings.sections.model",
  外观: "settings.sections.appearance",
  关于: "settings.sections.about",
};

type AutoLaunchStatus =
  | "正在读取"
  | "桌面端可用"
  | "正在保存"
  | "浏览器不可用"
  | "系统不支持"
  | "读取失败";
const autoLaunchStatusKeys: Record<AutoLaunchStatus, MessageKey> = {
  正在读取: "settings.status.reading",
  桌面端可用: "settings.status.desktopAvailable",
  正在保存: "settings.status.saving",
  浏览器不可用: "settings.status.browserUnavailable",
  系统不支持: "settings.status.unsupported",
  读取失败: "settings.status.readFailed",
};

const rateSourceKeys: Record<string, MessageKey> = {
  live: "settings.rate.live",
  cache: "settings.rate.cache",
  "stale-cache": "settings.rate.staleCache",
  fallback: "settings.rate.fallback",
};

const localeLabelKeys: Record<Locale, MessageKey> = {
  "zh-CN": "settings.languages.zhCN",
  "en-US": "settings.languages.enUS",
  "ja-JP": "settings.languages.jaJP",
  "ko-KR": "settings.languages.koKR",
};

const retentionOptions = [30, 60, 90, 180, 0] as const;

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div>
        <div className="text-[13px]">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function Toggle({
  value,
  onChange,
  disabled = false,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      disabled={disabled}
      className={`h-5 w-9 rounded-full p-0.5 transition-colors ${
        value ? "bg-primary" : "border border-border bg-surface-2"
      } disabled:cursor-not-allowed disabled:opacity-50`}
      aria-pressed={value}
    >
      <span
        className="block size-4 rounded-full bg-background transition-transform"
        style={{ transform: value ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}

function NumberField({
  value,
  suffix,
  onChange,
  ariaLabel,
}: {
  value: number;
  suffix: string;
  onChange: (value: number) => void;
  ariaLabel?: string;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        min={0}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) =>
          onChange(Math.max(0, Number(event.target.value) || 0))
        }
        className="tt-num h-8 w-24 rounded-sm border border-border bg-surface-2 px-2 text-right text-[13px]"
      />
      <span className="text-[11px] text-muted-foreground">{suffix}</span>
    </span>
  );
}

export interface SettingsLoaderData {
  readonly storageUsage: StorageUsage | null;
  readonly storageError: string | null;
}

export function SettingsPage({
  loaderData,
}: {
  readonly loaderData: SettingsLoaderData;
}) {
  const [category, setCategory] = useState<Category>("通用");
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [autoLaunchStatus, setAutoLaunchStatus] =
    useState<AutoLaunchStatus>("正在读取");
  const [llmStatus, setLlmStatus] = useState<LLMConfigStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getLLMConfigStatus()
      .then((status) => {
        if (!cancelled) setLlmStatus(status);
      })
      .catch(() => {
        if (!cancelled) setLlmStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const { settings, setSettings, loaded } = useAppSettings();
  const {
    locale,
    localeMode,
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
  } = useI18n();
  const { theme, setTheme } = useTheme();
  const {
    result: versionResult,
    loading: versionLoading,
    refresh: versionRefresh,
  } = useVersionCheck();
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(
    loaderData.storageUsage,
  );
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [resetPreferencesDialogOpen, setResetPreferencesDialogOpen] =
    useState(false);
  const [clearingData, setClearingData] = useState(false);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  // Auto-launch logic (keep existing logic intact)
  useEffect(() => {
    const desktopApi = window.desktopApi;
    if (!desktopApi) {
      setAutoLaunchStatus("浏览器不可用");
      return;
    }

    let cancelled = false;
    desktopApi
      .getAutoLaunch()
      .then((state) => {
        if (cancelled) return;
        setAutoLaunchEnabled(state.enabled);
        setAutoLaunchStatus(state.supported ? "桌面端可用" : "系统不支持");
        setSettings((current) => ({
          ...current,
          launchAtLoginRequested: state.enabled,
        }));
      })
      .catch(() => {
        if (!cancelled) setAutoLaunchStatus("读取失败");
      });
    return () => {
      cancelled = true;
    };
  }, [setSettings]);

  const changeAutoLaunch = async (enabled: boolean) => {
    const desktopApi = window.desktopApi;
    if (!desktopApi) {
      toast.error(t("settings.toast.autoLaunchDesktopOnly"));
      return;
    }

    setAutoLaunchStatus("正在保存");
    try {
      const state = await desktopApi.setAutoLaunch(enabled);
      setAutoLaunchEnabled(state.enabled);
      setAutoLaunchStatus(state.supported ? "桌面端可用" : "系统不支持");
      update("launchAtLoginRequested", state.enabled);
      if (state.supported) {
        toast.success(
          state.enabled
            ? t("settings.toast.autoLaunchEnabled")
            : t("settings.toast.autoLaunchDisabled"),
        );
      } else {
        toast.error(t("settings.toast.autoLaunchUnsupported"));
      }
    } catch {
      setAutoLaunchStatus("读取失败");
      toast.error(t("settings.toast.autoLaunchSaveFailed"));
    }
  };

  const autoLaunchHint =
    autoLaunchStatus === "浏览器不可用"
      ? t("settings.autoLaunchHint.browserOnly")
      : autoLaunchStatus === "系统不支持"
        ? t("settings.autoLaunchHint.unsupported")
        : autoLaunchStatus === "读取失败"
          ? t("settings.autoLaunchHint.readFailed")
          : t("settings.autoLaunchHint.default");

  const changeRetentionDays = async (retentionDays: number) => {
    update("retentionDays", retentionDays);
    try {
      const result = await applyRetentionPolicyQuery({
        data: { retentionDays },
      });
      setStorageUsage(result.usage);
      if (result.cleanup.removedFiles > 0) {
        toast.success(
          t("settings.toast.cleanupDone", {
            count: result.cleanup.removedFiles,
            size: format.formatBytes(result.cleanup.removedBytes),
          }),
        );
      } else {
        toast.success(
          retentionDays === 0
            ? t("settings.toast.keepForever")
            : t("settings.toast.retentionSaved"),
        );
      }
    } catch {
      toast.error(t("settings.toast.retentionFailed"));
    }
  };

  const handleClearCache = async () => {
    setClearingData(true);
    try {
      const result = await clearRegenerableCacheQuery();
      setStorageUsage(result.usage);
      toast.success(
        result.cleanup.removedFiles > 0
          ? t("settings.toast.cleared", {
              count: result.cleanup.removedFiles,
              size: format.formatBytes(result.cleanup.removedBytes),
            })
          : t("settings.toast.nothingToClear"),
      );
    } catch {
      toast.error(t("settings.toast.clearFailed"));
    } finally {
      setClearingData(false);
      setClearCacheDialogOpen(false);
    }
  };

  const handleResetPreferences = async () => {
    setClearingData(true);
    try {
      const result = await window.desktopApi?.resetPreferences();
      for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(STORAGE_KEY_PREFIX))
          window.localStorage.removeItem(key);
      }
      setSettings(DEFAULT_SETTINGS);
      toast.success(
        result
          ? t("settings.toast.resetDone", { count: result.removedKeys })
          : t("settings.toast.resetDoneBrowser"),
      );
    } catch {
      toast.error(t("settings.toast.resetFailed"));
    } finally {
      setClearingData(false);
      setResetPreferencesDialogOpen(false);
    }
  };

  const handleRefreshRates = async () => {
    try {
      await refreshRates();
      toast.success(t("settings.rate.refreshed"));
    } catch {
      toast.error(t("settings.rate.failed"));
    }
  };

  // Sync storage usage when loader data changes
  useEffect(() => {
    setStorageUsage(loaderData.storageUsage);
  }, [loaderData.storageUsage]);

  return (
    <>
      <PageHeader
        title={t("settings.pageHeader")}
        desc={t("settings.pageHeaderDesc")}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,24%)_minmax(0,1fr)]">
        <Panel bodyClassName="p-2">
          {categories.map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              className={`relative flex w-full rounded-sm px-3 py-2 text-left text-[13px] ${
                category === item
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {t(categoryKeys[item])}
            </button>
          ))}
        </Panel>

        <Panel title={t(categoryKeys[category])}>
          {category === "通用" && (
            <div>
              <Field
                label={t("settings.language")}
                hint={
                  localeMode === "system"
                    ? t("settings.languageFollowHint")
                    : t("settings.languageManualHint")
                }
              >
                <Segmented
                  value={localeMode === "manual" ? locale : "system"}
                  onChange={(value) =>
                    value === "system"
                      ? setLocaleMode("system")
                      : setLocaleMode("manual", value as Locale)
                  }
                  options={[
                    { value: "system", label: t("settings.followSystem") },
                    { value: "zh-CN", label: t("settings.languages.zhCN") },
                    { value: "en-US", label: t("settings.languages.enUS") },
                    { value: "ja-JP", label: t("settings.languages.jaJP") },
                    { value: "ko-KR", label: t("settings.languages.koKR") },
                  ]}
                />
              </Field>
              <Field
                label={t("settings.currency")}
                hint={
                  currencyMode === "manual"
                    ? t("settings.currencyManualHint")
                    : currencySource === "fallback"
                      ? t("settings.currencyFallbackHint")
                      : t("settings.currencyFollowHint")
                }
              >
                <Segmented
                  value={currencyMode === "manual" ? displayCurrency : "system"}
                  onChange={(value) =>
                    value === "system"
                      ? setCurrencyMode("system")
                      : setCurrencyMode("manual", value as Currency)
                  }
                  options={[
                    { value: "system", label: t("settings.followSystem") },
                    { value: "CNY", label: "CNY" },
                    { value: "USD", label: "USD" },
                    { value: "JPY", label: "JPY" },
                    { value: "KRW", label: "KRW" },
                  ]}
                />
              </Field>
              <Field
                label={t("settings.rate.title")}
                hint={t("settings.rate.desc")}
              >
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-2">
                    <span className="tt-num text-[13px]">
                      {rates
                        ? t("settings.rate.line", {
                            rate: format.formatNumber(
                              rates.rates[displayCurrency] ?? 1,
                              { maximumFractionDigits: 4 },
                            ),
                            currency: displayCurrency,
                          })
                        : "—"}
                    </span>
                    <TTButton
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRefreshRates()}
                      disabled={ratesLoading}
                    >
                      {ratesLoading
                        ? t("settings.rate.refreshing")
                        : t("settings.rate.refresh")}
                    </TTButton>
                  </div>
                  {rates && (
                    <div className="text-[11px] text-muted-foreground">
                      {t("settings.rate.updatedAt", { date: rates.date })}
                      {" · "}
                      {t(
                        rateSourceKeys[rates.source] ??
                          "settings.rate.fallback",
                      )}
                      {rates.source !== "live" &&
                        ` · ${t("settings.rate.offlineHint", {
                          source: t(
                            rateSourceKeys[rates.source] ??
                              "settings.rate.fallback",
                          ),
                        })}`}
                    </div>
                  )}
                </div>
              </Field>
              <Field label={t("settings.autoLaunch")} hint={autoLaunchHint}>
                <Toggle
                  value={autoLaunchEnabled}
                  onChange={changeAutoLaunch}
                  disabled={autoLaunchStatus !== "桌面端可用"}
                />
                <span
                  className={`text-[11px] ${
                    autoLaunchStatus === "桌面端可用" ? "text-ok" : "text-warn"
                  }`}
                >
                  {autoLaunchStatus === "桌面端可用"
                    ? autoLaunchEnabled
                      ? t("settings.status.enabledInSystem")
                      : t("settings.status.disabledInSystem")
                    : t(autoLaunchStatusKeys[autoLaunchStatus])}
                </span>
              </Field>
              <Field
                label={t("security.center.model.title")}
                hint={t("security.center.model.desc")}
              >
                <Link
                  to="/security"
                  search={{ configureModel: "1" }}
                  className="inline-flex h-8 items-center rounded-lg bg-surface-2 px-3 text-[12px] hover:bg-accent"
                >
                  {t("security.center.model.configure")}
                </Link>
              </Field>
              <Field
                label={t("settings.dataPath")}
                hint={t("settings.dataPathHint", brandParams)}
              >
                <input
                  value={storageUsage?.directory ?? settings.dataPath}
                  readOnly
                  disabled
                  className="h-8 w-48 rounded-sm border border-border bg-surface-2 px-2 text-[13px] text-muted-foreground disabled:cursor-not-allowed"
                />
              </Field>
              <Field
                label={t("settings.retention")}
                hint={t("settings.retentionHint", brandParams)}
              >
                <Segmented
                  value={String(settings.retentionDays)}
                  onChange={(value) => void changeRetentionDays(Number(value))}
                  options={retentionOptions.map((days) => ({
                    value: String(days),
                    label:
                      days === 0
                        ? t("settings.retentionForever")
                        : t("settings.retentionDays", { count: days }),
                  }))}
                />
              </Field>
              <Field label={t("settings.storage")}>
                {storageUsage ? (
                  <span
                    className={`tt-num text-[13px] ${storageUsage.exceedsSoftCap ? "text-warn" : ""}`}
                  >
                    {format.formatBytes(storageUsage.bytes)} /{" "}
                    {format.formatBytes(storageUsage.softCapBytes)}
                    {storageUsage.exceedsSoftCap
                      ? t("settings.storageExceedsSoftCap")
                      : ""}
                  </span>
                ) : loaderData.storageError ? (
                  <span className="text-[13px] text-warn">
                    {loaderData.storageError}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    {t("common.loading")}
                  </span>
                )}
              </Field>
              <div className="flex items-center justify-between gap-3 border-b border-border py-3">
                <div>
                  <div className="text-[13px]">{t("settings.clearCache")}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("settings.clearCacheHint", brandParams)}
                  </div>
                </div>
                <TTButton
                  variant="danger"
                  size="sm"
                  onClick={() => setClearCacheDialogOpen(true)}
                >
                  {t("settings.clearCacheButton")}
                </TTButton>
              </div>

              <AlertDialog
                open={clearCacheDialogOpen}
                onOpenChange={setClearCacheDialogOpen}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("settings.clearCacheDialogTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("settings.clearCacheDialogDesc", brandParams)}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={clearingData}>
                      {t("common.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        void handleClearCache();
                      }}
                      disabled={clearingData}
                      className="bg-danger text-danger-foreground hover:bg-danger/90"
                    >
                      {clearingData
                        ? t("settings.clearing")
                        : t("settings.confirmClearCache")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <div className="flex items-center justify-between gap-3 py-3 last:border-0">
                <div>
                  <div className="text-[13px]">{t("settings.resetPrefs")}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {t("settings.resetPrefsHint")}
                  </div>
                </div>
                <TTButton
                  variant="danger"
                  size="sm"
                  onClick={() => setResetPreferencesDialogOpen(true)}
                >
                  {t("settings.resetButton")}
                </TTButton>
              </div>
              <AlertDialog
                open={resetPreferencesDialogOpen}
                onOpenChange={setResetPreferencesDialogOpen}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t("settings.resetDialogTitle")}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("settings.resetDialogDesc", brandParams)}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={clearingData}>
                      {t("common.cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        void handleResetPreferences();
                      }}
                      disabled={clearingData}
                      className="bg-danger text-danger-foreground hover:bg-danger/90"
                    >
                      {clearingData
                        ? t("settings.resetting")
                        : t("settings.confirmReset")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {category === "扫描配置" && (
            <div>
              <Field
                label={t("settings.scan.onDemand")}
                hint={t("settings.scan.onDemandDesc")}
              >
                <StatusBadge tone="ok">{t("common.status.fresh")}</StatusBadge>
              </Field>
              <Field
                label={t("settings.retention")}
                hint={`${t("settings.scan.retentionNote")} ${t("settings.retentionHint", brandParams)}`}
              >
                <Segmented
                  value={String(settings.retentionDays)}
                  onChange={(value) => void changeRetentionDays(Number(value))}
                  options={retentionOptions.map((days) => ({
                    value: String(days),
                    label:
                      days === 0
                        ? t("settings.retentionForever")
                        : t("settings.retentionDays", { count: days }),
                  }))}
                />
              </Field>
              <Field label={t("settings.storage")}>
                {storageUsage ? (
                  <span className="tt-num text-[13px]">
                    {format.formatBytes(storageUsage.bytes)}
                    {storageUsage.exceedsSoftCap
                      ? t("settings.storageExceedsSoftCap")
                      : ""}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    {t("common.loading")}
                  </span>
                )}
              </Field>
            </div>
          )}

          {category === "模型配置" && (
            <div>
              {llmStatus == null ? (
                <Field label={t("settings.model.loading")}>
                  <span className="text-[13px] text-muted-foreground">
                    {t("common.loading")}
                  </span>
                </Field>
              ) : llmStatus.configured ? (
                <>
                  <Field
                    label={t("settings.model.configured")}
                    hint={t("settings.model.apiKeyMasked")}
                  >
                    <StatusBadge tone="ok">
                      {t("common.status.fresh")}
                    </StatusBadge>
                  </Field>
                  <Field label={t("settings.model.baseUrl")}>
                    <code className="tt-num rounded-sm bg-surface-2 px-2 py-1 text-[12px]">
                      {llmStatus.baseUrl}
                    </code>
                  </Field>
                  <Field label={t("settings.model.model")}>
                    <code className="tt-num rounded-sm bg-surface-2 px-2 py-1 text-[12px]">
                      {llmStatus.model}
                    </code>
                  </Field>
                </>
              ) : (
                <Field
                  label={t("settings.model.notConfigured")}
                  hint={t("settings.model.notConfiguredDesc")}
                >
                  <StatusBadge tone="warn">
                    {t("common.status.disabled")}
                  </StatusBadge>
                </Field>
              )}
            </div>
          )}

          {category === "外观" && (
            <div>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {themes.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setTheme(item.id)}
                    className={`overflow-hidden rounded-sm border text-left ${
                      theme === item.id ? "border-primary" : "border-border"
                    }`}
                  >
                    {/* 迷你主题预览：把主题类套在缩略图容器上，使 CSS 变量局部生效 */}
                    <div
                      className={`flex items-center gap-1.5 border-b border-border/60 bg-background px-2 py-2 ${item.cls}`}
                    >
                      <span className="h-6 w-1.5 shrink-0 rounded-sm bg-sidebar" />
                      <div className="flex flex-1 flex-col gap-1">
                        <span className="h-1.5 w-3/4 rounded-full bg-primary/70" />
                        <span className="h-1.5 w-1/2 rounded-full bg-muted-foreground/40" />
                      </div>
                      <span className="size-2.5 shrink-0 rounded-full bg-ok" />
                    </div>
                    <div className="px-2 py-1.5">
                      <div className="text-[13px] font-medium">
                        {t(item.labelKey)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {t(item.descKey)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <Field label={t("settings.currentLanguage")}>
                  <span className="text-[13px] text-muted-foreground">
                    {t(localeLabelKeys[locale])}
                  </span>
                </Field>
              </div>
            </div>
          )}

          {category === "关于" && (
            <div>
              <Field label={t("settings.version")}>
                <span className="tt-num text-[13px]">V{APP_VERSION}</span>
              </Field>
              <Field label={t("settings.releaseDate")}>
                <span className="text-[13px] text-muted-foreground">
                  {APP_RELEASE_DATE}
                </span>
              </Field>
              <Field label={t("settings.checkUpdate")}>
                <div className="flex items-center gap-2">
                  <TTButton
                    variant="ghost"
                    size="sm"
                    onClick={() => void versionRefresh()}
                    disabled={versionLoading}
                  >
                    {versionLoading
                      ? t("settings.checking")
                      : t("settings.checkUpdate")}
                  </TTButton>
                  {versionResult && (
                    <span className="text-[12px] text-muted-foreground">
                      {versionResult.status === "newer"
                        ? t("settings.updateFound", {
                            version: versionResult.latestVersion ?? "",
                          })
                        : versionResult.status === "current"
                          ? t("settings.upToDate")
                          : t("settings.updateFailed")}
                    </span>
                  )}
                </div>
                {versionResult && versionResult.status === "newer" && (
                  <div className="mt-2 rounded-sm border border-primary/30 bg-primary/5 p-3">
                    {versionResult.changelog && (
                      <p className="text-[12px] leading-relaxed text-muted-foreground">
                        {versionResult.changelog}
                      </p>
                    )}
                    {versionResult.releaseUrl && (
                      <a
                        href={versionResult.releaseUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
                      >
                        <ExternalLink className="size-3" />
                        {t("settings.viewRelease")}
                      </a>
                    )}
                  </div>
                )}
              </Field>
              <Field label={t("settings.sourceRepo")}>
                <a
                  href={APP_REPO_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  {APP_REPO_URL}
                </a>
              </Field>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
