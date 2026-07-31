import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Database, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type {} from "../../electron/global";
import { Dot, PageHeader, Panel, Segmented, StatusBadge, TTButton } from "../components/tt";
import {
  getLocalUsageSnapshot,
  getUsageAdapterConfig,
  saveUsageAdapterConfig,
  USAGE_ADAPTER_PRESETS,
  type LocalUsageSnapshot,
  type UsageAdapterConfigState,
} from "../lib/local-usage";
import {
  createEmptyUsageSnapshot,
  formatDateTime,
  sourceLabel,
} from "../lib/local-usage/presentation";
import {
  SECURITY_RULE_KINDS,
  validateSecurityRulePattern,
  type SecurityRuleKind,
  type UserSecurityRule,
} from "../lib/security/rules";
import {
  useTrustToolsSettings,
  type ProviderBudget,
  type TrustToolsSettings,
} from "../lib/settings/store";
import { themes, useTheme } from "../lib/theme";

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const adapterConfig = await getUsageAdapterConfig().catch(() => ({
      path: "~/.trusttools/usage-adapters.json",
      text: '{\n  "version": 1,\n  "adapters": []\n}\n',
    }));
    try {
      return { snapshot: await getLocalUsageSnapshot(), error: null, adapterConfig };
    } catch (error) {
      return {
        snapshot: createEmptyUsageSnapshot(),
        error: error instanceof Error ? error.message : "本地数据读取失败",
        adapterConfig,
      };
    }
  },
  head: () => ({
    meta: [
      { title: "设置 · TrustTools V3.0" },
      { name: "description", content: "管理仅保存在当前浏览器 localStorage 的本地设置。" },
    ],
  }),
  component: SettingsPage,
});

const categories = [
  "通用",
  "数据采集",
  "技能管理",
  "记忆",
  "安全规则",
  "预警",
  "外观",
  "关于",
] as const;
type Category = (typeof categories)[number];
type AutoLaunchStatus =
  | "正在读取"
  | "桌面端可用"
  | "正在保存"
  | "浏览器不可用"
  | "系统不支持"
  | "读取失败";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <div>
        <div className="text-[13px]">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
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
        onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))}
        className="tt-num h-8 w-24 rounded-sm border border-border bg-surface-2 px-2 text-right text-[13px]"
      />
      <span className="text-[11px] text-muted-foreground">{suffix}</span>
    </span>
  );
}

