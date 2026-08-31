import type {
  ReportDefinition,
  ReportDefinitionSummary,
  ReportDocument,
  ReportKind,
  ReportTemplateKind,
  ReportSummary,
} from "./contracts.ts";
import { REPORT_TEMPLATES, templateSetFor } from "./templates.ts";
import type { Locale } from "../../lib/i18n/locale";

export const BUILTIN_REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    definitionId: "reports.daily",
    kind: "daily",
    title: "Daily brief",
    template: REPORT_TEMPLATES["zh-CN"].daily,
    templates: templateSetFor(),
    scheduleRef: {
      taskId: "reports.generate.daily",
      scheduleId: "reports.daily",
    },
    enabled: true,
  },
  {
    definitionId: "reports.weekly",
    kind: "weekly",
    title: "Weekly review",
    template: REPORT_TEMPLATES["zh-CN"].weekly,
    templates: templateSetFor(),
    scheduleRef: {
      taskId: "reports.generate.weekly",
      scheduleId: "reports.weekly",
    },
    enabled: true,
  },
];

export function templateForLocale(
  definition: ReportDefinition,
  locale: Locale = "zh-CN",
  kind: ReportTemplateKind = definition.kind,
) {
  return definition.templates?.[locale]?.[kind] ?? definition.template;
}

export function toReportSummary(
  document: ReportDocument,
  definition: ReportDefinition,
): ReportSummary {
  return {
    reportId: document.reportId,
    runId: document.runId,
    definitionId: document.definitionId,
    kind: definition.kind,
    status: document.status,
    title: document.title,
    generatedAt: document.generatedAt,
    templateVersion: document.templateVersion,
    evidence: document.evidence,
    assets: document.assets,
  };
}

export function toDefinitionSummary(
  definition: ReportDefinition,
): ReportDefinitionSummary {
  return {
    definitionId: definition.definitionId,
    kind: definition.kind,
    title: definition.title,
    templateVersion: definition.template.version,
    scheduleRef: definition.scheduleRef,
    enabled: definition.enabled,
  };
}

export function validKind(value: unknown): value is ReportKind {
  return value === "daily" || value === "weekly";
}

export function canTransition(
  from: ReportDocument["status"],
  to: ReportDocument["status"],
): boolean {
  return (
    (from === "draft" && to === "approved") ||
    ((from === "draft" || from === "approved") && to === "archived")
  );
}

/**
 * Storage boundary for report bodies. This is NOT a free choice: the `reports`
 * table carries `CHECK (length(body) BETWEEN 1 AND 60000)` in migration
 * `0001_initial_schema` (line ~583). SQLite cannot alter a CHECK on an existing
 * table, and the migration is checksum-validated against already-created
 * databases — so the durable limit stays 60,000 characters and `safeReportText`
 * keeps truncating here. The transport layer (server-fns) allows up to 2 MiB;
 * anything above the DB boundary is truncated explicitly and signalled via
 * `wasReportTextTruncated` instead of silently dropped (P1-10).
 */
export const REPORT_BODY_MAX = 60_000;

export function safeReportText(value: string, max = REPORT_BODY_MAX): string {
  const text = value.trim().slice(0, max);
  if (!text) throw new TypeError("report body is empty");
  if (
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\|\\\\|\b(?:bearer|sk-|api[_-]?key|password|secret)\b)/i.test(
      text,
    )
  )
    throw new TypeError("report body contains sensitive data");
  return text;
}

/**
 * Explicit truncation signal (P1-10): true when `value` exceeds the storage
 * boundary and a persistence path would slice it. Callers surface this to the
 * user ("Text longer than 60,000 characters will be truncated") instead of truncating silently.
 */
export function wasReportTextTruncated(
  value: string,
  max = REPORT_BODY_MAX,
): boolean {
  return value.trim().length > max;
}
