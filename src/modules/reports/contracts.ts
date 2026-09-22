import type { Result } from "../../shared/result.ts";
import type { Locale } from "../../lib/i18n/locale";

export const reportsModuleId = "reports" as const;
export type ReportsModuleId = typeof reportsModuleId;
export type ReportKind = "daily" | "weekly";
export type ReportTemplateKind = ReportKind | "monthly";
export type ReportStatus = "draft" | "approved" | "archived";
export type ReportRunStatus =
  "queued" | "running" | "succeeded" | "failed" | "offline" | "budget-exceeded";
export type ReportTrigger = "manual" | "schedule";

/** Opaque link to the task scheduler. It is not a cron expression or command. */
export interface ScheduleRef {
  readonly taskId: "reports.generate.daily" | "reports.generate.weekly";
  readonly scheduleId: "reports.daily" | "reports.weekly";
}

export interface TemplateVersion {
  readonly templateId: string;
  readonly version: number;
  readonly label: string;
  /** Private server-side template content. Never returned in a public DTO. */
  readonly template: string;
}

export type ReportTemplateCatalog = Readonly<
  Record<ReportTemplateKind, TemplateVersion>
>;
export type ReportTemplateSet = Readonly<Record<Locale, ReportTemplateCatalog>>;

export interface ReportDefinition {
  readonly definitionId: string;
  readonly kind: ReportKind;
  readonly title: string;
  readonly template: TemplateVersion;
  /** Versioned prompts keyed by report cadence and supported locale. */
  readonly templates?: ReportTemplateSet;
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
  /**
   * Set by the save path when the submitted body exceeded the durable
   * storage boundary (60,000 chars, see `domain.REPORT_BODY_MAX`) and was
   * therefore truncated. The renderer must surface this to the user (P1-10).
   */
  readonly truncated?: boolean;
}

