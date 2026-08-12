import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Columns2,
  FolderOpen,
  HelpCircle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  EmptyState,
  PageHeader,
  Panel,
  Segmented,
  TTButton,
} from "../../../components/tt";
import { JarvisInsight } from "../../../components/JarvisInsight";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n/messages";
import type { CandidateOutput, SessionRef } from "../contracts";
import type { DistillationSessionItem, DistillationViewModel } from "./index";
import { approveCandidate, cancelCandidate, startDistillation } from "../query";
import { DistillMetrics } from "./distill/DistillMetrics";
import { MaterialDrawer } from "./distill/MaterialDrawer";
import { ExpCard } from "./distill/ExpCard";
import { DistillConfig } from "./distill/DistillConfig";
import { DISTILL_GUIDE_KEY, DistillGuide } from "./distill/DistillGuide";

const MAX_SELECTION = 8;

function keyOf(item: { source: string; sessionId: string }): string {
  return `${item.source}:${item.sessionId}`;
}

function toRef(item: { source: string; sessionId: string }): SessionRef {
  return { source: item.source, sessionId: item.sessionId };
}

function readGuideSeen(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(DISTILL_GUIDE_KEY) === "1";
  } catch {
    return true;
  }
}

/**
 * Distillation workbench aligned with the V3.0 prototype: shared Jarvis
 * insight card, first-run guide overlay, quick/pro config card, session-level
 * material picker and an experiment card list backed by the persisted
 * candidate store. All figures come from real server fns — sessions, model
 * options, persisted candidates and the workbench counters.
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
  const [candidates, setCandidates] = useState<CandidateOutput[]>(() => [
    ...initial.candidates,
  ]);
  const [runs, setRuns] = useState(initial.stats.runs);
  const [approved, setApproved] = useState(initial.stats.approved);
  const [timeRange, setTimeRange] = useState("all");
  const [granularity, setGranularity] = useState("session");
  const [modelId, setModelId] = useState(
    () =>
      initial.modelOptions.find((option) => !option.offline)?.id ?? "offline",
  );
  const [promptPreset, setPromptPreset] = useState("summary");
  const [promptText, setPromptText] = useState("");
  const [showGuide, setShowGuide] = useState(() => !readGuideSeen());

  const sessions = useMemo(() => initial.sessions, [initial.sessions]);
  const selectionCount = selected.size;
  const canStart =
    !busy && selectionCount > 0 && selectionCount <= MAX_SELECTION;
  const waitingCount = candidates.filter(
    (item) => item.approvalState === "waiting-approval",
  ).length;

  const selectedItems = useMemo(
    () => sessions.filter((item) => selected.has(keyOf(item))),
    [sessions, selected],
  );
  const selectedTurns = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.turns, 0),
    [selectedItems],
  );

  const jarvisLines = useMemo(() => {
    const lines: string[] = [];
    if (selectionCount > 0) {
      lines.push(
        t("distill.insightSelected", {
          count: selectionCount,
          turns: selectedTurns,
        }),
      );
    }
    if (waitingCount > 0) {
      lines.push(t("distill.insightWaiting", { count: waitingCount }));
    }
    if (runs > 0) {
      lines.push(t("distill.insightRuns", { count: runs }));
    }
    if (approved > 0) {
      lines.push(t("distill.insightApproved", { count: approved }));
    }
    if (lines.length === 0) {
      lines.push(t("distill.insightEmpty"));
    }
    return lines;
  }, [selectionCount, selectedTurns, waitingCount, runs, approved, t]);

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

  function removeItem(item: DistillationSessionItem) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(keyOf(item));
      return next;
    });
  }

  function dismissGuide() {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(DISTILL_GUIDE_KEY, "1");
      } catch {
        // localStorage unavailable (private mode) — the guide simply re-appears.
      }
    }
    setShowGuide(false);
  }

  async function runDistillation(
    refs: readonly SessionRef[],
    options?: { modelId?: string; promptText?: string },
  ) {
    if (refs.length === 0) return;
    setBusy(true);
    try {
      const result = await startDistillation({
        data: {
          sessionRefs: refs.map((ref) => ({ ...ref })),
          ...(options?.modelId ? { modelId: options.modelId } : {}),
          ...(options?.promptText ? { promptText: options.promptText } : {}),
        },
      });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      if (result.candidate) {
        setCandidates((prev) => [result.candidate!, ...prev]);
      }
      setRuns((current) => current + 1);
      toast.success(t("common.success"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  function handleStart() {
    void runDistillation(selectedItems.map(toRef), {
      modelId: mode === "pro" ? modelId : undefined,
      promptText: mode === "pro" ? promptText : undefined,
    });
  }

  function handleRegenerate(candidate: CandidateOutput) {
    void runDistillation(candidate.selectedSessionRefs, {
      modelId: mode === "pro" ? modelId : undefined,
      promptText: mode === "pro" ? promptText : undefined,
    });
  }

  async function handleApprove(candidateId: string) {
    setBusy(true);
    try {
      const result = await approveCandidate({
        data: { candidateId },
      });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      if (result.candidate) {
        setCandidates((prev) =>
          prev.map((item) =>
            item.candidateId === candidateId && result.candidate
              ? result.candidate
              : item,
          ),
        );
        setApproved((current) => current + 1);
      }
      toast.success(t("common.success"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel(candidateId: string) {
    setBusy(true);
    try {
      const result = await cancelCandidate({
        data: { candidateId },
      });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      if (result.candidate) {
        setCandidates((prev) =>
          prev.map((item) =>
            item.candidateId === candidateId && result.candidate
              ? result.candidate
              : item,
          ),
        );
      }
      toast.success(t("common.success"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  // No real model is configured, so any run today uses the offline fallback.
  const offlineResult = !initial.modelOptions.some((option) => !option.offline);

  return (
    <>
      {showGuide && <DistillGuide onClose={dismissGuide} />}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={t("common.distillation.pageTitle")}
          desc={t("common.distillation.pageDesc")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "quick", label: t("common.distillation.modeQuick") },
              { value: "pro", label: t("common.distillation.modePro") },
            ]}
          />
          <TTButton variant="ghost" onClick={() => setShowGuide(true)}>
            <HelpCircle className="size-3.5" />
            {t("distill.help")}
          </TTButton>
          <TTButton
            variant="ghost"
            title={t("distill.compareUnavailable")}
            onClick={() => toast.info(t("distill.compareUnavailable"))}
          >
            <Columns2 className="size-3.5" />
            {t("distill.compare")}
          </TTButton>
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

      <div className="mb-3">
        <JarvisInsight
          title={t("distill.jarvisTitle")}
          lines={jarvisLines}
          rotateLabel={t("distill.insightRotate")}
          dotsLabel={t("distill.insightDots")}
        />
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
        approved={approved}
      />

      <DistillConfig
        mode={mode}
        timeRange={timeRange}
        onTimeRange={setTimeRange}
        granularity={granularity}
        onGranularity={setGranularity}
        modelId={modelId}
        onModelId={setModelId}
        modelOptions={initial.modelOptions}
        promptPreset={promptPreset}
        onPromptPreset={setPromptPreset}
        promptText={promptText}
        onPromptText={setPromptText}
        selectedItems={selectedItems}
        onOpenMaterial={() => setDrawerOpen(true)}
        onRemoveItem={removeItem}
        onRun={handleStart}
        canRun={canStart}
        busy={busy}
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

      <section className="mb-3">
        <h2 className="mb-2 text-[13px] font-medium tracking-[0.025em]">
          {t("distill.resultsTitle")}
        </h2>
        {candidates.length === 0 ? (
          <Panel>
            <EmptyState
              title={t("distill.noCandidates")}
              desc={t("distill.noCandidatesDesc")}
            />
          </Panel>
        ) : (
          <ul className="space-y-3">
            {candidates.map((candidate) => (
              <li key={candidate.candidateId}>
                <ExpCard
                  candidate={candidate}
                  busy={busy}
                  onApprove={() => void handleApprove(candidate.candidateId)}
                  onCancel={() => void handleCancel(candidate.candidateId)}
                  onRegenerate={() => handleRegenerate(candidate)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

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
