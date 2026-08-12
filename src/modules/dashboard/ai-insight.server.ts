/**
 * Server-only dashboard AI insight composition.
 *
 * The LLM provider receives a deliberately small, allowlisted aggregate only.
 * It never receives raw events, session data, project paths, prompts, commands,
 * source-log contents, or any browser supplied text. This module owns the
 * provider boundary and returns a browser-safe projection only.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createAiExecutor } from "../ai-orchestration/ai-executor.ts";
import {
  createProviderRegistry,
  createRegistryRouter,
} from "../ai-orchestration/provider-registry.ts";
import type {
  AIModelProvider,
  AIProviderRequest,
  AIResponse,
} from "../ai-orchestration/contracts.ts";
import { createDashboardV2View } from "./application/v2.ts";
import type {
  DashboardAIInsightView,
  DashboardV2Snapshot,
} from "./contracts.ts";
import type { MonitoringStatus } from "../monitoring/contracts.ts";
import { APP_NAME } from "../../lib/app-config.ts";

const DASHBOARD_INSIGHT_PROMPT = {
  id: "dashboard.insight.aggregate",
  version: 1,
  template: `You are ${APP_NAME}' local dashboard analyst. Analyze only the supplied aggregate JSON. Do not infer hidden activity, identifiers, paths, prompts, commands, or source content. Return JSON only with this exact shape: {"headline":"...","insights":[{"title":"...","detail":"...","severity":"info|attention|risk"}]}. Provide at most 3 concise, actionable observations. If data quality is incomplete, say so plainly.`,
} as const;

const INSIGHT_TTL_MS = 5 * 60 * 1000;
const INSIGHT_TIMEOUT_MS = 20_000;
const MAX_LABEL_LENGTH = 80;
const SENSITIVE_CONTENT =
  /(?:\/(?:Users|home|private|var|tmp)\/|[A-Za-z]:\\|\\\\|\b(?:sk|pk)-[A-Za-z0-9_-]{12,}\b|\bbearer\s+\S+|\b(?:api[ _-]?key|password|secret|authorization|cookie|credential)\b|\b(?:sudo|curl|wget|rm\s+-rf|npm\s+(?:install|publish))\b)/i;

const outputSchema = z
  .object({
    headline: z.string().trim().min(1).max(180),
    insights: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(80),
            detail: z.string().trim().min(1).max(260),
            severity: z.enum(["info", "attention", "risk"]),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

type DashboardAIInsight = NonNullable<DashboardAIInsightView["insight"]>;

/** This is the complete allowlist for the outbound provider payload. */
export interface DashboardAIInsightInput {
  readonly range: { readonly preset: "30d" };
  readonly totals: {
    readonly events: number;
    readonly totalTokens: number;
    readonly inputTokens: number;
    readonly cachedInputTokens: number;
    readonly outputTokens: number;
    readonly cacheRatePercent: number | null;
    readonly estimatedCostUsd: number | null;
    readonly costQuality: "available" | "partial" | "unavailable";
  };
  readonly topModels: readonly DashboardAIInsightRank[];
  readonly topProjects: readonly DashboardAIInsightRank[];
  readonly topTools: readonly DashboardAIInsightRank[];
  readonly monitoring: {
    readonly running: boolean;
    readonly pendingCount: number;
    readonly collectorHealth: readonly {
      readonly id: "usage" | "skills" | "sessions" | "security";
      readonly state: "idle" | "running" | "healthy" | "degraded" | "failed";
    }[];
  };
  readonly security: {
    readonly available: boolean;
    readonly assessedAssets: number | null;
    readonly failedAssets: number | null;
    readonly suspicious: number | null;
    readonly dangerous: number | null;
  };
  readonly outputs: {
    readonly securityRuns: DashboardAIInsightAvailability;
    readonly distillationOutputs: DashboardAIInsightAvailability;
    readonly dailyReports: DashboardAIInsightAvailability;
  };
}

export interface DashboardAIInsightRank {
  readonly label: string;
  readonly tokens: number;
  readonly events: number;
}

export interface DashboardAIInsightAvailability {
  readonly available: boolean;
  readonly count: number | null;
}

export interface OpenAICompatibleConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
}

interface CacheEntry {
  readonly generatedAt: string;
  readonly expiresAt: number;
  readonly insight: DashboardAIInsight;
}

export interface DashboardAIInsightService {
  /** Read-only; never invokes a provider. Used by the dashboard route loader. */
  readonly read: () => DashboardAIInsightView;
  /** Explicit user action only. This is the sole method that may invoke a provider. */
  readonly refresh: (
    input: DashboardAIInsightInput,
  ) => Promise<DashboardAIInsightView>;
}