export interface ReportStore {
  createRun(run: ReportRun): Promise<void>;
  updateRun(run: ReportRun): Promise<void>;
  saveDocument(document: ReportDocument): Promise<void>;
  /** Replace an existing document for the same definition and period anchor. */
  replaceForPeriod(document: ReportDocument): Promise<void>;
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
 * Structured, display-safe report figures aggregated from real usage/session
 * projections (event tokens/source/projects plus session counts/turns/cost/
 * edits/duration). Never raw sessions, absolute paths or conversation content
 * — every field here is an aggregate safe to persist and to render.
 */
export interface ReportStats {
  /** Display label for the covered period, e.g. "Today 2026-08-19". */
  readonly periodLabel: string;
  readonly sessions: number;
  readonly turns: number;
  readonly tokens: number;
  /** USD source-of-truth used for accounting and reconciliation. */
  readonly costUsd: number;
  /** Optional CNY display projection captured from the shared rate snapshot. */
  readonly costCny?: number;
  readonly edits: number;
  /** False when generic execution wrappers hide whether a turn edited code. */
  readonly editsComplete?: boolean;
  readonly durationMin: number;
  readonly bySource: readonly {
    readonly source: string;
    readonly sessions: number;
    readonly tokens: number;
    readonly costUsd: number;
    readonly costCny?: number;
    readonly edits: number;
    readonly editsComplete?: boolean;
    readonly durationMin: number;
  }[];
  /** Display-safe project keys present in the period (no paths). */
  readonly projects: readonly string[];
  readonly activeAgentCount?: number;
  readonly activeProjectCount?: number;
  readonly activeModelCount?: number;
  /** Deterministic daily-report breakdowns. All labels are display-safe. */
  readonly byModel?: readonly ReportModelStats[];
  readonly byProject?: readonly ReportProjectStats[];
  readonly sessionsDetail?: readonly ReportSessionStats[];
  /**
   * Approximate behavior distribution (clean-room). Absent when the period has
   * no tool signal at all, so "zero usage" stays distinguishable from "no data".
   */
  readonly behaviors?: readonly ReportBehaviorStats[];
  /**
   * Desensitized tool-behavior detail aggregated per source for the period
   * (tool name + call count only; never parameters, commands or content).
   * Present when the usage snapshot carries tool signals.
   */
  readonly toolUsageBySource?: readonly {
    readonly source: string;
    readonly tools: readonly {
      readonly name: string;
      readonly calls: number;
    }[];
  }[];
  /** Present only when at least one durable output was created in the period. */
  readonly outputs?: ReportOutputCounts;
  readonly cache?: ReportCacheStats;
  readonly yesterday?: ReportPeriodComparison;
  readonly trend?: readonly ReportTrendPoint[];
}

export interface ReportTrendPoint {
  readonly date: string;
  readonly tokens: number;
  readonly costCny?: number;
  readonly sessions: number;
  readonly durationMin: number;
}

export interface ReportModelStats {
  readonly model: string;
  readonly calls: number;
  readonly tokens: number;
  readonly costCny?: number;
}

export interface ReportProjectStats {
  readonly label: string;
  readonly kind?: "project" | "conversation";
  readonly sessions: number;
  readonly tokens: number;
  readonly costCny?: number;
  readonly source?: string;
}

export interface ReportSessionStats {
  readonly title: string;
  /**
   * True when the session started inside the covered period but kept running
   * beyond it. Its `tokens` are then the whole-session cumulative total rather
   * than a period figure, so renderers must label it instead of implying the
   * number belongs to this period.
   */
  readonly crossPeriod?: boolean;
  readonly project?: string;
  readonly source: string;
  readonly turns: number;
  readonly tokens: number;
  readonly durationMin: number;
  readonly repeated?: boolean;
}

/**
 * Approximate behavior distribution for a report period, derived from
 * aggregate (already-desensitized) tool categories — never from raw session
 * or conversation content. Labels stay consistent with the Model Details
 * drawer (`behavior-classify.ts`).
 */
/** Stable, locale-neutral behavior identifiers so every locale can label them. */
export type ReportBehaviorKey =
  | "debug"
  | "execution"
  | "research"
  | "planning"
  | "subagent"
  | "skills"
  | "qa";

export interface ReportBehaviorStats {
  /** Stable behavior key; renderers localize it. */
  readonly key: ReportBehaviorKey;
  /** Behavior label (Chinese). */
  readonly label: string;
  /** Share of tokens attributed to this behavior (0–1). */
  readonly tokenShare: number;
  /** Share of buckets/events attributed to this behavior (0–1). */
  readonly eventShare: number;
}

/**
 * Durable outputs created during a report period (clean-room: counts only,
 * never titles or content). Weekly/monthly reports use these to ground the
 * "沉淀与产出" section in real data instead of generic claims.
 */
export interface ReportOutputCounts {
  /** Distinct skills installed in the period. */
  readonly skills: number;
  /** Memory/knowledge assets created in the period. */
  readonly knowledge: number;
  /** Distillation-approved knowledge assets created in the period. */
  readonly distillations: number;
}

/**
 * Counts durable outputs created inside a report period. Implemented by the
 * composition root (backed by the skill snapshot and knowledge repository);
 * the reports module only sees this port, never those implementations.
 */
export interface ReportOutputPort {
  collect(input: {
    /** Local `YYYY-MM-DD` inclusive period start. */
    readonly from: string;
    /** Local `YYYY-MM-DD` inclusive period end. */
    readonly to: string;
  }): Promise<ReportOutputCounts>;
}

export interface ReportCacheStats {
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedTokens?: number;
  readonly cacheHitRate?: number;
  readonly savingsCny?: number;
}

export interface ReportPeriodComparison {
  readonly tokens?: number;
  readonly costCny?: number;
  readonly sessions?: number;
  readonly turns?: number;
  readonly durationMin?: number;
  readonly activeAgents?: number;
  readonly activeProjects?: number;
}

/**
 * Bounded, locally redacted digest of one session's actual content. Only
 * produced when the user turns on content-based reporting; it is never
 * persisted as part of the report body.
 */
export interface ReportSessionDigest {
  readonly title: string;
  /** What the user asked for, sampled across the session. */
  readonly goals: readonly string[];
  /** What the agent reported doing, sampled across the session. */
  readonly progress: readonly string[];
  /** How the work ended. */
  readonly outcome: readonly string[];
  /** True when at least one redaction replaced sensitive material. */
  readonly redacted: boolean;
}

export interface ReportContext {
  readonly evidence: readonly EvidenceRef[];
  /** Controlled, already-redacted context; never raw sessions or paths. */
  readonly summary: string;
  /** Present only when content-based reporting is enabled and readable. */
  readonly sessionDigests?: readonly ReportSessionDigest[];
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
    /** Prompt/output language. Defaults to zh-CN for legacy callers. */
    readonly locale?: Locale;
    /** Monthly period uses the monthly prompt while retaining the weekly definition. */
    readonly templateKind?: ReportTemplateKind;
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
  /** Prompt/output language. Defaults to zh-CN for scheduled/legacy callers. */
  readonly locale?: Locale;
  /** Optional prompt cadence override (used by the existing monthly period flow). */
  readonly templateKind?: ReportTemplateKind;
  /** Target period for the report. Absent = current period (manual schedule). */
  readonly period?: ReportPeriod;
}

export interface ReportsModuleContract {
  readonly module: ReportsModuleId;
  readonly schemaVersion: 1;
}
