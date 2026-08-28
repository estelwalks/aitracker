import type { MessageKey } from "../../../lib/i18n/schema.ts";

export const INSIGHT_SURFACE_IDS = [
  "dashboard",
  "agents",
  "distill",
  "reports",
  "memory",
  "security",
  "tracker",
  "skills",
  "market",
  "chats",
  "chat-detail",
  "widget",
  "settings",
  "sources",
] as const;
export type InsightSurfaceId = (typeof INSIGHT_SURFACE_IDS)[number];

/** User-configurable AI insight refresh period bounds. */
export const DEFAULT_INSIGHT_REFRESH_INTERVAL_MS = 5 * 60 * 60 * 1000;
export const MIN_INSIGHT_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const MAX_INSIGHT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface InsightScope {
  readonly range?: "today" | "7d" | "30d" | "all";
  readonly entityId?: string;
}

export interface InsightEvidence {
  readonly id: string;
  readonly kind: "metric" | "status" | "trend" | "availability";
  readonly value: string | number | boolean | null;
  readonly unit?: "count" | "tokens" | "percent" | "usd" | "status";
  readonly observedAt: string;
  readonly freshness: "fresh" | "stale" | "unknown";
  readonly sensitivity: "public" | "aggregate";
}

export interface InsightEvidenceBundle {
  readonly surfaceId: InsightSurfaceId;
  readonly scope: InsightScope;
  readonly observedAt: string;
  readonly evidence: readonly InsightEvidence[];
  readonly partial?: boolean;
}

export type InsightSeverity = "info" | "attention" | "risk";

export type InsightActionId =
  | "open_security"
  | "open_distill"
  | "open_reports"
  | "open_sessions"
  | "open_sources"
  | "open_settings"
  | "open_tracker"
  | "open_market"
  | "open_skills"
  | "open_memory";

export interface InsightCandidate {
  readonly id: string;
  readonly severity: InsightSeverity;
  readonly factKey: MessageKey;
  readonly factParams: Readonly<Record<string, string | number>>;
  readonly ruleKey?: MessageKey;
  readonly ruleParams?: Readonly<Record<string, string | number>>;
  readonly evidenceRefs: readonly string[];
  readonly allowedActionIds: readonly InsightActionId[];
  readonly actionId?: InsightActionId;
  readonly mandatory?: boolean;
  /**
   * Set to false when the rendered fact contains a local entity name (for
   * example a project, session, or custom Skill). The candidate still
   * participates in local rule ranking/fallback, but is never serialized into
   * the remote enhancement payload.
   */
  readonly remoteEligible?: boolean;
}

export interface InsightEnvelopeLine {
  readonly id: string;
  readonly severity: InsightSeverity;
  readonly key: MessageKey;
  readonly params: Readonly<Record<string, string | number>>;
  readonly analysis?: string;
  readonly action?: {
    readonly id: InsightActionId;
    readonly labelKey: MessageKey;
  };
  readonly source: "rules" | "enhanced";
}

export type InsightEnvelopeStatus =
  | "rules"
  | "enhanced-cached"
  | "enhanced-ready"
  | "enhancer-unavailable"
  | "budget-exceeded"
  | "timeout"
  | "enhancer-failed"
  | "invalid-output"
  | "no-eligible-candidates"
  | "pending"
  | "stale";

export interface InsightEnvelope {
  readonly surfaceId: InsightSurfaceId;
  readonly status: InsightEnvelopeStatus;
  readonly lines: readonly InsightEnvelopeLine[];
  readonly generatedAt: string;
  readonly source: "rules" | "enhanced";
  readonly canEnhance: boolean;
  /** Renderer hint only. True after the server validated auto mode + consent. */
  readonly autoEnhance: boolean;
  readonly modelLabel?: string;
  /** Effective settings value used for this page's refresh and AI cache. */
  readonly refreshIntervalMs?: number;
  /** Actual persisted AI generation time, when this envelope contains AI text. */
  readonly enhancementGeneratedAtMs?: number;
  /** Exact expiry time derived from the configured refresh interval. */
  readonly enhancementExpiresAtMs?: number;
  /**
   * Renderer-safe failure attribution of the final failed attempt (e.g.
   * "reasoning-only", "empty-content", "timeout"). Never raw provider output.
   */
  readonly failureDetail?: string;
  /** False when valid AI text was produced but could not be persisted. */
  readonly persisted?: boolean;
}

