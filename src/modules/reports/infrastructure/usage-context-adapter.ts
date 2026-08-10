/**
 * Minimal ReportContextPort. Real evidence aggregation joins four streams
 * (usage, insights, security, knowledge) and is intentionally deferred until
 * the insights module can feed it (W3.4 follow-up). Until then `collect`
 * returns an empty evidence list and a fixed, kind-scoped summary that is
 * safe to persist and to render in the dashboard.
 *
 * TODO(reports-evidence): wire usage/insights/security/knowledge evidence
 * collectors here. The summary must remain redacted — never raw sessions,
 * absolute paths, or tokens.
 */
import type {
  ReportContext,
  ReportContextPort,
  ReportDefinition,
} from "../contracts.ts";

function summaryFor(definition: ReportDefinition): string {
  switch (definition.kind) {
    case "daily":
      return "Daily report context (offline). Evidence aggregation lands in a follow-up.";
    case "weekly":
      return "Weekly report context (offline). Evidence aggregation lands in a follow-up.";
    default: {
      const exhaustive: never = definition.kind;
      void exhaustive;
      return "Report context (offline). Evidence aggregation lands in a follow-up.";
    }
  }
}

export function createReportContextPort(): ReportContextPort {
  return {
    async collect(input: {
      readonly definition: ReportDefinition;
    }): Promise<ReportContext> {
      return {
        evidence: [],
        summary: summaryFor(input.definition),
      };
    },
  };
}
