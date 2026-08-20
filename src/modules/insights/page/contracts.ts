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
}

export interface PageInsightAdapter {
  readonly surfaceId: InsightSurfaceId;
  readonly adapterVersion: number;
  loadEvidence(scope: InsightScope): Promise<InsightEvidenceBundle>;
  composeCandidates(bundle: InsightEvidenceBundle): readonly InsightCandidate[];
}

export interface InsightEnhancementInput {
  readonly surface: InsightSurfaceId;
  /** Actual evidence adapter version; participates in cache identity only. */
  readonly adapterVersion: number;
  readonly locale: string;
  /** Effective preference projection. The server, never the renderer, sets it. */
  readonly profileId?: string | null;
  readonly dailyCallLimit?: number | null;
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
  | "invalid-output";

export interface InsightEnhancementResult {
  readonly status: InsightEnhancementStatus;
  readonly lines: readonly {
    readonly candidateId: string;
    readonly analysis?: string;
    readonly actionId?: InsightActionId;
  }[];
  readonly modelLabel?: string;
}

export interface InsightEnhancerPort {
  readonly id: string;
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
}
