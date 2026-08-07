import { err, type Result } from "../../../shared/result.ts";
import type {
  KnowledgeAsset,
  KnowledgeAssetKind,
  KnowledgeRepository,
} from "../../knowledge/contracts.ts";
import type { TaskApi, TaskRunSummaryPublic } from "../../tasks/api.server.ts";
import type {
  GenerateReportInput,
  ReportDefinitionSummary,
  ReportRun,
  ReportSummary,
  ReportsApplication,
  ReportsModuleContract,
} from "../contracts.ts";

export type ReportsViewModel = ReportsModuleContract;

export type ReportUiStatus =
  "draft" | "running" | "waiting-approval" | "failed" | "published" | "stale";

/** A report row safe to serialize to the renderer. It deliberately has no body. */
export interface ReportListItem {
  readonly reportId?: string;
  readonly runId?: string;
  readonly definitionId: string;
  readonly kind: "daily" | "weekly";
  readonly title: string;
  readonly status: ReportUiStatus;
  readonly generatedAt?: string;
  readonly templateVersion?: number;
  readonly assetCount: number;
  readonly evidenceCount: number;
  readonly retryable?: boolean;
  readonly errorCode?: `errors.${string}`;
}

export interface ReportDetailSummary extends ReportListItem {
  readonly assets: readonly {
    readonly assetId: string;
    readonly kind: string;
  }[];
  readonly evidence: readonly {
    readonly module: string;
    readonly ref: string;
    readonly observedAt: string;
  }[];
}

export interface MemoryAssetSummary {
  readonly assetId: string;
  readonly kind: KnowledgeAssetKind;
  readonly title: string;
  readonly version: number;
  readonly status: KnowledgeAsset["status"];
  readonly updatedAt: string;
}

export interface ReportsFeed {
  readonly reports: readonly ReportListItem[];
  readonly memories: readonly MemoryAssetSummary[];
  readonly definitions: readonly ReportDefinitionSummary[];
  readonly generatedAt: string;
  readonly offline: boolean;
  readonly disabled: boolean;
}

export interface ReportQueryViewModel {
  readonly feed: ReportsFeed;
  readonly selected?: ReportDetailSummary;
}

/** Framework-neutral read ports. Implementations may use a local JSON store. */
export interface ReportsQuerySource {
  listReports(): Promise<readonly ReportSummary[]>;
  listRuns(): Promise<readonly ReportRun[]>;
}

export interface ReportsPresentationOptions {
  readonly reports: ReportsApplication;
  readonly source: ReportsQuerySource;
  readonly knowledge?: Pick<KnowledgeRepository, "list">;
  readonly now?: () => Date;
  readonly staleAfterMs?: number;
  readonly offline?: boolean;
  readonly disabled?: boolean;
}

export interface ReportsPresentationApi {
  query(input?: {
    readonly reportId?: string;
  }): Promise<Result<ReportQueryViewModel>>;
  generateNow(
    input: Omit<GenerateReportInput, "trigger"> & {
      readonly trigger?: "manual";
    },
  ): ReturnType<ReportsApplication["generate"]>;
}

const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

function taskRunToRun(value: TaskRunSummaryPublic): ReportRun | undefined {
  if (value.taskId !== "reports.generate") return undefined;
  return {
    runId: value.runId,
    definitionId: "reports.daily",
    trigger: value.trigger === "schedule" ? "schedule" : "manual",
    status:
      value.status === "succeeded"
        ? "succeeded"
        : value.status === "failed"
          ? "failed"
          : value.status === "running"
            ? "running"
            : "queued",
    ...(value.startedAt
      ? { startedAt: value.startedAt }
      : { startedAt: value.queuedAt ?? new Date(0).toISOString() }),
    ...(value.finishedAt ? { finishedAt: value.finishedAt } : {}),
    ...(value.errorCode ? { errorCode: value.errorCode } : {}),
    ...(value.retryable === undefined ? {} : { retryable: value.retryable }),
    evidence: [],
  };
}

function statusFor(
  report: ReportSummary | undefined,
  run: ReportRun | undefined,
  now: number,
  staleAfterMs: number,
): ReportUiStatus {
  if (run?.status === "queued" || run?.status === "running") return "running";
  if (run?.status === "failed" || run?.status === "budget-exceeded")
    return "failed";
  if (report?.status === "archived") return "stale";
  if (
    report?.generatedAt &&
    now - Date.parse(report.generatedAt) > staleAfterMs
  )
    return "stale";
  if (report?.status === "approved") return "published";
  if (report?.status === "draft") {
    return "waiting-approval";
  }
  return "stale";
}

