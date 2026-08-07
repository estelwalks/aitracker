import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  TTButton,
} from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n/messages";
import type { CandidateOutput } from "../contracts";
import type { DistillationSessionItem, DistillationViewModel } from "./index";
import { approveCandidate, cancelCandidate, startDistillation } from "../query";

const MAX_SELECTION = 8;

function keyOf(item: { source: string; sessionId: string }): string {
  return `${item.source}:${item.sessionId}`;
}

const APPROVAL_TONE: Record<
  CandidateOutput["approvalState"],
  "neutral" | "primary" | "ok" | "warn" | "danger"
> = {
  "waiting-approval": "warn",
  approved: "ok",
  cancelled: "neutral",
};

export function DistillationPage({
  initial,
}: {
  initial: DistillationViewModel;
}) {
  const { t, format } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // The candidate most recently produced or actioned in this view. Because
  // the application keeps candidates in memory and exposes no list API, this
  // is the only candidate the workbench can act on after `start`.
  const [active, setActive] = useState<CandidateOutput | undefined>(undefined);

  const sessions = useMemo(() => initial.sessions, [initial.sessions]);
  const selectionCount = selected.size;
  const canStart =
    !busy && selectionCount > 0 && selectionCount <= MAX_SELECTION;

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
    const refs = sessions
      .filter((item) => selected.has(keyOf(item)))
      .map((item) => ({ source: item.source, sessionId: item.sessionId }));
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

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={t("common.distillation.pageTitle")}
          desc={t("common.distillation.pageDesc")}
        />
        <TTButton
          variant="primary"
          disabled={!canStart}
          title={
            selectionCount === 0
              ? t("common.distillation.startHint")
              : undefined
          }
          onClick={handleStart}
        >
          <Sparkles className="size-3.5" />
          {t("common.distillation.start")}
        </TTButton>
      </div>

      <Panel
        className="mt-3"
        title={t("common.distillation.selectSessions", { max: MAX_SELECTION })}
        action={
          selectionCount > 0 ? (
            <span className="tt-num text-[11px] text-muted-foreground">
              {t("common.distillation.selected", { count: selectionCount })}
            </span>
          ) : undefined
        }
      >
        {sessions.length === 0 ? (
          <EmptyState
            title={t("common.distillation.noSessions")}
            desc={t("common.distillation.noSessionsDesc")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {sessions.map((item) => {
              const key = keyOf(item);
              const checked = selected.has(key);
              const disabled = !checked && selected.size >= MAX_SELECTION;
              return (
                <li
                  key={key}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-3 text-[13px]"
                >
                  <label className="flex min-w-[180px] flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggle(item)}
                      className="size-3.5 accent-primary"
                    />
                    <Dot className="bg-primary" />
                    <span className="truncate font-medium text-foreground">
                      {item.title}
                    </span>
                  </label>
                  <span className="tt-num text-[11px] text-muted-foreground">
                    {item.source}:{item.sessionId}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("common.distillation.selectedTurns", {
                      count: item.turns,
                    })}
                  </span>
                  <span className="tt-num text-[11px] text-muted-foreground">
                    {format.formatDateTime(item.startedAt, false)}
                  </span>
                  <StatusBadge tone="neutral">{item.status}</StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel className="mt-3" title={t("common.distillation.candidate")}>
        <p className="mb-3 text-[11px] text-muted-foreground">
          {t("common.distillation.candidateNote")}
        </p>
        {active ? (
          <div className="rounded-sm border border-border bg-surface px-3 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="truncate font-medium text-foreground">
                {active.title}
              </span>
              <StatusBadge tone={APPROVAL_TONE[active.approvalState]}>
                {active.approvalState}
              </StatusBadge>
              <span className="tt-num text-[11px] text-muted-foreground">
                {active.mode}
              </span>
              <span className="tt-num text-[11px] text-muted-foreground">
                {format.formatDateTime(active.generatedAt, false)}
              </span>
            </div>
            <p className="mt-2 line-clamp-3 text-[12px] text-muted-foreground">
              {active.summary}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <TTButton
                variant="primary"
                size="sm"
                disabled={busy || active.approvalState !== "waiting-approval"}
                onClick={handleApprove}
              >
                {t("common.distillation.approve")}
              </TTButton>
              <TTButton
                variant="danger"
                size="sm"
                disabled={busy || active.approvalState !== "waiting-approval"}
                onClick={handleCancel}
              >
                {t("common.distillation.cancel")}
              </TTButton>
            </div>
          </div>
        ) : (
          <EmptyState
            title={t("common.distillation.candidate")}
            desc={t("common.distillation.candidateNote")}
          />
        )}
      </Panel>
    </>
  );
}
