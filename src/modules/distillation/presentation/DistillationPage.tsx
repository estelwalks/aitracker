import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  Columns2,
  HelpCircle,
  Loader2,
  Sparkles,
} from "lucide-react";
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
import { DistillHistoryDialog } from "./distill/DistillHistory";
import { DISTILL_GUIDE_KEY, DistillGuide } from "./distill/DistillGuide";
import { outTypeMeta, type OutTypeId } from "./distill/out-types";
import {
  filterDistillationSessions,
  isConfigMaterial,
  materialKeyOf,
  toggleMaterialSelection,
  toggleProjectSelection,
  type DistillationMaterialGranularity,
  type DistillationTimeRange,
} from "./distill/materials";

const MAX_SELECTION = 8;
/**
 * Heuristic tokens-per-turn used to estimate the selected material's size.
 * The privacy-safe renderer projection deliberately omits raw token totals,
 * so this estimate is always presented with the "~" prefix and the
 * "本次输入预估" sub-line (E-200) — never as a measured value.
 */
const EST_TOKENS_PER_TURN = 900;

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
 * insight card, first-run guide overlay, quick/pro config card with a header
 * quota status + history, output-type selection (② 出产物), a metric bar with
 * the prototype's semantics and a complete experiment history backed by the
 * persisted candidate store. All figures come from real server fns — sessions,
 * model options, persisted candidates and the workbench counters.
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
  // A carried-over `?segment=` session is seeded into the selection right away
  // (its segment is meaningless unless the session is part of sessionRefs).
  // Seeding here — rather than re-adding it in an effect — lets the drop
  // cleanup below run safely without racing the arrival.
  const [selected, setSelected] = useState<Set<string>>(() => {
    if (!initialSegment) return new Set();
    const key = `${initialSegment.source}:${initialSegment.sessionId}`;
    return initial.sessions.some((item) => materialKeyOf(item) === key)
      ? new Set([key])
      : new Set();
  });
  const [busy, setBusy] = useState(false);
  /** True only while a distillation run is in flight (drives 蒸馏中… states). */
  const [distilling, setDistilling] = useState(false);
  const [mode, setMode] = useState<"quick" | "pro">("quick");
  const [outType, setOutType] = useState<OutTypeId>("skill");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateOutput[]>(() => [
    ...initial.candidates,
  ]);
  const [runs, setRuns] = useState(initial.stats.runs);
  /** Runs completed within this page session (prototype "本次会话" semantics). */
  const [sessionRuns, setSessionRuns] = useState(0);
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
  // User-selected transcript segments (Story B-100): the `?segment=` URL
  // window plus any ranges picked in the material drawer. Each segment lives
  // only in this page's state and is forwarded to the server on start; the
  // referenced text is loaded into memory server-side and never persisted.
  const [segments, setSegments] = useState<SegmentRef[]>(() =>
    initialSegment ? [{ ...initialSegment }] : [],
  );
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
  // A segment whose session leaves the selection is meaningless — drop it so a
  // run can never reference an unselected session. The counterpart (adding a
  // segment's session to the selection) happens eagerly where segments enter —
  // the `initialSegment` seed above and `handleSegmentsChange` below — never in
  // an effect, which would fight an explicit user deselection (the session
  // would snap straight back).
  useEffect(() => {
    if (segments.length === 0) return;
    setSegments((current) => {
      const next = current.filter((seg) => {
        const key = `${seg.source}:${seg.sessionId}`;
        return selected.has(key);
      });
      return next.length === current.length ? current : next;
    });
  }, [selected, segments]);
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
  // Config-material mode has no real file source yet — the run stays disabled
  // until the data layer exposes tool config files (E-300, honest empty state).
  const configMaterial = isConfigMaterial(granularity);
  const canStart =
    !busy &&
    !configMaterial &&
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
  // E-200: documented heuristic estimate (see EST_TOKENS_PER_TURN) presented
  // with the "~" prefix and the "本次输入预估" sub-line, never as measured data.
  const estTokens = selectedItems.reduce(
    (sum, item) => sum + item.turns * EST_TOKENS_PER_TURN,
    0,
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
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(keyOf(item));
      return next;
    });
  }

  function toggleProject(items: readonly DistillationSessionItem[]) {
    setSelected(
      (prev) =>
        toggleProjectSelection(
          prev,
          items.map(keyOf),
          MAX_SELECTION,
        ) as Set<string>,
    );
  }

  function clearSegments() {
    setSegments([]);
  }

  /**
   * Segments only enter the page through this handler (the material drawer) and
   * the `initialSegment` seed. The segment's session is added to the selection
   * here, in the same commit, so a freshly picked range is never dropped by the
   * stale-read cleanup effect; segments whose session cannot be selected (the
   * selection is full or the session left the visible set) are filtered out.
   */
  function handleSegmentsChange(next: SegmentRef[]) {
    const nextSelected = new Set(selected);
    let selectedChanged = false;
    for (const seg of next) {
      const key = `${seg.source}:${seg.sessionId}`;
      if (nextSelected.has(key) || nextSelected.size >= MAX_SELECTION) continue;
      if (!materialSessions.some((item) => keyOf(item) === key)) continue;
      nextSelected.add(key);
      selectedChanged = true;
    }
    const kept = next.filter((seg) =>
      nextSelected.has(`${seg.source}:${seg.sessionId}`),
    );
    const same =
      kept.length === segments.length &&
      kept.every(
        (seg, index) =>
          seg.source === segments[index].source &&
          seg.sessionId === segments[index].sessionId &&
          seg.startIndex === segments[index].startIndex &&
          seg.endIndex === segments[index].endIndex,
      );
    if (selectedChanged) setSelected(nextSelected);
    if (!same) setSegments(kept);
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

  /**
   * E-300: the transport does not carry the selected output type yet, so the
   * chosen type reaches the model through the prompt directive. The directive
   * always leads; the user's pro-mode prompt text (if any) follows.
   */
  function buildPrompt(userPrompt: string | undefined): string | undefined {
    const directive = t(outTypeMeta(outType).instructionKey);
    const parts = [directive, userPrompt?.trim()].filter(Boolean);
    return parts.length > 0 ? parts.join("；") : undefined;
  }

  async function runDistillation(
    refs: readonly SessionRef[],
    options?: { modelId?: string; promptText?: string },
  ) {
    if (refs.length === 0) return;
    setBusy(true);
    setDistilling(true);
    try {
      const result = await startDistillation({
        data: {
          sessionRefs: refs.map((ref) => ({ ...ref })),
          // Forward the user-selected transcript windows; the server loads
          // their text into memory for this request only.
          ...(segments.length > 0
            ? { segments: segments.map((seg) => ({ ...seg })) }
            : {}),
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
      setSessionRuns((current) => current + 1);
      toast.success(t("common.success"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
      setDistilling(false);
    }
  }

  function handleStart() {
    void runDistillation(selectedItems.map(toRef), {
      modelId: mode === "pro" ? modelId : undefined,
      promptText: buildPrompt(mode === "pro" ? promptText : undefined),
    });
  }

  function handleRegenerate(candidate: CandidateOutput) {
    void runDistillation(candidate.selectedSessionRefs, {
      modelId: mode === "pro" ? modelId : undefined,
      promptText: buildPrompt(mode === "pro" ? promptText : undefined),
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

  function handleViewHistory(candidateId: string) {
    setHistoryOpen(false);
    document
      .getElementById(`distill-result-${candidateId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleSwitchModel() {
    const firstReal = initial.modelOptions.find((option) => !option.offline);
    if (firstReal) setModelId(firstReal.id);
  }

  // No real model is configured, so any run today uses the offline fallback.
  const offlineResult = !initial.modelOptions.some((option) => !option.offline);

  return (
    <>
      {showGuide && <DistillGuide onClose={dismissGuide} />}

      <div className="relative space-y-5 pb-10">
        {/* Page header mirrors the prototype (738-757): title + workflow hint +
            help + side-by-side compare. The mode switch / quota status /
            history / manage-models controls live in the config card header. */}
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-[15px] font-semibold tracking-tight">
            {t("common.distillation.pageTitle")}
          </h1>
          <span className="font-mono text-[11px] text-muted-foreground">
            {t("distill.workflow")}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* Prototype help control: icon only, title reveals 蒸馏是什么？ */}
            <TTButton
              variant="ghost"
              title={t("distill.guideTitle")}
              aria-label={t("distill.guideTitle")}
              onClick={() => setShowGuide(true)}
            >
              <HelpCircle className="size-3.5" />
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
          estTokens={estTokens}
          runs={sessionRuns}
          approved={approved}
          busy={distilling}
        />

        {segments.length > 0 ? (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-[12px]">
            <span className="font-medium text-foreground">
              {t("distill.segment.banner", {
                count: segments.reduce(
                  (sum, seg) => sum + (seg.endIndex - seg.startIndex + 1),
                  0,
                ),
              })}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-muted-foreground">
              {segments
                .map((seg) => `${seg.source}:${seg.sessionId}`)
                .join(" · ")}
            </span>
            <TTButton variant="ghost" size="sm" onClick={clearSegments}>
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
          outType={outType}
          onOutType={setOutType}
          historyCount={candidates.length}
          segmentsCount={segments.length}
          onHistory={() => setHistoryOpen(true)}
          onSwitchModel={handleSwitchModel}
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
            {distilling && (
              <span
                className="inline-flex items-center gap-1.5 text-[11.5px] font-medium"
                style={{ color: "var(--chart-1)" }}
              >
                <Loader2 className="size-3.5 animate-spin" />
                {t("distill.running")}
              </span>
            )}
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
          {candidates.length === 0 && !distilling ? (
            <Panel>
              <EmptyState
                title={t("distill.noCandidates")}
                desc={t("distill.noCandidatesDesc")}
              />
            </Panel>
          ) : (
            <ul id="distill-results" className="scroll-mt-20 space-y-3">
              {distilling && (
                <li aria-live="polite">
                  <div className="rounded-xl bg-card px-4 py-3 ring-1 ring-border/60">
                    <div className="flex items-center gap-2">
                      <Sparkles className="size-3.5 animate-pulse text-primary" />
                      <span className="text-[12.5px] font-medium">
                        {t("distill.running")}
                      </span>
                    </div>
                    <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/50" />
                    </div>
                    <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                      {t("distill.distillingNote")}
                    </p>
                  </div>
                </li>
              )}
              {candidates.map((candidate) => (
                <li
                  key={candidate.candidateId}
                  id={`distill-result-${candidate.candidateId}`}
                  className="scroll-mt-20"
                >
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
            segments={segments}
            onSegmentsChange={handleSegmentsChange}
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

        {historyOpen && (
          <DistillHistoryDialog
            candidates={candidates}
            onClose={() => setHistoryOpen(false)}
            onView={handleViewHistory}
          />
        )}
      </div>
    </>
  );
}
