import { useMemo, useState } from "react";
import { AlertTriangle, FolderOpen, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  PageHeader,
  Panel,
  Segmented,
  TTButton,
} from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n/messages";
import type { CandidateOutput } from "../contracts";
import type { DistillationSessionItem, DistillationViewModel } from "./index";
import { approveCandidate, cancelCandidate, startDistillation } from "../query";
import { DistillMetrics } from "./distill/DistillMetrics";
import { MaterialDrawer } from "./distill/MaterialDrawer";
import { ExpCard } from "./distill/ExpCard";

const MAX_SELECTION = 8;

function keyOf(item: { source: string; sessionId: string }): string {
  return `${item.source}:${item.sessionId}`;
}

/**
 * Distillation workbench aligned with the prototype: quick/advanced mode,
 * session-level material picker, one-click run and an experiment card. All
 * data is real (existing server fns); without a configured LLM the candidate
 * is honestly marked as an offline fallback.
 */
export function DistillationPage({
  initial,
}: {
  initial: DistillationViewModel;
}) {
  const { t, format } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"quick" | "pro">("quick");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [active, setActive] = useState<CandidateOutput | undefined>(undefined);
  const [runs, setRuns] = useState(0);

  const sessions = useMemo(() => initial.sessions, [initial.sessions]);
  const selectionCount = selected.size;
  const canStart =
    !busy && selectionCount > 0 && selectionCount <= MAX_SELECTION;
  const selectedItems = useMemo(
    () => sessions.filter((item) => selected.has(keyOf(item))),
    [sessions, selected],
  );
  const selectedTurns = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.turns, 0),
    [selectedItems],
  );

  function toggle(item: DistillationSessionItem) {
    setSelected((prev) => {
      const key = keyOf(item);
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      if (next.size >= MAX_SELECTION) return prev;
      next.add(key);
      return next;
    });
  }

  async function handleStart() {
    const refs = selectedItems.map((item) => ({
      source: item.source,
      sessionId: item.sessionId,
    }));
    setBusy(true);
    try {
      const result = await startDistillation({ data: { sessionRefs: refs } });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      setActive(result.candidate);
      setRuns((current) => current + 1);
      toast.success(t("common.success"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleApprove() {
    if (!active) return;
    setBusy(true);
    try {
      const result = await approveCandidate({
        data: { candidateId: active.candidateId },
      });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      setActive(result.candidate);
      toast.success(t("common.success"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!active) return;
    setBusy(true);
    try {
      const result = await cancelCandidate({
        data: { candidateId: active.candidateId },
      });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      setActive(result.candidate);
      toast.success(t("common.success"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const offlineResult =
    active?.mode === "offline" || active?.execution.status === "offline";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={t("common.distillation.pageTitle")}
          desc={t("common.distillation.pageDesc")}
        />
        <div className="flex items-center gap-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "quick", label: t("common.distillation.modeQuick") },
              { value: "pro", label: t("common.distillation.modePro") },
            ]}
          />
          <TTButton
            variant="primary"
            disabled={!canStart}
            title={
              selectionCount === 0
                ? t("common.distillation.runHint")
                : undefined
            }
            onClick={handleStart}
          >
            <Sparkles className="size-3.5" />
            {t("common.distillation.start")}
          </TTButton>
        </div>
      </div>

      {offlineResult && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          <AlertTriangle className="size-3.5 shrink-0" />
          {t("common.distillation.modelNotConfigured")}
        </div>
      )}

      <DistillMetrics
        selectedCount={selectionCount}
        selectedTurns={selectedTurns}
        runs={runs}
        approved={active?.approvalState === "approved" ? 1 : 0}
      />

      <Panel
        className="mb-3"
        title={t("common.distillation.selectSessions", { max: MAX_SELECTION })}
        action={
          <div className="flex items-center gap-2">
            <span className="tt-num text-[11px] text-muted-foreground">
              {t("common.distillation.selected", { count: selectionCount })}
            </span>
            <TTButton
              size="sm"
              variant="ghost"
              onClick={() => setDrawerOpen(true)}
            >
              <FolderOpen className="size-3.5" />
              {t("common.distillation.openMaterial")}
            </TTButton>
          </div>
        }
      >
        {selectedItems.length === 0 ? (
          <EmptyState
            title={t("common.distillation.candidate")}
            desc={t("common.distillation.candidateNote")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {selectedItems.map((item) => (
              <li
                key={keyOf(item)}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-3 text-[13px]"
              >
                <span className="min-w-[180px] flex-1 truncate font-medium text-foreground">
                  {item.title}
                </span>
                <span className="tt-num text-[11px] text-muted-foreground">
                  {item.source}:{item.sessionId}
                </span>
                <span className="tt-num text-[11px] text-muted-foreground">
                  {t("common.distillation.selectedTurns", {
                    count: item.turns,
                  })}
                </span>
                <span className="tt-num text-[11px] text-muted-foreground">
                  {format.formatDateTime(item.startedAt, false)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {active ? (
        <ExpCard
          candidate={active}
          busy={busy}
          onApprove={handleApprove}
          onCancel={handleCancel}
        />
      ) : (
        <Panel title={t("common.distillation.candidate")}>
          <EmptyState
            title={t("common.distillation.candidate")}
            desc={t("common.distillation.candidateNote")}
          />
        </Panel>
      )}

      {drawerOpen && (
        <MaterialDrawer
          sessions={sessions}
          selected={selected}
          onToggle={toggle}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}
