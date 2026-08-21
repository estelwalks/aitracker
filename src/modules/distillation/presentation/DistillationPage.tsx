import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowRight,
  Columns2,
  HelpCircle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";

import "./distill/distill.css";

import { TTButton } from "../../../components/tt";
import { InsightCard } from "../../insights/page/presentation/insight-card";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n/messages";
import type { SegmentRefCodec } from "../../../lib/distill-segment";
import {
  getPreference,
  setPreference,
} from "../../../lib/preferences/client.ts";
import type { CandidateOutput, SegmentRef, SessionRef } from "../contracts";
import type { DistillationSessionItem, DistillationViewModel } from "./index";
import { approveCandidate, startDistillation } from "../query";
import { DistillMetrics } from "./distill/DistillMetrics";
import { MaterialDrawer } from "./distill/MaterialDrawer";
import { CandidateCompareDialog, ExpCard } from "./distill/ExpCard";
import { DistillConfig } from "./distill/DistillConfig";
import { DistillHistoryDialog } from "./distill/DistillHistory";
import { DISTILL_GUIDE_KEY, DistillGuide } from "./distill/DistillGuide";
import { outTypeMeta, type OutTypeId } from "./distill/out-types";
import {
  filterDistillationSessions,
  materialKeyOf,
  toggleMaterialSelection,
  toggleProjectSelection,
  type DistillationMaterialGranularity,
  type DistillationTimeRange,
} from "./distill/materials";

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

/**
 * 运行中结果卡（原型 ExpCard running 态 1832-1875）：与 done 态同一张卡结构
 * —— 完整 meta 头（kind chip + 时间 + 模型）+ 素材行 + 进度条。服务端同步
 * 完成、无真实进度遥测,用模拟进度(~3.8 秒跑满 100%) + 已耗时秒数,视觉对齐
 * 原型梯度条与百分比文案。
 */
