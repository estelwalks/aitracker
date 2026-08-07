/**
 * Reports transport adapter. Server-only: wires the composition root's
 * reports application into the presentation read model. The report bodies
 * never cross this boundary; only renderer-safe `ReportListItem` /
 * `ReportDefinitionSummary` rows are returned.
 *
 * Wiring note (W3.1b): the reports application exposes `definitions` and
 * `createDraft`/`generate`, but neither it nor the AtomicJsonStore currently
 * expose a public `list()` of persisted documents/runs. Until that lands
 * (W3.1c will widen the store + wire the TaskApi-backed run source), the
 * query source returns empty report/run lists so the page renders the
 * definition catalog and an honest "no reports yet" empty state. Generation
 * is surfaced as a disabled action — calling it is a deliberate no-op so the
 * UI contract is stable when the list source is connected.
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

/** Empty list source used until the store exposes a public list port. */
function emptyReportsSource(): ReportsQuerySource {
  return {
    async listReports(): Promise<readonly ReportSummary[]> {
      return [];
    },
    async listRuns(): Promise<readonly ReportRun[]> {
      return [];
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
  const root = await getCompositionRoot();
  const reports: ReportsApplication = root.reports;
  const presentation = createReportsPresentation({
    reports,
    source: emptyReportsSource(),
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
 * Trigger a draft report generation. Currently a no-op placeholder: the
 * generate button in the UI is disabled, and wiring the real
 * `reports.createDraft`/`reports.generate` (plus a list-capable source so the
 * new row appears) is W3.1c. Exposed now so the query/page transport boundary
 * is stable.
 */
export async function generateReport(
  _definitionId: string,
): Promise<{ triggered: false }> {
  return { triggered: false };
}
