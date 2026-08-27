import { ArrowLeftRight, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BrandIcon } from "../../../../components/BrandIcon";
import { AITrackerButton } from "../../../../components/aitracker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { toUiError } from "../../../../lib/errors";
import { useI18n } from "../../../../lib/i18n/context";
import { migrateSourceSkills } from "../../migration.server-fns";
import type { SourcesQueryEntry } from "./model";

/**
 * Sources 一键迁移（Story B-300）目标选择弹窗：可用 agent 多选 grid（排除
 * 源工具自身）+ 冲突策略（默认 skip）。确认后调 `migrateSourceSkills` ——
 * Skill 目录由服务端枚举，路径不出服务端；结果以 toast 汇总。
 */
export function SourceMigrationModal({
  source,
  installedTargetAgents,
  onClose,
  onDone,
}: {
  source: SourcesQueryEntry;
  installedTargetAgents: readonly string[];
  onClose: () => void;
  onDone: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const availableAgents =
    source.skillAgent == null
      ? []
      : installedTargetAgents.filter((agent) => agent !== source.skillAgent);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(availableAgents),
  );
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  const allSelected =
    availableAgents.length > 0 &&
    availableAgents.every((agent) => selected.has(agent));

  const toggle = (agent: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(availableAgents));
  };

  const confirm = async () => {
    const targetAgents = availableAgents.filter((agent) => selected.has(agent));
    if (targetAgents.length === 0) {
      toast.error(t("sources.migrate.selectTarget"));
      return;
    }
    setBusy(true);
    try {
      const result = await migrateSourceSkills({
        data: {
          sourceId: source.id,
          targetAgents,
          onConflict: overwrite ? "overwrite" : "skip",
        },
      });
      if (result.total === 0) {
        toast.info(t("sources.migrate.none"));
      } else if (result.failed.length > 0) {
        const details = result.failed
          .map(
            (failure) =>
              `${failure.skillName} → ${failure.agent}: ${t(
                failure.errorCode ?? "common.error",
                failure.errorParams,
              )}`,
          )
          .join("\n");
        toast.warning(
          t("sources.migrate.doneFailed", {
            succeeded: result.migrated.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          }),
          { description: details },
        );
      } else {
        toast.success(
          t("sources.migrate.done", {
            succeeded: result.migrated.length,
            skipped: result.skipped.length,
          }),
        );
      }
      onClose();
      await onDone();
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("sources.migrate.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("sources.migrate.title", { name: source.name })}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            {t("sources.migrate.desc")}
          </p>

          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">
              {t("sources.migrate.chooseTarget")} · {availableAgents.length}
            </span>
            <button
              type="button"
              onClick={toggleAll}
              disabled={availableAgents.length === 0}
              className="rounded-full bg-accent/50 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {allSelected
                ? t("sources.migrate.clearAll")
                : t("sources.migrate.selectAll")}
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {t("sources.migrate.hint")}
          </p>

          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {availableAgents.map((agent) => {
              const on = selected.has(agent);
              return (
                <button
                  key={agent}
                  type="button"
                  onClick={() => toggle(agent)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition-colors ${
                    on
                      ? "bg-primary/15 text-foreground"
                      : "bg-accent/25 text-foreground hover:bg-accent/50"
                  }`}
                >
                  <span
                    className={`grid size-4 shrink-0 place-items-center rounded-md ${
                      on ? "bg-primary text-primary-foreground" : "bg-accent"
                    }`}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <BrandIcon name={agent} className="size-4 shrink-0" />
                  <span className="truncate">{agent}</span>
                </button>
              );
            })}
          </div>

          {/* 冲突策略：默认 skip（不覆盖已存在的同名 Skill）。 */}
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-2">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
              className="size-4 accent-foreground"
            />
            <span className="text-[12.5px] text-muted-foreground">
              {t("sources.migrate.overwrite")}
            </span>
          </label>
        </div>

        <DialogFooter className="mt-3">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {t("sources.migrate.count", {
              selected: availableAgents.filter((agent) => selected.has(agent))
                .length,
              available: availableAgents.length,
            })}
          </span>
          <AITrackerButton variant="default" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </AITrackerButton>
          <AITrackerButton
            variant="primary"
            disabled={busy || selected.size === 0}
            onClick={() => void confirm()}
          >
            <ArrowLeftRight className="size-3.5" />
            {t("sources.migrate.confirm")}
          </AITrackerButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
