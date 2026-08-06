/**
 * Pricing rule-pack contracts (v1.5 offline pricing).
 *
 * Declarative JSON rule packs are the single source of truth for model name
 * conversion, rates, effective dates and unknown-model fallback. JSON is
 * validated by the Zod schemas below at build time (see
 * scripts/generate-pricing-imports.mjs); the runtime compiler trusts the
 * already-validated generated data and builds a read-only index.
 *
 * Design rules (docs/develop/architecture/AITracker-模型定价与转换规则-架构设计文档.md):
 * - Matchers are restricted (exact/alias/prefix/suffix/token-sequence/any);
 *   no regex, no substring-contains, no JS expressions.
 * - Amounts are decimal strings of non-negative integers compiled to bigint
 *   `nanoUsd` (1e-9 USD); the calculator never uses JS `number` for money.
 * - Every billable tool declares `billingMode` + `fallbackProfileRef`, so an
 *   unknown model is always `estimated`/`unpriced`/`not-billable` - never a
 *   silent $0.
 * - The module consumes the tool registry's stable `toolId`; it has no reverse
 *   import and no network/filesystem at runtime.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** ISO `YYYY-MM-DD`. */
export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u, "must be YYYY-MM-DD");

/** Stable lowercase-kebab tool id segment. */
export const ToolIdString = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/u, "must be kebab-case");

/**
 * A model name segment. Non-empty, ≤256 chars, no NUL/control chars. The
 * normalizer (normalize.ts) canonicalizes at runtime; the schema only enforces
 * safety, not a specific character set.
 */
export const ModelSegment = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => !/\p{Cc}/u.test(value), "must not contain control chars");

/**
 * Decimal string of a non-negative integer, ≤39 digits (well within bigint
 * range). Represents nanoUSD per million tokens (e.g. $5/MTok = "5000000000").
 */
export const NanoUsdString = z
  .string()
  .regex(/^\d{1,39}$/u, "must be a non-negative integer string");

/** Per-million-token nanoUSD rates. `cacheWrite: null` means "no known price". */
export const NanoUsdPerMillion = z.object({
  input: NanoUsdString,
  output: NanoUsdString,
  cacheRead: NanoUsdString,
  cacheWrite: NanoUsdString.nullable(),
});

export const TierNanoUsdPerMillion = z.object({
  input: NanoUsdString,
  output: NanoUsdString,
  cacheRead: NanoUsdString,
});

// ---------------------------------------------------------------------------
// Matchers (restricted, data-only)
// ---------------------------------------------------------------------------

export const ModelMatcherSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("exact"), value: ModelSegment }),
  z.object({ kind: z.literal("alias"), value: ModelSegment }),
  z.object({ kind: z.literal("prefix"), value: ModelSegment }),
  z.object({ kind: z.literal("suffix"), value: ModelSegment }),
  z.object({
    kind: z.literal("token-sequence"),
    tokens: z.array(ModelSegment).min(1).max(16),
  }),
  z.object({ kind: z.literal("any") }),
]);

export type ModelMatcher = z.infer<typeof ModelMatcherSchema>;

/**
 * Matcher precision rank used for deterministic ordering. Higher = more
 * specific. Defined here so compile/resolve share one source.
 *   exact > alias > prefix > suffix > token-sequence > any
 */
export const MATCHER_PRECISION: Record<ModelMatcher["kind"], number> = {
  exact: 60,
  alias: 50,
  prefix: 40,
  suffix: 30,
  "token-sequence": 20,
  any: 10,
};

// ---------------------------------------------------------------------------
// Source metadata (evidence for every rate)
// ---------------------------------------------------------------------------

export const SourceMetadataSchema = z.object({
  kind: z.enum(["official", "vendor", "community"]),
  label: z.string().min(1).max(128),
  url: z.string().url().optional(),
  verifiedAt: DateString,
});

export type SourceMetadata = z.infer<typeof SourceMetadataSchema>;

// ---------------------------------------------------------------------------
// Rates, tiers, conversion rules, fallback profiles
// ---------------------------------------------------------------------------

export const RateTierSchema = z.object({
  /** Inclusive upper bound on (input + cached + cacheCreation) tokens; null = open top tier. */
  maxInputTokens: z.number().int().positive().nullable(),
  rates: TierNanoUsdPerMillion,
});

export const RateRuleSchema = z.object({
  id: z.string().min(1).max(128),
  canonicalModelId: z.string().min(1).max(128),
  effective: z.object({ from: DateString, to: DateString.nullable() }),
  usdNanoPerMillion: NanoUsdPerMillion,
  source: SourceMetadataSchema,
  tiers: z.array(RateTierSchema).optional(),
});

export type RateRule = z.infer<typeof RateRuleSchema>;

export const ScopeSchema = z
  .object({
    /** Tool-scoped rule (highest precision). Absent = applies to all tools. */
    toolIds: z.array(ToolIdString).optional(),
    /** Provider-scoped rule (medium precision). */
    providers: z.array(z.string().min(1).max(64)).optional(),
  })
  .optional();

export type Scope = z.infer<typeof ScopeSchema>;