export interface DashboardAIInsightServiceOptions {
  /** `undefined` resolves process env; `null` explicitly disables the provider. */
  readonly config?: OpenAICompatibleConfig | null;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly timeoutMs?: number;
}

function validLabel(value: string, fallback: string): string {
  const candidate = value.trim().slice(0, MAX_LABEL_LENGTH);
  if (!candidate || SENSITIVE_CONTENT.test(candidate)) return fallback;
  return candidate;
}

function rank(
  rows: readonly {
    readonly key: string;
    readonly tokens: number;
    readonly events: number;
  }[],
  fallback: string,
): DashboardAIInsightRank[] {
  return rows.slice(0, 3).map((row) => ({
    label: validLabel(row.key, fallback),
    tokens: Math.max(0, Math.round(row.tokens)),
    events: Math.max(0, Math.round(row.events)),
  }));
}

function toAvailability(value: {
  readonly available: boolean;
  readonly count: number | null;
}): DashboardAIInsightAvailability {
  return { available: value.available, count: value.count };
}

/**
 * Builds the provider payload from renderer-safe aggregates. It intentionally
 * accepts no event/session/object carrying raw local context.
 */
export function toDashboardAIInsightInput(input: {
  readonly snapshot: DashboardV2Snapshot;
  readonly monitoring: MonitoringStatus | null;
}): DashboardAIInsightInput {
  const view = createDashboardV2View(input.snapshot, "30d");
  const names = new Map(
    input.snapshot.tools.map((tool) => [tool.id, tool.name]),
  );
  const toolRows = view.tools
    .filter((tool) => tool.events > 0)
    .map((tool) => ({
      key: names.get(tool.id) ?? "tool",
      tokens: tool.tokens,
      events: tool.events,
    }));
  const security = input.monitoring?.security;
  return {
    range: { preset: "30d" },
    totals: {
      events: view.totals.events,
      totalTokens: view.totals.totalTokens,
      inputTokens: view.totals.inputTokens,
      cachedInputTokens: view.totals.cachedInputTokens,
      outputTokens: view.totals.outputTokens,
      cacheRatePercent:
        view.cacheRate == null ? null : Math.round(view.cacheRate * 100) / 100,
      estimatedCostUsd: view.estimatedCostUsd,
      costQuality:
        view.estimatedCostUsd == null
          ? "unavailable"
          : view.estimatedCostIsPartial
            ? "partial"
            : "available",
    },
    topModels: rank(view.models, "model"),
    topProjects: rank(view.projects, "project"),
    topTools: rank(toolRows, "tool"),
    monitoring: {
      running: input.monitoring?.running ?? false,
      pendingCount: input.monitoring?.pendingCount ?? 0,
      collectorHealth: (input.monitoring?.collectors ?? []).map(
        (collector) => ({
          id: collector.id,
          state: collector.state,
        }),
      ),
    },
    security: {
      available: security !== undefined,
      assessedAssets: security?.assessedAssetCount ?? null,
      failedAssets: security?.failedAssetCount ?? null,
      suspicious: security?.suspiciousCount ?? null,
      dangerous: security?.dangerousCount ?? null,
    },
    outputs: {
      securityRuns: toAvailability(
        input.snapshot.outputAvailability.securityRuns,
      ),
      distillationOutputs: toAvailability(
        input.snapshot.outputAvailability.distillationOutputs,
      ),
      dailyReports: toAvailability(
        input.snapshot.outputAvailability.dailyReports,
      ),
    },
  };
}

function containsSensitiveText(value: string): boolean {
  return SENSITIVE_CONTENT.test(value);
}

function parseInsightOutput(value: string): DashboardAIInsight | null {
  if (value.length > 2_000 || containsSensitiveText(value)) return null;
  try {
    const parsed = outputSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return null;
    const insight = parsed.data;
    if (
      containsSensitiveText(insight.headline) ||
      insight.insights.some(
        (item) =>
          containsSensitiveText(item.title) ||
          containsSensitiveText(item.detail),
      )
    )
      return null;
    return insight;
  } catch {
    return null;
  }
}

