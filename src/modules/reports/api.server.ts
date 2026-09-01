/**
 * Reports transport adapter. Server-only: wires the composition root's
 * reports application into the presentation read model. Report bodies are only
 * returned through `getReportBody` (redacted generated content — see
 * `safeReportText`); the list view model stays body-free.
 *
 * The store exposes `listDocuments`/`listRuns` (see the ReportStore contract),
 * so the query source reads real persisted documents/runs instead of an empty
 * list. Session counts for the archive band / calendar / header stats come
 * from the SessionSnapshot, while header Tokens/cost are projected from the
 * UsageSnapshot so this read model uses event-date accounting consistently.
 *
 * Generation depends solely on the active S-500 model profile (real model
 * call). Without an active profile the transport reports `{ triggered: false }`
 * so the UI shows the honest disabled state rather than a fake success.
 */
import type { Locale } from "../../lib/i18n/locale";
import type {
  ReportQueryViewModel,
  ReportsQuerySource,
} from "./presentation/index.ts";
import type {
  ReportContent,
  ReportDefinitionSummary,
  ReportPeriod,
  ReportRun,
  ReportSummary,
  ReportsApplication,
} from "./contracts.ts";
import type { UsageSnapshotDto } from "../usage/contracts.ts";
import { estimateUsageBucketCost } from "./infrastructure/usage-cost.ts";

/**
 * T4-02: Session density now comes from the SessionSnapshot (one O(1) read),
 * not from paging `sessions.query()` (which re-scanned per page). The
 * snapshot's pre-aggregated density rows map directly to the reports
 * `SessionDensity` shape; a stale/empty snapshot degrades to empty density.
 */
async function loadSessionDensityFromSnapshot(
  getSnapshot: () => Promise<{
    readonly density?: readonly {
      readonly date: string;
      readonly count: number;
      readonly totalTokens: number;
      readonly knownUsd: number;
    }[];
    readonly total?: number;
  } | null>,
): Promise<ReportQueryViewModel["feed"]["density"]> {
  try {
    const snapshot = await getSnapshot();
    if (!snapshot) return { total: 0, days: {} };
    const days: Record<
      string,
      { count: number; tokens: number; knownUsd: number }
    > = {};
    let total = 0;
    for (const row of snapshot.density ?? []) {
      total += row.count;
      const existing = days[row.date] ?? { count: 0, tokens: 0, knownUsd: 0 };
      existing.count += row.count;
      existing.tokens += row.totalTokens;
      existing.knownUsd += row.knownUsd;
      days[row.date] = existing;
    }
    return { total, days };
  } catch {
    return { total: 0, days: {} };
  }
}

async function loadUnifiedDensityFromSnapshots(
  getSessionSnapshot: Parameters<typeof loadSessionDensityFromSnapshot>[0],
  getUsageSnapshot: () => Promise<UsageSnapshotDto | null>,
): Promise<ReportQueryViewModel["feed"]["density"]> {
  const [sessionDensity, usageSnapshot] = await Promise.all([
    loadSessionDensityFromSnapshot(getSessionSnapshot),
    getUsageSnapshot().catch(() => null),
  ]);
  if (!usageSnapshot) return sessionDensity;

  const days: Record<
    string,
    { count: number; tokens: number; knownUsd: number }
  > = {};
  for (const [date, row] of Object.entries(sessionDensity.days)) {
    days[date] = { count: row.count, tokens: 0, knownUsd: 0 };
  }
  for (const bucket of usageSnapshot.aggregateBuckets ?? []) {
    const existing = days[bucket.date] ?? {
      count: 0,
      tokens: 0,
      knownUsd: 0,
    };
    existing.tokens += bucket.totalTokens;
    existing.knownUsd += estimateUsageBucketCost(bucket);
    days[bucket.date] = existing;
  }
  return { total: sessionDensity.total, days };
}

/** Reads persisted reports/runs/density from the composition root. */
function compositionReportsSource(
  reports: ReportsApplication,
  getSessionSnapshot: Parameters<typeof loadSessionDensityFromSnapshot>[0],
  getUsageSnapshot: () => Promise<UsageSnapshotDto | null>,
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
    sessionMetrics: () =>
      loadUnifiedDensityFromSnapshots(getSessionSnapshot, getUsageSnapshot),
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
  // T4-02: session density is projected from the SessionSnapshot (O(1)); the
  // snapshot's own density rows already aggregate count/tokens/cost per day.
  const getSessionSnapshot = async () => {
    const { sessionSnapshot } = root as {
      sessionSnapshot: {
        ensureHydrated(): Promise<void>;
        readLatest(): {
          data: {
            density?: readonly {
              date: string;
              count: number;
              totalTokens: number;
              knownUsd: number;
            }[];
            sessions?: readonly unknown[];
          } | null;
        };
      };
    };
    await sessionSnapshot.ensureHydrated();
    const latest = sessionSnapshot.readLatest();
    if (!latest.data) return null;
    return {
      density: latest.data.density,
      total: latest.data.sessions?.length ?? 0,
    };
  };
  const getUsageSnapshot = async (): Promise<UsageSnapshotDto | null> => {
    await root.usageSnapshot.ensureHydrated();
    return root.usageSnapshot.readLatest().data;
  };
  const activeView = await root.modelProfiles.getActiveView();
  const activeProfile = activeView
    ? await root.modelProfiles.getProfileForExecution(activeView.id)
    : null;
  const hasExecutableModel = Boolean(
    activeProfile?.apiKey?.trim() && activeProfile.model?.trim(),
  );
  const presentation = createReportsPresentation({
    reports,
    source: compositionReportsSource(
      reports,
      getSessionSnapshot,
      getUsageSnapshot,
    ),
    // The fixed report works offline. This flag only controls the compact
    // optional-AI-summary hint shown outside the report body.
    offline: !hasExecutableModel,
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
 * Trigger a draft report generation. All cadences use fixed data templates;
 * an executable model profile optionally adds a bounded summary section.
 */
export async function generateReport(
  definitionId: string,
  period?: ReportPeriod,
  locale: Locale = "zh-CN",
): Promise<{
  triggered: boolean;
  reportId?: string;
  errorCode?: string;
}> {
  try {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();
    const activeView = await root.modelProfiles.getActiveView();
    const activeProfile = activeView
      ? await root.modelProfiles.getProfileForExecution(activeView.id)
      : null;
    const modelId =
      activeProfile?.apiKey?.trim() && activeProfile.model?.trim()
        ? activeProfile.id
        : undefined;
    const result = await root.reports.generate({
      definitionId,
      trigger: "manual",
      modelId,
      period,
      locale,
    });
    if (!result.ok) {
      return { triggered: false, errorCode: result.error.code };
    }
    return { triggered: true, reportId: result.value.reportId };
  } catch {
    // Bootstrap/database failures are reported to the UI as a normal
    // generation failure instead of escaping the server function and
    // unmounting the reports page.
    return {
      triggered: false,
      errorCode: "errors.reports.generationFailed",
    };
  }
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

export async function saveReportBody(
  reportId: string,
  body: string,
): Promise<{ saved: boolean; content?: ReportContent; errorCode?: string }> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const result = await root.reports.saveContent(reportId, body);
  return result.ok
    ? { saved: true, content: result.value }
    : { saved: false, errorCode: result.error.code };
}
