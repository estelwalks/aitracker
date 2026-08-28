import { z } from "zod";

export const LOCALES = ["zh-CN", "en-US", "ja-JP", "ko-KR"] as const;
export const LocaleSchema = z.enum(LOCALES);
export type LocaleKey = (typeof LOCALES)[number];

/** Language-independent canonical risk-kind slugs (display names come from i18n by request locale). */
export const RISK_KINDS = ["remote_execution", "command_injection", "data_exfiltration", "secret_access", "persistence", "destructive", "obfuscation", "privilege_escalation", "sensitive_file_access", "network_abuse", "prompt_injection"] as const;
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const SCAN_MODES = ["quick", "full"] as const;
export const SCAN_STATUSES = ["complete", "partial"] as const;
export const BRANCH_STATUSES = ["complete", "skipped", "failed"] as const;
/** Supported model protocols. `openai` is retained as a legacy alias for `openai-completions`. */
export const PROVIDERS = ["openai-responses", "openai-completions", "anthropic", "openai"] as const;
export const THREAT_LEVELS = ["critical", "high", "medium", "low", "none"] as const;
/** Deduction-based scoring: severity weights applied to model findings (static rules use their own weight). */
export const LLM_SEVERITY_WEIGHTS = { critical: 45, high: 35, medium: 25, low: 10 } as const;
export const RiskKindSchema = z.enum(RISK_KINDS);
export const SeveritySchema = z.enum(SEVERITIES);
export const ThreatLevelSchema = z.enum(THREAT_LEVELS);
export const ProviderSchema = z.enum(PROVIDERS);

export const SkillFileSchema = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().max(2_000_000),
  /** The host may identify a non-text file while preserving the no-path-I/O boundary. */
  isBinary: z.boolean().optional().default(false),
  /** Original byte size when the file was collected from disk (used by the directory-size check). */
  byteSize: z.number().int().nonnegative().optional(),
}).strict();
export type SkillFile = z.infer<typeof SkillFileSchema>;
export const ModelConfigSchema = z.object({
  /** API protocol; `openai` is the legacy alias for `openai-completions`. When omitted, the endpoint is inspected. */
  provider: ProviderSchema.optional(),
  /** API base URL: protocol-specific paths are appended when the endpoint is not already a complete API path. */
  endpoint: z.string().url().max(2048),
  apiKey: z.string().min(1).max(8192),
  liteModel: z.string().min(1).max(256),
  proModel: z.string().min(1).max(256),
  timeoutMs: z.number().int().min(100).max(120_000).optional().default(120_000),
  /** Model context window (tokens). When omitted, per-file content sent to the model is capped at head + tail of 30K chars each;
   *  when declared, the budget is relaxed by the window (conservatively allocating 1 char/token to avoid exceeding context) for large-context models such as 1M. */
  contextWindowTokens: z.number().int().positive().max(10_000_000).optional(),
  /** Maximum tool-call turns for multiFileAnalysis (pro-model ReAct loop); defaults to 12. */
  maxAgentTurns: z.number().int().min(1).max(100).optional().default(12),
}).strict();
export const ScanSkillRequestSchema = z.object({
  mode: z.enum(SCAN_MODES).default("quick"),
  /** The application language; scan results (titles/descriptions/remediation/summary) are generated in this locale. */
  locale: LocaleSchema.default("zh-CN"),
  /** In-memory content to scan (no disk I/O). Mutually exclusive with `paths`. */
  files: z.array(SkillFileSchema).min(1).max(500).optional(),
  /** File or directory paths to read from disk. Mutually exclusive with `files`. */
  paths: z.array(z.string().min(1).max(1024)).min(1).max(100).optional(),
  model: ModelConfigSchema.optional(),
}).strict().superRefine((req, ctx) => {
  if (req.files?.length && req.paths?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "files and paths are mutually exclusive" });
  if (!req.files?.length && !req.paths?.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "files or paths is required" });
});