function DirectoryList({
  values,
  onChange,
  promptText,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  promptText: string;
}) {
  const add = () => {
    const value = window.prompt(promptText)?.trim();
    if (!value) return;
    if (values.includes(value)) return toast.error("该路径已存在");
    onChange([...values, value]);
    toast.success("路径已保存到本机设置");
  };

  return (
    <div className="py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="tt-label">路径列表</div>
        <TTButton size="sm" onClick={add}>
          <Plus className="size-3" /> 添加
        </TTButton>
      </div>
      {values.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">尚未添加自定义路径。</p>
      ) : (
        <ul className="space-y-1.5">
          {values.map((path) => (
            <li
              key={path}
              className="tt-num flex items-center justify-between gap-2 rounded-sm bg-surface-2 px-3 py-1.5 text-[12px]"
            >
              <span className="break-all">{path}</span>
              <button
                onClick={() => onChange(values.filter((item) => item !== path))}
                className="shrink-0 text-muted-foreground hover:text-danger"
                aria-label={`删除 ${path}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function createRuleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `rule-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function SecurityRuleManager({
  rules,
  onChange,
}: {
  rules: UserSecurityRule[];
  onChange: (rules: UserSecurityRule[]) => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SecurityRuleKind>("恶意 URL");
  const [pattern, setPattern] = useState("");

  const addRule = () => {
    const normalizedName = name.trim();
    if (!normalizedName) {
      toast.error("请输入规则名称");
      return;
    }
    if (normalizedName.length > 80) {
      toast.error("规则名称不能超过 80 个字符");
      return;
    }
    const validation = validateSecurityRulePattern(pattern);
    if (!validation.valid) {
      toast.error(validation.message);
      return;
    }
    onChange([
      ...rules,
      {
        id: createRuleId(),
        name: normalizedName,
        kind,
        pattern: pattern.trim(),
        enabled: true,
      },
    ]);
    setName("");
    setPattern("");
    toast.success("安全规则已保存到本机");
  };

  return (
    <div>
      <div className="rounded-sm border border-border bg-surface-2 p-3">
        <div className="tt-label mb-3">新增本地正则规则</div>
        <div className="grid gap-2 lg:grid-cols-[minmax(140px,0.8fr)_140px_minmax(220px,1.5fr)_auto]">
          <input
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            placeholder="规则名称"
            aria-label="规则名称"
            className="h-8 rounded-sm border border-border bg-background px-2 text-[13px]"
          />
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as SecurityRuleKind)}
            aria-label="规则分类"
            className="h-8 rounded-sm border border-border bg-background px-2 text-[13px]"
          >
            {SECURITY_RULE_KINDS.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <input
            value={pattern}
            maxLength={500}
            onChange={(event) => setPattern(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") addRule();
            }}
            placeholder="JavaScript 正则表达式，例如 evil\\.example"
            aria-label="正则表达式"
            className="tt-num h-8 rounded-sm border border-border bg-background px-2 text-[13px]"
          />
          <TTButton size="sm" onClick={addRule}>
            <Plus className="size-3" /> 添加规则
          </TTButton>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          新增前会校验 JavaScript 正则表达式；规则仅保存在当前设备的 localStorage。
        </p>
      </div>

      {rules.length === 0 ? (
        <p className="py-5 text-center text-[12px] text-muted-foreground">
          尚未添加用户规则，扫描仍会使用内置安全规则。
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center gap-3 rounded-sm border border-border p-3"
            >
              <Toggle
                value={rule.enabled}
                onChange={(enabled) =>
                  onChange(rules.map((item) => (item.id === rule.id ? { ...item, enabled } : item)))
                }
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">{rule.name}</span>
                  <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {rule.kind}
                  </span>
                  <span className={rule.enabled ? "text-ok" : "text-muted-foreground"}>
                    {rule.enabled ? "已启用" : "已禁用"}
                  </span>
                </div>
                <code className="tt-num mt-1 block break-all text-[11px] text-muted-foreground">
                  /{rule.pattern}/i
                </code>
              </div>
              <button
                onClick={() => {
                  onChange(rules.filter((item) => item.id !== rule.id));
                  toast.success("安全规则已删除");
                }}
                className="text-muted-foreground hover:text-danger"
                aria-label={`删除规则 ${rule.name}`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const emptyProviderBudget = (): ProviderBudget => ({
  provider: "",
  dailyBudget: 0,
  weeklyBudget: 0,
  monthlyBudget: 0,
});

function ProviderBudgetManager({
  budgets,
  onChange,
}: {
  budgets: ProviderBudget[];
  onChange: (budgets: ProviderBudget[]) => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<ProviderBudget>(emptyProviderBudget);

  const save = () => {
    const provider = draft.provider.trim();
    if (!provider) {
      toast.error("请输入服务商名称");
      return;
    }
    const duplicate = budgets.some(
      (item, index) =>
        index !== editingIndex && item.provider.toLowerCase() === provider.toLowerCase(),
    );
    if (duplicate) {
      toast.error("该服务商预算已存在");
      return;
    }
    const next = { ...draft, provider };
    onChange(
      editingIndex == null
        ? [...budgets, next]
        : budgets.map((item, index) => (index === editingIndex ? next : item)),
    );
    setEditingIndex(null);
    setDraft(emptyProviderBudget());
    toast.success(editingIndex == null ? "服务商预算已新增" : "服务商预算已更新");
  };

  const budgetField = (key: "dailyBudget" | "weeklyBudget" | "monthlyBudget", label: string) => (
    <label className="grid gap-1 text-[11px] text-muted-foreground">
      {label}
      <NumberField
        value={draft[key]}
        suffix="元"
        ariaLabel={label}
        onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))}
      />
    </label>
  );

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-3">
        <div className="text-[13px] font-medium">按服务商设置预算</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          名称忽略大小写判重；金额均为人民币，设置为零表示关闭该周期预算。
        </div>
      </div>
      <div className="grid items-end gap-2 rounded-sm border border-border bg-surface-2 p-3 lg:grid-cols-[minmax(150px,1fr)_auto_auto_auto_auto]">
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          服务商名称
          <input
            value={draft.provider}
            onChange={(event) =>
              setDraft((current) => ({ ...current, provider: event.target.value }))
            }
            placeholder="例如：OpenAI"
            aria-label="服务商名称"
            className="h-8 rounded-sm border border-border bg-background px-2 text-[13px]"
          />
        </label>
        {budgetField("dailyBudget", "每日预算")}
        {budgetField("weeklyBudget", "每周预算")}
        {budgetField("monthlyBudget", "每月预算")}
        <div className="flex gap-2">
          <TTButton size="sm" onClick={save}>
            {editingIndex == null ? <Plus className="size-3" /> : <Pencil className="size-3" />}
            {editingIndex == null ? "新增" : "保存"}
          </TTButton>
          {editingIndex != null && (
            <TTButton
              size="sm"
              onClick={() => {
                setEditingIndex(null);
                setDraft(emptyProviderBudget());
              }}
            >
              取消
            </TTButton>
          )}
        </div>
      </div>

      {budgets.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-muted-foreground">尚未设置服务商预算。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {budgets.map((budget, index) => (
            <li
              key={budget.provider.toLowerCase()}
              className="flex flex-wrap items-center gap-3 rounded-sm border border-border px-3 py-2 text-[12px]"
            >
              <span className="min-w-28 flex-1 font-medium">{budget.provider}</span>
              <span className="tt-num text-muted-foreground">日 ¥{budget.dailyBudget}</span>
              <span className="tt-num text-muted-foreground">周 ¥{budget.weeklyBudget}</span>
              <span className="tt-num text-muted-foreground">月 ¥{budget.monthlyBudget}</span>
              <button
                onClick={() => {
                  setEditingIndex(index);
                  setDraft({ ...budget });
                }}
                className="text-muted-foreground hover:text-primary"
                aria-label={`编辑服务商预算 ${budget.provider}`}
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={() => {
                  onChange(budgets.filter((_, itemIndex) => itemIndex !== index));
                  setEditingIndex(null);
                  setDraft(emptyProviderBudget());
                  toast.success("服务商预算已删除");
                }}
                className="text-muted-foreground hover:text-danger"
                aria-label={`删除服务商预算 ${budget.provider}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LocalCollectionStatus({
  snapshot,
  error,
}: {
  snapshot: LocalUsageSnapshot;
  error: string | null;
}) {
  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium">真实数据源</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            本地采集状态 · 生成时间：{formatDateTime(snapshot.generatedAt)}
          </div>
        </div>
        <StatusBadge tone={error ? "danger" : snapshot.mode === "real" ? "ok" : "warn"}>
          <Dot className={error ? "bg-danger" : snapshot.mode === "real" ? "bg-ok" : "bg-warn"} />
          {error ? "读取失败" : snapshot.mode === "real" ? "真实数据" : "暂无事件"}
        </StatusBadge>
      </div>

      {error && (
        <div className="mb-3 rounded-sm border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          本地采集状态读取失败：{error}。未使用 Mock 数据，请稍后刷新重试。
        </div>
      )}
      {!error && snapshot.mode === "empty" && (
        <div className="mb-3 rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          未发现可解析的本地使用记录，以下为真实 Adapter 探测结果，不会填充 Mock 数据。
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {snapshot.sources.map((source) => (
          <div
            key={source.source}
            data-testid="local-usage-adapter"
            className="rounded-sm border border-border bg-surface-2/35 px-3 py-2 text-xs"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 font-medium">
                <Dot
                  className={
                    source.available ? "bg-ok" : source.detected ? "bg-warn" : "bg-muted-foreground"
                  }
                />
                <span className="truncate">{sourceLabel(source.source)}</span>
              </div>
              <span
                className={
                  source.available
                    ? "text-ok"
                    : source.detected
                      ? "text-warn"
                      : "text-muted-foreground"
                }
              >
                {source.available
                  ? "有数据"
                  : source.detected
                    ? "已发现 · 暂无日志"
                    : "未发现客户端"}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span className="flex items-center gap-1">
                <FolderOpen className="size-3.5" />
                文件读取 <strong className="tt-num text-foreground">
                  {source.filesRead}
                </strong> / {source.filesConsidered}
              </span>
              <span className="flex items-center gap-1">
                <Database className="size-3.5" />
                事件{" "}
                <strong className="tt-num text-foreground">{source.events.toLocaleString()}</strong>
              </span>
              <span className={source.malformedLines > 0 ? "tt-num text-warn" : "tt-num"}>
                异常行 {source.malformedLines}
              </span>
            </div>
            {source.paths && source.paths.length > 0 && (
              <div className="mt-2 break-all border-t border-border/70 pt-2 text-[10px] text-muted-foreground">
                扫描目录：{source.paths.join(" · ")}
              </div>
            )}
          </div>
        ))}
      </div>
      {snapshot.sources.length === 0 && (
        <p className="rounded-sm border border-border px-3 py-4 text-center text-xs text-muted-foreground">
          当前未返回 Adapter 探测结果，未使用 Mock 数据。
        </p>
      )}
    </div>
  );
}

function AdapterConfigManager({ initialConfig }: { initialConfig: UsageAdapterConfigState }) {
  const router = useRouter();
  const [text, setText] = useState(initialConfig.text);
  const [saving, setSaving] = useState(false);

  useEffect(() => setText(initialConfig.text), [initialConfig.text]);

  const addPreset = (id: keyof typeof USAGE_ADAPTER_PRESETS) => {
    try {
      const parsed = JSON.parse(text) as {
        version?: number;
        adapters?: Array<{ id?: string }>;
      };
      const adapters = Array.isArray(parsed.adapters) ? parsed.adapters : [];
      const preset = USAGE_ADAPTER_PRESETS[id];
      const next = [...adapters.filter((adapter) => adapter.id !== preset.id), preset];
      setText(`${JSON.stringify({ version: 1, adapters: next }, null, 2)}\n`);
      toast.success(`${id === "aipy" ? "Aipy" : "WorkBuddy"} 配置已加入，点击保存后生效`);
    } catch {
      toast.error("请先修复当前 JSON，再添加预设");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const state = await saveUsageAdapterConfig({ data: text });
      setText(state.text);
      toast.success("数据源配置已保存，正在重新扫描");
      await router.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "数据源配置保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium">可配置数据源</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            配置文件：{initialConfig.path} · 支持 JSON、JSONL、只读 SQLite
          </div>
        </div>
        <div className="flex gap-2">
          <TTButton variant="ghost" size="sm" onClick={() => addPreset("aipy")}>
            添加 Aipy
          </TTButton>
          <TTButton variant="ghost" size="sm" onClick={() => addPreset("workbuddy")}>
            添加 WorkBuddy
          </TTButton>
          <TTButton size="sm" onClick={save} disabled={saving}>
            {saving ? "保存中…" : "保存并扫描"}
          </TTButton>
        </div>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        aria-label="数据源适配器 JSON 配置"
        className="tt-num mt-3 min-h-72 w-full resize-y rounded-sm border border-border bg-surface-2 p-3 text-[11px] leading-5"
      />
      <p className="mt-2 text-[11px] text-muted-foreground">
        SQLite 仅允许单条 SELECT/WITH 查询并以只读模式打开；路径必须相对用户主目录。
      </p>
    </div>
  );
}

function SettingsPage() {
  const { snapshot, error, adapterConfig } = Route.useLoaderData();
  const [category, setCategory] = useState<Category>("通用");
  const [autoLaunchEnabled, setAutoLaunchEnabled] = useState(false);
  const [autoLaunchStatus, setAutoLaunchStatus] = useState<AutoLaunchStatus>("正在读取");
  const { settings, setSettings, loaded } = useTrustToolsSettings();
  const { theme, setTheme } = useTheme();
  const update = <K extends keyof TrustToolsSettings>(key: K, value: TrustToolsSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

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
              <Field label="语言" hint="当前仅提供中文界面">
                <span className="text-[13px] text-muted-foreground">中文</span>
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
              <Field label="设置存储位置">
                <span className="text-[12px] text-muted-foreground">浏览器本地存储</span>
              </Field>
            </div>
          )}

          {category === "数据采集" && (
            <div>
              <Field label="智能体工具自动发现">
                <Toggle
                  value={settings.autoDiscoverAgents}
                  onChange={(value) => update("autoDiscoverAgents", value)}
                />
              </Field>
              <Field label="采集频率" hint="实时模式每 5 秒增量扫描；窗口重新获得焦点时立即扫描">
                <Segmented
                  value={settings.collectionFrequency}
                  onChange={(value) => update("collectionFrequency", value)}
                  options={[
                    { value: "realtime", label: "实时" },
                    { value: "5m", label: "每 5 分钟" },
                    { value: "30m", label: "每 30 分钟" },
                  ]}
                />
              </Field>
              <DirectoryList
                values={settings.monitoredDirectories}
                onChange={(value) => update("monitoredDirectories", value)}
                promptText="输入要记录的绝对路径或 ~/ 路径"
              />
              <LocalCollectionStatus snapshot={snapshot} error={error} />
              <AdapterConfigManager initialConfig={adapterConfig} />
            </div>
          )}

          {category === "技能管理" && (
            <div>
              <Field label="低频参考线" hint="未来接入真实调用记录后使用">
                <NumberField
                  value={settings.lowFrequencyCount}
                  suffix="次"
                  onChange={(value) => update("lowFrequencyCount", value)}
                />
              </Field>
              <Field label="休眠参考线">
                <NumberField
                  value={settings.dozeDays}
                  suffix="天"
                  onChange={(value) => update("dozeDays", value)}
                />
              </Field>
              <Field label="废弃参考线">
                <NumberField
                  value={settings.deadDays}
                  suffix="天"
                  onChange={(value) => update("deadDays", value)}
                />
              </Field>
              <Field label="回收站恢复窗口" hint="安全策略固定为 5 分钟">
                <span className="tt-num text-[13px]">5 分钟</span>
              </Field>
              <Field label="黑名单" hint="在技能详情页加入或移出，持久化到 ~/.trusttools">
                <span className="text-[12px] text-muted-foreground">由技能页面管理</span>
              </Field>
            </div>
          )}

          {category === "记忆" && (
            <div>
              <Field label="自动发现常见记忆路径">
                <Toggle
                  value={settings.memoryAutoDiscover}
                  onChange={(value) => update("memoryAutoDiscover", value)}
                />
              </Field>
              <DirectoryList
                values={settings.memoryDirectories}
                onChange={(value) => update("memoryDirectories", value)}
                promptText="输入文档文件或目录的绝对路径，也可使用 ~/ 开头"
              />
              <Field label="默认排除目录">
                <input
                  value={settings.memoryExcludes.join(", ")}
                  onChange={(event) =>
                    update(
                      "memoryExcludes",
                      event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    )
                  }
                  className="h-8 w-64 rounded-sm border border-border bg-surface-2 px-2 text-[13px]"
                />
              </Field>
            </div>
          )}

          {category === "安全规则" && (
            <SecurityRuleManager
              rules={settings.securityRules}
              onChange={(rules) => update("securityRules", rules)}
            />
          )}

          {category === "预警" && (
            <div>
              <Field label="日预算上限">
                <NumberField
                  value={settings.dailyBudget}
                  suffix="¥"
                  onChange={(value) => update("dailyBudget", value)}
                />
              </Field>
              <Field label="周预算上限">
                <NumberField
                  value={settings.weeklyBudget}
                  suffix="¥"
                  onChange={(value) => update("weeklyBudget", value)}
                />
              </Field>
              <Field label="月预算上限">
                <NumberField
                  value={settings.monthlyBudget}
                  suffix="¥"
                  onChange={(value) => update("monthlyBudget", value)}
                />
              </Field>
              <Field label="预警阈值">
                <Segmented
                  value={String(settings.alertThreshold)}
                  onChange={(value) => update("alertThreshold", Number(value) as 80 | 90 | 100)}
                  options={[
                    { value: "80", label: "80%" },
                    { value: "90", label: "90%" },
                    { value: "100", label: "100%" },
                  ]}
                />
              </Field>
              <ProviderBudgetManager
                budgets={settings.providerBudgets}
                onChange={(value) => update("providerBudgets", value)}
              />
            </div>
          )}

          {category === "外观" && (
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
                  <div className="mt-1 text-[11px] text-muted-foreground">{item.desc}</div>
                </button>
              ))}
            </div>
          )}

          {category === "关于" && (
            <div>
              <Field label="版本">
                <span className="tt-num text-[13px]">V3.0.1</span>
              </Field>
              <Field label="运行形态">
                <span className="text-[13px] text-muted-foreground">
                  {autoLaunchStatus === "浏览器不可用" ? "本地浏览器客户端" : "桌面客户端"}
                </span>
              </Field>
              <Field label="人工智能安全审查">
                <span className="text-[13px] text-warn">未配置</span>
              </Field>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
