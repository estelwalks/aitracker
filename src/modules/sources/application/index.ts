import { err, ok, type Result } from "../../../shared/result.ts";
import { RENDERER_SAFE_RUNTIME_POLICY } from "../../../app/runtime-policy.generated.ts";
import type {
  GetSourceHealthRequest,
  SourceHealth,
  SourceHealthInputs,
  SourceHealthRepository,
  SourceHealthSnapshot,
  SourcesApplication,
  SourcesApplicationErrorCode,
} from "../contracts.ts";

/** Keep the Sources badge aligned with the Usage snapshot it primarily shows. */
export const DEFAULT_MAX_AGE_MS =
  RENDERER_SAFE_RUNTIME_POLICY.snapshotPolicies.usage.freshForMinutes * 60_000;

function freshness(
  timestamp: string | undefined,
  now: number,
  maxAgeMs: number,
) {
  if (timestamp == null || !Number.isFinite(Date.parse(timestamp)))
    return "unknown" as const;
  return now - Date.parse(timestamp) <= Math.max(0, maxAgeMs)
    ? ("fresh" as const)
    : ("stale" as const);
}

function issueCode(code: string): `errors.${string}` {
  const normalized = code.replace(/[^a-zA-Z0-9_-]/g, "-");
  return `errors.source-${normalized}`;
}

function mergeHealth(
  sourceId: string,
  inputs: SourceHealthInputs,
  now: number,
  maxAgeMs: number,
): SourceHealth {
  const agent = inputs.agentHealth?.find((item) => item.agentId === sourceId);
  const usage = inputs.usageSnapshot?.sources.find(
    (item) => item.source === sourceId,
  );
  const skill =
    inputs.skillSnapshot?.agents[
      sourceId as keyof typeof inputs.skillSnapshot.agents
    ];
  const usageUpdated = inputs.usageSnapshot?.generatedAt;
  const skillUpdated = inputs.skillSnapshot?.generatedAt;
  const agentUpdated = agent?.observedAt;
  const timestamps = [agentUpdated, usageUpdated, skillUpdated].filter(
    (value): value is string => value != null,
  );
  const lastUpdatedAt = timestamps.sort().at(-1);
  const statuses = [
    agent?.status,
    usage == null
      ? undefined
      : usage.available
        ? usage.diagnostics?.length
          ? "degraded"
          : "healthy"
        : "unavailable",
    skill == null ? undefined : skill.installed ? "healthy" : "unavailable",
  ].filter((value): value is SourceHealth["status"] => value != null);
  const status =
    statuses.length === 0
      ? "unknown"
      : statuses.includes("unavailable")
        ? "unavailable"
        : statuses.includes("degraded")
          ? "degraded"
          : statuses.includes("healthy")
            ? "healthy"
            : "unknown";
  const issues = new Set<`errors.${string}`>();
  if (agent?.issueCode) issues.add(agent.issueCode);
  if (usage && !usage.available) issues.add("errors.source-unavailable");
  for (const diagnostic of usage?.diagnostics ?? [])
    issues.add(issueCode(diagnostic.code));
  if (skill && !skill.installed) issues.add("errors.skill-not-installed");
  const anomalyLines =
    (usage?.malformedLines ?? 0) +
    (usage?.diagnostics?.reduce((sum, item) => sum + item.count, 0) ?? 0);
  return {
    sourceId,
    status,
    freshness: freshness(lastUpdatedAt, now, maxAgeMs),
    anomalyLines,
    ...((agentUpdated ?? usageUpdated)
      ? { lastScannedAt: agentUpdated ?? usageUpdated }
      : {}),
    ...(lastUpdatedAt ? { lastUpdatedAt } : {}),
    issueCodes: [...issues],
  };
}

function project(
  inputs: SourceHealthInputs,
  now: number,
  maxAgeMs: number,
): SourceHealthSnapshot {
  const ids = new Set<string>();
  for (const item of inputs.agentHealth ?? []) ids.add(item.agentId);
  for (const item of inputs.usageSnapshot?.sources ?? []) ids.add(item.source);
  for (const item of Object.keys(inputs.skillSnapshot?.agents ?? {}))
    ids.add(item);
  return {
    generatedAt: new Date(now).toISOString(),
    sources: [...ids]
      .sort()
      .map((sourceId) => mergeHealth(sourceId, inputs, now, maxAgeMs)),
  };
}

export interface CreateSourcesApplicationOptions {
  readonly repository: SourceHealthRepository;
  readonly clock?: () => number;
  readonly defaultMaxAgeMs?: number;
}

export function createSourcesApplication(
  options: CreateSourcesApplicationOptions,
): SourcesApplication {
  const clock = options.clock ?? Date.now;
  const maxAge = options.defaultMaxAgeMs ?? DEFAULT_MAX_AGE_MS;
  return {
    async getSourceHealth(
      request = {},
    ): Promise<Result<SourceHealthSnapshot, SourcesApplicationErrorCode>> {
      try {
        const inputs = await options.repository.read();
        return ok(project(inputs, clock(), request.maxAgeMs ?? maxAge));
      } catch {
        return err("errors.sources.readFailed");
      }
    },
  };
}
