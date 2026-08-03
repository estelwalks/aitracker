import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";

import type {} from "../../electron/global";
import {
  Dot,
  PageHeader,
  Panel,
  Segmented,
  StatusBadge,
  TTButton,
} from "../components/tt";
import {
  useTrustToolsSettings,
  type TrustToolsSettings,
} from "../lib/settings/store";
import { useI18n } from "../lib/i18n/context";
import { themes, useTheme } from "../lib/theme";
import { useVersionCheck } from "../lib/version-check";
import {
  APP_VERSION,
  APP_RELEASE_DATE,
  APP_REPO_URL,
} from "../lib/app-version";
import {
  getStorageUsageFn,
  pruneLocalDataFn,
  type StorageUsage,
} from "../lib/local-usage/prune.server";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";

export const Route = createFileRoute("/settings")({
  loader: async () => {
    try {
      const usage = await getStorageUsageFn();
      return { storageUsage: usage, storageError: null };
    } catch (error) {
      return {
        storageUsage: null,
        storageError:
          error instanceof Error ? error.message : "无法读取存储信息",
      };
    }
  },
  head: () => ({
    meta: [
      { title: "设置 · TrustTools V3.0" },
      {
        name: "description",
        content: "管理仅保存在当前设备的本机设置。",
      },
    ],
  }),
  component: SettingsPage,
});

