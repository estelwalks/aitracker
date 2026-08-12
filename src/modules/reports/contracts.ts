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

/** Private persisted report body. Keep this type in server/application code. */
export interface ReportDocument {
  readonly reportId: string;
  readonly runId: string;
  readonly definitionId: string;
  readonly status: ReportStatus;
  readonly title: string;
  readonly body: string;
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

export interface ReportContext {
  readonly evidence: readonly EvidenceRef[];
  /** Controlled, already-redacted context; never raw sessions or paths. */
  readonly summary: string;
  readonly assets?: readonly AssetRef[];
}

export interface ReportContextPort {
  collect(input: {
    readonly definition: ReportDefinition;
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
  approve(reportId: string, actor: string): Promise<Result<ReportSummary>>;
  archive(reportId: string, actor: string): Promise<Result<ReportSummary>>;
  /** Enumerate persisted reports (newest first). */
  list(): Promise<Result<readonly ReportSummary[]>>;
  /** Enumerate persisted runs (newest first). */
  listRuns(): Promise<Result<readonly ReportRun[]>>;
  /** Number of persisted reports, or null when the store is unavailable. */
  count(): Promise<number | null>;
}

export interface GenerateReportInput {
  readonly definitionId: string;
  readonly trigger: ReportTrigger;
  readonly budgetUsd?: number;
}

export interface ReportsModuleContract {
  readonly module: ReportsModuleId;
  readonly schemaVersion: 1;
}
