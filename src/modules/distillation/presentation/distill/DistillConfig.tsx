import {
  AlertTriangle,
  Check,
  ChevronDown,
  FlaskConical,
  FolderOpen,
  Loader2,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { BrandIcon } from "../../../../components/BrandIcon";
import { useI18n } from "../../../../lib/i18n/context";
import type { SegmentRef } from "../../contracts";
import type { DistillationSessionItem } from "../index.ts";
import { MaterialPicker } from "./MaterialDrawer.tsx";
import {
  OUT_GROUPS,
  OUT_TYPES,
  outTypeMeta,
  type OutTypeId,
} from "./out-types.ts";
import {
  EST_TOKENS_PER_TURN,
  type DistillationMaterialGranularity,
  type DistillationTimeRange,
} from "./materials.ts";

/** Prototype 5 prompt word presets: Click to add duplicates to the existing text without replacement. */
const PRESETS = [
  { id: "concise", key: "distill.presetConcise" },
  { id: "scripts", key: "distill.presetScripts" },
  { id: "pitfalls", key: "distill.presetPitfalls" },
  { id: "sources", key: "distill.presetSources" },
  { id: "chinese", key: "distill.presetChinese" },
] as const;

const PROMPT_BY_PRESET = {
  concise: "distill.presetPromptConcise",
  scripts: "distill.presetPromptScripts",
  pitfalls: "distill.presetPromptPitfalls",
  sources: "distill.presetPromptSources",
  chinese: "distill.presetPromptChinese",
} as const;

export interface DistillConfigModelOption {
  readonly id: string;
  readonly label: string;
  readonly offline?: boolean;
  /** Vendor group shown in the picker dropdown header (Official / Anthropic / …). */
  readonly vendor?: string;
  /** Secondary mono text under the model name (model or endpoint). */
  readonly sub?: string;
  /** True for the official-mode profile; only official models gate on quota. */
  readonly official?: boolean;
  /** True when the profile has a usable endpoint (status dot). */
  readonly ok?: boolean;
}

/** Renderer-safe projection of the server-side daily quota (Story B-600). */
export interface DistillQuotaView {
  readonly used: number;
  readonly limit: number;
  /** Calls still available today (`max(0, limit - used)`). */
  readonly remaining: number;
}

/** Material list row left label: aligned with StepTag text (prototype pl-[22px]). */
function RowLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`distill-row-label w-[60px] shrink-0 whitespace-nowrap pl-[22px] font-mono text-[11px] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Output-type picker (prototype ② output): two group cards — capability
 * assets → Skill library, memory assets → memory library — each carrying its
 * type chips. Selection drives the run-button label and the prompt directive.
 */
function OutTypePicker({
  value,
  onChange,
}: {
  value: OutTypeId;
  onChange: (value: OutTypeId) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
      {OUT_GROUPS.map((group) => {
        const items = OUT_TYPES.filter((meta) => meta.group === group.id);
        const active = items.some((meta) => meta.id === value);
        return (
          <div
            key={group.id}
            className="rounded-[12px] px-3 py-2.5 transition-colors"
            style={{
              background: active
                ? "color-mix(in oklab, var(--chart-1) 7%, transparent)"
                : "var(--color-surface)",
              boxShadow: active
                ? "inset 0 0 0 1px color-mix(in oklab, var(--chart-1) 40%, transparent)"
                : "inset 0 0 0 1px var(--color-border)",
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[11.5px] font-semibold">
                {t(group.labelKey)}
              </span>
              <span className="aitracker-tag ml-auto shrink-0 font-mono">
                → {t(group.destKey)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {items.map((meta) => {
                const on = meta.id === value;
                return (
                  <button
                    key={meta.id}
                    type="button"
                    onClick={() => onChange(meta.id)}
                    aria-pressed={on}
                    title={t(meta.hintKey)}
                    className={`aitracker-chip font-mono ${on ? "aitracker-chip-on" : ""}`}
                  >
                    {t(meta.labelKey)}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ModelSelect({
  options,
  value,
  onChange,
}: {
  options: readonly DistillConfigModelOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const kw = query.trim().toLocaleLowerCase();
  const list = kw
    ? options.filter((option) =>
        `${option.label} ${option.sub ?? ""} ${option.vendor ?? ""}`
          .toLocaleLowerCase()
          .includes(kw),
      )
    : options;
  const groups = useMemo(() => {
    const map = new Map<string, typeof list>();
    for (const option of list) {
      const vendor = option.vendor ?? t("distill.ownVendor");
      map.set(vendor, [...(map.get(vendor) ?? []), option]);
    }
    return [...map.entries()];
  }, [list, t]);

  return (
    <div ref={rootRef} className="relative w-full sm:max-w-[300px]">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((currentOpen) => !currentOpen)}
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-left transition-colors hover:bg-accent/40"
          style={{ boxShadow: "inset 0 0 0 1px var(--border)" }}
        >
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{
              background: current?.ok ? "var(--chart-2)" : "var(--chart-5)",
            }}
          />
          <span className="truncate text-[12px] leading-5 font-medium">
            {current?.offline ? t("distill.proOffline") : current?.label}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] leading-5 text-muted-foreground">
            {current?.offline ? "" : current?.sub}
          </span>
          <ChevronDown
            className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div
            className="absolute z-30 mt-1.5 w-[320px] max-w-[92vw] rounded-xl bg-card p-1.5"
            style={{
              boxShadow:
                "0 18px 48px -18px rgba(0,0,0,.6), inset 0 0 0 1px var(--border)",
            }}
          >
            <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
              <Search className="size-3.5 shrink-0 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("distill.modelSearch")}
                className="w-full bg-transparent font-mono text-[11.5px] outline-none placeholder:text-muted-foreground"
              />
            </div>
            <div className="aitracker-scroll mt-1.5 max-h-[260px] overflow-y-auto">
              {groups.length === 0 && (
                <div className="px-3 py-6 text-center font-mono text-[11px] text-muted-foreground">
                  {t("distill.modelNoMatch")}
                </div>
              )}
              {groups.map(([vendor, items]) => (
                <div key={vendor} className="mb-1">
                  <div className="px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted-foreground">
                    {vendor}
                  </div>
                  {items.map((option) => {
                    const on = option.id === value;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          onChange(option.id);
                          setOpen(false);
                          setQuery("");
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                          on ? "bg-accent/60" : "hover:bg-accent/35"
                        }`}
                      >
                        <span
                          className="size-1.5 shrink-0 rounded-full"
                          style={{
                            background: option.ok
                              ? "var(--chart-2)"
                              : "var(--chart-5)",
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] leading-4">
                            {option.offline
                              ? t("distill.proOffline")
                              : option.label}
                          </span>
                          <span className="block truncate font-mono text-[10px] leading-4 text-muted-foreground">
                            {option.sub}
                          </span>
                        </span>
                        {on && (
                          <Check
                            className="size-3.5 shrink-0"
                            style={{ color: "var(--chart-1)" }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <Link
              to="/settings"
              search={{ section: "model" }}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-surface-2 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              + {t("distill.addOwnModel")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export function DistillConfig({
  mode,
  onMode,
  timeRange,
  onTimeRange,
  granularity,
  onGranularity,
  modelId,
  onModelId,
  modelOptions,
  quota,
  promptText,
  onPromptText,
  outType,
  onOutType,
  segments,
  onSwitchModel,
  availableItems,
  selected,
  selectedItems,
  onToggle,
  onToggleProject,
  onOpenMaterial,
  onClearSelection,
  onClearSegments,
  onRun,
  canRun,
  modelConfigured = true,
  busy,
}: {
  mode: "quick" | "pro";
  onMode: (value: "quick" | "pro") => void;
  timeRange: DistillationTimeRange;
  onTimeRange: (value: DistillationTimeRange) => void;
  granularity: DistillationMaterialGranularity;
  onGranularity: (value: DistillationMaterialGranularity) => void;
  modelId: string;
  onModelId: (value: string) => void;
  modelOptions: readonly DistillConfigModelOption[];
  /** Server-side daily quota projection; `null` when the ledger is unavailable. */
  quota: DistillQuotaView | null;
  promptText: string;
  onPromptText: (value: string) => void;
  /** Selected output type (prototype ② product). */
  outType: OutTypeId;
  onOutType: (value: OutTypeId) => void;
  /** User-picked transcript windows (pro material box chips + run hint counts). */
  segments: readonly SegmentRef[];
  /** Switch the pro-mode model to the first own (non-official) profile. */
  onSwitchModel: () => void;
  availableItems: readonly DistillationSessionItem[];
  selected: ReadonlySet<string>;
  selectedItems: readonly DistillationSessionItem[];
  onToggle: (item: DistillationSessionItem) => void;
  onToggleProject: (items: readonly DistillationSessionItem[]) => void;
  onOpenMaterial: () => void;
  /** Quick-mode "Clear": Clear the selected session. */
  onClearSelection: () => void;
  /** Pro-mode material box "Clear": Clear the selected clips. */
  onClearSegments: () => void;
  onRun: () => void;
  canRun: boolean;
  modelConfigured?: boolean;
  busy: boolean;
}) {
  const { t, format } = useI18n();
  const pickPreset = (id: string) => {
    const key = PROMPT_BY_PRESET[id as keyof typeof PROMPT_BY_PRESET];
    if (!key) return;
    const text = t(key);
    // Prototype semantics: By default, the existing text is deduplicated and appended (v.trim() ? v.trim()+";" : "") + p.text.
    onPromptText(
      promptText.includes(text)
        ? promptText
        : (promptText.trim() ? `${promptText.trim()}；` : "") + text,
    );
  };

  const selectedOption =
    modelOptions.find((option) => option.id === modelId) ?? modelOptions[0];
  const hasRealModels = modelOptions.some((option) => !option.offline);
  const quotaExhausted =
    quota != null && quota.remaining <= 0 && selectedOption?.official === true;
  const typeMeta = outTypeMeta(outType);
  // The switching target of the quota banner: the first self-owned (unofficial, non-offline) model, consistent with the prototype profiles[0].
  const switchTarget = modelOptions.find(
    (option) => !option.offline && option.official !== true,
  );
  const statusLabel = selectedOption?.official
    ? null
    : selectedOption?.ok
      ? t("distill.ownModelConnected")
      : t("distill.ownModelUnconfigured");
  // The prototype token is heuristically estimated (turns × EST_TOKENS_PER_TURN, E-200).
  const estTokens = selectedItems.reduce(
    (sum, item) => sum + item.turns * EST_TOKENS_PER_TURN,
    0,
  );
  // The material box chips aggregates the number of selections by session (the prototype's "{count} items").
  const segsBySession = useMemo(() => {
    const map = new Map<string, number>();
    for (const seg of segments) {
      const key = `${seg.source}:${seg.sessionId}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [segments]);
  // Chips session title: Press `${source}:${sessionId}` to check the current options.
  const titleByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of availableItems) {
      map.set(`${item.source}:${item.sessionId}`, item.title);
    }
    return map;
  }, [availableItems]);
  const pickedEmpty =
    mode === "pro" ? segments.length === 0 : selected.size === 0;
  const runHint = pickedEmpty
    ? mode === "quick"
      ? granularity === "project"
        ? t("distill.runNeedProject")
        : t("distill.runNeedSession")
      : t("distill.runNeedSegments")
    : mode === "quick"
      ? t("distill.runSummaryQuick", {
          count: selectedItems.length,
          tokens: format.formatTokens(estTokens),
        })
      : t("distill.runSummarySegments", {
          count: segments.length,
          tokens: format.formatTokens(estTokens),
        });

  return (
    <section className="distill-config-card min-w-0 rounded-xl bg-card p-5">
      {/* 卡头：标题 + quick/pro chips + 额度/模型状态 + 历史 + 管理模型 */}
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">
          {t("distill.configTitle")}
        </h2>
        <div className="aitracker-toolbar shrink-0 gap-1">
          {(
            [
              ["quick", t("common.distillation.modeQuick"), Zap],
              ["pro", t("common.distillation.modePro"), FlaskConical],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              onClick={() => onMode(key)}
              aria-pressed={mode === key}
              className={`aitracker-chip font-mono ${mode === key ? "aitracker-chip-on" : ""}`}
            >
              <Icon className="size-3" /> {label}
            </button>
          ))}
        </div>
        {statusLabel && (
          <span
            className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
            title={statusLabel}
          >
            {statusLabel}
          </span>
        )}
        <Link
          to="/settings"
          search={{ section: "model" }}
          className="aitracker-chip shrink-0 font-mono"
        >
          {t("distill.manageModels")}
        </Link>
      </header>

      {/* E-400: exhausted-quota banner with a one-click switch to the first
          own-model profile (prototype lines 883-902). */}
      {quotaExhausted && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
          style={{
            background: "color-mix(in oklab, var(--chart-5) 14%, transparent)",
            color: "var(--chart-5)",
          }}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{t("distill.quotaOutBanner")}</span>
          {switchTarget && (
            <button
              type="button"
              onClick={onSwitchModel}
              className="ml-auto rounded-lg bg-foreground px-3 py-1 font-mono text-[11px] text-background"
            >
              {t("distill.quotaSwitch", { name: switchTarget.label })}
            </button>
          )}
        </div>
      )}

      <div className="mt-3 divide-y divide-border/40">
        {/* ① 选素材：粒度（会话 / 项目）+ 时间（quick 模式）。原型 distill.tsx
            只暴露「按会话 / 按项目」两个粒度；config 素材是原型里的死代码
            （material 状态硬编码为 chat，无入口），故工作台不提供该选项。 */}
        <div className="distill-config-row flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <RowLabel>{t("distill.stepMaterial")}</RowLabel>
          {mode === "quick" && (
            <>
              <div className="aitracker-toolbar gap-1">
                {(
                  [
                    ["session", t("distill.grainSession")],
                    ["project", t("distill.grainProject")],
                  ] as const
                ).map(([value, label]) => {
                  const on = granularity === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onGranularity(value)}
                      aria-pressed={on}
                      className={`aitracker-chip font-mono ${on ? "aitracker-chip-on" : ""}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="h-4 w-px bg-border/60" />
              <div className="aitracker-toolbar gap-1">
                {(
                  [
                    ["today", t("distill.rangeToday")],
                    ["7", t("distill.range7")],
                    ["30", t("distill.range30")],
                    ["all", t("distill.rangeAll")],
                  ] as const
                ).map(([value, label]) => {
                  const on = timeRange === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onTimeRange(value)}
                      aria-pressed={on}
                      className={`aitracker-chip font-mono ${on ? "aitracker-chip-on" : ""}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t("distill.rangeSessions", { count: availableItems.length })}
                {granularity === "session" && selected.size > 0
                  ? ` · ${t("distill.rangeSelected", { count: selected.size })}`
                  : ""}
              </span>
              {granularity === "session" && selected.size > 0 && (
                <button
                  type="button"
                  onClick={onClearSelection}
                  className="font-mono text-[10.5px] text-muted-foreground underline-offset-2 hover:underline"
                >
                  {t("distill.clear")}
                </button>
              )}
            </>
          )}
        </div>

        {/* 素材列表行：quick = 会话/项目卡片；pro = 素材盒；config = 诚实空态 */}
        <div className="distill-config-row flex flex-wrap items-start gap-3 py-3">
          <RowLabel className="mt-1">
            {granularity === "project"
              ? t("distill.materialProject")
              : t("distill.materialSession")}
          </RowLabel>
          <div className="min-w-0 flex-1">
            {mode === "quick" ? (
              <MaterialPicker
                sessions={availableItems}
                selected={selected}
                granularity={granularity}
                onToggle={onToggle}
                onToggleProject={onToggleProject}
                compact
              />
            ) : (
              <div
                className="rounded-xl px-4 py-3.5 transition-colors"
                style={
                  segments.length
                    ? {
                        background:
                          "color-mix(in oklab, var(--chart-1) 8%, transparent)",
                        boxShadow:
                          "inset 0 0 0 1px color-mix(in oklab, var(--chart-1) 45%, transparent)",
                      }
                    : {
                        background: "var(--surface-2)",
                        boxShadow:
                          "inset 0 0 0 1px color-mix(in oklab, var(--foreground) 14%, transparent)",
                      }
                }
              >
                {segments.length === 0 ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-lg"
                      style={{
                        background:
                          "color-mix(in oklab, var(--chart-1) 16%, transparent)",
                      }}
                    >
                      <FolderOpen
                        className="size-4"
                        style={{ color: "var(--chart-1)" }}
                      />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px] font-semibold">
                        {t("distill.materialBoxEmpty")}
                      </div>
                      <div className="mt-0.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                        {t("distill.materialBoxEmptyDesc")}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={onOpenMaterial}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 font-mono text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: "var(--chart-1)" }}
                    >
                      <FolderOpen className="size-3.5" />
                      {t("distill.materialOpen")}
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className="grid size-9 shrink-0 place-items-center rounded-lg"
                        style={{
                          background:
                            "color-mix(in oklab, var(--chart-1) 16%, transparent)",
                        }}
                      >
                        <FolderOpen
                          className="size-4"
                          style={{ color: "var(--chart-1)" }}
                        />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-semibold">
                          {t("distill.materialBoxCount", {
                            chats: segsBySession.size,
                            segs: segments.length,
                          })}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                          {t("distill.materialBoxTokens", {
                            tokens: format.formatTokens(estTokens),
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={onOpenMaterial}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 font-mono text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                        style={{ background: "var(--chart-1)" }}
                      >
                        {t("distill.materialContinue")}
                      </button>
                      <button
                        type="button"
                        onClick={onClearSegments}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-surface-2 px-3 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Trash2 className="size-3.5" />
                        {t("distill.clear")}
                      </button>
                    </div>
                    {segsBySession.size > 0 && (
                      <ul className="mt-3 flex flex-wrap gap-1.5">
                        {[...segsBySession.entries()]
                          .slice(0, 8)
                          .map(([key, count]) => (
                            <li
                              key={key}
                              className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 py-1 font-mono text-[10.5px]"
                            >
                              <BrandIcon
                                name={key.split(":")[0]!}
                                className="size-3.5 shrink-0"
                              />
                              <span className="truncate">
                                {titleByKey.get(key) ?? key.split(":")[1]}
                              </span>
                              <span className="shrink-0 text-muted-foreground">
                                {t("distill.chipCount", { count })}
                              </span>
                            </li>
                          ))}
                        {segsBySession.size > 8 && (
                          <li className="inline-flex items-center rounded-full bg-foreground/[0.06] px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground">
                            +{segsBySession.size - 8}
                          </li>
                        )}
                      </ul>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {mode === "pro" && (
          <>
            <div className="distill-config-row flex flex-wrap items-center gap-3 py-3">
              <RowLabel>{t("distill.proModel")}</RowLabel>
              <div className="min-w-0 flex-1">
                <ModelSelect
                  options={modelOptions}
                  value={modelId}
                  onChange={onModelId}
                />
              </div>
            </div>
            <div className="distill-config-row flex flex-wrap items-start gap-3 py-3">
              <RowLabel className="mt-2">{t("distill.proPresets")}</RowLabel>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => pickPreset(preset.id)}
                      className="rounded-lg bg-surface-2 px-2.5 py-1 font-mono text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      + {t(preset.key)}
                    </button>
                  ))}
                  {promptText.trim() !== "" && (
                    <button
                      type="button"
                      onClick={() => onPromptText("")}
                      className="font-mono text-[10.5px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {t("distill.clear")}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <textarea
                    value={promptText}
                    onChange={(event) => onPromptText(event.target.value)}
                    placeholder={t("distill.proPromptPlaceholder")}
                    onKeyDown={(event) => {
                      if (
                        (event.metaKey || event.ctrlKey) &&
                        event.key === "Enter" &&
                        canRun
                      ) {
                        event.preventDefault();
                        onRun();
                      }
                    }}
                    rows={3}
                    className="min-h-[76px] w-full resize-y rounded-lg bg-surface-2 px-3 py-2 pb-6 text-[12px] leading-6 outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-[var(--chart-1)]"
                  />
                  <span className="pointer-events-none absolute right-3 bottom-2 font-mono text-[9.5px] text-muted-foreground">
                    {t("distill.promptCount", { count: promptText.length })}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* ② 出产物：能力资产 → Skill 库 / 记忆资产 → 记忆库 */}
        <div className="distill-config-row flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
          <RowLabel>{t("distill.outLabel")}</RowLabel>
          <OutTypePicker value={outType} onChange={onOutType} />
        </div>

        {/* ③ 跑蒸馏 */}
        <div className="distill-config-row flex flex-wrap items-center gap-3 py-3 pb-0">
          <RowLabel>{t("distill.runLabel")}</RowLabel>
          <button
            type="button"
            onClick={() => {
              if (!modelConfigured) {
                onRun();
                return;
              }
              onRun();
            }}
            disabled={busy || (!canRun && modelConfigured)}
            className="inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 font-mono text-[11.5px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{
              background: "var(--foreground)",
              color: "var(--background)",
            }}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : mode === "quick" ? (
              <Zap className="size-4" />
            ) : (
              <FlaskConical className="size-4" />
            )}
            {busy
              ? t("distill.running")
              : mode === "quick"
                ? t("distill.runQuick", { type: t(typeMeta.labelKey) })
                : t("distill.runPro", { type: t(typeMeta.labelKey) })}
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
            {!modelConfigured ? (
              <Link
                to="/settings"
                search={{ section: "model" }}
                className="text-warn underline underline-offset-2"
              >
                {t("distill.noModelHint")}
              </Link>
            ) : (
              runHint
            )}
          </span>
        </div>
      </div>
    </section>
  );
}