export function resolveDashboardAIInsightConfig(
  env: NodeJS.ProcessEnv = process.env,
): OpenAICompatibleConfig | undefined {
  const baseUrl = env.TRUSTTOOLS_LLM_BASE_URL?.trim();
  const apiKey = env.TRUSTTOOLS_LLM_API_KEY?.trim();
  const model = env.TRUSTTOOLS_LLM_MODEL?.trim();
  if (!baseUrl || !apiKey || !model) return undefined;
  if (apiKey.length < 8 || /[\r\n]/.test(apiKey)) return undefined;
  if (!/^[A-Za-z0-9._:/-]{1,120}$/.test(model)) return undefined;
  try {
    const url = new URL(baseUrl);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    )
      return undefined;
    return {
      baseUrl: url.toString().replace(/\/$/u, ""),
      apiKey,
      model,
    };
  } catch {
    return undefined;
  }
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
}

function createOpenAICompatibleProvider(
  config: OpenAICompatibleConfig,
  fetchImpl: typeof fetch,
): AIModelProvider {
  return {
    providerId: "openai-compatible",
    async invoke(request: AIProviderRequest): Promise<AIResponse> {
      const response = await fetchImpl(endpoint(config.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: 600,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: request.prompt.template },
            { role: "user", content: request.input.text },
          ],
        }),
        signal: request.signal,
      });
      if (!response.ok) throw new Error("provider-failed");
      const payload: unknown = await response.json();
      const text = readChatCompletionText(payload);
      if (text == null) throw new Error("provider-invalid-response");
      return {
        providerId: "openai-compatible",
        modelId: config.model,
        text,
        finishReason: "stop",
      };
    },
  };
}

function readChatCompletionText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length !== 1) return null;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : null;
}

function cachedView(
  config: OpenAICompatibleConfig,
  entry: CacheEntry | undefined,
  now: number,
): DashboardAIInsightView {
  if (!entry || entry.expiresAt <= now)
    return {
      status: "idle",
      configured: true,
      generatedAt: null,
      model: config.model,
      insight: null,
    };
  return {
    status: "ready",
    configured: true,
    generatedAt: entry.generatedAt,
    model: config.model,
    insight: entry.insight,
  };
}

function notConfiguredView(): DashboardAIInsightView {
  return {
    status: "not-configured",
    configured: false,
    generatedAt: null,
    model: null,
    insight: null,
  };
}

/**
 * In-memory TTL/dedup service. Environment configuration is intentionally
 * evaluated once at server composition time; browser code cannot add a
 * provider or secret and an unconfigured service cannot initiate a request.
 */
export function createDashboardAIInsightService(
  options: DashboardAIInsightServiceOptions = {},
): DashboardAIInsightService {
  const config =
    options.config === undefined
      ? resolveDashboardAIInsightConfig()
      : options.config;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? INSIGHT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? INSIGHT_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? fetch;
  let cache: CacheEntry | undefined;
  let pending: Promise<DashboardAIInsightView> | undefined;
  if (!config) {
    return {
      read: notConfiguredView,
      async refresh() {
        return notConfiguredView();
      },
    };
  }
  const registry = createProviderRegistry([
    createOpenAICompatibleProvider(config, fetchImpl),
  ]);
  const executor = createAiExecutor({ router: createRegistryRouter(registry) });

  return {
    read() {
      return cachedView(config, cache, now());
    },
    refresh(input) {
      if (pending) return pending;
      pending = (async () => {
        // JSON serialization is the final payload audit point. Do not add a
        // generic object here: the interface above is the outbound allowlist.
        const payload = JSON.stringify(input);
        if (containsSensitiveText(payload)) {
          return {
            status: "invalid-output" as const,
            configured: true,
            generatedAt: null,
            model: config.model,
            insight: null,
          };
        }
        const result = await executor.execute({
          requestId: randomUUID(),
          providerId: "openai-compatible",
          modelId: config.model,
          prompt: DASHBOARD_INSIGHT_PROMPT,
          input: { text: payload },
          timeoutMs,
        });
        if (result.summary.status !== "completed" || !result.response?.text) {
          return {
            status: "failed" as const,
            configured: true,
            generatedAt: null,
            model: config.model,
            insight: null,
          };
        }
        const insight = parseInsightOutput(result.response.text);
        if (!insight) {
          return {
            status: "invalid-output" as const,
            configured: true,
            generatedAt: null,
            model: config.model,
            insight: null,
          };
        }
        const generatedAt = new Date(now()).toISOString();
        cache = { generatedAt, expiresAt: now() + ttlMs, insight };
        return cachedView(config, cache, now());
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}

let productionService: DashboardAIInsightService | undefined;

/** Server singleton; request handlers share TTL cache and in-flight dedupe. */
export function getDashboardAIInsightService(): DashboardAIInsightService {
  productionService ??= createDashboardAIInsightService();
  return productionService;
}

/** Useful to force a new environment resolution in isolated server tests only. */
export function resetDashboardAIInsightServiceForTests(): void {
  productionService = undefined;
}
