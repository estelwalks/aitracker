import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import type {} from "../../../../electron/global";
import {
  Dot,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
  AITrackerButton,
} from "../../../components/aitracker";
import {
  DEFAULT_SETTINGS,
  useAppSettings,
  type AppSettings,
} from "../../../lib/settings/store";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import { type Currency, type Locale } from "../../../lib/i18n/locale";
import { themes, useTheme } from "../../../lib/theme";
import { useVersionCheck } from "../../../lib/version-check";
import {
  AUTO_UPDATE_PREFERENCE_KEY,
  DEFAULT_AUTO_UPDATE_ENABLED,
  parseAutoUpdateEnabled,
} from "../../../lib/update-preferences";
import {
  listPreferences,
  getPreference,
  setPreference,
  removePreference,
} from "../../../lib/preferences/client.ts";
import {
  APP_VERSION,
  APP_REPO_URL,
  brandParams,
} from "../../../lib/app-config";
import {
  applyRetentionPolicyQuery,
  clearCollectedDataQuery,
  clearRegenerableCacheQuery,
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
import { Field, Toggle } from "./fields";
import { ModelProfilesSection } from "./ModelProfilesSection";
import { MenuBarAppSettingsSection } from "./MenuBarAppSettingsSection";
import { ScanScheduleSection } from "./ScanScheduleSection";
import { ReportSchedule } from "../../reports/presentation/index.ts";
import { useSecurityClient } from "./use-security-client";
import {
  SETTINGS_CATEGORIES,
  parseSettingsSection,
  resolveSettingsCategory,
  type SettingsCategory,
  type SettingsSection,
} from "../settings-navigation";
import { InsightSettingsSection } from "../../insights/index.ts";
import {
  getSecurityLlmReviewAvailability,
  setSecurityLlmReviewEnabled,
} from "../../security-assessment/index.ts";

const categoryKeys: Record<SettingsCategory, MessageKey> = {
  preferences: "settings.sections.preferences",
  scan: "settings.sections.scan",
  reports: "settings.sections.reports",
  model: "settings.sections.model",
  data: "settings.sections.data",
  about: "settings.sections.about",
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

const retentionOptions = [30, 60, 90, 180, 0] as const;

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
        className="aitracker-num aitracker-text-body h-8 w-24 rounded-sm border border-border bg-surface-2 px-2 text-right"
      />
      <span className="aitracker-text-caption text-muted-foreground">
        {suffix}
      </span>
    </span>
  );
}

export interface SettingsLoaderData {
  readonly storageUsage: StorageUsage | null;
  readonly storageError: string | null;
  /**
   * Deep-link target: `?section=scan` opens scanning and security,
   * `?section=reports` opens daily and weekly reports, `?section=model` opens models and AI; old `?section=menu-bar-app`
   * Still mapped to app preferences.
   */
  readonly section?: SettingsSection;
}

