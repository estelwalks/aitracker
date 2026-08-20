import type { Result } from "../../shared/result.ts";

export const reportsModuleId = "reports" as const;
export type ReportsModuleId = typeof reportsModuleId;
export type ReportKind = "daily" | "weekly";
export type ReportStatus = "draft" | "approved" | "archived";
export type ReportRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "offline" | "budget-exceeded";
export type ReportTrigger = "manual" | "schedule";

/** Opaque link to the task scheduler. It is not a cron expression or command. */
export interface ScheduleRef {
  readonly taskId: "reports.generate";
  readonly scheduleId: "reports.daily" | "reports.weekly";
}

export interface TemplateVersion {
  readonly templateId: string;
  readonly version: number;
  readonly label: string;
  /** Private server-side template content. Never returned in a public DTO. */
  readonly template: string;
}

export interface ReportDefinition {
  readonly definitionId: string;
  readonly kind: ReportKind;
  readonly title: string;
  readonly template: TemplateVersion;
  readonly scheduleRef: ScheduleRef;
  readonly enabled: boolean;
}

/** Renderer-safe catalog entry; template body remains server-only. */
export interface ReportDefinitionSummary {
  readonly definitionId: string;
  readonly kind: ReportKind;
  readonly title: string;
  readonly templateVersion: number;
  readonly scheduleRef: ScheduleRef;
  readonly enabled: boolean;
}

export interface EvidenceRef {
  readonly module: "usage" | "insights" | "security" | "knowledge" | "tasks";
  readonly ref: string;
  readonly observedAt: string;
}

export interface AssetRef {
  readonly assetId: string;
  readonly kind: "knowledge" | "chart" | "attachment";
}

export interface ReportRun {
  readonly runId: string;
  readonly definitionId: string;
  readonly trigger: ReportTrigger;
  readonly status: ReportRunStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly errorCode?: `errors.${string}`;
  readonly retryable?: boolean;
  readonly evidence: readonly EvidenceRef[];
}

/** Persisted report metadata. New records reference a local Markdown file. */
export interface ReportDocument {
  readonly reportId: string;
  readonly runId: string;
  readonly definitionId: string;
  readonly status: ReportStatus;
  readonly title: string;
  /** Relative filename under the configured reports directory. */
  readonly contentFile?: string;
  /** Legacy v1 inline body. Readable and lazily migrated; never set on new records. */
  readonly body?: string;
  readonly generatedAt: string;
  readonly templateVersion: number;
  readonly evidence: readonly EvidenceRef[];
  readonly assets: readonly AssetRef[];
  readonly approvedBy?: string;
  readonly approvedAt?: string;
}

/** Browser-safe summary; body, prompts, model response and private errors are absent. */
export interface ReportSummary {
  readonly reportId: string;
  readonly runId: string;
  readonly definitionId: string;
  readonly kind: ReportKind;
  readonly status: ReportStatus;
  readonly title: string;
  readonly generatedAt: string;
  readonly templateVersion: number;
  readonly evidence: readonly EvidenceRef[];
  readonly assets: readonly AssetRef[];
}

/**
 * Renderer-facing report body. The `body` is generated report content already
 * redacted by `safeReportText` at persistence time (no paths, commands,
 * secrets or raw conversation content) — safe to cross the transport boundary
 * for inline preview/editing.
 */
export interface ReportContent {
  readonly reportId: string;
  readonly definitionId: string;
  readonly kind: ReportKind;
  readonly title: string;
  readonly body: string;
  readonly generatedAt: string;
}

export interface ReportStore {
  createRun(run: ReportRun): Promise<void>;
  updateRun(run: ReportRun): Promise<void>;
  saveDocument(document: ReportDocument): Promise<void>;
  getDocument(reportId: string): Promise<ReportDocument | undefined>;
  latest(definitionId: string): Promise<ReportDocument | undefined>;
  /** Enumerate persisted report documents (newest first). */
  listDocuments(): Promise<readonly ReportDocument[]>;
  /** Enumerate persisted runs (newest first). */
  listRuns(): Promise<readonly ReportRun[]>;
}

/** Server-only durable Markdown content storage. */
export interface ReportContentStore {
  create(document: ReportDocument, body: string): Promise<string>;
  read(contentFile: string): Promise<string>;
  /** Write a new immutable revision and return its relative filename. */
  replace(document: ReportDocument, body: string): Promise<string>;
}