export const FindingSchema = z.object({
  id: z.string(), kind: RiskKindSchema, severity: SeveritySchema, source: z.enum(["static", "model"]),
  kindDisplay: z.string(), severityDisplay: z.string(),
  ruleId: z.string().optional(), ruleName: z.string(), message: z.string(), remediation: z.string(),
  weight: z.number().int().nonnegative(), cweId: z.string().optional(), bypassVerification: z.boolean().optional(),
  path: z.string(), line: z.number().int().positive().optional(), excerpt: z.string().max(240).optional(),
  /** SHA-256 of the file's (path + "\0" + content); absent for directory-level checks (e.g. file-04). */
  fileHash: z.string().optional(),
  /** Model-provided rationale for the finding (present on model findings). */
  reasoning: z.string().max(500).optional(),
}).strict();
export const BranchSchema = z.object({ name: z.enum(["static", "ruleReview", "singleFileAnalysis", "multiFileAnalysis"]), status: z.enum(BRANCH_STATUSES), detail: z.string().max(240).optional() }).strict();
export const TOKEN_USAGE_STATUSES = ["not_applicable", "complete", "partial", "unavailable"] as const;
export const MODEL_BRANCHES = ["ruleReview", "singleFileAnalysis", "multiFileAnalysis", "semanticDedup"] as const;
const TokenUsageCountersSchema = z.object({
  requestCount: z.number().int().nonnegative(),
  reportedRequestCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
}).strict();
export const TokenUsageBreakdownSchema = TokenUsageCountersSchema.extend({
  status: z.enum(TOKEN_USAGE_STATUSES),
}).strict();
export const TokenUsageSchema = TokenUsageBreakdownSchema.extend({
  byModel: z.record(TokenUsageBreakdownSchema),
  byBranch: z.record(z.enum(MODEL_BRANCHES), TokenUsageBreakdownSchema),
}).strict();
export const CategoryBucketSchema = z.object({ count: z.number().int().nonnegative(), highestSeverity: SeveritySchema, totalWeight: z.number().int().nonnegative(), display: z.string() }).strict();
export const RuleMatchSchema = z.object({ path: z.string(), line: z.number().int().positive().optional(), excerpt: z.string().max(240).optional(), fileHash: z.string().optional() }).strict();
export const RuleAggregationSchema = z.object({
  ruleId: z.string(), ruleName: z.string(), kind: RiskKindSchema, severity: SeveritySchema,
  weight: z.number().int().nonnegative(), cweId: z.string().optional(), count: z.number().int().nonnegative(),
  matches: z.array(RuleMatchSchema),
}).strict();
export const ScanSkillReportSchema = z.object({
  status: z.enum(SCAN_STATUSES), mode: z.enum(SCAN_MODES), verdict: z.enum(["allow", "warn", "block", "unknown"]),
  riskScore: z.number().int().min(0).max(100), rulesVersion: z.string(), engineVersion: z.string(),
  locale: LocaleSchema, contentHash: z.string(), scannedFiles: z.number().int().nonnegative(),
  threatLevel: ThreatLevelSchema, threatLevelDisplay: z.string(),
  categories: z.record(CategoryBucketSchema), summary: z.string(),
  findings: z.array(FindingSchema), rules: z.array(RuleAggregationSchema),
  branches: z.array(BranchSchema), skippedFiles: z.array(z.object({ path: z.string(), reason: z.string() }).strict()),
  tokenUsage: TokenUsageSchema,
}).strict();

export type RiskKind = (typeof RISK_KINDS)[number];
export type Severity = (typeof SEVERITIES)[number];
export type ThreatLevel = (typeof THREAT_LEVELS)[number];
export type ScanSkillRequest = z.infer<typeof ScanSkillRequestSchema>;
export type ScanSkillReport = z.infer<typeof ScanSkillReportSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type CategoryBucket = z.infer<typeof CategoryBucketSchema>;
export type RuleAggregation = z.infer<typeof RuleAggregationSchema>;
export type TokenUsage = z.infer<typeof TokenUsageSchema>;
export type TokenUsageBreakdown = z.infer<typeof TokenUsageBreakdownSchema>;
export type ModelBranch = (typeof MODEL_BRANCHES)[number];
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface ScanDependencies { fetch?: FetchLike; log?: (message: string) => void }
