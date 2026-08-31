/**
 * Pricing rule-pack contracts (v1.5 offline pricing).
 *
 * Declarative JSON rule packs are the single source of truth for model name
 * conversion, rates, effective dates and unknown-model fallback. JSON is
 * validated by the Zod schemas below at build time (see
 * scripts/generate-pricing-imports.mjs); the runtime compiler trusts the
 * already-validated generated data and builds a read-only index.
 *
 * Design rules (docs/develop/architecture/AITracker-Model Pricing and Conversion Rules-Architecture Design Document.md):
 * - Matchers are restricted (exact/alias/prefix/suffix/token-sequence/any);
 *   no regex, no substring-contains, no JS expressions.
 * - Amounts are decimal strings of non-negative integers compiled to bigint
 *   `nanoUsd` (1e-9 USD); the calculator never uses JS `number` for money.
 * - Rates are owned by billing routes (`billingRouteId + canonicalModelId +
 *   region + effective`), never by AI tools. A tool only declares how to
 *   extract model names + billing evidence from its logs (`modelObservation`).
 * - Fallback behavior comes solely from the packaged JSON (fallback-profiles /
 *   billing-routes `reference` declarations); no environment variable may
 *   rewrite it. Unknown models are always `estimated`/`unpriced`/
 *   `not-billable` - never a silent $0.
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
  /**
   * Billing-route ownership (P1-1): a rate is priced by a billing route, never
   * by an AI tool. The rate primary key is
   * `billingRouteId + canonicalModelId + region + effective`.
   */
  billingRouteId: z.string().min(1).max(128),
  /** Region key; absent means "global" (the default region resolution). */
  region: z.string().min(1).max(64).optional(),
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
    /** Billing-route-scoped rule (P1-1); matches a resolved billingRouteId. */
    billingRouteIds: z.array(z.string().min(1).max(128)).optional(),
  })
  .optional();

export type Scope = z.infer<typeof ScopeSchema>;

/**
 * Model alias rule (P1-1 evolution of the conversion rule): maps an observed
 * (raw/normalized) model name to a canonical model id. Scope now also carries a
 * `billingRouteIds` dimension so aliasing can be route-aware in phase 2.
 */
