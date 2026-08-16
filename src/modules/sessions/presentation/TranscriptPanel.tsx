import { Link, useNavigate } from "@tanstack/react-router";
import {
  AppWindow,
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpToLine,
  Brain,
  ChevronRight,
  FileText,
  Loader2,
  Terminal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog.tsx";
import { EmptyState, StatusBadge, TTButton } from "../../../components/tt.tsx";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { sourceLabel } from "../../../lib/local-usage/presentation.ts";
import { useReportActions } from "../../reports/presentation/report-actions.ts";
import type { SessionSummary, SessionTranscriptMessage } from "../contracts.ts";
import { getSessionTranscript } from "../query.ts";
import {
  buildReportText,
  buildSegmentMarkdown,
  type ReportInput,
  type ReportLabel,
} from "./chat-report.ts";
import { ResumeSessionButton } from "./ResumeSessionButton.tsx";

/**
 * Session detail panel (Story S-300): sticky header, sticky segment-selection
 * bar, CLI/client resume card, and the full local conversation with
 * point-to-point segment selection for 蒸馏所选 and 生成简报.
 *
 * PRIVACY BOUNDARY — in-memory only, never persisted or uploaded: the
 * transcript is fetched through the server fn, which reads the user's own
 * local logs into memory for this page render. Nothing here writes to any
 * store and nothing leaves the machine.
 */
export function TranscriptPanel({ session }: { session: SessionSummary }) {
  const { t, format } = useI18n();
  const navigate = useNavigate();

  const [transcript, setTranscript] = useState<SessionTranscriptMessage[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [anchor, setAnchor] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const load = useCallback(() => {
    setStatus("loading");
    void getSessionTranscript({
      data: { source: session.source, sessionId: session.sessionId },
    })
      .then((result) => {
        setTranscript([...result.messages]);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [session.source, session.sessionId]);

  useEffect(load, [load]);

  const label = useMemo<ReportLabel>(
    () => ((key, params) => t(key, params as never)) as ReportLabel,
    [t],
  );

  const total = transcript.length;

  const reportInput = useCallback(
    (messages: readonly SessionTranscriptMessage[]): ReportInput => ({
      session,
      messages,
      dateLabel: format.formatDate(session.startedAt),
      tokensTotal: format.formatTokens(session.totals.totalTokens),
      tokensIn: format.formatTokens(session.totals.inputTokens),
      tokensOut: format.formatTokens(session.totals.outputTokens),
      modelLabel: session.model ?? label("common.unknown"),
      experienceItems: [
        label("sessions.transcript.expItem1"),
        label("sessions.transcript.expItem2"),
        label("sessions.transcript.expItem3"),
      ],
    }),
    [format, label, session],
  );

  const reportBody = useMemo(
    () =>
      status === "ready" ? buildReportText(reportInput(transcript), label) : "",
    [reportInput, status, transcript, label],
  );
  const reportActions = useReportActions(
    reportBody,
    `daily-report-${session.startedAt.slice(0, 10)}`,
  );

  // Segment selection — prototype parity: first click sets the anchor,
  // second click (or 以上/以下全部) sets the end; hover previews the range.
  const range = useMemo(() => {
    if (anchor === null) return null;
    const other = end ?? hover;
    if (other === null) return { s: anchor, e: anchor, live: false };
    return {
      s: Math.min(anchor, other),
      e: Math.max(anchor, other),
      live: end === null,
    };
  }, [anchor, end, hover]);

  const picked = useMemo(() => {
    if (!range) return [] as number[];
    if (range.live) return [range.s];
    const out: number[] = [];
    for (let index = range.s; index <= range.e; index += 1) out.push(index);
    return out;
  }, [range]);

  function pick(index: number) {
    if (anchor === null || end !== null) {
      setAnchor(index);
      setEnd(null);
    } else {
      setEnd(index);
    }
  }

  function reset() {
    setAnchor(null);
    setEnd(null);
    setHover(null);
  }

  function selectAll() {
    setAnchor(0);
    setEnd(Math.max(0, total - 1));
  }

  function allAbove() {
    if (anchor !== null) setEnd(0);
  }

  function allBelow() {
    if (anchor !== null) setEnd(Math.max(0, total - 1));
  }

  /**
   * 蒸馏所选: assemble the picked segment markdown, copy it to the clipboard
   * (so it can be pasted into the distill workbench prompt), notify, and jump
   * to /distill. Nothing is uploaded — the segment lives in this browser only.
   */
  async function runDistill() {
    if (end === null || total === 0) return;
    const pickedMessages = picked
      .map((index) => transcript[index])
      .filter(
        (message): message is SessionTranscriptMessage => message != null,
      );
    if (pickedMessages.length === 0) return;
    const markdown = buildSegmentMarkdown(reportInput(pickedMessages), label);
    try {
      await navigator.clipboard?.writeText(markdown);
    } catch {
      // Clipboard may be unavailable (permissions/private mode) — best effort.
    }
    toast.info(
      t("sessions.transcript.distillToast", {
        count: pickedMessages.length,
      }),
    );
    void navigate({ to: "/distill" });
  }

  const messageCount = status === "ready" ? total : session.turns;
  const selectionReady = end !== null && picked.length > 0;

  return (
    <div className="min-w-0 flex-1">
      <div className="sticky top-14 z-30 -mx-4 border-b border-border/60 bg-background/95 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex items-start gap-3">
          <Link
            to="/chats"
            aria-label={t("sessions.detail.back")}
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-semibold tracking-tight">
              {session.title || t("sessions.row.untitled")}
            </h1>
            <div className="tt-num mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <StatusBadge tone="primary">
                {sourceLabel(session.source)}
              </StatusBadge>
              <span>{format.formatDateTime(session.startedAt, false)}</span>
              <span aria-hidden="true">·</span>
              <span>{session.projectKey}</span>
              <span aria-hidden="true">·</span>
              <span>
                {t("sessions.transcript.messageCount", {
                  count: format.formatNumber(messageCount),
                })}
              </span>
              {session.model ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{session.model}</span>
                </>
              ) : null}
            </div>
          </div>
          <TTButton
            size="sm"
            onClick={() => setReportOpen(true)}
            title={t("sessions.transcript.generateReport")}
          >
            <FileText className="size-3.5" />
            {t("sessions.transcript.generateReport")}
          </TTButton>
          <ResumeSessionButton session={session} />
        </div>

        {status === "ready" && total > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border/60 pt-2.5">
            <span className="tt-num inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Brain className="size-3.5 text-primary" />
              {anchor === null
                ? t("sessions.transcript.startHint")
                : end === null
                  ? t("sessions.transcript.anchorSet", {
                      index: format.formatNumber(anchor + 1),
                    })
                  : t("sessions.transcript.selectedRange", {
                      count: format.formatNumber(picked.length),
                      start: format.formatNumber((range?.s ?? anchor) + 1),
                      end: format.formatNumber((range?.e ?? anchor) + 1),
                    })}
            </span>
            <div className="flex-1" />
            {anchor !== null && end === null ? (
              <>
                <TTButton
                  size="sm"
                  onClick={allAbove}
                  disabled={anchor === 0}
                  title={t("sessions.transcript.allAbove")}
                >
                  <ArrowUpToLine className="size-3.5" />
                  {t("sessions.transcript.allAbove")}
                </TTButton>
                <TTButton
                  size="sm"
                  onClick={allBelow}
                  disabled={anchor === total - 1}
                  title={t("sessions.transcript.allBelow")}
                >
                  <ArrowDownToLine className="size-3.5" />
                  {t("sessions.transcript.allBelow")}
                </TTButton>
              </>
            ) : null}
            <TTButton size="sm" onClick={selectAll}>
              {t("sessions.transcript.selectAll")}
            </TTButton>
            {anchor !== null ? (
              <TTButton size="sm" onClick={reset}>
                <X className="size-3.5" />
                {t("sessions.transcript.reset")}
              </TTButton>
            ) : null}
            <TTButton
              size="sm"
              variant={selectionReady ? "primary" : "default"}
              disabled={!selectionReady}
              onClick={() => void runDistill()}
            >
              <Brain className="size-3.5" />
              {t("sessions.transcript.distillSelected")}
              {selectionReady ? ` ${format.formatNumber(picked.length)}` : ""}
            </TTButton>
          </div>
        ) : null}
      </div>

      {session.resumeAvailable ? (
        <div className="mx-auto mt-4 mb-4 max-w-3xl rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <Terminal className="size-3.5 text-primary" />
            <span className="text-foreground">
              {t("sessions.transcript.cliResumable")}
            </span>
            <span aria-hidden="true">·</span>
            <span>{t("sessions.transcript.cliHint")}</span>
          </div>
          <dl className="tt-num grid gap-x-6 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="shrink-0">{t("sessions.transcript.sessionId")}</dt>
              <dd className="truncate text-foreground">{session.sessionId}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t("sessions.row.resumeDirHint")}
          </p>
        </div>
      ) : (
        <div className="mx-auto mt-4 mb-4 max-w-3xl rounded-xl border border-border bg-card p-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <AppWindow className="size-3.5" />
            <span className="text-foreground">
              {t("sessions.transcript.clientSession")}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {t("sessions.transcript.clientHint", {
                source: sourceLabel(session.source),
              })}
            </span>
          </div>
          <dl className="tt-num grid gap-x-6 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="shrink-0">{t("sessions.transcript.sessionId")}</dt>
              <dd className="truncate text-foreground">{session.sessionId}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="mx-auto max-w-3xl pb-24">
        {status === "loading" ? (
          <EmptyState
            icon={<Loader2 className="size-6 animate-spin" />}
            title={t("sessions.transcript.loading")}
          />
        ) : null}
        {status === "error" ? (
          <EmptyState
            title={t("sessions.transcript.error")}
            actions={
              <TTButton onClick={load}>
                {t("sessions.transcript.retry")}
              </TTButton>
            }
          />
        ) : null}
        {status === "ready" && total === 0 ? (
          <EmptyState title={t("sessions.transcript.empty")} />
        ) : null}
        {status === "ready" && total > 0 ? (
          <>
            <div className="space-y-4" onMouseLeave={() => setHover(null)}>
              {transcript.map((message, index) => (
                <Bubble
                  key={index}
                  message={message}
                  index={index}
                  isAnchor={anchor === index}
                  inRange={
                    range !== null && index >= range.s && index <= range.e
                  }
                  preview={range?.live === true}
                  confirmed={end !== null}
                  onPick={() => pick(index)}
                  onHover={() => setHover(index)}
                />
              ))}
            </div>
            <p className="mt-6 text-center text-[10px] tracking-wide text-muted-foreground">
              {t("sessions.transcript.localOnly")}
            </p>
          </>
        ) : null}
      </div>

      <Dialog
        open={reportOpen}
        onOpenChange={(open) => {
          if (!open) setReportOpen(false);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t("sessions.transcript.reportTitle")} ·{" "}
              {format.formatDate(session.startedAt)}
            </DialogTitle>
            <DialogDescription>
              {sourceLabel(session.source)} · {session.projectKey} ·{" "}
              {session.model ?? t("common.unknown")}
            </DialogDescription>
          </DialogHeader>
          <div className="tt-scroll max-h-[60vh] overflow-y-auto pr-1">
            <pre className="tt-num whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
              {reportBody}
            </pre>
          </div>
          <DialogFooter>
            <TTButton size="sm" onClick={() => void reportActions.copy()}>
              {t("common.reports.editor.copy")}
            </TTButton>
            <TTButton size="sm" onClick={reportActions.exportMd}>
              {t("common.reports.editor.exportMd")}
            </TTButton>
            <TTButton
              size="sm"
              variant="primary"
              onClick={() => setReportOpen(false)}
            >
              {t("common.close")}
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Bubble({
  message,
  index,
  isAnchor,
  inRange,
  preview,
  confirmed,
  onPick,
  onHover,
}: {
  message: SessionTranscriptMessage;
  index: number;
  isAnchor: boolean;
  inRange: boolean;
  preview: boolean;
  confirmed: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  const mark = (
    <span
      className={`mt-2.5 w-8 shrink-0 text-center text-[10px] transition-opacity ${
        isAnchor
          ? "text-primary"
          : inRange
            ? "text-primary/70"
            : "text-muted-foreground opacity-0 group-hover:opacity-100"
      }`}
    >
      {isAnchor
        ? t("sessions.transcript.anchorMark")
        : inRange && confirmed
          ? t("sessions.transcript.selectedMark")
          : `#${index + 1}`}
    </span>
  );
  const ring = isAnchor
    ? "ring-1 ring-primary"
    : inRange
      ? preview
        ? "ring-1 ring-primary/40"
        : "ring-1 ring-primary/70"
      : "";

  if (message.role === "user") {
    return (
      <div
        className="group flex cursor-pointer items-start justify-end gap-2"
        onClick={onPick}
        onMouseEnter={onHover}
      >
        <div
          className={`max-w-[80%] rounded-xl rounded-tr-sm border px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-foreground transition-all ${
            inRange
              ? "border-primary bg-primary/20"
              : "border-primary bg-primary/12"
          } ${ring}`}
        >
          {message.text}
        </div>
        {mark}
      </div>
    );
  }

  return (
    <div
      className="group flex cursor-pointer items-start justify-start gap-2"
      onClick={onPick}
      onMouseEnter={onHover}
    >
      {mark}
      <div
        className={`max-w-[85%] rounded-xl rounded-tl-sm border bg-surface-2 px-3.5 py-2.5 transition-all ${
          inRange ? "border-primary" : "border-border"
        } ${ring}`}
      >
        {message.thinking ? (
          <div className="mb-2 border-b border-border pb-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen((current) => !current);
              }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronRight
                className={`size-3 transition-transform ${open ? "rotate-90" : ""}`}
              />
              {t("sessions.transcript.thinking")}
            </button>
            {open ? (
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground italic whitespace-pre-wrap">
                {message.thinking}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground">
          {message.text}
        </p>
      </div>
    </div>
  );
}