const categories = ["通用", "外观", "关于"] as const;
type Category = (typeof categories)[number];
type AutoLaunchStatus =
  | "正在读取"
  | "桌面端可用"
  | "正在保存"
  | "浏览器不可用"
  | "系统不支持"
  | "读取失败";

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${(mb * 1024).toFixed(1)} KB`;
  return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
}

function SettingsPage() {
  const loaderData = Route.useLoaderData();
  const [category, setCategory] = useState<Category>("通用");
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [autoLaunchStatus, setAutoLaunchStatus] =
    useState<AutoLaunchStatus>("正在读取");
  const { settings, setSettings, loaded } = useTrustToolsSettings();
  const { locale } = useI18n();
  const { theme, setTheme } = useTheme();
  const {
    result: versionResult,
    loading: versionLoading,
    refresh: versionRefresh,
  } = useVersionCheck();
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(
    loaderData.storageUsage,
  );
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [clearingData, setClearingData] = useState(false);

  const update = <K extends keyof TrustToolsSettings>(
    key: K,
    value: TrustToolsSettings[K],
  ) => setSettings((current) => ({ ...current, [key]: value }));

  // Auto-launch logic (keep existing logic intact)
  useEffect(() => {
    const desktopApi = window.trustToolsDesktop;
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
    const desktopApi = window.trustToolsDesktop;
    if (!desktopApi) {
      toast.error("仅桌面客户端可设置开机自启");
      return;
    }

    setAutoLaunchStatus("正在保存");
    try {
      const state = await desktopApi.setAutoLaunch(enabled);
      setAutoLaunchEnabled(state.enabled);
      setAutoLaunchStatus(state.supported ? "桌面端可用" : "系统不支持");
      update("launchAtLoginRequested", state.enabled);
      if (state.supported) {
        toast.success(state.enabled ? "已开启开机自启" : "已关闭开机自启");
      } else {
        toast.error("当前系统不支持开机自启");
      }
    } catch {
      setAutoLaunchStatus("读取失败");
      toast.error("开机自启设置失败");
    }
  };

  const autoLaunchHint =
    autoLaunchStatus === "浏览器不可用"
      ? "仅桌面客户端可设置"
      : autoLaunchStatus === "系统不支持"
        ? "当前系统不支持此功能"
        : autoLaunchStatus === "读取失败"
          ? "无法读取系统开机项，请稍后重试"
          : "直接读取并修改当前系统的开机启动状态";

  const handleClearData = async () => {
    setClearingData(true);
    try {
      const result = await pruneLocalDataFn();
      setStorageUsage(result.usage);
      toast.success("本地数据已清除");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "清除数据失败");
    } finally {
      setClearingData(false);
      setClearDialogOpen(false);
    }
  };

  // Sync storage usage when loader data changes
  useEffect(() => {
    setStorageUsage(loaderData.storageUsage);
  }, [loaderData.storageUsage]);

  return (
    <>
      <PageHeader
        eyebrow="本机偏好"
        title="设置"
        desc="一般配置保存在当前设备；系统级选项仅在桌面客户端生效"
        status={
          <StatusBadge tone={loaded ? "ok" : "warn"}>
            <Dot className={`size-1 ${loaded ? "bg-ok" : "bg-warn"}`} />
            {loaded ? "已载入本机设置" : "正在载入"}
          </StatusBadge>
        }
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
              {item}
            </button>
          ))}
        </Panel>

        <Panel title={category}>
          {category === "通用" && (
            <div>
              <Field label="语言">
                <Segmented
                  value={locale}
                  onChange={() => {}}
                  options={[{ value: "zh-CN" as typeof locale, label: "中文" }]}
                />
              </Field>
              <Field label="开机自启" hint={autoLaunchHint}>
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
                      ? "已在系统中开启"
                      : "已在系统中关闭"
                    : autoLaunchStatus}
                </span>
              </Field>
              <Field
                label="数据路径"
                hint="修改后新数据写入新路径，已有数据保留在原位置不迁移"
              >
                <input
                  value={settings.dataPath}
                  readOnly
                  disabled
                  className="h-8 w-48 rounded-sm border border-border bg-surface-2 px-2 text-[13px] text-muted-foreground disabled:cursor-not-allowed"
                />
              </Field>
              <Field label="数据保留">
                <Segmented
                  value={String(settings.retentionDays)}
                  onChange={(value) => update("retentionDays", Number(value))}
                  options={[
                    { value: "30", label: "30天" },
                    { value: "60", label: "60天" },
                    { value: "90", label: "90天" },
                    { value: "180", label: "180天" },
                    { value: "0", label: "永久" },
                  ]}
                />
              </Field>
              <Field label="存储占用">
                {storageUsage ? (
                  <span className="tt-num text-[13px]">
                    {formatBytes(storageUsage.bytes)} /{" "}
                    {formatBytes(storageUsage.softCapBytes)}
                  </span>
                ) : loaderData.storageError ? (
                  <span className="text-[13px] text-warn">
                    {loaderData.storageError}
                  </span>
                ) : (
                  <span className="text-[13px] text-muted-foreground">
                    加载中...
                  </span>
                )}
              </Field>
              <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0">
                <div>
                  <div className="text-[13px]">清除数据</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    将删除全部采集记录与配置，操作不可撤销
                  </div>
                </div>
                <TTButton
                  variant="danger"
                  size="sm"
                  onClick={() => setClearDialogOpen(true)}
                >
                  清除数据
                </TTButton>
              </div>

              <AlertDialog
                open={clearDialogOpen}
                onOpenChange={setClearDialogOpen}
              >
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>确认清除</AlertDialogTitle>
                    <AlertDialogDescription>
                      将删除全部采集记录与配置，操作不可撤销
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={clearingData}>
                      取消
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault();
                        void handleClearData();
                      }}
                      disabled={clearingData}
                      className="bg-danger text-danger-foreground hover:bg-danger/90"
                    >
                      {clearingData ? "清除中..." : "确认清除"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}

          {category === "外观" && (
            <div>
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                {themes.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => setTheme(item.id)}
                    className={`rounded-sm border p-3 text-left ${
                      theme === item.id ? "border-primary" : "border-border"
                    }`}
                  >
                    <div className="text-[13px] font-medium">{item.label}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {item.desc}
                    </div>
                  </button>
                ))}
              </div>
              <div className="mt-4 border-t border-border pt-4">
                <Field label="语言">
                  <span className="text-[13px] text-muted-foreground">
                    中文（当前仅支持）
                  </span>
                </Field>
              </div>
            </div>
          )}

          {category === "关于" && (
            <div>
              <Field label="版本">
                <span className="tt-num text-[13px]">V{APP_VERSION}</span>
              </Field>
              <Field label="发布日期">
                <span className="text-[13px] text-muted-foreground">
                  {APP_RELEASE_DATE}
                </span>
              </Field>
              <Field label="检查更新">
                <div className="flex items-center gap-2">
                  <TTButton
                    variant="ghost"
                    size="sm"
                    onClick={() => void versionRefresh()}
                    disabled={versionLoading}
                  >
                    {versionLoading ? "检查中..." : "检查更新"}
                  </TTButton>
                  {versionResult && (
                    <span className="text-[12px] text-muted-foreground">
                      {versionResult.status === "newer"
                        ? `发现新版本 ${versionResult.latestVersion}`
                        : versionResult.status === "current"
                          ? "已是最新版本"
                          : "无法获取版本信息"}
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
                        查看发布页面
                      </a>
                    )}
                  </div>
                )}
              </Field>
              <Field label="源码仓库">
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