function RunningExpCard({
  color,
  kindLabel,
  modelLabel,
  segCount,
  sources,
}: {
  color: string;
  kindLabel: string;
  modelLabel: string;
  segCount: number;
  sources: string;
}) {
  const { t, format } = useI18n();
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const tid = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    const pid = window.setInterval(
      () => setProgress(Math.min(1, (Date.now() - started) / 3800)),
      120,
    );
    return () => {
      window.clearInterval(tid);
      window.clearInterval(pid);
    };
  }, []);
  return (
    <article
      className="animate-fade-in relative overflow-hidden rounded-xl bg-card"
      style={{ boxShadow: `inset 3px 0 0 ${color}` }}
    >
      <div
        className="pointer-events-none absolute -top-16 right-0 size-40 rounded-full opacity-[0.14] blur-3xl"
        style={{ background: color }}
      />
      <div className="relative flex flex-wrap items-center gap-2 px-4 py-3 font-mono text-[10.5px] text-muted-foreground">
        <span
          className="rounded-full px-2 py-0.5 font-semibold"
          style={{
            background: `color-mix(in oklab, ${color} 16%, transparent)`,
            color,
          }}
        >
          {kindLabel}
        </span>
        <span>{format.formatDateTime(new Date().toISOString(), false)}</span>
        <span>· {modelLabel}</span>
      </div>
      <div className="relative px-4 pb-2 font-mono text-[10.5px] text-muted-foreground">
        {t("distill.materialMeta", { count: segCount, sources })}
      </div>
      <div className="relative px-4 pb-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.07]">
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${Math.round(progress * 100)}%`,
              background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 50%, var(--chart-2)))`,
            }}
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {t("distill.running")} {Math.round(progress * 100)}%
          {t("distill.runningElapsed", { seconds: elapsed })}
        </p>
      </div>
    </article>
  );
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
  const [viewId, setViewId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<CandidateOutput[]>(() => [
    ...initial.candidates,
  ]);
  // 蒸馏次数（持久化累计 + 本次页面会话增量）。刷新后回到持久化总数，与
  // `approved` 同口径，避免 runs 归零而 approved 保留总量的矛盾。
  const [runs, setRuns] = useState(initial.stats.runs);
  /** 本页面会话内新产生的候选 id(历史弹窗「本次会话结果」区,原型内存实验)。 */
  const [sessionIds, setSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [approved, setApproved] = useState(initial.stats.approved);
  const [timeRange, setTimeRange] = useState<DistillationTimeRange>("all");
  const [granularity, setGranularity] =
    useState<DistillationMaterialGranularity>("session");
  const [modelId, setModelId] = useState(
    () => initial.activeModelId ?? initial.modelOptions[0]?.id ?? "offline",
  );
  const [promptText, setPromptText] = useState("");
  // User-selected transcript segments (Story B-100): the `?segment=` URL
  // window plus any ranges picked in the material drawer. Each segment lives
  // only in this page's state and is forwarded to the server on start; the
  // referenced text is loaded into memory server-side and never persisted.
  const [segments, setSegments] = useState<SegmentRef[]>(() =>
    initialSegment ? [{ ...initialSegment }] : [],
  );
  // Guide visibility is loaded after hydration from the SQLite preference
  // repository so SSR and the first client render remain identical.
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    void getPreference(DISTILL_GUIDE_KEY).then((seen) => {
      setShowGuide(seen !== true);
    });
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
  // B-600: an official-model run whose daily quota is exhausted cannot start
  // (prototype parity: only the official model consumes the daily quota; custom
  // profiles never gate on it). The server re-checks the authoritative ledger on
  // every start, so this only pre-empts the obvious case; a race is still
  // rejected with `errors.distillation.quotaExceeded` and toasted below.
  const selectedModel = initial.modelOptions.find(
    (option) => option.id === modelId,
  );
  // True when at least one real (non-offline) model is available — a saved
  // profile. When false, every run is blocked with
  // `errors.distillation.noModelConfigured`, so the page shows a config hint.
  const hasRealModel = initial.modelOptions.some((option) => !option.offline);
  // Prototype parity: the official model gates on its daily quota in both
  // modes (quick mode defaults to the official profile; pro lets you pick one).
  const quotaExhausted =
    selectedModel?.official === true &&
    initial.quota != null &&
    initial.quota.remaining <= 0;
  const canStart = !busy && selectionCount > 0 && !quotaExhausted;

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
  /** 可对比的结果:已完成(已入库)候选,取最近两条(原型 done >= 2 语义)。 */
  const doneCandidates = useMemo(
    () => candidates.filter((c) => c.approvalState === "approved"),
    [candidates],
  );
  /** 本次页面会话内产生的候选（原型 `exps`：内存实验，刷新即清空）。 */
  const sessionCandidates = useMemo(
    () => candidates.filter((c) => sessionIds.has(c.candidateId)),
    [candidates, sessionIds],
  );
  const shownCandidate = useMemo(
    () =>
      // 历史弹窗的「查看」可能指向刷新后从持久化恢复的候选（不在 sessionIds），
      // 先从全量 candidates 解析，否则回退到本次会话首个结果。
      (viewId ? candidates.find((c) => c.candidateId === viewId) : undefined) ??
      sessionCandidates[0],
    [candidates, sessionCandidates, viewId],
  );

  function toggle(item: DistillationSessionItem) {
    setSelected(
      (prev) => toggleMaterialSelection(prev, keyOf(item)) as Set<string>,
    );
  }

  /** Quick 模式「清空」：清空已选会话（原型选中区的一键清空）。 */
  function clearSelection() {
    setSelected(new Set());
  }

  /** Pro 模式素材盒「清空」：清空已选片段。 */
  function clearSegments() {
    setSegments([]);
  }

  function toggleProject(items: readonly DistillationSessionItem[]) {
    setSelected(
      (prev) => toggleProjectSelection(prev, items.map(keyOf)) as Set<string>,
    );
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
      if (nextSelected.has(key)) continue;
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
    void setPreference(DISTILL_GUIDE_KEY, true);
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
    options?: {
      modelId?: string;
      promptText?: string;
      kind?: CandidateOutput["kind"];
    },
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
          ...(options?.kind ? { kind: options.kind } : {}),
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
        // Prototype parity: a run completes straight into a usable result — no
        // waiting/approve step. The candidate is approved on completion so
        // memory kinds write into the knowledge library immediately and
        // capability kinds are instantly savable.
        let accepted: CandidateOutput = result.candidate;
        try {
          const approved = await approveCandidate({
            data: { candidateId: result.candidate.candidateId },
          });
          if (approved.ok && approved.candidate) {
            accepted = approved.candidate;
            setApproved((current) => current + 1);
          }
        } catch {
          // The approval write failed (no knowledge port); the result is still
          // shown, just not counted as 已入库.
        }
        setCandidates((prev) => [accepted, ...prev]);
        setSessionIds((prev) => new Set(prev).add(accepted.candidateId));
      }
      setRuns((current) => current + 1);
      toast.success(t("common.success"), {
        action: {
          label: t("distill.viewResult"),
          onClick: () =>
            document
              .getElementById("distill-results")
              ?.scrollIntoView({ behavior: "smooth", block: "start" }),
        },
      });
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
      setDistilling(false);
    }
  }

  function handleStart() {
    setViewId(null);
    // Quick mode also forwards the selected model: the page defaults `modelId`
    // to the active saved profile or offline, so one-click runs use the shared
    // model source. The
    // selected output type travels as `kind` so the result card renders the
    // right asset class (skill/workflow/prompt vs persona/memory).
    void runDistillation(selectedItems.map(toRef), {
      modelId,
      kind: outTypeMeta(outType).kind,
      promptText: buildPrompt(mode === "pro" ? promptText : undefined),
    });
  }

  function handleRegenerate(candidate: CandidateOutput) {
    setViewId(null);
    void runDistillation(candidate.selectedSessionRefs, {
      modelId,
      kind: outTypeMeta(outType).kind,
      promptText: buildPrompt(mode === "pro" ? promptText : undefined),
    });
  }

  function handleViewHistory(candidateId: string) {
    setHistoryOpen(false);
    setViewId(candidateId);
    window.setTimeout(() => {
      document
        .getElementById("distill-results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function handleSwitchModel() {
    // 额度横幅的切换目标：第一个自有（非官方、非离线）模型，与原型一致。
    const firstOwn = initial.modelOptions.find(
      (option) => !option.offline && option.official !== true,
    );
    if (firstOwn) setModelId(firstOwn.id);
  }

  return (
    <div className="distill-workbench relative space-y-5 pb-10">
      {showGuide && <DistillGuide onClose={dismissGuide} />}
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
            disabled={doneCandidates.length < 2}
            title={
              doneCandidates.length < 2
                ? t("distill.compareNeedTwo")
                : undefined
            }
            onClick={() => setCompareOpen(true)}
          >
            <Columns2 className="size-3.5" />
            {t("distill.compare")}
          </TTButton>
        </div>
      </header>

      {!hasRealModel && (
        <Link
          to="/settings"
          search={{ section: "model" }}
          className="group flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 transition-colors hover:border-warn/50 hover:bg-warn/15"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warn" />
          <p className="flex-1 text-[12.5px] leading-6 text-foreground/85">
            {t("distill.noModelHint")}
          </p>
          <ArrowRight className="mt-1.5 size-3.5 shrink-0 text-warn transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

      <div className="mb-3">
        <InsightCard
          surfaceId="distill"
          variant="hero"
          title={t("distill.jarvisTitle")}
          dotsLabel={t("distill.insightDots")}
        />
      </div>

      <DistillMetrics
        selectedCount={mode === "pro" ? segments.length : selectionCount}
        estTokens={estTokens}
        runs={runs}
        approved={approved}
        busy={distilling}
      />

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
        promptText={promptText}
        onPromptText={setPromptText}
        outType={outType}
        onOutType={setOutType}
        historyCount={candidates.length}
        segments={segments}
        onHistory={() => setHistoryOpen(true)}
        onSwitchModel={handleSwitchModel}
        availableItems={materialSessions}
        selected={selected}
        selectedItems={selectedItems}
        onToggle={toggle}
        onToggleProject={toggleProject}
        onOpenMaterial={() => setDrawerOpen(true)}
        onClearSelection={clearSelection}
        onClearSegments={clearSegments}
        onRun={handleStart}
        canRun={canStart}
        busy={busy}
      />

      {(candidates.length > 0 || distilling) && (
        <section className="mb-3">
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-card px-4 py-3">
            <h2 className="text-[13px] font-semibold tracking-tight">
              {t("distill.resultsTitle")}
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("distill.resultsSummary", {
                count: sessionCandidates.length,
                approved: sessionCandidates.filter(
                  (c) => c.approvalState === "approved",
                ).length,
              })}
            </span>
            {distilling && (
              <span
                className="inline-flex items-center gap-1.5 font-mono text-[11px]"
                style={{ color: "var(--chart-1)" }}
              >
                <Loader2 className="size-3.5 animate-spin" />
                {t("distill.running")}
              </span>
            )}
          </div>
          <div id="distill-results" className="scroll-mt-20 space-y-3">
            {distilling ? (
              <RunningExpCard
                color={outTypeMeta(outType).color}
                kindLabel={t(outTypeMeta(outType).labelKey)}
                modelLabel={
                  selectedModel?.offline
                    ? t("distill.proOffline")
                    : (selectedModel?.label ?? "offline")
                }
                segCount={selectedItems.length}
                sources={[
                  ...new Set(selectedItems.map((item) => item.source)),
                ].join(" / ")}
              />
            ) : (
              shownCandidate && (
                <ExpCard
                  candidate={shownCandidate}
                  sessions={sessions}
                  modelOptions={initial.modelOptions}
                  busy={busy}
                  onRegenerate={() => handleRegenerate(shownCandidate)}
                />
              )
            )}

            {((distilling && sessionCandidates.length > 0) ||
              (!distilling && sessionCandidates.length > 1)) && (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="w-full rounded-xl bg-surface-2 py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {t("distill.anotherHistoryResults", {
                  count: distilling
                    ? sessionCandidates.length
                    : sessionCandidates.length - 1,
                })}
              </button>
            )}
          </div>
        </section>
      )}

      {drawerOpen && (
        <MaterialDrawer
          sessions={materialSessions}
          segments={segments}
          onSegmentsChange={handleSegmentsChange}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {compareOpen && doneCandidates[0] && doneCandidates[1] && (
        <CandidateCompareDialog
          candidates={[doneCandidates[0], doneCandidates[1]]}
          modelOptions={initial.modelOptions}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {historyOpen && (
        <DistillHistoryDialog
          candidates={candidates}
          sessions={sessions}
          sessionIds={sessionIds}
          modelOptions={initial.modelOptions}
          onClose={() => setHistoryOpen(false)}
          onView={handleViewHistory}
        />
      )}
    </div>
  );
}
