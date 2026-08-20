/**
 * Optional LLM review supplement (M4) — server-only composition.
 *
 * The provider receives a deliberately small, allowlisted aggregate only
 * (dimension hit counts, severity counts, verdict, asset kind, rule version).
 * It never receives source code, file contents, excerpts, absolute paths,
 * project names, session/memory bodies, or API keys.
 *
 * The model result is validated through five layers and attached as a
 * read-only supplement. Any failure discards the LLM result and keeps the
 * static rule result — the verdict and severity are never changed, hidden or
 * downgraded. This mirrors `dashboard/ai-insight.server.ts`'s aggregate ->
 * call -> Zod -> sensitive-scan -> keep-default flow.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { AIExecutorPort } from "../../ai-orchestration/ai-executor.ts";
import { APP_NAME } from "../../../lib/app-config.ts";
import {
  SECURITY_LLM_DIMENSIONS,
  SECURITY_LLM_REVIEW_PREF_KEY,
  type SecurityLlmDimension,
  type SecurityLlmReview,
  type SecurityLlmReviewAggregate,
  type SecurityLlmReviewAvailability,
  type SecurityLlmReviewAggregateRequest,
} from "../llm-review.contracts.ts";

const REVIEW_TTL_MS = 5 * 60 * 1000;
const REVIEW_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_TEXT_LENGTH = 4_000;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const REVIEW_PROMPT = {
  id: "security.llm-review.aggregate",
  version: 1,
  template: `You are ${APP_NAME}'s local security analyst. Analyze only the supplied aggregate JSON (per-dimension hit counts, severity counts, verdict, asset kind, rule version). Do not infer source code, file contents, excerpts, absolute paths, project names, or commands. You must NOT change or override the verdict; your output is supplementary only. Return JSON only with this exact shape:
{"summary":"...","dimensions":[{"kind":"<dimension>","analysis":"..."}],"confidence":"low|medium|high"}
- summary: at most 260 characters, a concise assessment of the overall risk pattern.
- dimensions: at most 3 entries; each "kind" must be one of ${SECURITY_LLM_DIMENSIONS.join(", ")} and each "analysis" at most 160 characters.
- confidence: one of low|medium|high.
Never include numbers, URLs, file paths, or shell commands anywhere in summary or analysis.`,
} as const;

export type SecurityLlmReviewErrorCode =
  | "errors.security.llmReview.invalidAggregate"
  | "errors.security.llmReview.sensitivePayload"
  | "errors.security.llmReview.disabled"
  | "errors.security.llmReview.notConfigured"
  | "errors.security.llmReview.schemaRejected"
  | "errors.security.llmReview.referenceRejected"
  | "errors.security.llmReview.factRejected"
  | "errors.security.llmReview.sensitiveOutput"
  | "errors.security.llmReview.offline"
  | "errors.security.llmReview.timeout"
  | "errors.security.llmReview.failed";

const dimensionHitSchema = z
  .object({
    hit: z.boolean(),
    count: z.number().int().nonnegative().max(1_000_000),
  })
  .strict();

const aggregateSchema = z
  .object({
    dimensions: z.record(z.enum(SECURITY_LLM_DIMENSIONS), dimensionHitSchema),
    severityCounts: z
      .object({
        high: z.number().int().nonnegative(),
        medium: z.number().int().nonnegative(),
        low: z.number().int().nonnegative(),
      })
      .strict(),
    verdict: z.enum(["clean", "suspicious", "dangerous", "unknown"]),
    assetKind: z.enum(["skill", "package", "knowledge", "distillation"]),
    rulesVersion: z.string().min(1).max(128).regex(OPAQUE_ID),
  })
  .strict()
  .superRefine((value, context) => {
    for (const dimension of SECURITY_LLM_DIMENSIONS) {
      if (!(dimension in value.dimensions)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing dimension ${dimension}`,
        });
      }
    }
  });

const outputSchema = z
  .object({
    summary: z.string().trim().min(1).max(260),
    dimensions: z
      .array(
        z
          .object({
            kind: z.enum(SECURITY_LLM_DIMENSIONS),
            analysis: z.string().trim().min(1).max(160),
          })
          .strict(),
      )
      .min(0)
      .max(3),
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

type ParsedOutput = z.infer<typeof outputSchema>;

const NUMBER_PATTERN = /\d/;
const URL_PATTERN = /https?:\/\/|www\./i;
const ABSOLUTE_PATH_PATTERN =
  /(?:^|\s)(?:\/[\S]+|[A-Za-z]:[\\/][\S]*|\\\\[\S]+)/;
const CREDENTIAL_PATTERN =
  /\b(?:sk|pk|ghp|api)_[A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\bbearer\s+\S+/i;
const COMMAND_PATTERN =
  /\b(?:sudo|curl|wget|npx|npm|node|bash|zsh|powershell|cmd(?:\.exe)?|sh|rm)\b/i;
const INJECTION_PATTERN =
  /\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/i;

/**
 * Outbound payload audit: paths, credential material, commands, URLs — not
 * digits (counts are legitimate) and not the fixed dimension enum vocabulary
 * (e.g. the `secret` dimension key is an enum value, not a leaked word).
 */