export interface PageInsightAdapter {
  readonly surfaceId: InsightSurfaceId;
  readonly adapterVersion: number;
  loadEvidence(scope: InsightScope): Promise<InsightEvidenceBundle>;
  composeCandidates(bundle: InsightEvidenceBundle): readonly InsightCandidate[];
}

export interface InsightEnhancementInput {
  readonly surface: InsightSurfaceId;
  /** Scope participates in cache identity; chat detail must not share AI text. */
  readonly scope?: InsightScope;
  /** Actual evidence adapter version; participates in cache identity only. */
  readonly adapterVersion: number;
  readonly locale: string;
  /** Effective preference projection. The server, never the renderer, sets it. */
  readonly profileId?: string | null;
  readonly dailyCallLimit?: number | null;
  /** Effective cache refresh period from the user's local settings. */
  readonly cacheTtlMs?: number;
  /** Server-only ownership marker; never serialized into the provider payload. */
  readonly batchOwned?: boolean;
  readonly candidates: readonly {
    readonly id: string;
    readonly severity: InsightSeverity;
    readonly fact: string;
    readonly actionIds: readonly InsightActionId[];
    readonly mandatory: boolean;
  }[];
}

export type InsightEnhancementStatus =
  | "enhanced-ready"
  | "enhanced-cached"
  | "enhancer-unavailable"
  | "budget-exceeded"
  | "timeout"
  | "enhancer-failed"
  | "invalid-output"
  | "pending";

export interface InsightEnhancementResult {
  readonly status: InsightEnhancementStatus;
  readonly lines: readonly {
    readonly candidateId: string;
    readonly analysis?: string;
    readonly actionId?: InsightActionId;
  }[];
  readonly modelLabel?: string;
  readonly generatedAtMs?: number;
  readonly expiresAtMs?: number;
  /**
   * Renderer-safe, bounded failure attribution for the final failed attempt
   * (e.g. "timeout", "empty-content", "reasoning-only"). Never raw provider
   * output; populated only when the result status is a failure.
   */
  readonly failureDetail?: string;
  /**
   * False when valid AI text was produced but the SQLite enhancement cache
   * write failed (privacy guard or storage error). Renderer shows a hint;
   * batch items are recorded as failed instead of completed.
   */
  readonly persisted?: boolean;
}

export interface InsightEnhancerPort {
  readonly id: string;
  /** Whether the effective preference resolves to a configured model. */
  readonly isAvailable?: (profileId?: string | null) => Promise<boolean>;
  /** Read a valid persisted result without starting a model request. */
  readonly readCached?: (
    input: InsightEnhancementInput,
  ) => Promise<InsightEnhancementResult | null>;
  enhance(input: InsightEnhancementInput): Promise<InsightEnhancementResult>;
}

/** Current wording/version required before aggregate facts may be sent automatically. */
export const INSIGHT_AUTO_CONSENT_VERSION = "1";

export type InsightMode = "rules" | "enhanced-manual" | "enhanced-auto";

export interface InsightPreference {
  readonly scopeKey: string;
  readonly mode: InsightMode;
  readonly profileId: string | null;
  readonly consentVersion: string | null;
  readonly consentedAtMs: number | null;
  readonly dailyCallLimit: number | null;
  readonly updatedAtMs: number;
}

export interface InsightStorePort {
  getEffectivePreference(surfaceId: string): InsightPreference;
  setPreference(value: InsightPreference): void;
  getRefreshIntervalMs(): number;
  setRefreshIntervalMs(value: number, updatedAtMs: number): void;
  /** Prevent renderer auto-enhancement while a persistent batch owns calls. */
  hasActiveRefreshRun?(): boolean;
  invalidateAll?(): number;
}
