import { FolderOpen, Play, X } from "lucide-react";

import { Panel, Segmented, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { DistillationSessionItem } from "../index.ts";
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

export function DistillConfig({
  mode,
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
  selectedItems,
  onOpenMaterial,
  onRemoveItem,
  onRun,
  canRun,
  busy,
}: {
  mode: "quick" | "pro";
  timeRange: DistillationTimeRange;
  onTimeRange: (value: DistillationTimeRange) => void;
  granularity: DistillationMaterialGranularity;
  onGranularity: (value: DistillationMaterialGranularity) => void;
  modelId: string;
  onModelId: (value: string) => void;
  modelOptions: readonly DistillConfigModelOption[];
  promptPreset: string;
  onPromptPreset: (value: string) => void;
  promptText: string;
  onPromptText: (value: string) => void;
  selectedItems: readonly DistillationSessionItem[];
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
    <Panel title={t("distill.configTitle")} className="mb-3">
      {mode === "quick" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">
                {t("distill.quickTimeRange")}
              </div>
              <Segmented
                value={timeRange}
                onChange={onTimeRange}
                options={[
                  { value: "today", label: t("distill.rangeToday") },
                  { value: "7", label: t("distill.range7") },
                  { value: "30", label: t("distill.range30") },
                  { value: "all", label: t("distill.rangeAll") },
                ]}
              />
            </div>
            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">
                {t("distill.quickGranularity")}
              </div>
              <Segmented
                value={granularity}
                onChange={onGranularity}
                options={[
                  { value: "session", label: t("distill.grainSession") },
                  { value: "project", label: t("distill.grainProject") },
                ]}
              />
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t("distill.quickNote")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <TTButton variant="ghost" size="sm" onClick={onOpenMaterial}>
              <FolderOpen className="size-3.5" />
              {t("distill.proMaterial")}
            </TTButton>
            <span className="text-[11px] text-muted-foreground">
              {t("distill.proSelected", { count: selectedItems.length })}
            </span>
          </div>

          {selectedItems.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {selectedItems.map((item) => (
                <li
                  key={`${item.source}:${item.sessionId}`}
                  className="flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] text-foreground"
                >
                  <span className="max-w-40 truncate">{item.title}</span>
                  <button
                    type="button"
                    aria-label={t("common.distillation.cancel")}
                    onClick={() => onRemoveItem(item)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">
                {t("distill.proModel")}
              </div>
              <select
                value={modelId}
                onChange={(event) => onModelId(event.target.value)}
                aria-label={t("distill.proModel")}
                className="h-9 w-full rounded-lg bg-surface-2/70 px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
              >
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.offline ? t("distill.proOffline") : option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] text-muted-foreground">
                {t("distill.proPresets")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => pickPreset(preset.id)}
                    className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                      promptPreset === preset.id
                        ? "bg-foreground text-background"
                        : "bg-surface-2 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(preset.key)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <textarea
            value={promptText}
            onChange={(event) => onPromptText(event.target.value)}
            placeholder={t("distill.proPromptPlaceholder")}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                onRun();
              }
            }}
            rows={4}
            className="w-full resize-y rounded-lg bg-surface-2/70 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/30"
          />

          <div className="flex justify-end">
            <TTButton
              variant="primary"
              size="sm"
              disabled={!canRun || busy}
              onClick={onRun}
            >
              <Play className="size-3.5" />
              {t("distill.proRun")}
            </TTButton>
          </div>
        </div>
      )}
    </Panel>
  );
}