function itemFor(
  report: ReportSummary | undefined,
  run: ReportRun | undefined,
  definition: ReportDefinitionSummary | undefined,
  now: number,
  staleAfterMs: number,
): ReportListItem {
  const status = statusFor(report, run, now, staleAfterMs);
  return {
    ...(report?.reportId ? { reportId: report.reportId } : {}),
    ...(run?.runId || report?.runId
      ? { runId: run?.runId ?? report?.runId }
      : {}),
    definitionId:
      report?.definitionId ??
      run?.definitionId ??
      definition?.definitionId ??
      "unknown",
    kind: report?.kind ?? definition?.kind ?? "daily",
    title: report?.title ?? definition?.title ?? "Report",
    status,
    ...(report?.generatedAt ? { generatedAt: report.generatedAt } : {}),
    ...(report?.templateVersion === undefined
      ? {}
      : { templateVersion: report.templateVersion }),
    assetCount: report?.assets.length ?? 0,
    evidenceCount: report?.evidence.length ?? 0,
    ...(run?.retryable === undefined ? {} : { retryable: run.retryable }),
    ...(run?.errorCode ? { errorCode: run.errorCode } : {}),
  };
}

export function createReportsPresentation(
  options: ReportsPresentationOptions,
): ReportsPresentationApi {
  const now = options.now ?? (() => new Date());
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  return {
    async query(input = {}) {
      try {
        const [reports, runs, memories] = await Promise.all([
          options.source.listReports(),
          options.source.listRuns(),
          options.knowledge?.list(),
        ]);
        const definitions = options.reports.definitions;
        const byRun = new Map(runs.map((run) => [run.runId, run]));
        const items: ReportListItem[] = [];
        for (const report of reports) {
          items.push(
            itemFor(
              report,
              byRun.get(report.runId),
              definitions.find(
                (item) => item.definitionId === report.definitionId,
              ),
              now().getTime(),
              staleAfterMs,
            ),
          );
        }
        const reportRunIds = new Set(reports.map((report) => report.runId));
        for (const run of runs) {
          if (reportRunIds.has(run.runId)) continue;
          items.push(
            itemFor(
              undefined,
              run,
              definitions.find(
                (item) => item.definitionId === run.definitionId,
              ),
              now().getTime(),
              staleAfterMs,
            ),
          );
        }
        items.sort((a, b) =>
          (b.generatedAt ?? "").localeCompare(a.generatedAt ?? ""),
        );
        const selected = input.reportId
          ? reports.find((report) => report.reportId === input.reportId)
          : undefined;
        return {
          ok: true,
          value: {
            feed: {
              reports: items,
              memories: memories?.ok
                ? memories.value.map((asset) => ({
                    assetId: asset.assetId,
                    kind: asset.kind,
                    title: asset.title,
                    version: asset.currentVersion,
                    status: asset.status,
                    updatedAt: asset.updatedAt,
                  }))
                : [],
              definitions,
              generatedAt: now().toISOString(),
              offline: options.offline ?? false,
              disabled: options.disabled ?? false,
            },
            ...(selected
              ? {
                  selected: {
                    ...itemFor(
                      selected,
                      byRun.get(selected.runId),
                      definitions.find(
                        (item) => item.definitionId === selected.definitionId,
                      ),
                      now().getTime(),
                      staleAfterMs,
                    ),
                    assets: selected.assets.map((asset) => ({
                      assetId: asset.assetId,
                      kind: asset.kind,
                    })),
                    evidence: selected.evidence.map((evidence) => ({
                      ...evidence,
                    })),
                  },
                }
              : {}),
          },
        };
      } catch {
        return { ok: false, error: { code: "errors.reports.queryFailed" } };
      }
    },
    generateNow(input) {
      if (options.disabled)
        return Promise.resolve(err("errors.reports.disabled"));
      if (options.offline)
        return Promise.resolve(err("errors.reports.offline"));
      return options.reports.generate({ ...input, trigger: "manual" });
    },
  };
}

/** Converts a task API run list into the report query port without leaking task details. */
export function createTaskBackedReportsSource(
  reports: ReportsQuerySource,
  tasks: Pick<TaskApi, "listRuns">,
): ReportsQuerySource {
  return {
    listReports: () => reports.listReports(),
    async listRuns() {
      const result = await tasks.listRuns({ taskId: "reports.generate" });
      if (!result.ok) return [];
      return result.value
        .map(taskRunToRun)
        .filter((run): run is ReportRun => !!run);
    },
  };
}