export const ConversionRuleSchema = z.object({
  id: z.string().min(1).max(128),
  scope: ScopeSchema,
  priority: z.number().int(),
  when: ModelMatcherSchema,
  /** Canonical model id this rule converts to (required except for `any`). */
  convertTo: z.string().min(1).max(128).optional(),
  /** Reference to a RateRule id in the same or referenced pack. */
  rateRef: z.string().min(1).max(128).optional(),
  /** Reference to a FallbackProfile id (for `any` rules). */
  fallbackProfileRef: z.string().min(1).max(128).optional(),
});

export type ConversionRule = z.infer<typeof ConversionRuleSchema>;

export const FallbackProfileSchema = z.object({
  id: z.string().min(1).max(128),
  appliesTo: z.enum(["api-metered", "subscription", "unknown"]),
  /** Present for `estimated` profiles; absent for `unpriced`/`not-billable`. */
  usdNanoPerMillion: NanoUsdPerMillion.optional(),
  confidence: z.enum(["estimated", "unpriced", "not-billable"]),
  label: z.string().min(1).max(256),
  reviewRequired: z.boolean().optional(),
});

export type FallbackProfile = z.infer<typeof FallbackProfileSchema>;

// ---------------------------------------------------------------------------
// Pack + manifest
// ---------------------------------------------------------------------------

export const PricingPackSchema = z.object({
  schemaVersion: z.literal(1),
  packId: z.string().min(1).max(64),
  revision: z.string().min(1).max(64),
  rules: z.array(ConversionRuleSchema).default([]),
  rates: z.array(RateRuleSchema).default([]),
  /** Only the `defaults` pack declares fallback profiles. */
  fallbackProfiles: z.array(FallbackProfileSchema).optional(),
});

export type PricingPack = z.infer<typeof PricingPackSchema>;

export const PricingManifestEntrySchema = z.object({
  packId: z.string().min(1).max(64),
  /** Repo-relative path to the `.rules.json` file. */
  path: z.string().min(1).max(256),
});

export const PricingManifestSchema = z.object({
  schemaVersion: z.literal(1),
  packs: z.array(PricingManifestEntrySchema),
});

export type PricingManifest = z.infer<typeof PricingManifestSchema>;

// ---------------------------------------------------------------------------
// Tool pricing policy (declared per tool, references packs/profiles)
// ---------------------------------------------------------------------------

export const ReasoningPolicySchema = z.enum([
  "separate",
  "include-in-output",
  "ignore",
]);

export const ToolPricingPolicySchema = z.object({
  /** `unsupported` tools are never billed (e.g. read-only / no usage). */
  billingMode: z.enum(["api-metered", "subscription", "unsupported"]),
  rulePackRefs: z.array(z.string().min(1).max(64)).default([]),
  fallbackProfileRef: z.string().min(1).max(128),
  reasoningPolicy: ReasoningPolicySchema.default("separate"),
});

export type ToolPricingPolicy = z.infer<typeof ToolPricingPolicySchema>;

// ---------------------------------------------------------------------------
// Runtime interfaces (not JSON-validated; used by compile/resolve/calculate)
// ---------------------------------------------------------------------------

export type PricingConfidence =
  "exact" | "estimated" | "unpriced" | "not-billable";

export interface PricingTokens {
  input: bigint;
  output: bigint;
  cacheRead: bigint;
  cacheWrite: bigint;
  reasoningOutput: bigint;
}

export interface PricingLookupInput {
  /** Registry stable tool id (the usage event `source`). Required. */
  toolId: string;
  /** Raw model name from the log; never mutated. */
  rawModel: string;
  /** ISO date/datetime; used to pick the effective rate. */
  occurredAt: string;
  tokens: PricingTokens;
}

export interface PricingResolution {
  rawModel: string;
  normalizedModel: string;
  canonicalModelId?: string;
  /** Always set, including `generic-normalize-v1` when only normalization ran. */
  conversionRuleId: string;
  rateRuleId?: string;
  fallbackProfileId?: string;
  confidence: PricingConfidence;
  /** Machine-readable reason enum, e.g. `exact-match`, `no-rate-match`, `unpriced`. */
  reason: PricingReason;
  packageVersion: string;
  /** Known cost in nanoUSD; absent when `confidence` is `unpriced`/`not-billable`. */
  knownUsdNano?: bigint;
  /** Per-token cost breakdown in nanoUSD (when a rate or estimate applied). */
  costBreakdown?: {
    input: bigint;
    output: bigint;
    cacheRead: bigint;
    cacheWrite: bigint;
    reasoning: bigint;
  };
  /** Source label for UI display (e.g. "OpenAI API pricing"). */
  sourceLabel?: string;
}

/** Machine-readable outcome reasons. */
export type PricingReason =
  | "exact-match"
  | "alias-match"
  | "prefix-match"
  | "suffix-match"
  | "token-sequence-match"
  | "fallback-estimated"
  | "fallback-not-billable"
  | "no-rate-match"
  | "unpriced"
  | "no-policy"
  | "unsafe-model"
  | "historical-rate-missing";

/** Parse a NanoUsdString into a bigint. Throws on malformed input (should never happen post-validation). */
export function parseNanoUsd(value: string): bigint {
  return BigInt(value);
}

/** Convert a USD-per-million decimal number to a nanoUSD bigint. */
export function usdPerMillionToNano(usdPerMillion: number): bigint {
  // $5/MTok = 5e9 nanoUSD/MTok
  return BigInt(Math.round(usdPerMillion * 1_000_000_000));
}