export const ModelAliasRuleSchema = z.object({
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

export type ModelAliasRule = z.infer<typeof ModelAliasRuleSchema>;

/**
 * @deprecated P1-1: renamed to `ModelAliasRuleSchema` (billing ownership moved
 * to billing routes). Retained as the compile-time rule shape (`CompiledRule`
 * extends it) while compile() still consumes the legacy packs
 * (`pricing-manifest.json` `packs`, content-identical to the new data files).
 * TODO(P1-1 phase 4): switch compile() to `modelAliasRules` + `ratePacks` and
 * delete this alias together with the legacy packs.
 */
export const ConversionRuleSchema = ModelAliasRuleSchema;
/** @deprecated P1-1: use `ModelAliasRule`. */
export type ConversionRule = ModelAliasRule;

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
// P1-1 pricing-ownership refactor: billing routes, model catalog, route
// selection, model observation, rate packs.
//
// An AI tool is NOT a price owner: the same tool can use any compatible model
// and multiple API/subscription accounts; the same model can be billed
// differently via official API, aggregators, cloud-provider proxies or
// enterprise gateways. Rates are therefore owned by *billing routes* and the
// rate primary key is `billingRouteId + canonicalModelId + region + effective`.
// Phase 2 rewrites compile/resolve to consume these contracts; phase 1 only
// declares them (the legacy pack pipeline below still drives resolve).
// ---------------------------------------------------------------------------

/** How a billing route charges usage (docs P1-1). */
export const BillingRouteKindSchema = z.enum([
  "official-api",
  "aggregator",
  "cloud-provider",
  "enterprise-gateway",
  "subscription",
]);

export type BillingRouteKind = z.infer<typeof BillingRouteKindSchema>;

/**
 * A billing route: the entity that actually bills usage (OpenAI API, DeepSeek
 * official API, OpenRouter aggregator, Azure proxy, enterprise gateway, ...).
 * Routes are discovered from log evidence via `route-selection-rules.json`.
 */
export const BillingRouteSchema = z.object({
  /** Stable route id; referenced by rates (`billingRouteId`) and rules. */
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(128).optional(),
  kind: BillingRouteKindSchema,
  /** Billing principal, e.g. "openai", "deepseek", "openrouter". */
  provider: z.string().min(1).max(64).optional(),
  /** Log field names that identify this route (e.g. "endpoint", "baseUrl"). */
  endpointEvidence: z.array(z.string().min(1).max(64)).optional(),
  /** Log field names that identify the account plan (e.g. "accountPlan"). */
  accountPlanEvidence: z.array(z.string().min(1).max(64)).optional(),
  /**
   * Region resolution. `default` applies when no region evidence was
   * extracted; `fromEvidence` lists log fields that carry the region.
   */
  region: z
    .object({
      default: z.string().min(1).max(64).optional(),
      fromEvidence: z.array(z.string().min(1).max(64)).optional(),
    })
    .optional(),
  status: z.enum(["active", "retired"]).default("active"),
  /**
   * Reference-route declaration (P1-1 phase 3): when NO billing evidence is
   * available, a route marked `reference: true` may still price usage, but the
   * resolution is always `estimated` (reason `no-route-evidence`) - never an
   * exact/official bill. Absent = this route never prices without evidence.
   */
  reference: z.boolean().optional(),
});

export type BillingRoute = z.infer<typeof BillingRouteSchema>;

/**
 * Route-selection rule: pick a billing route from log evidence (endpoint /
 * provider / account-plan fields). Only restricted matching is allowed
 * (equals/contains/present) - never regex or JS expressions.
 */
export const RouteSelectionRuleSchema = z.object({
  id: z.string().min(1).max(128),
  /** Higher wins; ties fall back to evidence specificity in phase 2. */
  priority: z.number().int(),
  when: z
    .object({
      kind: z.literal("evidence"),
      /** Evidence key from `PricingLookupInput.evidence` (e.g. "endpoint"). */
      field: z.string().min(1).max(64),
      /** Exact match on the evidence value. */
      equals: z.string().min(1).max(256).optional(),
      /** Plain substring match (no regex). */
      contains: z.string().min(1).max(256).optional(),
      /** Field is present (non-empty). */
      present: z.literal(true).optional(),
    })
    .superRefine((when, ctx) => {
      const set = [when.equals, when.contains, when.present].filter(
        (v) => v !== undefined,
      );
      if (set.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "when must set exactly one of equals/contains/present (restricted matching only)",
        });
      }
    }),
  routeId: z.string().min(1).max(128),
});

export type RouteSelectionRule = z.infer<typeof RouteSelectionRuleSchema>;

/**
 * Model catalog entry: authoritative declaration of a canonical model id
 * (the id rates and alias rules reference). `aliases.profile` names the
 * normalization profile used for alias matching.
 */
export const ModelCatalogEntrySchema = z.object({
  /** Canonical model id (the key referenced by rates/alias rules). */
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256).optional(),
  family: z.string().min(1).max(64).optional(),
  provider: z.string().min(1).max(64).optional(),
  aliases: z
    .object({
      profile: z.string().min(1).max(64),
    })
    .optional(),
});

export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;

/**
 * Per-tool model observation (the tool JSON `modelObservation` section):
 * how to extract the model name and billing evidence from that tool's logs.
 * Tools declare *evidence extraction*, never rates or billing modes (P1-1).
 */
export const ToolModelObservationSchema = z.object({
  /** Log field carrying the model name (default "model"). */
  modelField: z.string().min(1).max(64).optional(),
  /** Normalization profile id (default "generic-normalize-v1"). */
  normalizeProfile: z.string().min(1).max(64).optional(),
  /** Billing-evidence extraction: log field names per evidence kind. */
  evidence: z
    .object({
      providerField: z.string().min(1).max(64).optional(),
      endpointField: z.string().min(1).max(64).optional(),
      accountPlanField: z.string().min(1).max(64).optional(),
      regionField: z.string().min(1).max(64).optional(),
    })
    .optional(),
  /** Usage-parsing semantics (not monetary pricing). */
  tokenSemantics: z
    .object({
      reasoningIncludedInOutput: z.boolean().optional(),
      cacheWriteBillable: z.boolean().optional(),
    })
    .optional(),
});

export type ToolModelObservation = z.infer<typeof ToolModelObservationSchema>;

// ---------------------------------------------------------------------------
// P1-1 data files (model-catalog / billing-routes / model-alias-rules /
// route-selection-rules / rate-packs / fallback-profiles)
// ---------------------------------------------------------------------------

export const ModelCatalogFileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().min(1).max(64),
  models: z.array(ModelCatalogEntrySchema),
});

