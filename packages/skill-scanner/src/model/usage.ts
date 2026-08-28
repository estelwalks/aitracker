import type { ModelBranch, TokenUsage, TokenUsageBreakdown } from "../types.js";

export interface UsageContext { model: string; branch: ModelBranch }

interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
}

type MutableCounters = Omit<TokenUsageBreakdown, "status">;

const emptyCounters = (): MutableCounters => ({
  requestCount: 0, reportedRequestCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0,
});

const nonnegativeInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;

/** Normalizes provider usage. OpenAI prompt_tokens already includes cached tokens; Anthropic cache fields are additive. */
export function normalizeModelUsage(body: unknown): NormalizedUsage | undefined {
  if (!body || typeof body !== "object") return undefined;
  const usage = (body as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const raw = usage as Record<string, unknown>;
  const prompt = nonnegativeInt(raw.prompt_tokens);
  const completion = nonnegativeInt(raw.completion_tokens);
  if (prompt !== undefined || completion !== undefined) {
    const inputTokens = prompt ?? 0;
    const outputTokens = completion ?? 0;
    const reportedTotal = nonnegativeInt(raw.total_tokens);
    const details = raw.prompt_tokens_details && typeof raw.prompt_tokens_details === "object"
      ? raw.prompt_tokens_details as Record<string, unknown> : undefined;
    return {
      inputTokens,
      outputTokens,
      totalTokens: reportedTotal ?? inputTokens + outputTokens,
      cachedInputTokens: nonnegativeInt(details?.cached_tokens) ?? 0,
    };
  }
  const directInput = nonnegativeInt(raw.input_tokens);
  const output = nonnegativeInt(raw.output_tokens);
  const inputDetails = raw.input_tokens_details && typeof raw.input_tokens_details === "object"
    ? raw.input_tokens_details as Record<string, unknown> : undefined;
  const cachedTokens = nonnegativeInt(raw.cached_tokens) ?? nonnegativeInt(inputDetails?.cached_tokens) ?? 0;
  const cacheRead = nonnegativeInt(raw.cache_read_input_tokens) ?? 0;
  const cacheCreation = nonnegativeInt(raw.cache_creation_input_tokens) ?? 0;
  if (directInput === undefined && output === undefined && cachedTokens === 0 && cacheRead === 0 && cacheCreation === 0) return undefined;
  const inputTokens = (directInput ?? 0) + cacheRead + cacheCreation;
  const outputTokens = output ?? 0;
  const reportedTotal = nonnegativeInt(raw.total_tokens);
  return { inputTokens, outputTokens, totalTokens: reportedTotal ?? inputTokens + outputTokens, cachedInputTokens: cachedTokens + cacheRead };
}

function statusOf(counters: MutableCounters): TokenUsageBreakdown["status"] {
  if (counters.requestCount === 0) return "not_applicable";
  if (counters.reportedRequestCount === 0) return "unavailable";
  if (counters.reportedRequestCount < counters.requestCount) return "partial";
  return "complete";
}

const finish = (counters: MutableCounters): TokenUsageBreakdown => ({ ...counters, status: statusOf(counters) });

export class TokenUsageCollector {
  private readonly total = emptyCounters();
  private readonly models = new Map<string, MutableCounters>();
  private readonly branches = new Map<ModelBranch, MutableCounters>();

  request(context: UsageContext): void {
    this.total.requestCount += 1;
    this.counters(this.models, context.model).requestCount += 1;
    this.counters(this.branches, context.branch).requestCount += 1;
  }

  response(context: UsageContext, body: unknown): void {
    const usage = normalizeModelUsage(body);
    if (!usage) return;
    for (const counters of [this.total, this.counters(this.models, context.model), this.counters(this.branches, context.branch)]) {
      counters.reportedRequestCount += 1;
      counters.inputTokens += usage.inputTokens;
      counters.outputTokens += usage.outputTokens;
      counters.totalTokens += usage.totalTokens;
      counters.cachedInputTokens += usage.cachedInputTokens;
    }
  }

  report(): TokenUsage {
    return {
      ...finish(this.total),
      byModel: Object.fromEntries([...this.models].map(([name, counters]) => [name, finish(counters)])),
      byBranch: Object.fromEntries([...this.branches].map(([name, counters]) => [name, finish(counters)])),
    };
  }

  private counters<K>(map: Map<K, MutableCounters>, key: K): MutableCounters {
    let counters = map.get(key);
    if (!counters) { counters = emptyCounters(); map.set(key, counters); }
    return counters;
  }
}
