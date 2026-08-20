import {
  AlertTriangle,
  Check,
  ChevronDown,
  FlaskConical,
  FolderOpen,
  History,
  Info,
  Loader2,
  Search,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { BrandIcon } from "../../../../components/BrandIcon";
import { EmptyState } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { DistillationSessionItem } from "../index.ts";
import { MaterialPicker } from "./MaterialDrawer.tsx";
import {
  OUT_GROUPS,
  OUT_TYPES,
  outTypeMeta,
  type OutTypeId,
} from "./out-types.ts";
import {
  isConfigMaterial,
  type DistillationMaterialGranularity,
  type DistillationTimeRange,
} from "./materials.ts";

const PRESETS = [
  { id: "summary", key: "distill.presetSummary" },
  { id: "skill", key: "distill.presetSkill" },
  { id: "brief", key: "distill.presetBrief" },
] as const;

const PROMPT_BY_PRESET = {
  summary: "distill.presetPromptSummary",
  skill: "distill.presetPromptSkill",
  brief: "distill.presetPromptBrief",
} as const;

export interface DistillConfigModelOption {
  readonly id: string;
  readonly label: string;
  readonly offline?: boolean;
}

/** Renderer-safe projection of the server-side daily quota (Story B-600). */
export interface DistillQuotaView {
  readonly used: number;
  readonly limit: number;
  /** Calls still available today (`max(0, limit - used)`). */
  readonly remaining: number;
}

/** ①/②/③ 步骤标签（原型 StepTag）：编号为 chart-1 底色圆点。 */
function StepTag({ n, text }: { n: string; text: string }) {
  return (
    <span className="flex w-[60px] shrink-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
      <span
        className="grid size-4 shrink-0 place-items-center rounded-full text-[9.5px] font-semibold"
        style={{
          background: "color-mix(in oklab, var(--chart-1) 20%, transparent)",
          color: "var(--chart-1)",
        }}
      >
        {n}
      </span>
      {text}
    </span>
  );
}

/** 素材列表行左侧标签：与 StepTag 文本对齐（原型 pl-[22px]）。 */
function RowLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`w-[60px] shrink-0 pl-[22px] font-mono text-[11px] text-muted-foreground ${className}`}
    >
      {children}
    </span>
  );
}