export type ModelCatalogFile = z.infer<typeof ModelCatalogFileSchema>;

export const BillingRoutesFileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().min(1).max(64),
  routes: z.array(BillingRouteSchema),
});

export type BillingRoutesFile = z.infer<typeof BillingRoutesFileSchema>;

export const ModelAliasRulesFileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().min(1).max(64),
  rules: z.array(ModelAliasRuleSchema),
});

export type ModelAliasRulesFile = z.infer<typeof ModelAliasRulesFileSchema>;

export const RouteSelectionRulesFileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().min(1).max(64),
  rules: z.array(RouteSelectionRuleSchema),
});

export type RouteSelectionRulesFile = z.infer<
  typeof RouteSelectionRulesFileSchema
>;

/** A rate pack: rates grouped by billing route (or region/effective era). */
export const RatePackSchema = z.object({
  schemaVersion: z.literal(1),
  packId: z.string().min(1).max(64),
  revision: z.string().min(1).max(64),
  rates: z.array(RateRuleSchema).default([]),
});

export type RatePack = z.infer<typeof RatePackSchema>;

export const FallbackProfilesFileSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.string().min(1).max(64),
  profiles: z.array(FallbackProfileSchema),
});

export type FallbackProfilesFile = z.infer<typeof FallbackProfilesFileSchema>;

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

/** Manifest entry for a P1-1 data file (no packId; it is not a rule pack). */
export const PricingDataFileEntrySchema = z.object({
  /** Repo-relative path to the JSON file. */
  path: z.string().min(1).max(256),
});

export const PricingManifestSchema = z.object({
  schemaVersion: z.literal(1),
  /** Legacy rule packs (phase-1 pipeline; phase 2 switches to the files below). */
  packs: z.array(PricingManifestEntrySchema),
  /** P1-1 data files consumed by the phase-2 compile/resolve rewrite. */
  modelCatalog: PricingDataFileEntrySchema.optional(),
  billingRoutes: PricingDataFileEntrySchema.optional(),
  modelAliasRules: PricingDataFileEntrySchema.optional(),
  routeSelectionRules: PricingDataFileEntrySchema.optional(),
  ratePacks: z.array(PricingManifestEntrySchema).optional(),
  fallbackProfiles: PricingDataFileEntrySchema.optional(),
});

export type PricingManifest = z.infer<typeof PricingManifestSchema>;

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
  /**
   * Billing evidence extracted from the log (P1-1), keyed by the evidence
   * field names declared in the tool's `modelObservation.evidence` (e.g.
   * `{ endpoint: "https://api.deepseek.com/v1", accountPlan: "pro" }`).
   * Phase 2 resolves the billing route from this evidence.
   */
  evidence?: Record<string, string>;
}

export interface PricingResolution {
  rawModel: string;
  normalizedModel: string;
  canonicalModelId?: string;
  /** Always set, including `generic-normalize-v1` when only normalization ran. */
  conversionRuleId: string;
  rateRuleId?: string;
  fallbackProfileId?: string;
  /** P1-1: the billing route that priced this resolution (phase 2 sets it). */
  billingRouteId?: string;
  /** P1-1: the route-selection rule that chose `billingRouteId` (phase 2). */
  routeSelectionRuleId?: string;
  confidence: PricingConfidence;
  /** Machine-readable reason enum, e.g. `exact-match`, `no-rate-match`, `unpriced`. */
  reason: PricingReason;
  packageVersion: string;
  /** Known cost in nanoUSD; absent when `confidence` is `unpriced`/`not-billable`. */
  knownUsdNano?: bigint;
  /** Notional cache-read saving in nanoUSD (when a rate matched). */
  cacheSavingsUsdNano?: bigint;
  /**
   * True when the event carried cache-write tokens but the matched rate had no
   * cache-write price (P1-6): known components were billed at the real rate,
   * only the cache-write component is unbilled.
   */
  unpricedCacheWrite?: boolean;
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
  | "historical-rate-missing"
  | "no-route-evidence";

/** Parse a NanoUsdString into a bigint. Throws on malformed input (should never happen post-validation). */
export function parseNanoUsd(value: string): bigint {
  return BigInt(value);
}

/** Convert a USD-per-million decimal number to a nanoUSD bigint. */
export function usdPerMillionToNano(usdPerMillion: number): bigint {
  // $5/MTok = 5e9 nanoUSD/MTok
  return BigInt(Math.round(usdPerMillion * 1_000_000_000));
}
