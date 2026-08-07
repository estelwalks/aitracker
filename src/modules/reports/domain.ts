import type {
  ReportDefinition,
  ReportDocument,
  ReportKind,
  ReportSummary,
} from "./contracts.ts";

export const BUILTIN_REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    definitionId: "reports.daily",
    kind: "daily",
    title: "Daily brief",
    template: {
      templateId: "reports.daily.default",
      version: 1,
      label: "Daily brief v1",
      template:
        "Summarize the supplied activity, risks, costs and knowledge changes for today.",
    },
    scheduleRef: { taskId: "reports.generate", scheduleId: "reports.daily" },
    enabled: true,
  },
  {
    definitionId: "reports.weekly",
    kind: "weekly",
    title: "Weekly review",
    template: {
      templateId: "reports.weekly.default",
      version: 1,
      label: "Weekly review v1",
      template:
        "Summarize the supplied activity, trends, risks and recommended follow-ups for this week.",
    },
    scheduleRef: { taskId: "reports.generate", scheduleId: "reports.weekly" },
    enabled: true,
  },
];

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

export function safeReportText(value: string, max = 60_000): string {
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
