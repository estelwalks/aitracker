/**
 * Insight Enhancer application: the orchestrating port implementation for the
 * optional LLM enhancement of today's-insight rule facts (M2).
 *
 * Responsibilities, in order: resolve an active profile (never call the model
 * without one), read/write the enhancement cache via the SQLite repository,
 * enforce an in-process daily call budget, merge concurrent same-scope calls
 * (singleflight), generate, validate (five layers), and persist. Every failure
 * path returns a stable status — nothing here throws to the caller.
 */
import { sha256Hex } from "../../../lib/crypto/sha256.ts";
import type { AIExecutorPort } from "../../ai-orchestration/index.ts";
import type {
  AIExecutionSummary,
  TokenUsage,
} from "../../ai-orchestration/contracts.ts";
import type {
  InsightActionId,
  InsightEnhancementInput,
  InsightEnhancementResult,
  InsightEnhancerPort,
  InsightMode,
  InsightSurfaceId,
} from "../page/contracts.ts";
import type {
  InsightCacheIdentity,
  InsightEnhancementCache,
  SqliteInsightRepository,
} from "../infrastructure/sqlite-insight-repository.server.ts";
import {
  createLLMInsightGenerator,
  type InsightGenerateResult,
} from "./llm-page-insight-generator.ts";
import {
  buildInsightPromptTemplate,
  getInsightPrompt,
  type InsightPrompt,
} from "./prompt-registry.ts";
import {
  validateEnhancementOutput,
  type ValidatedEnhancementLine,
} from "./validation.ts";

export const INSIGHT_ENHANCER_ID = "insight-enhancer";

/** Refresh enhanced insight text at most once per hour for the same evidence. */
export const INSIGHT_ENHANCEMENT_CACHE_TTL_MS = 60 * 60 * 1000;
/**
 * Default budget for automatic enhancement: one page can refresh every hour,
 * while up to 14 first visits or page switches add 14 calls, leaving
 * headroom within 500.
 */
const DEFAULT_DAILY_CALL_LIMIT = 500;
/** The enhancer is the "enhanced" path; manual vs auto is interchangeable for
 * cache purposes (only "rules" is treated differently by the repository). */
const ENHANCEMENT_CACHE_MODE: InsightMode = "enhanced-manual";

export interface ActiveInsightProfile {
  readonly id: string;
  readonly label: string;
}

/**
 * Enhancement input accepted by this implementation. It is a structural
 * superset of M1's `InsightEnhancementInput`: the optional `forbiddenEntities`
 * vocabulary lets the wiring module refuse entity names (projects, sessions,
 * skills) in output and payload without widening M1's contract.
 */
export interface InsightEnhancerInput extends InsightEnhancementInput {
  readonly forbiddenEntities?: readonly string[];
}

