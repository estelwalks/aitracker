import { useEffect, useMemo, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import {
  ArrowRight,
  ChevronRight,
  FlaskConical,
  Loader2,
  PackageCheck,
} from "lucide-react";
import { toast } from "sonner";

import "./distill/distill.css";

import { Pagination } from "../../../components/aitracker";
import { InsightCard } from "../../insights/index.ts";
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
import {
  deleteCandidates,
  getDistillationTask,
  startDistillation,
} from "../query";
import { DistillMetrics } from "./distill/DistillMetrics";
import { MaterialDrawer } from "./distill/MaterialDrawer";
import { ExpCard } from "./distill/ExpCard";
import { DistillConfig } from "./distill/DistillConfig";
import { DISTILL_GUIDE_KEY, DistillGuide } from "./distill/DistillGuide";
import { resolveCandidateSource } from "./distill/source-resolve";
import { kindMeta, outTypeMeta, type OutTypeId } from "./distill/out-types";
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
/** 蒸馏历史每页条数（原型 HIST_PAGE = 10）。 */
const HIST_PAGE = 10;
const DISTILL_TASK_KEY = "aitracker.distillation.active-task";

function keyOf(item: { source: string; sessionId: string }): string {
  return materialKeyOf(item);
}

function toRef(item: { source: string; sessionId: string }): SessionRef {
  return { source: item.source, sessionId: item.sessionId };
}

/**
 * 运行中结果卡（原型 ExpCard running 态 1832-1875）：与 done 态同一张卡结构
 * —— 完整 meta 头（kind chip + 时间 + 模型）+ 素材行 + 进度条。进度来自
 * 服务端任务阶段；服务端没有细粒度遥测时，最高保持在 92%。
 * 原型梯度条与百分比文案。
 */
function RunningExpCard({
  color,
  kindLabel,
  modelLabel,
  segCount,
  sources,
  progress: serverProgress,
}: {
  color: string;
  kindLabel: string;
  modelLabel: string;
  segCount: number;
  sources: string;
  progress: number;
}) {
  const { t, format } = useI18n();
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const tid = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    const pid = window.setInterval(() => {
      if (serverProgress > 0) return;
      setProgress(Math.min(0.92, (Date.now() - started) / 30000));
    }, 120);
    return () => {
      window.clearInterval(tid);
      window.clearInterval(pid);
    };
  }, [serverProgress]);
  const visibleProgress = serverProgress > 0 ? serverProgress : progress;
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
              width: `${Math.round(visibleProgress * 100)}%`,
              background: `linear-gradient(90deg, ${color}, color-mix(in oklab, ${color} 50%, var(--chart-2)))`,
            }}
          />
        </div>
        <p className="mt-2 font-mono text-[11px] text-muted-foreground">
          {t("distill.running")} {Math.round(visibleProgress * 100)}%
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
  const { t, format } = useI18n();
  const router = useRouter();
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
  const [distillProgress, setDistillProgress] = useState(0);
  const [mode, setMode] = useState<"quick" | "pro">("quick");
  const [outType, setOutType] = useState<OutTypeId>("skill");
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** 工作台视图：配置 / 结果 切换（原型 distill.tsx distillView）。 */
  const [distillView, setDistillView] = useState<"config" | "result">("config");
  const [histPage, setHistPage] = useState(1);
  // 默认展开第一条历史（原型 open = viewId ?? exps[0]）。一旦用户点击切换，
  // 显式用 viewId 控制，允许全部收起。
  const [viewId, setViewId] = useState<string | null>(
    () => initial.candidates[0]?.candidateId ?? null,
  );
  const [candidates, setCandidates] = useState<CandidateOutput[]>(() => [
    ...initial.candidates,
  ]);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(
    () => new Set(),
  );
  // 蒸馏次数（持久化累计 + 本次页面会话增量）。刷新后回到持久化总数，与
  // `approved` 同口径，避免 runs 归零而 approved 保留总量的矛盾。
  const [runs, setRuns] = useState(initial.stats.runs);
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

  // Keep the active task outside the route component. Electron can minimize
  // or navigate away from the workbench while the server task continues.
  // Re-entering the page resumes the progress display instead of starting a
  // second run or losing the running card.
  useEffect(() => {
    let disposed = false;
    const storedTaskId = window.localStorage.getItem(DISTILL_TASK_KEY);
    if (!storedTaskId) return;
    setDistilling(true);
    setBusy(true);
    setDistillView("result");
    const poll = async () => {
      try {
        const task = await getDistillationTask({
          data: { taskId: storedTaskId },
        });
        if (disposed) return;
        if (!task) {
          window.localStorage.removeItem(DISTILL_TASK_KEY);
          setDistilling(false);
          setBusy(false);
          return;
        }
        setDistillProgress(
          task.phase === "completed" ? 1 : Math.min(0.92, task.percent / 100),
        );
        if (["completed", "failed", "cancelled"].includes(task.phase)) {
          window.localStorage.removeItem(DISTILL_TASK_KEY);
          setDistilling(false);
          setBusy(false);
          if (task.phase === "completed") void router.invalidate();
        }
      } catch {
        // Keep the task id for the next page entry; a transient IPC failure
        // must not make the running task disappear.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 600);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [router]);

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
  const canStart =
    !busy && selectionCount > 0 && !quotaExhausted && hasRealModel;

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
  /** 蒸馏历史计数与分页（原型 distill.tsx 462-486：本次会话 + 持久历史合并）。 */
  const totalRuns = candidates.length;
  const totalSaved = candidates.filter(
    (c) => c.approvalState === "approved",
  ).length;
  const histPageCount = Math.max(1, Math.ceil(totalRuns / HIST_PAGE));
  const curHistPage = Math.min(histPage, histPageCount);
  const winStart = (curHistPage - 1) * HIST_PAGE;
  const shownCandidates = candidates.slice(winStart, winStart + HIST_PAGE);
  async function removeCandidates(ids: readonly string[]) {
    if (ids.length === 0) return;
    await deleteCandidates({ data: { candidateIds: [...ids] } });
    setCandidates((current) =>
      current.filter((item) => !ids.includes(item.candidateId)),
    );
    setSelectedCandidateIds(new Set());
    setViewId((current) => (current && ids.includes(current) ? null : current));
    await router.invalidate();
  }

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
      if (!sessions.some((item) => keyOf(item) === key)) continue;
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
    setDistillProgress(0);
    let accepted: CandidateOutput | null = null;
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
      // Task protocol: when the server runs asynchronously, wait for the
      // terminal state before exposing the result or refreshing read models.
      let task = result.task;
      if (task) window.localStorage.setItem(DISTILL_TASK_KEY, task.taskId);
      while (
        task &&
        !["completed", "failed", "cancelled"].includes(task.phase)
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        task =
          (await getDistillationTask({ data: { taskId: task.taskId } })) ??
          undefined;
        if (task) setDistillProgress(Math.min(0.92, task.percent / 100));
      }
      if (task?.phase !== "completed") {
        window.localStorage.removeItem(DISTILL_TASK_KEY);
        toast.error(
          task?.errorCode
            ? t(task.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      setDistillProgress(1);
      window.localStorage.removeItem(DISTILL_TASK_KEY);
      if (task.candidate) {
        // Prototype parity: a run completes straight into a usable result — no
        // waiting/approve step. The candidate is approved on completion so
        // memory kinds write into the knowledge library immediately and
        // capability kinds are instantly savable.
        accepted = task.candidate;
        setApproved((current) => current + 1);
        setCandidates((prev) => [accepted!, ...prev]);
        // 完成后切到结果视图并展开这条产物，但保持页面停留在顶部视角，
        // 不自动滚动定位到进度条（用户可自行滚动查看进度）。
        setViewId(accepted!.candidateId);
        setDistillView("result");
        setHistPage(1);
        // Refresh route-owned read models so Reports/Memory do not wait for
        // the next navigation or the Windows snapshot polling interval.
        await router.invalidate();
      }
      setRuns((current) => current + 1);
      toast.success(
        t("distill.completedToHistory", {
          label: t(kindMeta(accepted?.kind ?? "memory").labelKey),
        }),
        {
          action: {
            label: t("distill.viewResult"),
            onClick: () => {
              setDistillView("result");
              if (accepted) setViewId(accepted.candidateId);
              window.setTimeout(
                () =>
                  document
                    .getElementById("distill-results")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                60,
              );
            },
          },
        },
      );
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setBusy(false);
      setDistilling(false);
    }
  }

  function handleStart() {
    if (!hasRealModel) {
      toast.error(t("errors.distillation.noModelConfigured"));
      return;
    }
    setViewId(null);
    setDistillView("result");
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
    setDistillView("result");
    void runDistillation(candidate.selectedSessionRefs, {
      modelId,
      kind: outTypeMeta(outType).kind,
      promptText: buildPrompt(mode === "pro" ? promptText : undefined),
    });
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
      <div className="mb-3">
        <InsightCard
          surfaceId="distill"
          variant="hero"
          title={t("insights.title")}
          dotsLabel={t("distill.insightDots")}
        />
      </div>

      {/* 工作区：配置 / 结果 切换（原型 distill.tsx 873-1370，窄屏不再左右挤压） */}
      <section className="relative min-w-0 space-y-4">
        {distillView === "config" && (
          <>
            <DistillMetrics
              selectedCount={mode === "pro" ? segments.length : selectionCount}
              estTokens={estTokens}
              runs={runs}
              approved={approved}
              busy={distilling}
            />

            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2">
              <div className="aitracker-toolbar gap-1">
                {(
                  [
                    {
                      k: "config",
                      label: t("distill.viewConfig"),
                      Icon: FlaskConical,
                      badge: null,
                    },
                    {
                      k: "result",
                      label: t("distill.historyTitle"),
                      Icon: PackageCheck,
                      badge: totalRuns || null,
                    },
                  ] as const
                ).map(({ k, label, Icon, badge }) => {
                  const on = distillView === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setDistillView(k)}
                      className={`aitracker-chip font-mono ${on ? "aitracker-chip-on" : ""}`}
                    >
                      <Icon className="size-4" /> {label}
                      {badge != null && badge > 0 && (
                        <span className="ml-1 rounded-full bg-foreground/10 px-1.5 text-[10px]">
                          {badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                {t("distill.workbenchHint")}
              </span>
            </div>

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
              segments={segments}
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
              modelConfigured={hasRealModel}
              busy={busy}
            />
          </>
        )}

        {distillView === "result" && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card px-3 py-2">
            <div className="aitracker-toolbar gap-1">
              <button
                type="button"
                onClick={() => setDistillView("config")}
                className="aitracker-chip font-mono"
              >
                <FlaskConical className="size-3.5" /> {t("distill.viewConfig")}
              </button>
              <button
                type="button"
                onClick={() => setDistillView("result")}
                className="aitracker-chip font-mono aitracker-chip-on"
              >
                <PackageCheck className="size-3.5" />{" "}
                {t("distill.historyTitle")}
                {totalRuns > 0 && (
                  <span className="ml-1 rounded-full bg-foreground/10 px-1.5 text-[10px]">
                    {totalRuns}
                  </span>
                )}
              </button>
            </div>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
              {t("distill.summaryRuns", {
                count: totalRuns,
                saved: totalSaved,
              })}
            </span>
            {distilling && (
              <span
                className="inline-flex items-center gap-1.5 font-mono text-[11px]"
                style={{ color: "var(--chart-1)" }}
              >
                <Loader2 className="size-3.5 animate-spin" />{" "}
                {t("distill.running")}
              </span>
            )}
            <Link
              to="/skills"
              className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-primary hover:underline"
            >
              {t("distill.goSkills")} <ArrowRight className="size-3" />
            </Link>
          </div>
        )}

        {distillView === "result" && (
          <aside className="aitracker-scroll min-w-0 space-y-3">
            <div id="distill-results" className="scroll-mt-20 space-y-3">
              {distilling && (
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
                  progress={distillProgress}
                />
              )}

              {totalRuns === 0 && !distilling && (
                <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
                  <FlaskConical className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 font-mono text-[11.5px] text-muted-foreground">
                    {t("distill.emptyTitle")}
                  </p>
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground/70">
                    {t("distill.emptyDesc")}
                  </p>
                </div>
              )}

              {shownCandidates.length > 0 && (
                <>
                  <div className="mb-2 flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2">
                    <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={shownCandidates.every((item) =>
                          selectedCandidateIds.has(item.candidateId),
                        )}
                        onChange={(event) => {
                          // Snapshot the DOM value before scheduling the state
                          // update. Synthetic events may no longer expose
                          // currentTarget when React runs the updater.
                          const checked = event.currentTarget.checked;
                          setSelectedCandidateIds((current) => {
                            const next = new Set(current);
                            for (const item of shownCandidates) {
                              if (checked) next.add(item.candidateId);
                              else next.delete(item.candidateId);
                            }
                            return next;
                          });
                        }}
                      />
                      {t("distill.selectedCandidates", {
                        count: selectedCandidateIds.size,
                      })}
                    </label>
                    {selectedCandidateIds.size > 0 && (
                      <button
                        type="button"
                        className="text-[11px] text-destructive hover:underline"
                        onClick={() =>
                          void removeCandidates([...selectedCandidateIds])
                        }
                      >
                        {t("distill.deleteSelected")}
                      </button>
                    )}
                  </div>
                  <ul className="overflow-hidden rounded-xl border border-border bg-card">
                    {shownCandidates.map((candidate, i0) => {
                      const i = winStart + i0;
                      const badge = kindMeta(candidate.kind);
                      const resolved = resolveCandidateSource(
                        candidate,
                        sessions,
                      );
                      const sources =
                        resolved.sources.join(" / ") ||
                        [
                          ...new Set(
                            candidate.selectedSessionRefs.map((r) => r.source),
                          ),
                        ].join(" / ");
                      const open = viewId === candidate.candidateId;
                      const saved = candidate.approvalState === "approved";
                      return (
                        <li
                          key={candidate.candidateId}
                          className={`group relative transition-colors hover:bg-surface-2/40 ${
                            i > 0
                              ? "[box-shadow:inset_0_1px_0_var(--rowline)]"
                              : ""
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setViewId(open ? null : candidate.candidateId)
                            }
                            className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
                          >
                            <input
                              type="checkbox"
                              checked={selectedCandidateIds.has(
                                candidate.candidateId,
                              )}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                setSelectedCandidateIds((current) => {
                                  const next = new Set(current);
                                  if (checked) next.add(candidate.candidateId);
                                  else next.delete(candidate.candidateId);
                                  return next;
                                });
                              }}
                              className="mt-2 size-3.5 shrink-0"
                            />
                            <span
                              className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md"
                              style={{
                                background: `color-mix(in oklab, ${badge.color} 12%, transparent)`,
                                color: badge.color,
                              }}
                            >
                              {saved ? (
                                <PackageCheck className="size-4" />
                              ) : (
                                <FlaskConical className="size-4" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                                <span className="aitracker-num truncate text-[14px] font-semibold">
                                  {candidate.title || t(badge.labelKey)}
                                </span>
                                <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-px text-[11px] text-muted-foreground">
                                  {t(badge.labelKey)}
                                </span>
                                <span className="aitracker-num hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                                  {t("distill.histSegments", {
                                    count: candidate.selectedSessionRefs.length,
                                  })}{" "}
                                  ·{" "}
                                  {format.formatDateTime(
                                    candidate.generatedAt,
                                    false,
                                  )}
                                </span>
                                <span
                                  className="shrink-0 rounded-full px-2 py-px font-mono text-[10px]"
                                  style={
                                    saved
                                      ? {
                                          background:
                                            "color-mix(in oklab, var(--chart-1) 16%, transparent)",
                                          color: "var(--chart-1)",
                                        }
                                      : {
                                          background: "var(--surface-2)",
                                          color: "var(--muted-foreground)",
                                        }
                                  }
                                >
                                  {saved
                                    ? t("distill.histSaved")
                                    : t("distill.statusUnsaved")}
                                </span>
                              </span>
                              <span className="mt-1 block truncate text-[12.5px] leading-relaxed text-muted-foreground">
                                {sources}
                              </span>
                            </span>
                            <ChevronRight
                              className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
                                open ? "rotate-90" : ""
                              }`}
                            />
                          </button>
                          {open && (
                            <div className="px-3.5 pb-3.5">
                              <ExpCard
                                candidate={candidate}
                                sessions={sessions}
                                modelOptions={initial.modelOptions}
                                busy={busy}
                                bare
                                onRegenerate={() => handleRegenerate(candidate)}
                                onSaved={() => {
                                  setViewId(candidate.candidateId);
                                  setDistillView("result");
                                }}
                              />
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}

              {totalRuns > HIST_PAGE && (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                  <Pagination
                    page={curHistPage}
                    pageCount={histPageCount}
                    onChange={setHistPage}
                  />
                </div>
              )}
            </div>
          </aside>
        )}
      </section>

      {drawerOpen && (
        <MaterialDrawer
          sessions={sessions}
          segments={segments}
          onSegmentsChange={handleSegmentsChange}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </div>
  );
}
