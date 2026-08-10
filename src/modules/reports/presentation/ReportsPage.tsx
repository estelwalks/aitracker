import { useMemo } from "react";
import { FileText, CalendarDays, CalendarRange } from "lucide-react";

import {
  Dot,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  TTButton,
} from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import type { ReportKind } from "../contracts";
import type {
  ReportListItem,
  ReportQueryViewModel,
  ReportUiStatus,
} from "./index";

/**
 * Status → common.status.* label key. `ReportUiStatus` maps cleanly onto the
 * shared status vocabulary so the page avoids a dedicated reports namespace
 * (W5 will consolidate all copy).
 */
const STATUS_LABEL_KEY: Record<ReportUiStatus, MessageKey> = {
  draft: "common.status.waitingApproval",
  running: "common.status.running",
  "waiting-approval": "common.status.waitingApproval",
  failed: "common.status.failed",
  published: "common.status.fresh",
  stale: "common.status.stale",
};

const STATUS_TONE: Record<
  ReportUiStatus,
  "neutral" | "primary" | "ok" | "warn" | "danger"
> = {
  draft: "warn",
  running: "primary",
  "waiting-approval": "warn",
  failed: "danger",
  published: "ok",
  stale: "neutral",
};

const KIND_LABEL_KEY: Record<ReportKind, MessageKey> = {
  daily: "common.reports.kindDaily",
  weekly: "common.reports.kindWeekly",
};

const KIND_ICON: Record<ReportKind, typeof CalendarDays> = {
  daily: CalendarDays,
  weekly: CalendarRange,
};

export function ReportsPage({ initial }: { initial: ReportQueryViewModel }) {
  const { t, format } = useI18n();
  const feed = initial.feed;
  const offline = feed.offline;
  const disabled = feed.disabled;
  const generateBlocked = offline || disabled;
  const reports = useMemo(() => feed.reports, [feed.reports]);
  const definitions = useMemo(() => feed.definitions, [feed.definitions]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PageHeader
          title={t("common.reports.pageTitle")}
          desc={t("common.reports.pageDesc")}
        />
        <TTButton
          variant="primary"
          disabled={generateBlocked || definitions.length === 0}
          title={generateBlocked ? t("common.reports.generateHint") : undefined}
          onClick={() => {
            /* Generation wiring is W3.1c; button stays disabled in W3.1b. */
          }}
        >
          <FileText className="size-3.5" />
          {t("common.reports.generate")}
        </TTButton>
      </div>

      {(offline || disabled) && (
        <div className="mb-3 rounded-sm border border-border bg-surface px-3 py-2 text-[12px] text-muted-foreground">
          {offline ? t("common.status.offline") : t("common.status.disabled")}
          {disabled && ` · ${t("common.reports.generateHint")}`}
        </div>
      )}

      <Panel className="mt-3" title={t("common.reports.definitions")}>
        {definitions.length === 0 ? (
          <EmptyState
            title={t("common.reports.emptyTitle")}
            desc={t("common.reports.emptyDesc")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {definitions.map((definition) => {
              const KindIcon = KIND_ICON[definition.kind];
              const enabled = definition.enabled;
              return (
                <li
                  key={definition.definitionId}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-3 text-[13px]"
                >
                  <div className="flex min-w-[180px] flex-1 items-center gap-2">
                    <KindIcon className="size-3.5 text-muted-foreground" />
                    <span className="font-medium text-foreground">
                      {definition.title}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {t(KIND_LABEL_KEY[definition.kind])}
                  </span>
                  <span className="tt-num text-[11px] text-muted-foreground">
                    v{definition.templateVersion}
                  </span>
                  <StatusBadge tone={enabled ? "ok" : "neutral"}>
                    {enabled
                      ? t("common.status.fresh")
                      : t("common.status.disabled")}
                  </StatusBadge>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel className="mt-3" title={t("common.reports.reports")}>
        <p className="mb-3 text-[11px] text-muted-foreground">
          {t("common.reports.updatedAt", {
            time: format.formatDateTime(feed.generatedAt, false),
          })}
        </p>
        {reports.length === 0 ? (
          <EmptyState
            title={t("common.reports.emptyTitle")}
            desc={t("common.reports.emptyDesc")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {reports.map((report) => (
              <ReportRow
                key={report.reportId ?? report.runId ?? report.definitionId}
                report={report}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

function ReportRow({ report }: { report: ReportListItem }) {
  const { t, format } = useI18n();
  const tone = STATUS_TONE[report.status];
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 py-3 text-[13px]">
      <div className="flex w-full items-center gap-2">
        <Dot className="bg-primary" />
        <span className="truncate font-medium text-foreground">
          {report.title}
        </span>
        <StatusBadge tone={tone}>
          {t(STATUS_LABEL_KEY[report.status])}
        </StatusBadge>
      </div>
      <div className="flex w-full flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground">
        <span>
          {t(KIND_LABEL_KEY[report.kind])}
          {report.templateVersion !== undefined && (
            <> · v{report.templateVersion}</>
          )}
        </span>
        {report.generatedAt && (
          <span className="tt-num">
            {format.formatDateTime(report.generatedAt, false)}
          </span>
        )}
        <span className="tt-num">
          {report.assetCount} / {report.evidenceCount}
        </span>
        {report.errorCode && (
          <span className="text-danger">{report.errorCode}</span>
        )}
      </div>
    </li>
  );
}