export interface InsightExecutionRecord {
  readonly capability: "page-insight";
  readonly surfaceId: InsightSurfaceId;
  readonly profileId: string;
  readonly summary: AIExecutionSummary;
  readonly usage?: Pick<TokenUsage, "inputTokens" | "outputTokens">;
  readonly inputFingerprint: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export type InsightRecordExecution = (
  record: InsightExecutionRecord,
) => void | Promise<void>;

export interface InsightEnhancerOptions {
  readonly ai: AIExecutorPort;
  readonly repository: SqliteInsightRepository;
  /** Resolves the active model profile. `null` disables the enhancer. */
  readonly resolveActiveProfile?: () => Promise<ActiveInsightProfile | null>;
  /** Resolves an explicitly selected effective-preference profile. */
  readonly resolveProfile?: (
    profileId: string,
  ) => Promise<ActiveInsightProfile | null>;
  readonly now?: () => number;
  /** Cache TTL. Defaults to one hour. */
  readonly ttlMs?: number;
  /** In-process daily call budget. Defaults to 500. */
  readonly dailyCallLimit?: number;
  /** Merge concurrent same-scope calls into one promise. Defaults to true. */
  readonly singleflight?: boolean;
  /**
   * How many model calls may run concurrently through this enhancer
   * (page visits and batch items share the pool). Defaults to 3. Kept small
   * because the gateway is reliable for a few requests but rejects bursts.
   */
  readonly maxConcurrentRequests?: number;
  /**
   * Attempts per surface, including retries after transient failures
   * (timeout, provider failure, invalid output). Defaults to 3 (2 retries).
   * `budget-exceeded` is never retried.
   */
  readonly maxAttempts?: number;
  /** Retry backoff in ms, keyed by the retry attempt number (1-based). */
  readonly retryDelayMs?: (attempt: number) => number;
  /** Overrides INSIGHT_MAX_OUTPUT_TOKENS (calibrated for reasoning models). */
  readonly maxOutputTokens?: number;
  /** Overrides INSIGHT_MODEL_TIMEOUT_MS. */
  readonly timeoutMs?: number;
  /**
   * Persisted budget reservation + execution audit hook. The wiring module
   * adapts this to the composition root's `ai_executions` / `ai_daily_usage`
   * repository. Defaults to no-op.
   */
  readonly recordExecution?: InsightRecordExecution;
}

function cacheIdentityKey(identity: InsightCacheIdentity): string {
  return JSON.stringify([
    identity.surfaceId,
    identity.scopeHash,
    identity.evidenceHash,
    identity.locale,
    identity.profileId,
    identity.promptVersionId,
    identity.promptVersion,
  ]);
}

function persistedEnhancementStatus(
  status: string | null,
): InsightEnhancementResult["status"] {
  return status === "budget-exceeded" ||
    status === "timeout" ||
    status === "invalid-output" ||
    status === "enhancer-unavailable"
    ? status
    : "enhancer-failed";
}

function sha256(text: string): string {
  return sha256Hex(text);
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    out[key] = canonicalize(record[key]);
  }
  return out;
}

function canonicalCandidates(
  candidates: InsightEnhancementInput["candidates"],
): unknown {
  const sorted = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
  return sorted.map((candidate) => ({
    id: candidate.id,
    severity: candidate.severity,
    fact: candidate.fact,
    actionIds: [...candidate.actionIds].sort(),
    mandatory: candidate.mandatory,
  }));
}