export function SettingsPage({
  loaderData,
}: {
  readonly loaderData: SettingsLoaderData;
}) {
  const router = useRouter();
  const requestedSection = useRouterState({
    select: (state) =>
      parseSettingsSection(
        (state.location.search as Record<string, unknown>).section,
      ),
  });
  const [category, setCategory] = useState<SettingsCategory>(() =>
    resolveSettingsCategory(loaderData.section),
  );
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [autoLaunchStatus, setAutoLaunchStatus] =
    useState<AutoLaunchStatus>("正在读取");
  const {
    client: securityClient,
    status: securityStatus,
    refresh: refreshSecurity,
  } = useSecurityClient();
  const { settings, setSettings } = useAppSettings();
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
  const desktopApi =
    typeof window === "undefined" ? undefined : window.desktopApi;
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(
    DEFAULT_AUTO_UPDATE_ENABLED,
  );
  const [autoUpdateSupported, setAutoUpdateSupported] = useState(false);
  const [autoUpdateLoading, setAutoUpdateLoading] = useState(true);
  const [desktopUpdateState, setDesktopUpdateState] =
    useState<
      Awaited<ReturnType<NonNullable<Window["desktopApi"]>["getUpdateState"]>>
    >();
  const [autoUpdatePreferenceLoaded, setAutoUpdatePreferenceLoaded] =
    useState(false);
  const {
    result: versionResult,
    loading: versionLoading,
    refresh: versionRefresh,
  } = useVersionCheck(
    autoUpdatePreferenceLoaded && autoUpdateEnabled && !desktopApi,
  );
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(
    loaderData.storageUsage,
  );
  const [clearCacheDialogOpen, setClearCacheDialogOpen] = useState(false);
  const [clearCollectedDataDialogOpen, setClearCollectedDataDialogOpen] =
    useState(false);
  const [resetPreferencesDialogOpen, setResetPreferencesDialogOpen] =
    useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [llmReviewConfigured, setLlmReviewConfigured] = useState(false);
  const [llmReviewEnabled, setLlmReviewEnabled] = useState(true);
  const [llmReviewLoading, setLlmReviewLoading] = useState(true);

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  // Keep same-route deep links (for example /settings?section=model) in sync
  // after the SettingsPage has already mounted.
  useEffect(() => {
    setCategory(resolveSettingsCategory(requestedSection));
  }, [requestedSection]);

  // Optional LLM review supplement (M4): master toggle. It defaults on; an
  // unconfigured model still degrades to the local rule result.
  useEffect(() => {
    let disposed = false;
    getSecurityLlmReviewAvailability()
      .then((next) => {
        if (disposed) return;
        setLlmReviewConfigured(next.configured);
        setLlmReviewEnabled(next.enabled);
      })
      .catch(() => {
        if (disposed) return;
        setLlmReviewConfigured(false);
        setLlmReviewEnabled(true);
      })
      .finally(() => {
        if (!disposed) setLlmReviewLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  // The update preference is shared with the Electron main process through
  // the desktop IPC bridge. Browser preview falls back to the regular local
  // preference store so the setting remains deterministic in both runtimes.
  useEffect(() => {
    let cancelled = false;
    const api = desktopApi;
    const unsubscribe = api?.onUpdateStateChanged((next) => {
      if (!cancelled) setDesktopUpdateState(next);
    });

    void (async () => {
      try {
        if (api) {
          const [preference, state] = await Promise.all([
            api.getAutoUpdate(),
            api.getUpdateState(),
          ]);
          if (cancelled) return;
          setAutoUpdateEnabled(preference.enabled);
          setAutoUpdateSupported(preference.supported);
          setDesktopUpdateState(state);
        } else {
          const preference = await getPreference(AUTO_UPDATE_PREFERENCE_KEY);
          if (cancelled) return;
          setAutoUpdateEnabled(parseAutoUpdateEnabled(preference));
          setAutoUpdateSupported(true);
        }
      } catch {
        if (cancelled) return;
        setAutoUpdateEnabled(DEFAULT_AUTO_UPDATE_ENABLED);
        setAutoUpdateSupported(api === undefined);
      } finally {
        if (!cancelled) {
          setAutoUpdatePreferenceLoaded(true);
          setAutoUpdateLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [desktopApi]);

  const changeLlmReview = async (enabled: boolean) => {
    setLlmReviewEnabled(enabled);
    try {
      const next = await setSecurityLlmReviewEnabled({ data: { enabled } });
      setLlmReviewConfigured(next.configured);
      setLlmReviewEnabled(next.enabled);
      toast.success(t("settings.toast.llmReviewSaved"));
    } catch {
      setLlmReviewEnabled(!enabled);
      toast.error(t("settings.toast.llmReviewSaveFailed"));
    }
  };

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

  const changeAutoUpdate = async (enabled: boolean) => {
    const previous = autoUpdateEnabled;
    setAutoUpdateEnabled(enabled);
    try {
      if (desktopApi) {
        const next = await desktopApi.setAutoUpdate(enabled);
        setAutoUpdateEnabled(next.enabled);
        setAutoUpdateSupported(next.supported);
      } else {
        await setPreference(
          AUTO_UPDATE_PREFERENCE_KEY,
          JSON.stringify(enabled),
        );
      }
      toast.success(
        enabled
          ? t("settings.toast.autoUpdateEnabled")
          : t("settings.toast.autoUpdateDisabled"),
      );
    } catch {
      setAutoUpdateEnabled(previous);
      toast.error(t("settings.toast.autoUpdateSaveFailed"));
    }
  };

  const handleCheckForUpdates = async () => {
    try {
      if (desktopApi) {
        setDesktopUpdateState(await desktopApi.checkForUpdates());
      } else {
        await versionRefresh();
      }
    } catch {
      toast.error(t("settings.toast.updateCheckFailed"));
    }
  };

  const handleDownloadUpdate = async () => {
    if (!desktopApi) return;
    try {
      setDesktopUpdateState(await desktopApi.downloadUpdate());
    } catch {
      toast.error(t("settings.toast.updateDownloadFailed"));
    }
  };

  const handleInstallUpdate = async () => {
    if (!desktopApi) return;
    try {
      const result = await desktopApi.installUpdate();
      if (!result.opened) toast.error(t("settings.toast.updateInstallFailed"));
    } catch {
      toast.error(t("settings.toast.updateInstallFailed"));
    }
  };

  const shownUpdate = desktopApi
    ? desktopUpdateState
    : versionResult
      ? {
          status:
            versionResult.status === "newer"
              ? versionResult.downloadUrl
                ? ("available" as const)
                : ("error" as const)
              : versionResult.status,
          currentVersion: versionResult.currentVersion,
          latestVersion: versionResult.latestVersion,
          releaseDate: versionResult.releaseDate,
          downloadUrl: versionResult.downloadUrl,
          assetName: versionResult.assetName,
          releaseUrl: versionResult.releaseUrl,
          changelog: versionResult.changelog,
          errorCode: versionResult.errorCode,
        }
      : undefined;
  const updateChecking = desktopApi
    ? desktopUpdateState?.status === "checking"
    : versionLoading;
  const updateDownloaded = shownUpdate?.status === "downloaded";

  const autoLaunchHint =
    autoLaunchStatus === "浏览器不可用"
      ? undefined
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

  const handleClearCollectedData = async () => {
    setClearingData(true);
    try {
      const result = await clearCollectedDataQuery({
        data: { confirmed: true },
      });
      setStorageUsage(result.usage);
      // Collection-backed route loaders and read models may still have the
      // previous snapshot in memory. Invalidate the current route after the
      // destructive operation so the settings readout and any active loader
      // state observe the empty data set.
      await router.invalidate();
      toast.success(
        result.cleanup.removedRows > 0
          ? t("settings.toast.collectedDataCleared", {
              count: result.cleanup.removedRows,
              size: format.formatBytes(result.cleanup.removedBytes),
            })
          : t("settings.toast.noCollectedDataToClear"),
      );
    } catch {
      toast.error(t("settings.toast.collectedDataClearFailed"));
    } finally {
      setClearingData(false);
      setClearCollectedDataDialogOpen(false);
    }
  };

  const handleResetPreferences = async () => {
    setClearingData(true);
    try {
      const preferences = await listPreferences();
      const removed = await Promise.all(
        Object.keys(preferences).map((key) => removePreference(key)),
      );
      setSettings(DEFAULT_SETTINGS);
      toast.success(
        t("settings.toast.resetDone", {
          count: removed.filter(Boolean).length,
        }),
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
      // Offline/failure never rejects (last-known-good is returned). Success
      // is carried by the manual-refresh marker (the exchange.refresh task
      // actually rewrote the http-cache); the snapshot `source` after a
      // refresh is always a plain cache/stale/fallback read label, so it can
      // never decide the outcome.
      const snapshot = await refreshRates();
      if (snapshot.refreshed === true) {
        toast.success(t("settings.rate.refreshed"));
      } else {
        toast.error(t("settings.rate.failed"));
      }
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

      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,24%)_minmax(0,1fr)]">
        <Panel className="min-w-0" bodyClassName="p-2">
          {SETTINGS_CATEGORIES.map((item) => (
            <button
              key={item}
              onClick={() => setCategory(item)}
              className={`aitracker-text-body relative flex w-full rounded-sm px-3 py-2 text-left ${
                category === item
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
            >
              {t(categoryKeys[item])}
            </button>
          ))}
        </Panel>

        <Panel className="min-w-0" title={t(categoryKeys[category])}>
          {category === "preferences" && (
            <div>
              <Field label={t("settings.theme")} hint={t("settings.themeDesc")}>
                <Segmented
                  value={theme}
                  onChange={(value) => setTheme(value as typeof theme)}
                  options={themes.map((item) => ({
                    value: item.id,
                    label: t(item.labelKey),
                  }))}
                />
              </Field>
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
                    <span className="aitracker-num aitracker-text-body">
                      {rates
                        ? t("settings.rate.line", {
                            rate: format.formatNumber(
                              rates.rates[displayCurrency] ?? 1,
                              { maximumFractionDigits: 2 },
                            ),
                            currency: displayCurrency,
                          })
                        : "—"}
                    </span>
                    <AITrackerButton
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleRefreshRates()}
                      disabled={ratesLoading}
                    >
                      {ratesLoading
                        ? t("settings.rate.refreshing")
                        : t("settings.rate.refresh")}
                    </AITrackerButton>
                  </div>
                  {rates && (
                    <div className="aitracker-text-caption text-muted-foreground">
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
              <MenuBarAppSettingsSection />
              <InsightSettingsSection />
              <Field label={t("settings.autoLaunch")} hint={autoLaunchHint}>
                <Toggle
                  value={autoLaunchEnabled}
                  onChange={changeAutoLaunch}
                  disabled={autoLaunchStatus !== "桌面端可用"}
                />
                {autoLaunchStatus !== "浏览器不可用" && (
                  <span
                    className={`aitracker-text-caption ${
                      autoLaunchStatus === "桌面端可用"
                        ? "text-ok"
                        : "text-warn"
                    }`}
                  >
                    {autoLaunchStatus === "桌面端可用"
                      ? autoLaunchEnabled
                        ? t("settings.status.enabledInSystem")
                        : t("settings.status.disabledInSystem")
                      : t(autoLaunchStatusKeys[autoLaunchStatus])}
                  </span>
                )}
              </Field>
            </div>
          )}

          {category === "scan" && (
            <div>
              <ScanScheduleSection
                client={securityClient}
                status={securityStatus}
                onRetry={() => void refreshSecurity()}
              />
              <div className="mb-3 mt-1 border-t border-border pt-3">
                <Field
                  label={t("settings.security.llmReview")}
                  hint={
                    llmReviewConfigured
                      ? t("settings.security.llmReviewHint")
                      : t("settings.security.llmReviewUnconfiguredHint")
                  }
                >
                  <Toggle
                    value={llmReviewEnabled}
                    onChange={(enabled) => void changeLlmReview(enabled)}
                    disabled={llmReviewLoading}
                  />
                </Field>
              </div>
              <div className="mb-3 mt-1 border-t border-border pt-3">
                <Field
                  label={t("settings.scan.onDemand")}
                  hint={t("settings.scan.onDemandDesc")}
                >
                  <StatusBadge tone="ok">
                    {t("common.status.fresh")}
                  </StatusBadge>
                </Field>
              </div>
            </div>
          )}

          {category === "reports" && (
            <div>
              <ReportSchedule variant="settings" />
            </div>
          )}

          {category === "model" && (
            <div>
              <ModelProfilesSection />
            </div>
          )}

          {category === "data" && (
            <div>
              <Field
                label={t("settings.dataPath")}
                hint={t("settings.dataPathHint", brandParams)}
              >
                <input
                  value={settings.dataPath}
                  readOnly
                  disabled
                  className="aitracker-text-body h-8 w-48 rounded-sm border border-border bg-surface-2 px-2 text-muted-foreground disabled:cursor-not-allowed"
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
                    className={`aitracker-num aitracker-text-body ${storageUsage.exceedsSoftCap ? "text-warn" : ""}`}
                  >
                    {format.formatBytes(storageUsage.bytes)} /{" "}
                    {format.formatBytes(storageUsage.softCapBytes)}
                    {storageUsage.exceedsSoftCap
                      ? t("settings.storageExceedsSoftCap")
                      : ""}
                  </span>
                ) : loaderData.storageError ? (
                  <span className="aitracker-text-body text-warn">
                    {loaderData.storageError}
                  </span>
                ) : (
                  <span className="aitracker-text-body text-muted-foreground">
                    {t("common.loading")}
                  </span>
                )}
              </Field>
              <div className="mt-4 border-t border-border pt-1">
                <div className="aitracker-text-caption mb-1 pt-2 font-medium uppercase tracking-wide text-muted-foreground">
                  {t("settings.dataDangerZone")}
                </div>
                <div className="flex items-center justify-between gap-3 border-b border-border py-3">
                  <div>
                    <div className="aitracker-text-body">
                      {t("settings.clearCache")}
                    </div>
                    <div className="aitracker-text-caption mt-0.5 text-muted-foreground">
                      {t("settings.clearCacheHint", brandParams)}
                    </div>
                  </div>
                  <AITrackerButton
                    variant="danger"
                    size="sm"
                    onClick={() => setClearCacheDialogOpen(true)}
                  >
                    {t("settings.clearCacheButton")}
                  </AITrackerButton>
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
                        onClick={(event) => {
                          event.preventDefault();
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
                <div className="flex items-center justify-between gap-3 border-b border-border py-3">
                  <div>
                    <div className="aitracker-text-body">
                      {t("settings.clearCollectedData")}
                    </div>
                    <div className="aitracker-text-caption mt-0.5 text-muted-foreground">
                      {t("settings.clearCollectedDataHint")}
                    </div>
                  </div>
                  <AITrackerButton
                    variant="danger"
                    size="sm"
                    onClick={() => setClearCollectedDataDialogOpen(true)}
                  >
                    {t("settings.clearCollectedDataButton")}
                  </AITrackerButton>
                </div>
                <AlertDialog
                  open={clearCollectedDataDialogOpen}
                  onOpenChange={setClearCollectedDataDialogOpen}
                >
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        {t("settings.clearCollectedDataDialogTitle")}
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        {t(
                          "settings.clearCollectedDataDialogDesc",
                          brandParams,
                        )}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={clearingData}>
                        {t("common.cancel")}
                      </AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(event) => {
                          event.preventDefault();
                          void handleClearCollectedData();
                        }}
                        disabled={clearingData}
                        className="bg-danger text-danger-foreground hover:bg-danger/90"
                      >
                        {clearingData
                          ? t("settings.clearingCollectedData")
                          : t("settings.confirmClearCollectedData")}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <div className="flex items-center justify-between gap-3 py-3 last:border-0">
                  <div>
                    <div className="aitracker-text-body">
                      {t("settings.resetPrefs")}
                    </div>
                    <div className="aitracker-text-caption mt-0.5 text-muted-foreground">
                      {t("settings.resetPrefsHint")}
                    </div>
                  </div>
                  <AITrackerButton
                    variant="danger"
                    size="sm"
                    onClick={() => setResetPreferencesDialogOpen(true)}
                  >
                    {t("settings.resetButton")}
                  </AITrackerButton>
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
                        onClick={(event) => {
                          event.preventDefault();
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
            </div>
          )}

          {category === "about" && (
            <div>
              <Field label={t("settings.version")}>
                <span className="aitracker-num aitracker-text-body">
                  V{shownUpdate?.currentVersion ?? APP_VERSION}
                </span>
              </Field>
              <Field label={t("settings.releaseDate")}>
                <span className="aitracker-text-body text-muted-foreground">
                  {shownUpdate?.releaseDate
                    ? format.formatDate(shownUpdate.releaseDate)
                    : "—"}
                </span>
              </Field>
              <Field label={t("settings.autoUpdate")}>
                <Toggle
                  value={autoUpdateEnabled}
                  onChange={(value) => void changeAutoUpdate(value)}
                  disabled={
                    autoUpdateLoading ||
                    (desktopApi !== undefined && !autoUpdateSupported)
                  }
                  ariaLabel={t("settings.autoUpdate")}
                />
              </Field>
              <Field label={t("settings.checkUpdate")}>
                <div className="flex items-center gap-2">
                  <AITrackerButton
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleCheckForUpdates()}
                    disabled={updateChecking}
                  >
                    {updateChecking
                      ? t("settings.checking")
                      : t("settings.checkUpdate")}
                  </AITrackerButton>
                  {shownUpdate && (
                    <span className="aitracker-text-body-sm text-muted-foreground">
                      {shownUpdate.status === "downloaded"
                        ? t("settings.updateDownloaded")
                        : shownUpdate.status === "available"
                          ? t("settings.updateFound", {
                              version: shownUpdate.latestVersion ?? "",
                            })
                          : shownUpdate.status === "error" &&
                              shownUpdate.errorCode === "no-asset"
                            ? t("settings.updateNoAsset", {
                                version: shownUpdate.latestVersion ?? "",
                              })
                            : shownUpdate.status === "current"
                              ? t("settings.upToDate")
                              : shownUpdate.status === "downloading"
                                ? t("settings.downloading")
                                : t("settings.updateFailed")}
                    </span>
                  )}
                </div>
                {shownUpdate &&
                  (shownUpdate.status === "available" ||
                    shownUpdate.status === "downloading" ||
                    shownUpdate.status === "downloaded" ||
                    (shownUpdate.status === "error" &&
                      shownUpdate.errorCode === "no-asset")) && (
                    <div className="mt-2 rounded-sm border border-primary/30 bg-primary/5 p-3">
                      {shownUpdate.changelog && (
                        <p className="aitracker-text-body-sm leading-relaxed text-muted-foreground">
                          {shownUpdate.changelog}
                        </p>
                      )}
                      {shownUpdate.assetName && (
                        <p className="aitracker-text-caption mt-2 text-muted-foreground">
                          {t("settings.updateAsset", {
                            asset: shownUpdate.assetName,
                          })}
                        </p>
                      )}
                      {shownUpdate.status === "available" && desktopApi && (
                        <AITrackerButton
                          variant="primary"
                          size="sm"
                          onClick={() => void handleDownloadUpdate()}
                          className="mt-2"
                        >
                          {t("settings.downloadUpdate")}
                        </AITrackerButton>
                      )}
                      {shownUpdate.status === "available" &&
                        !desktopApi &&
                        shownUpdate.downloadUrl && (
                          <a
                            href={shownUpdate.downloadUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="aitracker-text-body-sm mt-2 inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" />
                            {t("settings.downloadUpdate")}
                          </a>
                        )}
                      {shownUpdate.status === "downloading" && (
                        <span className="aitracker-text-body-sm mt-2 inline-flex text-muted-foreground">
                          {t("settings.downloading")}
                        </span>
                      )}
                      {updateDownloaded && desktopApi && (
                        <AITrackerButton
                          variant="primary"
                          size="sm"
                          onClick={() => void handleInstallUpdate()}
                          className="mt-2"
                        >
                          {t("settings.installUpdate")}
                        </AITrackerButton>
                      )}
                      {shownUpdate.releaseUrl && (
                        <a
                          href={shownUpdate.releaseUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="aitracker-text-body-sm mt-2 inline-flex items-center gap-1 text-primary hover:underline"
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
                  className="aitracker-text-body inline-flex items-center gap-1 text-primary hover:underline"
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
