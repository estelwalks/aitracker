/**
 * Reports transport adapter. Server-only: wires the composition root's
 * reports application into the presentation read model. Report bodies are only
 * returned through `getReportBody` (redacted generated content — see
 * `safeReportText`); the list view model stays body-free.
 *
 * The store exposes `listDocuments`/`listRuns` (see the ReportStore contract),
 * so the query source reads real persisted documents/runs instead of an empty
 * list. Session density for the archive band / calendar / header stats comes
 * from the composition root's sessions port (`root.sessions`), aggregated by
 * `aggregateSessionDensity` — never mocked.
 *
 * Generation is gated on a usable model backend: an active S-500 model
 * profile (real model call) or the legacy TRUSTTOOLS_LLM_* environment
 * configuration (see ai-orchestration/config). Without either the transport
 * reports `{ triggered: false }` so the UI shows the honest disabled state
 * rather than a fake success.
 */
import type { Locale } from "../../lib/i18n/locale";
import type { SessionQueryPort } from "../sessions/contracts.ts";
import type {
  ReportQueryViewModel,
  ReportsQuerySource,
} from "./presentation/index.ts";
import type {
  ReportContent,
  ReportDefinitionSummary,
  ReportRun,
  ReportSummary,
  ReportsApplication,
} from "./contracts.ts";
import { aggregateSessionDensity } from "./period.ts";

/** Cap on sessions loaded for density (10 pages of 100) to bound scan cost. */
const DENSITY_MAX_SESSIONS = 1_000;

/**
 * Load real session density via the composition root's sessions port. The port
 * paginates at 100/page and each page triggers one local scan, so we page to
 * `total` but hard-cap the loop to `DENSITY_MAX_SESSIONS` (a fresh install with
 * huge history still bounds the first paint). On any failure the page degrades
 * to empty density instead of surfacing a raw error.
 */
async function loadSessionDensity(
  sessions: SessionQueryPort,
): Promise<ReportQueryViewModel["feed"]["density"]> {
  try {
    const collected: Array<{
      startedAt: string;
      totals?: { totalTokens?: number };
      cost?: { knownUsd?: number };
    }> = [];
    // The query port reports the true total even when pages are capped, so the
    // coverage figure stays honest for histories larger than the density window.
    let realTotal = 0;
    for (let page = 1; page <= DENSITY_MAX_SESSIONS / 100; page += 1) {
      const result = await sessions.query({
        page,
        pageSize: 100,
        sort: { field: "startedAt", direction: "desc" },
      });
      if (!result.ok) break;
      realTotal = result.value.total;
      for (const session of result.value.sessions) {
        collected.push({
          startedAt: session.startedAt,
          totals: session.totals,
          cost: session.cost,
        });
      }
      if (
        collected.length >= realTotal ||
        collected.length >= DENSITY_MAX_SESSIONS
      )
        break;
    }
    const density = aggregateSessionDensity(collected);
    return {
      ...density,
      total: realTotal > density.total ? realTotal : density.total,
    };
  } catch {
    return { total: 0, days: {} };
  }
}

/** Reads persisted reports/runs/density from the composition root. */
function compositionReportsSource(
  reports: ReportsApplication,
  sessions: SessionQueryPort,
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
    sessionMetrics: () => loadSessionDensity(sessions),
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
    source: compositionReportsSource(reports, root.sessions),
    // Generation runs when an S-500 model profile is active OR the legacy
    // environment-variable LLM is configured; without either the page shows
    // the honest offline state so it disables generation instead of faking it.
    offline: !(await root.modelProfiles.getActiveView()) && !isLLMConfigured(),
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
          density: { total: 0, days: {} },
          reportCount: 0,
          runCount: 0,
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
 * Trigger a draft report generation. Honest gate: generation is available when
 * an S-500 model profile is active (real model call) or the legacy
 * TRUSTTOOLS_LLM_* environment configuration exists; with neither the
 * transport reports `{ triggered: false }` (the UI keeps the button disabled).
 * When an active profile exists its id is passed through so the profile-backed
 * provider performs the real call.
 */
export async function generateReport(definitionId: string): Promise<{
  triggered: boolean;
  errorCode?: string;
}> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const activeProfile = await root.modelProfiles.getActiveView();
  if (!activeProfile) {
    const { isLLMConfigured } = await import("../ai-orchestration/config.ts");
    if (!isLLMConfigured()) return { triggered: false };
  }
  const result = await root.reports.generate({
    definitionId,
    trigger: "manual",
    modelId: activeProfile?.id,
  });
  if (!result.ok) {
    return { triggered: false, errorCode: result.error.code };
  }
  return { triggered: true };
}

/**
 * Renderer-safe report body for inline preview/editing. The body was redacted
 * by `safeReportText` at write time (generated report content only — no paths,
 * commands, secrets or raw conversation), so it is safe to cross the boundary.
 */
export async function getReportBody(
  reportId: string,
): Promise<ReportContent | null> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.reports.readContent(reportId);
  return result.ok ? result.value : null;
}
