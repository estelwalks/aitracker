/**
 * Reports transport adapter. Server-only: wires the composition root's
 * reports application into the presentation read model. The report bodies
 * never cross this boundary; only renderer-safe `ReportListItem` /
 * `ReportDefinitionSummary` rows are returned.
 *
 * The store now exposes `listDocuments`/`listRuns` (see the ReportStore
 * contract), so the query source reads real persisted documents/runs instead
 * of returning an empty list. Generation is gated on an actual LLM being
 * configured (see ai-orchestration/config); without one the transport reports
 * "not triggered" so the UI shows the honest disabled state rather than a fake
 * success.
 */
import type { Locale } from "../../lib/i18n/locale";
import type {
  ReportQueryViewModel,
  ReportsQuerySource,
} from "./presentation/index.ts";
import type {
  ReportDefinitionSummary,
  ReportRun,
  ReportSummary,
  ReportsApplication,
} from "./contracts.ts";

/** Reads persisted reports/runs from the composition root's application. */
function compositionReportsSource(
  reports: ReportsApplication,
): ReportsQuerySource {
  return {
    async listReports(): Promise<readonly ReportSummary[]> {
      const result = await reports.list();
      return result.ok ? result.value : [];
    },
    async listRuns(): Promise<readonly ReportRun[]> {
      const result = await reports.listRuns();
      return result.ok ? result.value : [];
    },
  };
}

export interface LoadReportsResult {
  readonly viewModel: ReportQueryViewModel;
  readonly definitions: readonly ReportDefinitionSummary[];
}

/**
 * Load the reports read model for the renderer. Builds the presentation
 * against the composition root's reports application and resolves the query
 * once. The `locale` is accepted for parity with the other module transports
 * (and for future per-locale formatting); the current view model is
 * locale-neutral.
 */
export async function loadReports(_locale: Locale): Promise<LoadReportsResult> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { createReportsPresentation } = await import("./presentation/index.ts");
  const { isLLMConfigured } = await import("../ai-orchestration/config.ts");
  const root = await getCompositionRoot();
  const reports: ReportsApplication = root.reports;
  const presentation = createReportsPresentation({
    reports,
    source: compositionReportsSource(reports),
    // Without a configured LLM the generation pipeline cannot run; surface the
    // honest offline state so the page disables generation instead of faking it.
    offline: !isLLMConfigured(),
  });
  const result = await presentation.query();
  if (!result.ok) {
    // The presentation only fails on an unexpected throw; degrade to an
    // offline-style empty feed instead of surfacing a raw error code.
    return {
      viewModel: {
        feed: {
          reports: [],
          memories: [],
          definitions: reports.definitions,
          generatedAt: new Date().toISOString(),
          offline: true,
          disabled: false,
        },
      },
      definitions: reports.definitions,
    };
  }
  return {
    viewModel: result.value,
    definitions: reports.definitions,
  };
}

/**
 * Trigger a draft report generation. Honest gate: without a configured LLM the
 * transport reports `{ triggered: false }` (the UI keeps the button disabled);
 * with one it runs the real generation pipeline and reports success.
 */
export async function generateReport(
  definitionId: string,
): Promise<{ triggered: boolean }> {
  const { isLLMConfigured } = await import("../ai-orchestration/config.ts");
  if (!isLLMConfigured()) return { triggered: false };
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.reports.generate({
    definitionId,
    trigger: "manual",
  });
  return { triggered: result.ok };
}