const PAYLOAD_SENSITIVE =
  /(?:\/(?:Users|home|private|var|tmp|etc)\/|[A-Za-z]:[\\/]|\\\\|\b(?:sk|pk|ghp|api)_[A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\bbearer\s+\S+|\b(?:sudo|curl|wget|rm\s+-rf|npm\s+(?:install|publish)|npx|node|bash|powershell)\b|https?:\/\/|www\.)/i;

function containsOutputSensitive(value: string): boolean {
  return (
    URL_PATTERN.test(value) ||
    ABSOLUTE_PATH_PATTERN.test(value) ||
    CREDENTIAL_PATTERN.test(value) ||
    COMMAND_PATTERN.test(value) ||
    INJECTION_PATTERN.test(value)
  );
}

function containsDigits(value: string): boolean {
  return NUMBER_PATTERN.test(value);
}

type OutputParseResult =
  | { readonly ok: true; readonly data: ParsedOutput }
  | { readonly ok: false; readonly code: SecurityLlmReviewErrorCode };

/**
 * Five-layer output validation. Each layer maps to a stable, sanitized error
 * code; the original text is never logged or returned.
 */
function parseLlmReviewOutput(text: string): OutputParseResult {
  if (text.length === 0 || text.length > MAX_OUTPUT_TEXT_LENGTH) {
    return { ok: false, code: "errors.security.llmReview.schemaRejected" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, code: "errors.security.llmReview.schemaRejected" };
  }
  // Layer 2 — Schema.
  const schema = outputSchema.safeParse(parsed);
  if (!schema.success) {
    return { ok: false, code: "errors.security.llmReview.schemaRejected" };
  }
  const data = schema.data;
  // Layer 3 — Reference: each dimension kind is valid and unique.
  const kinds = new Set(data.dimensions.map((entry) => entry.kind));
  if (kinds.size !== data.dimensions.length) {
    return { ok: false, code: "errors.security.llmReview.referenceRejected" };
  }
  // Layer 4 — Fact: no digits anywhere in the human-readable fields.
  const fields = [
    data.summary,
    ...data.dimensions.map((entry) => entry.analysis),
  ];
  if (fields.some(containsDigits)) {
    return { ok: false, code: "errors.security.llmReview.factRejected" };
  }
  // Layer 5 — Security-sensitive words: no URL/path/command/credential/injection.
  if (fields.some(containsOutputSensitive)) {
    return { ok: false, code: "errors.security.llmReview.sensitiveOutput" };
  }
  return { ok: true, data };
}

/** Server-side profile resolution; the API key never leaves this boundary. */
export interface SecurityLlmReviewProfile {
  readonly id: string;
  readonly label: string;
}

export type SecurityLlmReviewResolveProfile =
  () => Promise<SecurityLlmReviewProfile | null>;

async function resolveActiveProfile(): Promise<SecurityLlmReviewProfile | null> {
  try {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const repository = (await getCompositionRoot()).modelProfiles;
    const active = await repository.getActiveView();
    if (!active) return null;
    const profile = await repository.getProfileForExecution(active.id);
    if (!profile?.apiKey) return null;
    return {
      id: active.id,
      label: active.name || profile.model || active.id,
    };
  } catch {
    return null;
  }
}

async function readLlmReviewPreference(): Promise<boolean> {
  try {
    const { getCompositionRoot } =
      await import("../../../app/composition.server.ts");
    const root = await getCompositionRoot();
    return (
      root.database.features.appPreferences.get(SECURITY_LLM_REVIEW_PREF_KEY)
        ?.value === true
    );
  } catch {
    return false;
  }
}

interface CacheEntry {
  readonly review: SecurityLlmReview;
  readonly expiresAt: number;
}

export interface SecurityLlmReviewServiceOptions {
  readonly aiExecutor: AIExecutorPort;
  readonly resolveProfile?: SecurityLlmReviewResolveProfile;
  readonly isEnabled?: () => boolean | Promise<boolean>;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
  readonly observe?: (code: SecurityLlmReviewErrorCode) => void;
}

export interface SecurityLlmReviewService {
  /** Explicit user-triggered path; the sole method that may invoke a model. */
  review(
    request: SecurityLlmReviewAggregateRequest,
  ): Promise<SecurityLlmReview | null>;
  /** Read-only; never invokes a provider. */
  availability(): Promise<SecurityLlmReviewAvailability>;
}

function cacheKey(
  request: SecurityLlmReviewAggregateRequest,
  profileId: string,
): string {
  return `${request.assetRef}|${request.aggregate.rulesVersion}|${profileId}`;
}

/**
 * In-memory TTL cache + single-flight dedup. The provider config is resolved
 * per request; an unconfigured/disabled service cannot initiate a request.
 */
export function createSecurityLlmReviewService(
  options: SecurityLlmReviewServiceOptions,
): SecurityLlmReviewService {
  const aiExecutor = options.aiExecutor;
  const resolveProfile = options.resolveProfile ?? resolveActiveProfile;
  const isEnabled = options.isEnabled ?? readLlmReviewPreference;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? REVIEW_TTL_MS;
  const timeoutMs = options.timeoutMs ?? REVIEW_TIMEOUT_MS;
  const observe =
    options.observe ??
    ((code) => {
      // Sanitized error code only; never the model text or aggregate.
      console.warn(`[security-llm-review] ${code}`);
    });

  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<SecurityLlmReview | null>>();

  async function validateAggregate(
    aggregate: SecurityLlmReviewAggregate,
  ): Promise<boolean> {
    const parsed = aggregateSchema.safeParse(aggregate);
    if (!parsed.success) {
      observe("errors.security.llmReview.invalidAggregate");
      return false;
    }
    // Final outbound payload audit point.
    const payload = JSON.stringify(parsed.data);
    if (PAYLOAD_SENSITIVE.test(payload)) {
      observe("errors.security.llmReview.sensitivePayload");
      return false;
    }
    return true;
  }

  return {
    async review(request) {
      if (!(await validateAggregate(request.aggregate))) return null;
      if (!(await isEnabled())) {
        observe("errors.security.llmReview.disabled");
        return null;
      }
      const profile = await resolveProfile();
      if (!profile) {
        observe("errors.security.llmReview.notConfigured");
        return null;
      }

      const key = cacheKey(request, profile.id);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now()) return cached.review;

      const inflight = pending.get(key);
      if (inflight) return inflight;

      const task = (async (): Promise<SecurityLlmReview | null> => {
        let result;
        try {
          result = await aiExecutor.execute({
            requestId: randomUUID(),
            providerId: "profile",
            modelId: profile.id,
            prompt: REVIEW_PROMPT,
            input: { text: JSON.stringify(request.aggregate) },
            timeoutMs,
          });
        } catch {
          observe("errors.security.llmReview.failed");
          return null;
        }

        if (result.summary.status !== "completed" || !result.response?.text) {
          const status = result.summary.status;
          observe(
            status === "timeout"
              ? "errors.security.llmReview.timeout"
              : status === "offline"
                ? "errors.security.llmReview.offline"
                : "errors.security.llmReview.failed",
          );
          return null;
        }

        const parsed = parseLlmReviewOutput(result.response.text);
        if (!parsed.ok) {
          observe(parsed.code);
          return null;
        }

        const review: SecurityLlmReview = {
          summary: parsed.data.summary,
          dimensions: parsed.data.dimensions.map((entry) => ({
            kind: entry.kind as SecurityLlmDimension,
            analysis: entry.analysis,
          })),
          confidence: parsed.data.confidence,
          reviewedAt: new Date(now()).toISOString(),
          modelLabel: profile.label,
        };
        cache.set(key, { review, expiresAt: now() + ttlMs });
        return review;
      })();

      pending.set(key, task);
      try {
        return await task;
      } finally {
        pending.delete(key);
      }
    },
    async availability() {
      const [resolvedProfile, enabled] = await Promise.all([
        resolveProfile(),
        Promise.resolve(isEnabled()).then((value) => Boolean(value)),
      ]);
      return { configured: resolvedProfile != null, enabled };
    },
  };
}

let productionService: SecurityLlmReviewService | undefined;

/** Server singleton; request handlers share TTL cache and in-flight dedupe. */
export function getSecurityLlmReviewService(): SecurityLlmReviewService {
  if (productionService) return productionService;
  productionService = createSecurityLlmReviewService({
    aiExecutor: {
      async execute(request) {
        const { getCompositionRoot } =
          await import("../../../app/composition.server.ts");
        return (await getCompositionRoot()).aiExecutor.execute(request);
      },
    },
  });
  return productionService;
}

/** Useful to force fresh profile/preference resolution in server tests only. */
export function resetSecurityLlmReviewServiceForTests(): void {
  productionService = undefined;
}