function localDateKey(nowMs: number): string {
  const date = new Date(nowMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function mapCachedLines(
  cache: InsightEnhancementCache,
): InsightEnhancementResult["lines"] {
  return cache.lines
    .filter((line) => line.candidateId !== null && line.analysis !== null)
    .map((line) => ({
      candidateId: line.candidateId as string,
      analysis: line.analysis as string,
      ...(line.actionId === null || line.actionId === undefined
        ? {}
        : { actionId: line.actionId as InsightActionId }),
    }));
}

function mapFailureStatus(
  status: InsightGenerateResult["status"],
): InsightEnhancementResult["status"] {
  switch (status) {
    case "budget-exceeded":
      return "budget-exceeded";
    case "timeout":
      return "timeout";
    case "failed":
      return "enhancer-failed";
    case "completed":
      return "enhancer-failed"; // completed but missing text is handled by the caller
  }
}

export function createInsightEnhancer(
  options: InsightEnhancerOptions,
): InsightEnhancerPort & { id: string } {
  const ai = options.ai;
  const repository = options.repository;
  const resolveActiveProfile = options.resolveActiveProfile;
  const resolveProfile = options.resolveProfile;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? INSIGHT_ENHANCEMENT_CACHE_TTL_MS;
  const dailyCallLimit = options.dailyCallLimit ?? DEFAULT_DAILY_CALL_LIMIT;
  const singleflight = options.singleflight ?? true;
  const recordExecution = options.recordExecution ?? (() => undefined);
  const maxAttempts = options.maxAttempts ?? 3;
  const retryDelayMs =
    options.retryDelayMs ?? ((attempt: number) => attempt * 500);
  const generate = createLLMInsightGenerator({
    ai,
    ...(options.maxOutputTokens !== undefined
      ? { maxOutputTokens: options.maxOutputTokens }
      : {}),
    ...(options.timeoutMs !== undefined
      ? { timeoutMs: options.timeoutMs }
      : {}),
  });

  const calls = new Map<string, number>();
  const inflight = new Map<string, Promise<InsightEnhancementResult>>();
  // The gateway is reliable for a few requests but rejects bursts from
  // several mounted page cards. Singleflight handles duplicate evidence;
  // this bounded semaphore keeps different surfaces (and batch items)
  // concurrent instead of strictly serial, capped at maxConcurrentRequests.
  const maxConcurrentRequests = options.maxConcurrentRequests ?? 3;
  let activeSlots = 0;
  const slotWaiters: Array<() => void> = [];

  function acquire(): Promise<void> {
    if (activeSlots < maxConcurrentRequests) {
      activeSlots += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => slotWaiters.push(resolve));
  }

  function release(): void {
    const next = slotWaiters.shift();
    if (next !== undefined) next();
    else activeSlots -= 1;
  }

  type EnhancementContext = {
    readonly profile: ActiveInsightProfile;
    readonly promptEntry: InsightPrompt;
    readonly evidenceHash: string;
    readonly identity: InsightCacheIdentity;
    readonly requestTtlMs: number;
  };

  async function buildContext(
    input: InsightEnhancerInput,
  ): Promise<EnhancementContext | null> {
    let profile: ActiveInsightProfile | null = null;
    try {
      profile = input.profileId
        ? resolveProfile
          ? await resolveProfile(input.profileId)
          : null
        : resolveActiveProfile
          ? await resolveActiveProfile()
          : null;
    } catch {
      profile = null;
    }
    if (profile === null) return null;

    const nowMs = now();
    const dateKey = localDateKey(nowMs);
    const promptEntry = getInsightPrompt(input.surface);
    const evidenceHash = sha256(
      JSON.stringify(canonicalize(canonicalCandidates(input.candidates))),
    );
    const scopeHash = sha256(
      JSON.stringify(
        canonicalize({
          surface: input.surface,
          locale: input.locale,
          scope: input.scope ?? {},
          dateKey,
          adapterVersion: input.adapterVersion,
        }),
      ),
    );
    const requestTtlMs =
      input.cacheTtlMs !== undefined &&
      Number.isSafeInteger(input.cacheTtlMs) &&
      input.cacheTtlMs > 0
        ? input.cacheTtlMs
        : ttlMs;

    return {
      profile,
      promptEntry,
      evidenceHash,
      requestTtlMs,
      identity: {
        surfaceId: input.surface,
        scopeHash,
        evidenceHash,
        locale: input.locale,
        profileId: profile.id,
        promptVersionId: promptEntry.id,
        promptVersion: promptEntry.version,
      },
    };
  }

  function readCachedResult(
    context: EnhancementContext,
    nowMs: number,
  ): InsightEnhancementResult | null {
    let cached: InsightEnhancementCache | undefined;
    try {
      // The configured refresh period is the contract for AI generation. A
      // changed evidence sample must not cause every page switch to enqueue a
      // new model request; the current rule facts are still rendered beside
      // the cached model analysis until this period expires.
      cached =
        repository.findLatestValid?.(context.identity, nowMs) ??
        repository.findValid(context.identity, nowMs);
    } catch {
      return null;
    }
    if (
      cached === undefined ||
      cached.generatedAtMs + context.requestTtlMs <= nowMs
    ) {
      return null;
    }
    return {
      status: "enhanced-cached",
      lines: mapCachedLines(cached),
      modelLabel: cached.modelLabel ?? undefined,
      generatedAtMs: cached.generatedAtMs,
      expiresAtMs: cached.expiresAtMs,
    };
  }

  function pruneCalls(dateKey: string): void {
    for (const key of [...calls.keys()]) {
      if (!key.startsWith(`${dateKey}:`)) calls.delete(key);
    }
  }

  async function recordBestEffort(
    record: InsightExecutionRecord,
  ): Promise<void> {
    try {
      await recordExecution(record);
    } catch {
      // Audit failure must never fail or change the enhancement result.
    }
  }

  async function runEnhancementAttempt(
    input: InsightEnhancerInput,
    profile: ActiveInsightProfile,
    identity: InsightCacheIdentity,
    promptEntry: InsightPrompt,
    evidenceHash: string,
    cacheTtlMs: number,
  ): Promise<{ result: InsightEnhancementResult; retryable: boolean }> {
    try {
      const prompt = {
        id: promptEntry.id,
        version: promptEntry.version,
        template: buildInsightPromptTemplate(promptEntry),
      };
      const startedAtMs = now();
      const generated = await generate.generate({
        surface: input.surface,
        locale: input.locale,
        candidates: input.candidates,
        prompt,
        profileId: profile.id,
        modelLabel: profile.label,
        forbiddenEntities: input.forbiddenEntities,
      });
      const finishedAtMs = now();

      if (generated.summary) {
        await recordBestEffort({
          capability: "page-insight",
          surfaceId: input.surface,
          profileId: profile.id,
          summary: generated.summary,
          usage: generated.usage,
          inputFingerprint: evidenceHash,
          startedAtMs,
          finishedAtMs,
        });
      }

      if (generated.status !== "completed" || generated.text === undefined) {
        const status = mapFailureStatus(generated.status);
        return {
          result: {
            status,
            lines: [],
            ...(generated.failureDetail !== undefined
              ? { failureDetail: generated.failureDetail }
              : {}),
          },
          // Budget exhaustion is final for this call; everything else
          // (timeout, provider failure) may succeed on a fresh attempt.
          retryable: status === "timeout" || status === "enhancer-failed",
        };
      }

      const validation = validateEnhancementOutput(generated.text, input, {
        forbiddenEntities: input.forbiddenEntities,
      });
      if (!validation.ok) {
        // The model's output shape varies per attempt; a fresh attempt may
        // comply with the schema.
        return {
          result: { status: "invalid-output", lines: [] },
          retryable: true,
        };
      }

      const nowMs = now();
      const lines: InsightEnhancementResult["lines"] = validation.output.map(
        (line: ValidatedEnhancementLine) => ({
          candidateId: line.candidateId,
          analysis: line.analysis,
          ...(line.actionId === undefined ? {} : { actionId: line.actionId }),
        }),
      );
      const cacheValue: InsightEnhancementCache = {
        ...identity,
        cacheKey: sha256(JSON.stringify(canonicalize(identity))),
        modelLabel: profile.label,
        aiRequestId: generated.requestId,
        generatedAtMs: nowMs,
        expiresAtMs: nowMs + cacheTtlMs,
        status: "ready",
        lines: validation.output.map((line, index) => ({
          sequence: index,
          candidateId: line.candidateId,
          analysis: line.analysis,
          actionId: line.actionId ?? null,
        })),
      };
      let persisted = true;
      try {
        repository.saveEnhancement({
          mode: ENHANCEMENT_CACHE_MODE,
          value: cacheValue,
          forbiddenEntities: input.forbiddenEntities,
        });
      } catch {
        // Privacy-guard or storage failure: return the enhanced lines anyway,
        // but report that they were not persisted so the caller can mark the
        // batch item failed instead of silently reporting success.
        persisted = false;
      }

      return {
        result: {
          status: "enhanced-ready",
          lines,
          modelLabel: profile.label,
          generatedAtMs: cacheValue.generatedAtMs,
          expiresAtMs: cacheValue.expiresAtMs,
          ...(persisted ? {} : { persisted: false }),
        },
        retryable: false,
      };
    } catch {
      return {
        result: { status: "enhancer-failed", lines: [] },
        retryable: true,
      };
    }
  }

  async function runEnhancement(
    input: InsightEnhancerInput,
    profile: ActiveInsightProfile,
    identity: InsightCacheIdentity,
    promptEntry: InsightPrompt,
    evidenceHash: string,
    cacheTtlMs: number,
  ): Promise<InsightEnhancementResult> {
    let lastFailureDetail: string | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const { result, retryable } = await runEnhancementAttempt(
        input,
        profile,
        identity,
        promptEntry,
        evidenceHash,
        cacheTtlMs,
      );
      if (!retryable || attempt === maxAttempts) return result;
      if (result.failureDetail !== undefined) {
        lastFailureDetail = result.failureDetail;
      }
      const delayMs = retryDelayMs(attempt);
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
    return {
      status: "enhancer-failed",
      lines: [],
      ...(lastFailureDetail !== undefined
        ? { failureDetail: lastFailureDetail }
        : {}),
    };
  }

  async function readCached(
    input: InsightEnhancerInput,
  ): Promise<InsightEnhancementResult | null> {
    const context = await buildContext(input);
    if (context === null) return null;
    return readCachedResult(context, now());
  }

  async function enhance(
    input: InsightEnhancerInput,
  ): Promise<InsightEnhancementResult> {
    const context = await buildContext(input);
    if (context === null) {
      return { status: "enhancer-unavailable", lines: [] };
    }

    const { identity, evidenceHash, promptEntry, profile, requestTtlMs } =
      context;
    const nowMs = now();
    const dateKey = localDateKey(nowMs);
    pruneCalls(dateKey);
    const cached = readCachedResult(context, nowMs);
    if (cached !== null) return cached;

    const flightKey = cacheIdentityKey(identity);
    if (singleflight) {
      const inflightResult = inflight.get(flightKey);
      if (inflightResult) return inflightResult;
    }

    const generation = repository.getRefreshGeneration?.() ?? 0;
    const generationStartedAtMs =
      repository.getRefreshGenerationStartedAtMs?.() ?? 0;
    const refreshWindowActive =
      generation > 0 &&
      (repository.hasActiveRefreshRun?.() === true ||
        (generationStartedAtMs > 0 &&
          nowMs < generationStartedAtMs + requestTtlMs));
    const timeBucket = refreshWindowActive
      ? 0
      : generation > 0 && generationStartedAtMs > 0
        ? 1 + Math.floor((nowMs - generationStartedAtMs) / requestTtlMs)
        : Math.floor(nowMs / requestTtlMs);
    const ownerId = crypto.randomUUID();
    const reservationKey = sha256(
      JSON.stringify(canonicalize({ generation, timeBucket, identity })),
    );
    const reservation = repository.claimGeneration?.({
      reservationKey,
      generation,
      timeBucket,
      identity,
      ownerId,
      createdAtMs: nowMs,
    });
    if (reservation && !reservation.claimed) {
      const completedCache = readCachedResult(context, now());
      if (completedCache !== null) return completedCache;
      if (reservation.reservation.status === "running") {
        // Another caller owns this exact identity right now; its result is
        // written to the cache when it finishes. This is not a failure.
        return { status: "pending", lines: [] };
      }
      return {
        status: persistedEnhancementStatus(
          reservation.reservation.resultStatus,
        ),
        lines: [],
      };
    }

    const finishReservation = (
      result: InsightEnhancementResult,
    ): InsightEnhancementResult => {
      try {
        repository.finishGeneration?.({
          reservationKey,
          ownerId,
          status:
            result.status === "enhanced-ready" ||
            result.status === "enhanced-cached"
              ? "completed"
              : "failed",
          resultStatus: result.status,
          nowMs: now(),
        });
      } catch {
        // The provider result remains authoritative even if coordination
        // telemetry cannot be updated. The unique reservation still prevents
        // a second call during this refresh generation/time bucket.
      }
      return result;
    };

    const budgetKey = `${dateKey}:${profile.id}`;
    const used = calls.get(budgetKey) ?? 0;
    const effectiveDailyCallLimit = input.dailyCallLimit ?? dailyCallLimit;
    if (used >= effectiveDailyCallLimit) {
      return finishReservation({ status: "budget-exceeded", lines: [] });
    }
    calls.set(budgetKey, used + 1);

    const work = (async () => {
      await acquire();
      try {
        return finishReservation(
          await runEnhancement(
            input,
            profile,
            identity,
            promptEntry,
            evidenceHash,
            requestTtlMs,
          ),
        );
      } finally {
        release();
      }
    })();
    if (singleflight) {
      inflight.set(flightKey, work);
      void work.then(() => inflight.delete(flightKey));
    }
    return work;
  }

  return { id: INSIGHT_ENHANCER_ID, readCached, enhance };
}
