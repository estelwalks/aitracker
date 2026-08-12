import { Link } from "@tanstack/react-router";
import { ArrowLeft, Clock3, GitBranch, Layers3, Terminal } from "lucide-react";

import {
  Card,
  MetricGrid,
  PageBar,
  StatusBadge,
} from "../../../components/tt.tsx";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { sourceLabel } from "../../../lib/local-usage/presentation.ts";
import { formatCostLabel } from "../../../lib/pricing/cost-label.ts";
import type { SessionSummary } from "../contracts.ts";
import { ResumeSessionButton } from "./ResumeSessionButton.tsx";

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const STATUS_TONE: Record<
  SessionSummary["status"],
  "ok" | "warn" | "danger" | "neutral"
> = {
  available: "ok",
  interrupted: "warn",
  lost: "danger",
  unavailable: "neutral",
};

/** Safe session summary view — there is intentionally no transcript panel. */
export function SessionDetailPage({ session }: { session: SessionSummary }) {
  const { t, format } = useI18n();
  return (
    <div className="space-y-4 pb-12">
      <PageBar
        title={t("sessions.detail.title")}
        summary={sourceLabel(session.source)}
      >
        <ResumeSessionButton session={session} />
      </PageBar>

      <Link
        to="/chats"
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" />
        {t("sessions.detail.back")}
      </Link>

      <Card
        title={session.title || t("sessions.row.untitled")}
        desc={t("sessions.detail.safeSummary")}
        action={
          <StatusBadge tone={STATUS_TONE[session.status]}>
            {t(`sessions.status.${session.status}`)}
          </StatusBadge>
        }
      >
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-5 pb-4 font-mono text-[11px] text-muted-foreground">
          <span>{sourceLabel(session.source)}</span>
          <span>{session.projectKey}</span>
          {session.model ? <span>{session.model}</span> : null}
          {session.statusReason ? <span>{session.statusReason}</span> : null}
        </div>
      </Card>

      <MetricGrid
        items={[
          {
            icon: Terminal,
            label: "Token",
            v: format.formatTokens(session.totals.totalTokens),
            sub: `${format.formatTokens(session.totals.inputTokens)} in · ${format.formatTokens(session.totals.outputTokens)} out`,
          },
          {
            icon: Clock3,
            label: t("sessions.detail.duration"),
            v: formatDuration(session.durationMs),
            sub: t("sessions.detail.activity"),
          },
          {
            icon: Layers3,
            label: t("sessions.row.turns"),
            v: format.formatNumber(session.turns),
            sub: `${t("sessions.row.edits")} ${format.formatNumber(session.editTurns)} · retry ${format.formatNumber(session.retryTurns)}`,
          },
          {
            icon: GitBranch,
            label: t("sessions.detail.subagents"),
            v: format.formatNumber(session.subagentCalls),
            sub: formatCostLabel(t, format, session.cost),
          },
        ]}
      />

      <Card title={t("sessions.detail.activity")}>
        <dl className="grid gap-px bg-border/60 sm:grid-cols-2">
          <DetailItem
            label={t("sessions.detail.startedAt")}
            value={format.formatDateTime(session.startedAt, false)}
          />
          <DetailItem
            label={t("sessions.detail.endedAt")}
            value={format.formatDateTime(session.endedAt, false)}
          />
          <DetailItem
            label={t("sessions.row.turns")}
            value={format.formatNumber(session.turns)}
          />
          <DetailItem
            label={t("sessions.row.edits")}
            value={format.formatNumber(session.editTurns)}
          />
        </dl>
        <p className="border-t border-border/60 px-5 py-3 text-[11px] text-muted-foreground">
          {t("sessions.row.resumeDirHint")}
        </p>
      </Card>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-5 py-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="tt-num mt-1 text-[13px] text-foreground">{value}</dd>
    </div>
  );
}
