/**
 * Server-only dashboard AI insight composition.
 *
 * The LLM provider receives a deliberately small, allowlisted aggregate only.
 * It never receives raw events, session data, project paths, prompts, commands,
 * source-log contents, or any browser supplied text. This module owns the
 * provider boundary and returns a browser-safe projection only.
 *
 * Provider configuration comes from the active SQLite model profile (S-500),
 * supporting both OpenAI-compatible and Anthropic protocols. The profile —
 * including its API key, which never crosses the renderer boundary — is
 * resolved through the composition root on every refresh.
 */
import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createAiExecutor,
  createProviderRegistry,
  createRegistryRouter,
  effectiveAuth,
  effectiveEndpoint,
  effectiveModel,
  effectiveProtocol,
  type ProfileProtocol,
} from "../ai-orchestration/index.ts";
import {
  chatHeaders,
  chatUrl,
  parseChatCompletion,
  requestBody,
} from "../ai-orchestration/api.server.ts";
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

// Interaction-level cache for the dashboard AI insight card (POST-only
// refresh path). Not a snapshot freshness/refresh cycle — per the
// runtime-policy governance rule (§3.4 规则 7) local interaction parameters
// stay in their module; Usage freshness lives in
// `runtime-policy.source.json` -> snapshotPolicies.usage.
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
      readonly id: import("../monitoring/contracts.ts").MonitoringCollectorId;
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

/**
 * Resolved runtime configuration for the dashboard AI insight provider. The
 * API key is server-side secret material and never appears in any
 * browser-safe view.
 */
export interface DashboardAIInsightRuntimeConfig {
  readonly protocol: ProfileProtocol;
  readonly auth: "x-api-key" | "bearer";
  readonly endpoint: string;
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Asynchronous profile resolution. Returns `null` when no usable active
 * profile exists (no active profile, missing key, or resolution failure).
 */
export type DashboardAIInsightResolveConfig =
  () => Promise<DashboardAIInsightRuntimeConfig | null>;

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
  /**
   * `undefined` resolves the active model profile from the repository;
   * `null` explicitly disables the provider.
   */
  readonly resolveConfig?: DashboardAIInsightResolveConfig | null;
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

/**
 * Default configuration resolution: reads the active model profile (S-500)
 * from the shared repository. The repository view carries no apiKey, so the
 * key is fetched through the key-bearing `getProfileForExecution` accessor and
 * used only inside this server-only boundary. Any failure (no active profile,
 * missing key, invalid model, repository/import error) yields `null`.
 */
async function resolveActiveProfileConfig(): Promise<DashboardAIInsightRuntimeConfig | null> {
  try {
    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const repository = (await getCompositionRoot()).modelProfiles;
    const active = await repository.getActiveView();
    if (!active) return null;
    const profile = await repository.getProfileForExecution(active.id);
    if (!profile?.apiKey) return null;
    const protocol = effectiveProtocol(profile.mode, profile.protocol);
    const endpoint = effectiveEndpoint(profile);
    const model = effectiveModel(profile);
    if (!endpoint || !model) return null;
    return {
      protocol,
      auth: effectiveAuth(profile),
      endpoint,
      apiKey: profile.apiKey,
      model,
    };
  } catch {
    return null;
  }
}

function createDashboardAIInsightProvider(
  config: DashboardAIInsightRuntimeConfig,
  fetchImpl: typeof fetch,
): AIModelProvider {
  return {
    providerId: "dashboard-insight",
    async invoke(request: AIProviderRequest): Promise<AIResponse> {
      // Request construction, headers and URL are shared with the profile
      // provider so every protocol (OpenAI Responses API, OpenAI Chat
      // Completions, Anthropic Messages API) behaves identically everywhere.
      const response = await fetchImpl(
        chatUrl(config.protocol, config.endpoint),
        {
          method: "POST",
          headers: chatHeaders(config.protocol, config.apiKey, config.auth),
          body: requestBody(
            "custom",
            config.protocol,
            config.model,
            request.prompt.template,
            request.input.text,
            600,
            // The insight card requires structured JSON; only the Chat
            // Completions branch uses these knobs.
            { temperature: 0.2, jsonResponse: true },
          ),
          signal: request.signal,
        },
      );
      if (!response.ok) throw new Error("provider-failed");
      const parsed = parseChatCompletion(
        config.protocol,
        await response.text(),
      );
      // Reasoning-only / empty responses are invalid here: the card needs the
      // actual answer text.
      if (parsed.kind !== "ok") throw new Error("provider-invalid-response");
      return {
        providerId: "dashboard-insight",
        modelId: config.model,
        text: parsed.text,
        finishReason: parsed.finishReason ?? "stop",
      };
    },
  };
}

function cachedView(
  config: DashboardAIInsightRuntimeConfig,
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
 * In-memory TTL/dedup service. The provider configuration is resolved from the
 * active model profile per refresh (server-side only); an unconfigured service
 * cannot initiate a request, and a profile's API key never reaches the browser.
 */
export function createDashboardAIInsightService(
  options: DashboardAIInsightServiceOptions = {},
): DashboardAIInsightService {
  const resolveConfig =
    options.resolveConfig === undefined
      ? resolveActiveProfileConfig
      : options.resolveConfig;
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? INSIGHT_TTL_MS;
  const timeoutMs = options.timeoutMs ?? INSIGHT_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? fetch;
  let cache: CacheEntry | undefined;
  let resolved: DashboardAIInsightRuntimeConfig | undefined;
  let pending: Promise<DashboardAIInsightView> | undefined;

  return {
    read() {
      return resolved
        ? cachedView(resolved, cache, now())
        : notConfiguredView();
    },
    refresh(input) {
      if (pending) return pending;
      pending = (async () => {
        let config: DashboardAIInsightRuntimeConfig | null;
        try {
          config = resolveConfig ? await resolveConfig() : null;
        } catch {
          config = null;
        }
        if (!config) {
          resolved = undefined;
          return notConfiguredView();
        }
        resolved = config;
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
        const registry = createProviderRegistry([
          createDashboardAIInsightProvider(config, fetchImpl),
        ]);
        const executor = createAiExecutor({
          router: createRegistryRouter(registry),
        });
        const result = await executor.execute({
          requestId: randomUUID(),
          providerId: "dashboard-insight",
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

/** Useful to force a fresh profile resolution in isolated server tests only. */
export function resetDashboardAIInsightServiceForTests(): void {
  productionService = undefined;
}
