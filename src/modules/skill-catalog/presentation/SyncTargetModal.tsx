import { Check, ChevronDown, Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BrandIcon } from "../../../components/BrandIcon";
import { AITrackerButton } from "../../../components/aitracker";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import {
  requestApprovedSkillSync,
  SKILL_AGENTS,
  type LocalSkill,
  type SkillAgent,
} from "../query.ts";

/**
 * Prototype-style sync-target picker (ToolTargetPicker): a 2-column grid of
 * detected agents with brand icons and check squares, a select-all control and
 * a collapsible "client not detected" section. Sync still runs through the real
 * server function; conflicts are handled with a single overwrite/skip toggle.
 */
export function SyncTargetModal({
  title,
  skills,
  availableAgents,
  onClose,
  onDone,
}: {
  title: string;
  skills: readonly LocalSkill[];
  availableAgents: readonly SkillAgent[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(availableAgents),
  );
  const [overwrite, setOverwrite] = useState(true);
  const [showMissing, setShowMissing] = useState(false);
  const [busy, setBusy] = useState(false);

  const missing = SKILL_AGENTS.filter(
    (agent) => !availableAgents.includes(agent),
  );
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
      toast.error(t("skills.toast.selectTarget"));
      return;
    }
    setBusy(true);
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    const failedDetails: string[] = [];
    try {
      for (const skill of skills) {
        const sourceRef = skill.installations[0]?.installationRef;
        if (!sourceRef) continue;
        try {
          const result = await requestApprovedSkillSync({
            data: {
              confirmed: true,
              installationRef: sourceRef,
              targetAgents,
              onConflict: overwrite ? "overwrite" : "skip",
            },
          });
          succeeded += result.succeeded.length;
          skipped += result.skipped.length;
          failed += result.failed.length;
          result.failed.forEach((failure) =>
            failedDetails.push(
              `${skill.name} → ${failure.agent}: ${t(
                failure.errorCode ?? "common.error",
                failure.errorParams,
              )}`,
            ),
          );
        } catch (error) {
          failed += targetAgents.length;
          const ui = toUiError(error);
          failedDetails.push(
            `${skill.name}: ${ui ? t(ui.code, ui.params) : t("skills.toast.syncFailed")}`,
          );
        }
      }
      if (failed > 0) {
        toast.warning(
          t("skills.toast.syncDoneFailed", { succeeded, skipped, failed }),
          { description: failedDetails.join("\n") },
        );
      } else {
        toast.success(t("skills.toast.syncDone", { succeeded, skipped }));
      }
      onClose();
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("skills.syncTarget.title", { title })}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Header: detected count + select all / clear */}
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground">
              {t("skills.syncTarget.detectedCount", {
                count: availableAgents.length,
              })}
            </span>
            <button
              type="button"
              onClick={toggleAll}
              className="rounded-full bg-accent/50 px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-accent"
            >
              {allSelected
                ? t("skills.syncTarget.clearAll")
                : t("skills.syncTarget.selectAll")}
            </button>
          </div>

          <p className="text-[11px] text-muted-foreground">
            {t("skills.syncTarget.hint")}
          </p>

          {/* 2-col grid of detected agents */}
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

          {/* Collapsible missing agents */}
          {missing.length > 0 && (
            <div className="rounded-xl bg-accent/15 px-3 py-2">
              <button
                type="button"
                onClick={() => setShowMissing((value) => !value)}
                className="flex w-full items-center justify-between text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <span>
                  {t("skills.syncTarget.missingCount", {
                    count: missing.length,
                  })}
                </span>
                <ChevronDown
                  className={`size-3.5 transition-transform ${showMissing ? "rotate-180" : ""}`}
                />
              </button>
              {showMissing && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {missing.map((agent) => (
                    <span
                      key={agent}
                      className="inline-flex items-center gap-1.5 rounded-full bg-accent/30 px-2.5 py-1 text-[11px] text-muted-foreground"
                    >
                      <BrandIcon name={agent} className="size-3.5 opacity-60" />
                      {agent}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Conflict handling (real sync requirement) */}
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-2">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(event) => setOverwrite(event.target.checked)}
              className="size-4 accent-foreground"
            />
            <span className="text-[12.5px] text-muted-foreground">
              {t("skills.syncTarget.overwrite")}
            </span>
          </label>
        </div>

        <DialogFooter className="mt-3">
          <span className="mr-auto text-[11px] text-muted-foreground">
            {t("skills.syncTarget.count", {
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
            <Download className="size-3.5" /> {t("skills.syncTarget.enable")}
          </AITrackerButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
