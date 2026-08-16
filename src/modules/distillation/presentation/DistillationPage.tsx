import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Columns2, HelpCircle } from "lucide-react";
import { toast } from "sonner";

import { EmptyState, Panel, TTButton } from "../../../components/tt";
import { JarvisInsight } from "../../../components/JarvisInsight";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n/messages";
import type { SegmentRefCodec } from "../../../lib/distill-segment";
import type { CandidateOutput, SegmentRef, SessionRef } from "../contracts";
import type { DistillationSessionItem, DistillationViewModel } from "./index";
import { approveCandidate, cancelCandidate, startDistillation } from "../query";
import { DistillMetrics } from "./distill/DistillMetrics";
import { MaterialDrawer } from "./distill/MaterialDrawer";
import { CandidateCompareDialog, ExpCard } from "./distill/ExpCard";
import { DistillConfig } from "./distill/DistillConfig";
import { DISTILL_GUIDE_KEY, DistillGuide } from "./distill/DistillGuide";
import {
  filterDistillationSessions,
  materialKeyOf,
  toggleMaterialSelection,
  toggleProjectSelection,
  type DistillationMaterialGranularity,
  type DistillationTimeRange,
} from "./distill/materials";

const MAX_SELECTION = 8;

function keyOf(item: { source: string; sessionId: string }): string {
  return materialKeyOf(item);
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
 * material picker and a complete experiment history backed by the persisted
 * candidate store. All figures come from real server fns — sessions, model
 * options, persisted candidates and the workbench counters.
 */
export function DistillationPage({
  initial,
  initialSegment = null,
}: {
  initial: DistillationViewModel;
  /** User-picked transcript window handed over from the session detail page. */
  initialSegment?: SegmentRefCodec | null;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"quick" | "pro">("quick");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateOutput[]>(() => [
    ...initial.candidates,
  ]);
  const [runs, setRuns] = useState(initial.stats.runs);
  const [approved, setApproved] = useState(initial.stats.approved);
  const [timeRange, setTimeRange] = useState<DistillationTimeRange>("all");
  const [granularity, setGranularity] =
    useState<DistillationMaterialGranularity>("session");
  const [modelId, setModelId] = useState(
    () =>
      initial.modelOptions.find((option) => !option.offline)?.id ?? "offline",
  );
  const [promptPreset, setPromptPreset] = useState("summary");
  const [promptText, setPromptText] = useState("");
  // Carried-over user segment (Story B-100). It lives only in this page's
  // state and is forwarded to the server on start; the referenced text is
  // loaded into memory server-side and never persisted.
  const [segment, setSegment] = useState<SegmentRef | null>(() =>
    initialSegment ? { ...initialSegment } : null,
  );
  // Once the user actively changes the selection, the carried-over segment
  // stops auto-selecting its session so it never overrides their choice.
  const selectionTouched = useRef(false);
  // Guide visibility is deferred to a client-only effect: SSR has no
  // localStorage, so reading it in the useState initializer makes the server
  // and first client render disagree and triggers a React hydration mismatch.
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    setShowGuide(!readGuideSeen());
  }, []);

  const sessions = useMemo(() => initial.sessions, [initial.sessions]);
  const materialSessions = useMemo(
    () => filterDistillationSessions(sessions, timeRange),
    [sessions, timeRange],
  );
  // A range is a selection boundary, not merely a visual filter. If it moves,
  // remove refs outside the now-visible real session set so a run cannot
  // silently include stale material.
  useEffect(() => {
    const available = new Set(materialSessions.map(keyOf));
    setSelected((current) => {
      const next = new Set(
        [...current].filter((sessionKey) => available.has(sessionKey)),
      );
      return next.size === current.size ? current : next;
    });
  }, [materialSessions]);
  // Auto-select the carried-over segment's session once, before the user
  // touches the selection, so the distill run has the session it points at.
  useEffect(() => {
    if (!segment || selectionTouched.current) return;
    const key = `${segment.source}:${segment.sessionId}`;
    if (!materialSessions.some((item) => keyOf(item) === key)) return;
    setSelected((current) => {
      if (current.has(key) || current.size >= MAX_SELECTION) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  }, [segment, materialSessions]);
  // A segment whose session leaves the selection is meaningless — drop it so
  // the run can never reference an unselected session.
  useEffect(() => {
    if (!segment) return;
    const key = `${segment.source}:${segment.sessionId}`;
    if (!selected.has(key)) setSegment(null);
  }, [selected, segment]);
  const selectionCount = selected.size;
  // B-600: a real-model run whose daily quota is exhausted cannot start. The
  // server re-checks the authoritative ledger on every start, so this only
  // pre-empts the obvious case; a race is still rejected with
  // `errors.distillation.quotaExceeded` and toasted by the error path below.
  const quotaExhausted =
    mode === "pro" &&
    modelId !== "offline" &&
    initial.quota != null &&
    initial.quota.remaining <= 0;
  const canStart =
    !busy &&
    selectionCount > 0 &&
    selectionCount <= MAX_SELECTION &&
    !quotaExhausted;
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
    selectionTouched.current = true;
    setSelected(
      (prev) =>
        toggleMaterialSelection(
          prev,
          keyOf(item),
          MAX_SELECTION,
        ) as Set<string>,
    );
  }

  function removeItem(item: DistillationSessionItem) {
    selectionTouched.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(keyOf(item));
      return next;
    });
  }

  function toggleProject(items: readonly DistillationSessionItem[]) {
    selectionTouched.current = true;
    setSelected(
      (prev) =>
        toggleProjectSelection(
          prev,
          items.map(keyOf),
          MAX_SELECTION,
        ) as Set<string>,
    );
  }

  function clearSegment() {
    selectionTouched.current = true;
    setSegment(null);
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
          // Forward the carried-over user segment; the server loads its
          // transcript window into memory for this request only.
          ...(segment ? { segments: [segment] } : {}),
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

      <div className="relative space-y-5 pb-10">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight">
            {t("common.distillation.pageTitle")}
          </h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("distill.workflow")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <TTButton variant="ghost" onClick={() => setShowGuide(true)}>
              <HelpCircle className="size-3.5" />
              {t("distill.help")}
            </TTButton>
            <TTButton
              variant="ghost"
              disabled={candidates.length < 2}
              title={
                candidates.length < 2 ? t("distill.compareNeedTwo") : undefined
              }
              onClick={() => setCompareOpen(true)}
            >
              <Columns2 className="size-3.5" />
              {t("distill.compare")}
            </TTButton>
          </div>
        </header>

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

        {segment ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[12px]">
            <span className="font-medium text-foreground">
              {t("distill.segment.banner", {
                count: segment.endIndex - segment.startIndex + 1,
              })}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
              {t("distill.segment.origin", {
                source: segment.source,
                sessionId: segment.sessionId,
              })}
            </span>
            <TTButton variant="ghost" size="sm" onClick={clearSegment}>
              {t("distill.segment.clear")}
            </TTButton>
          </div>
        ) : null}

        <DistillConfig
          mode={mode}
          onMode={setMode}
          timeRange={timeRange}
          onTimeRange={setTimeRange}
          granularity={granularity}
          onGranularity={setGranularity}
          modelId={modelId}
          onModelId={setModelId}
          modelOptions={initial.modelOptions}
          quota={initial.quota}
          promptPreset={promptPreset}
          onPromptPreset={setPromptPreset}
          promptText={promptText}
          onPromptText={setPromptText}
          availableItems={materialSessions}
          selected={selected}
          selectedItems={selectedItems}
          onToggle={toggle}
          onToggleProject={toggleProject}
          onOpenMaterial={() => setDrawerOpen(true)}
          onRemoveItem={removeItem}
          onRun={handleStart}
          canRun={canStart}
          busy={busy}
        />

        <section className="mb-3">
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-card px-4 py-3 ring-1 ring-border/60">
            <h2 className="text-[13px] font-semibold tracking-tight">
              {t("distill.resultsTitle")}
            </h2>
            <span className="font-mono text-[10.5px] text-muted-foreground">
              {t("distill.resultsSummary", {
                count: candidates.length,
                approved,
              })}
            </span>
            {candidates.length > 0 && (
              <TTButton
                className="ml-auto"
                variant="ghost"
                onClick={() =>
                  document
                    .getElementById("distill-results")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
              >
                <ArrowDown className="size-3.5" /> {t("distill.latestResult")}
              </TTButton>
            )}
          </div>
          {candidates.length === 0 ? (
            <Panel>
              <EmptyState
                title={t("distill.noCandidates")}
                desc={t("distill.noCandidatesDesc")}
              />
            </Panel>
          ) : (
            <ul id="distill-results" className="scroll-mt-20 space-y-3">
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
            sessions={materialSessions}
            selected={selected}
            granularity={granularity}
            onToggle={toggle}
            onToggleProject={toggleProject}
            onClose={() => setDrawerOpen(false)}
          />
        )}

        {compareOpen && candidates[0] && candidates[1] && (
          <CandidateCompareDialog
            candidates={[candidates[0], candidates[1]]}
            onClose={() => setCompareOpen(false)}
          />
        )}
      </div>
    </>
  );
}
