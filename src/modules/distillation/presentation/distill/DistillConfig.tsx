import {
  AlertTriangle,
  Check,
  ChevronDown,
  FlaskConical,
  FolderOpen,
  Info,
  Play,
  Search,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { BrandIcon } from "../../../../components/BrandIcon";
import { Panel, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { DistillationSessionItem } from "../index.ts";
import { MaterialPicker } from "./MaterialDrawer.tsx";
import type {
  DistillationMaterialGranularity,
  DistillationTimeRange,
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

/**
 * One-line quota status for the config panel. Real-model runs consume the
 * daily quota; offline runs are deterministic and never counted. An exhausted
 * quota shows the warning copy plus a link into the model-profiles settings.
 */
function QuotaHint({
  quota,
  realModel,
}: {
  quota: DistillQuotaView | null;
  realModel: boolean;
}) {
  const { t } = useI18n();
  if (!quota || !realModel) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
        <Info className="size-3" />
        {t("distill.quotaOffline")}
      </span>
    );
  }
  if (quota.remaining <= 0) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-[10.5px] text-warn">
        <AlertTriangle className="size-3 shrink-0" />
        {t("distill.quotaExhausted")}
        <Link
          to="/settings"
          search={{ section: "model" }}
          className="rounded bg-surface-2 px-1.5 py-0.5 text-primary hover:bg-accent"
        >
          {t("distill.quotaManage")}
        </Link>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-ok">
      <Sparkles className="size-3" />
      {t("distill.quotaRemaining", { count: quota.remaining })}
    </span>
  );
}

function ConfigRow({
  label,
  children,
  align = "center",
}: {
  label: string;
  children: React.ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={`flex flex-wrap gap-3 py-3 ${align === "start" ? "items-start" : "items-center"}`}
    >
      <span
        className={`${align === "start" ? "mt-1" : ""} w-16 shrink-0 font-mono text-[11px] text-muted-foreground`}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ChipRail<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={`rounded-full px-3 py-1 font-mono text-[10.5px] transition-colors ${
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "bg-surface-2 text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
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
  promptPreset,
  onPromptPreset,
  promptText,
  onPromptText,
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

  return (
    <Panel
      className="mb-5 overflow-visible"
      title={t("distill.configTitle")}
      action={
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-surface-2 p-0.5">
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
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                mode === key
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-3" /> {label}
            </button>
          ))}
        </div>
      }
      bodyClassName="pt-0"
    >
      <div className="divide-y divide-border/50">
        <ConfigRow label={t("distill.quickTimeRange")}>
          <div className="flex flex-wrap items-center gap-2">
            <ChipRail
              value={timeRange}
              onChange={onTimeRange}
              options={[
                { value: "today", label: t("distill.rangeToday") },
                { value: "7", label: t("distill.range7") },
                { value: "30", label: t("distill.range30") },
                { value: "all", label: t("distill.rangeAll") },
              ]}
            />
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {t("distill.rangeSessions", { count: availableItems.length })}
            </span>
          </div>
        </ConfigRow>

        <ConfigRow label={t("distill.quickGranularity")}>
          <ChipRail
            value={granularity}
            onChange={onGranularity}
            options={[
              { value: "session", label: t("distill.grainSession") },
              { value: "project", label: t("distill.grainProject") },
            ]}
          />
        </ConfigRow>

        {mode === "quick" ? (
          <ConfigRow
            label={
              granularity === "project"
                ? t("distill.materialProject")
                : t("distill.materialSession")
            }
            align="start"
          >
            <p className="mb-2 font-mono text-[10.5px] text-muted-foreground">
              {granularity === "project"
                ? t("distill.projectSelectionHint")
                : t("distill.sessionSelectionHint")}
            </p>
            <MaterialPicker
              sessions={availableItems}
              selected={selected}
              granularity={granularity}
              onToggle={onToggle}
              onToggleProject={onToggleProject}
              compact
            />
          </ConfigRow>
        ) : (
          <>
            <ConfigRow label={t("distill.proMaterial")} align="start">
              <div className="rounded-xl bg-surface-2/70 px-4 py-3 ring-1 ring-border/70">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
                    <FolderOpen className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold">
                      {t("distill.proSelected", {
                        count: selectedItems.length,
                      })}
                    </span>
                    <span className="block font-mono text-[10px] text-muted-foreground">
                      {t("distill.materialPrivacyShort")}
                    </span>
                  </span>
                  <TTButton variant="primary" onClick={onOpenMaterial}>
                    <FolderOpen className="size-3.5" />
                    {t("common.distillation.openMaterial")}
                  </TTButton>
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
            </ConfigRow>
            <ConfigRow label={t("distill.proModel")}>
              <ModelSelect
                options={modelOptions}
                value={modelId}
                onChange={onModelId}
              />
            </ConfigRow>
            <ConfigRow label={t("distill.proPresets")} align="start">
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
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
            </ConfigRow>
          </>
        )}

        <ConfigRow label={t("distill.quotaLabel")}>
          <QuotaHint
            quota={quota}
            realModel={mode === "pro" && modelId !== "offline"}
          />
        </ConfigRow>

        <ConfigRow label={t("distill.runLabel")}>
          <div className="flex flex-wrap items-center gap-3">
            <TTButton
              variant="primary"
              disabled={!canRun || busy}
              onClick={onRun}
            >
              {busy ? (
                <Sparkles className="size-3.5 animate-pulse" />
              ) : (
                <Play className="size-3.5" />
              )}
              {busy
                ? t("distill.running")
                : mode === "quick"
                  ? t("common.distillation.start")
                  : t("distill.proRun")}
            </TTButton>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {selectedItems.length > 0
                ? t("distill.runSummary", { count: selectedItems.length })
                : t("common.distillation.runHint")}
            </span>
            {selectedItems.length >= 8 && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-warn">
                <AlertTriangle className="size-3" />{" "}
                {t("distill.selectionLimit")}
              </span>
            )}
          </div>
        </ConfigRow>
      </div>
    </Panel>
  );
}