/**
 * Structured, display-safe report figures aggregated from real session data
 * (counts/tokens/cost by source, plus the display-safe project keys). Never
 * raw sessions, absolute paths or conversation content — every field here is
 * an aggregate safe to persist and to render.
 */
export interface ReportStats {
  /** Display label for the covered period, e.g. "今日 2026-08-19". */
  readonly periodLabel: string;
  readonly sessions: number;
  readonly turns: number;
  readonly tokens: number;
  readonly costUsd: number;
  readonly edits: number;
  readonly durationMin: number;
  readonly bySource: readonly {
    readonly source: string;
    readonly sessions: number;
    readonly tokens: number;
    readonly costUsd: number;
    readonly edits: number;
    readonly durationMin: number;
  }[];
  /** Display-safe project keys present in the period (no paths). */
  readonly projects: readonly string[];
}

export interface ReportContext {
  readonly evidence: readonly EvidenceRef[];
  /** Controlled, already-redacted context; never raw sessions or paths. */
  readonly summary: string;
  readonly assets?: readonly AssetRef[];
  /** Optional structured figures for the deterministic offline draft. */
  readonly stats?: ReportStats;
}

/**
 * The period a report is generated for. When absent the report covers the
 * current period (today / the current week). Day and week keys are local-time
 * `YYYY-MM-DD` (a week key is its Monday); a month key is `YYYY-MM`.
 */
export interface ReportPeriod {
  readonly granularity: "day" | "week" | "month";
  readonly key: string;
}

export interface ReportContextPort {
  collect(input: {
    readonly definition: ReportDefinition;
    readonly period?: ReportPeriod;
  }): Promise<ReportContext>;
}

export interface ReportGenerationResult {
  readonly status: "succeeded" | "offline" | "budget-exceeded" | "failed";
  readonly body?: string;
  readonly errorCode?: `errors.${string}`;
  readonly retryable?: boolean;
}

export interface ReportGenerationPort {
  generate(input: {
    readonly definition: ReportDefinition;
    readonly context: ReportContext;
    readonly budgetUsd?: number;
    /**
     * Explicit model id (an S-500 profile id). When absent the adapter falls
     * back to its injected `resolveModelId` and then to the default model id.
     */
    readonly modelId?: string;
  }): Promise<ReportGenerationResult>;
}

export interface ReportsApplication {
  readonly definitions: readonly ReportDefinitionSummary[];
  createDraft(input: {
    readonly definitionId: string;
    readonly actor: string;
    readonly trigger?: ReportTrigger;
  }): Promise<Result<ReportSummary>>;
  generate(input: GenerateReportInput): Promise<Result<ReportSummary>>;
  get(reportId: string): Promise<Result<ReportSummary>>;
  /** Redacted generated body for inline preview/editing (renderer-safe). */
  readContent(reportId: string): Promise<Result<ReportContent>>;
  /** Persist an edited Markdown body to the report's local file. */
  saveContent(reportId: string, body: string): Promise<Result<ReportContent>>;
  approve(reportId: string, actor: string): Promise<Result<ReportSummary>>;
  archive(reportId: string, actor: string): Promise<Result<ReportSummary>>;
  /** Enumerate persisted reports (newest first). */
  list(): Promise<Result<readonly ReportSummary[]>>;
  /** Enumerate persisted runs (newest first). */
  listRuns(): Promise<Result<readonly ReportRun[]>>;
  /** Number of persisted reports, or null when the store is unavailable. */
  count(): Promise<number | null>;
  /** Per-cadence counts (daily/weekly/monthly); null when the store is unavailable. */
  countByKind(): Promise<ReportCountsByKind>;
}

export interface ReportCountsByKind {
  readonly daily: number | null;
  readonly weekly: number | null;
  readonly monthly: number | null;
}

export interface GenerateReportInput {
  readonly definitionId: string;
  readonly trigger: ReportTrigger;
  readonly budgetUsd?: number;
  /** Active S-500 model profile id; routes generation to the real model. */
  readonly modelId?: string;
  /** Target period for the report. Absent = current period (manual schedule). */
  readonly period?: ReportPeriod;
}

export interface ReportsModuleContract {
  readonly module: ReportsModuleId;
  readonly schemaVersion: 1;
}