/**
 * Output-type picker (prototype ② 出产物): two group cards — capability
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
              <span className="tt-tag ml-auto shrink-0 font-mono">
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
                    className={`tt-chip font-mono ${on ? "tt-chip-on" : ""}`}
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
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle
      ? options.filter((option) =>
          option.label.toLocaleLowerCase().includes(needle),
        )
      : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div ref={rootRef} className="relative max-w-[360px]">
      <button
        type="button"
        onClick={() => setOpen((currentOpen) => !currentOpen)}
        className="flex w-full items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left ring-1 ring-border/70"
        aria-expanded={open}
      >
        <span
          className={`size-1.5 shrink-0 rounded-full ${current?.offline ? "bg-warn" : "bg-ok"}`}
        />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {current?.offline ? t("distill.proOffline") : current?.label}
        </span>
        <span className="truncate font-mono text-[10px] text-muted-foreground">
          {current?.id}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 w-full min-w-[300px] rounded-xl bg-card p-1.5 shadow-2xl ring-1 ring-border">
          <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("distill.modelSearch")}
              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] outline-none"
            />
          </div>
          <div className="mt-1 max-h-56 overflow-y-auto">
            {visible.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                  setQuery("");
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left ${
                  option.id === value ? "bg-accent" : "hover:bg-accent/60"
                }`}
              >
                <BrandIcon name={option.label} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-[12px]">
                  {option.offline ? t("distill.proOffline") : option.label}
                </span>
                {option.id === value && (
                  <Check className="size-3.5 text-primary" />
                )}
              </button>
            ))}
            {visible.length === 0 && (
              <p className="px-3 py-6 text-center font-mono text-[11px] text-muted-foreground">
                {t("distill.modelNoMatch")}
              </p>
            )}
          </div>
        </div>
      )}
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
  promptPreset,
  onPromptPreset,
  promptText,
  onPromptText,
  outType,
  onOutType,
  historyCount,
  segmentsCount,
  onHistory,
  onSwitchModel,
  availableItems,
  selected,
  selectedItems,
  onToggle,
  onToggleProject,
  onOpenMaterial,
  onRemoveItem,
  onRun,
  canRun,
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
  promptPreset: string;
  onPromptPreset: (value: string) => void;
  promptText: string;
  onPromptText: (value: string) => void;
  /** Selected output type (prototype ② 出产物). */
  outType: OutTypeId;
  onOutType: (value: OutTypeId) => void;
  /** Number of persisted candidates, shown on the header history chip. */
  historyCount: number;
  /** Number of user-selected transcript segments (drives the privacy note). */
  segmentsCount?: number;
  /** Open the distill-history dialog (E-600). */
  onHistory: () => void;
  /** Switch the pro-mode model to the first non-offline option (E-400). */
  onSwitchModel: () => void;
  availableItems: readonly DistillationSessionItem[];
  selected: ReadonlySet<string>;
  selectedItems: readonly DistillationSessionItem[];
  onToggle: (item: DistillationSessionItem) => void;
  onToggleProject: (items: readonly DistillationSessionItem[]) => void;
  onOpenMaterial: () => void;
  onRemoveItem: (item: DistillationSessionItem) => void;
  onRun: () => void;
  canRun: boolean;
  busy: boolean;
}) {
  const { t } = useI18n();
  const pickPreset = (id: string) => {
    onPromptPreset(id);
    const key = PROMPT_BY_PRESET[id as keyof typeof PROMPT_BY_PRESET];
    if (key) onPromptText(t(key));
  };

  const realModel = mode === "pro" && modelId !== "offline";
  const hasRealModels = modelOptions.some((option) => !option.offline);
  const quotaExhausted = quota != null && quota.remaining <= 0 && realModel;
  const configMode = isConfigMaterial(granularity);
  const typeMeta = outTypeMeta(outType);
  const switchTarget = modelOptions.find((option) => !option.offline);
  const statusLabel =
    quota != null && realModel
      ? t("distill.quotaHeader", { count: quota.remaining })
      : hasRealModels
        ? t("distill.ownModelConnected")
        : t("distill.ownModelUnconfigured");

  return (
    <section className="shrink-0 rounded-xl bg-card p-5">
      {/* 卡头：标题 + quick/pro chips + 额度/模型状态 + 历史 + 管理模型 */}
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-[13px] font-semibold tracking-tight">
          {t("distill.configTitle")}
        </h2>
        <div className="tt-toolbar shrink-0 gap-1">
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
              className={`tt-chip font-mono ${mode === key ? "tt-chip-on" : ""}`}
            >
              <Icon className="size-3" /> {label}
            </button>
          ))}
        </div>
        <span
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
          title={statusLabel}
        >
          {statusLabel}
        </span>
        <button
          type="button"
          onClick={onHistory}
          className="tt-chip shrink-0 font-mono"
        >
          <History className="size-3" />
          {t("distill.historyHeader")}
          {historyCount > 0 ? ` · ${historyCount}` : ""}
        </button>
        <Link
          to="/settings"
          search={{ section: "model" }}
          className="tt-chip shrink-0 font-mono"
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
        {/* ① 选素材：粒度（会话 / 项目 / 配置）+ 时间（quick 模式） */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
          <StepTag n="1" text={t("distill.stepMaterial")} />
          {mode === "quick" && (
            <>
              <div className="tt-toolbar gap-1">
                {(
                  [
                    ["session", t("distill.grainSession")],
                    ["project", t("distill.grainProject")],
                    ["config", t("distill.configMaterial")],
                  ] as const
                ).map(([value, label]) => {
                  const on = granularity === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => onGranularity(value)}
                      aria-pressed={on}
                      className={`tt-chip font-mono ${on ? "tt-chip-on" : ""}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="h-4 w-px bg-border/60" />
              <div className="tt-toolbar gap-1">
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
                      className={`tt-chip font-mono ${on ? "tt-chip-on" : ""}`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <span className="font-mono text-[10.5px] text-muted-foreground">
                {t("distill.rangeSessions", { count: availableItems.length })}
              </span>
            </>
          )}
        </div>

        {/* 素材列表行：quick = 会话/项目卡片；pro = 素材盒；config = 诚实空态 */}
        <div className="flex flex-wrap items-start gap-3 py-3">
          <RowLabel className="mt-1">
            {configMode
              ? t("distill.configMaterial")
              : granularity === "project"
                ? t("distill.materialProject")
                : t("distill.materialSession")}
          </RowLabel>
          <div className="min-w-0 flex-1">
            {configMode ? (
              <>
                <p className="mb-2 font-mono text-[10.5px] text-muted-foreground">
                  {t("distill.configMaterialHint")}
                </p>
                {/* No tool config-file source in the data layer yet — honest empty
                    state instead of fabricating a TOOL_PROMPT_FILES mock list. */}
                <EmptyState
                  icon={<FolderOpen className="size-5" />}
                  title={t("distill.configMaterialEmpty")}
                  desc={t("distill.configMaterialEmptyDesc")}
                />
              </>
            ) : mode === "quick" ? (
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
                  selectedItems.length
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
                      {t("distill.proSelected", {
                        count: selectedItems.length,
                      })}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                      {t("distill.materialPrivacyShort")}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenMaterial}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 font-mono text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: "var(--chart-1)" }}
                  >
                    <FolderOpen className="size-3.5" />
                    {t("common.distillation.openMaterial")}
                  </button>
                </div>
                {selectedItems.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {selectedItems.map((item) => (
                      <li
                        key={`${item.source}:${item.sessionId}`}
                        className="inline-flex max-w-56 items-center gap-1.5 rounded-full bg-foreground/[0.06] px-2.5 py-1 font-mono text-[10px]"
                      >
                        <BrandIcon
                          name={item.source}
                          className="size-3.5 shrink-0"
                        />
                        <span className="truncate">{item.title}</span>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item)}
                          aria-label={t("common.cancel")}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        {mode === "pro" && (
          <>
            <div className="flex flex-wrap items-center gap-3 py-3">
              <RowLabel>{t("distill.proModel")}</RowLabel>
              <div className="min-w-0 flex-1">
                <ModelSelect
                  options={modelOptions}
                  value={modelId}
                  onChange={onModelId}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-3 py-3">
              <RowLabel className="mt-2">{t("distill.proPresets")}</RowLabel>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => pickPreset(preset.id)}
                      className={`rounded-lg px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                        promptPreset === preset.id
                          ? "bg-foreground text-background"
                          : "bg-surface-2 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      + {t(preset.key)}
                    </button>
                  ))}
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
                    className="min-h-[76px] w-full resize-y rounded-lg bg-surface-2 px-3 py-2 pb-6 text-[12px] leading-6 outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-primary"
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
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3">
          <StepTag n="2" text={t("distill.outLabel")} />
          <OutTypePicker value={outType} onChange={onOutType} />
        </div>

        {/* ③ 跑蒸馏 */}
        <div className="flex flex-wrap items-center gap-3 py-3 pb-0">
          <StepTag n="3" text={t("distill.runLabel")} />
          <button
            type="button"
            onClick={onRun}
            disabled={!canRun || busy}
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
            {configMode
              ? t("distill.configMaterialRunHint")
              : selectedItems.length > 0
                ? t("distill.runSummary", { count: selectedItems.length })
                : t("common.distillation.runHint")}
          </span>
          {!configMode && selectedItems.length >= 8 && (
            <span className="inline-flex items-center gap-1 text-[10.5px] text-warn">
              <AlertTriangle className="size-3" /> {t("distill.selectionLimit")}
            </span>
          )}
          {!configMode && quota != null && !realModel && (
            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
              <Info className="size-3" /> {t("distill.quotaOffline")}
            </span>
          )}
          {(segmentsCount ?? 0) > 0 && (
            <span className="inline-flex basis-full items-start gap-1.5 pl-[72px] text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              {t("distill.segment.privacyNote")}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
