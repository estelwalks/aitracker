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
import type { AIExecutorPort } from "../../ai-orchestration/ai-executor.ts";
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

/** Keep enhanced text aligned with the active page's 30-minute evidence cycle. */
export const INSIGHT_ENHANCEMENT_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_DAILY_CALL_LIMIT = 30;
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
  /** Cache TTL. Defaults to 30 minutes. */
  readonly ttlMs?: number;
  /** In-process daily call budget. Defaults to 30. */
  readonly dailyCallLimit?: number;
  /** Merge concurrent same-scope calls into one promise. Defaults to true. */
  readonly singleflight?: boolean;
  /**
   * Persisted budget reservation + execution audit hook. The wiring module
   * adapts this to the composition root's `ai_executions` / `ai_daily_usage`
   * repository. Defaults to no-op.
   */
  readonly recordExecution?: InsightRecordExecution;
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
  const generate = createLLMInsightGenerator({ ai });

  const calls = new Map<string, number>();
  const inflight = new Map<string, Promise<InsightEnhancementResult>>();

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

  async function runEnhancement(
    input: InsightEnhancerInput,
    profile: ActiveInsightProfile,
    identity: InsightCacheIdentity,
    promptEntry: InsightPrompt,
    evidenceHash: string,
  ): Promise<InsightEnhancementResult> {
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
        return { status: mapFailureStatus(generated.status), lines: [] };
      }

      const validation = validateEnhancementOutput(generated.text, input, {
        forbiddenEntities: input.forbiddenEntities,
      });
      if (!validation.ok) {
        return { status: "invalid-output", lines: [] };
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
        expiresAtMs: nowMs + ttlMs,
        status: "ready",
        lines: validation.output.map((line, index) => ({
          sequence: index,
          candidateId: line.candidateId,
          analysis: line.analysis,
          actionId: line.actionId ?? null,
        })),
      };
      try {
        repository.saveEnhancement({
          mode: ENHANCEMENT_CACHE_MODE,
          value: cacheValue,
          forbiddenEntities: input.forbiddenEntities,
        });
      } catch {
        // Privacy-guard or storage failure: return the enhanced lines anyway,
        // but do not persist them.
      }

      return {
        status: "enhanced-ready",
        lines,
        modelLabel: profile.label,
      };
    } catch {
      return { status: "enhancer-failed", lines: [] };
    }
  }

  async function enhance(
    input: InsightEnhancerInput,
  ): Promise<InsightEnhancementResult> {
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
    if (profile === null) {
      return { status: "enhancer-unavailable", lines: [] };
    }

    const nowMs = now();
    const dateKey = localDateKey(nowMs);
    pruneCalls(dateKey);

    const promptEntry = getInsightPrompt(input.surface);
    const evidenceHash = sha256(
      JSON.stringify(canonicalize(canonicalCandidates(input.candidates))),
    );
    const scopeHash = sha256(
      JSON.stringify(
        canonicalize({
          surface: input.surface,
          locale: input.locale,
          dateKey,
          adapterVersion: input.adapterVersion,
        }),
      ),
    );
    const identity: InsightCacheIdentity = {
      surfaceId: input.surface,
      scopeHash,
      evidenceHash,
      locale: input.locale,
      profileId: profile.id,
      promptVersionId: promptEntry.id,
      promptVersion: promptEntry.version,
    };

    let cached: InsightEnhancementCache | undefined;
    try {
      cached = repository.findValid(identity, nowMs);
    } catch {
      cached = undefined;
    }
    if (cached) {
      return {
        status: "enhanced-cached",
        lines: mapCachedLines(cached),
        modelLabel: cached.modelLabel ?? undefined,
      };
    }

    const flightKey = `${input.surface}:${input.locale}:${evidenceHash}`;
    if (singleflight) {
      const inflightResult = inflight.get(flightKey);
      if (inflightResult) return inflightResult;
    }

    const budgetKey = `${dateKey}:${profile.id}`;
    const used = calls.get(budgetKey) ?? 0;
    const effectiveDailyCallLimit = input.dailyCallLimit ?? dailyCallLimit;
    if (used >= effectiveDailyCallLimit) {
      return { status: "budget-exceeded", lines: [] };
    }
    calls.set(budgetKey, used + 1);

    const work = runEnhancement(
      input,
      profile,
      identity,
      promptEntry,
      evidenceHash,
    );
    if (singleflight) {
      inflight.set(flightKey, work);
      void work.then(() => inflight.delete(flightKey));
    }
    return work;
  }

  return { id: INSIGHT_ENHANCER_ID, enhance };
}
