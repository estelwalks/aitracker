import type {
  DashboardModuleContract,
  DashboardReadModel,
  DashboardUsageEvent,
  DashboardUsageSnapshot,
} from "./contracts";
import { createEmptyUsageSnapshot } from "../../lib/local-usage/presentation.ts";
import { getPricingSnapshot } from "../../lib/pricing/server-fns.ts";
import { catalogs, getMessage } from "../../lib/i18n/messages.ts";
import { brandParams } from "../../lib/app-config.ts";
import { createDashboardApplication } from "./application/index.ts";
import type { Locale } from "../../lib/i18n/locale.ts";
import { createProjectUsageReadModel } from "../projects/index.ts";
import { createInsightsApplication } from "../insights/index.ts";
import { estimateEventCost } from "../../lib/pricing/index.ts";
import type { LocalUsageSnapshot } from "../../lib/local-usage/types.ts";
import { PUBLIC_TOOL_MANIFEST } from "../../lib/tool-registry/public-manifest.generated.ts";
import type {
  DashboardV2OutputAvailability,
  DashboardV2Snapshot,
} from "./contracts.ts";
import type { MonitoringStatus } from "../monitoring/contracts.ts";
import { getMonitoringStatus } from "../../app/monitoring-status.server.ts";
import { getDashboardAIInsightService } from "./ai-insight.server.ts";
import type { DashboardProjectClassification } from "./project-classification.server.ts";

const SESSION_SOURCE_IDS = new Set(["claude-code", "codex", "grok", "dsh"]);
const SESSION_REFRESH_GRACE_MS = 30_000;

/** Refresh a valid snapshot when usage already contains a newly supported
 * session source that the persisted snapshot does not contain. */
export function shouldRefreshDashboardSessions(input: {
  readonly status: "empty" | "fresh" | "stale" | "refreshing" | "failed";
  readonly generatedAt: string | null;
  readonly sessionSources: readonly string[];
  readonly usageSources: readonly string[];
  readonly nowMs?: number;
}): boolean {
  if (input.status === "stale" || input.status === "failed") return true;
  if (input.status === "empty" || input.status === "refreshing") return false;
  const missingSource = input.usageSources.some(
    (source) =>
      SESSION_SOURCE_IDS.has(source) && !input.sessionSources.includes(source),
  );
  if (!missingSource) return false;
  const generatedMs = input.generatedAt ? Date.parse(input.generatedAt) : NaN;
  return (
    !Number.isFinite(generatedMs) ||
    (input.nowMs ?? Date.now()) - generatedMs >= SESSION_REFRESH_GRACE_MS
  );
}

function projectKey(project: string): string {
  const normalized = project.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!normalized || normalized === "~" || normalized === "unknown")
    return normalized || "unknown";
  return normalized.split("/").filter(Boolean).at(-1) ?? "unknown";
}

function localDateKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/**
 * Collapse local sessions before they cross the dashboard boundary. Project
 * rows only need a count by local day; session identifiers, source paths and
 * session metadata never leave this server adapter.
 */
export function aggregateDashboardProjectSessions(
  sessions: readonly {
    projectKey: string;
    projectRef?: string | null;
    source: string;
    startedAt: string;
    turns: number;
    editTurns: number;
    subagentCalls: number;
  }[],
  classifications: ReadonlyMap<
    string,
    DashboardProjectClassification
  > = new Map(),
) {
  const counts = new Map<
    string,
    { count: number; turns: number; editTurns: number; subagentCalls: number }
  >();
  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    if (date == null) continue;
    // Use the same final-segment projection as usage events. Codex session
    // projectKey can be a display fallback while projectRef carries the
    // authoritative cwd; neither raw value crosses this adapter.
    const projectRef = session.projectRef?.trim() || null;
    const directClassification = projectRef
      ? classifications.get(projectRef)
      : undefined;
    // Older persisted session snapshots only contain the safe projectKey.
    // Recover those rows only through a verified workspace label already
    // present in the classification index; never promote an unclassified
    // path or expose the reference itself.
    const classification =
      directClassification ??
      (projectRef == null
        ? [...classifications.values()].find(
            (candidate) =>
              candidate.kind === "workspace" &&
              candidate.label === session.projectKey,
          )
        : undefined);
    if (
      classification?.kind !== undefined &&
      classification.kind !== "workspace"
    ) {
      continue;
    }
    const project =
      classification?.label ?? projectKey(projectRef ?? session.projectKey);
    const key = `${project}\u0000${session.source}\u0000${date}`;
    const current = counts.get(key) ?? {
      count: 0,
      turns: 0,
      editTurns: 0,
      subagentCalls: 0,
    };
    current.count += 1;
    current.turns += session.turns;
    current.editTurns += session.editTurns;
    current.subagentCalls += session.subagentCalls;
    counts.set(key, current);
  }
  return [...counts.entries()]
    .map(([key, aggregate]) => {
      const [project, source, date] = key.split("\u0000");
      return { project: project!, source: source!, date: date!, ...aggregate };
    })
    .sort(
      (left, right) =>
        left.project.localeCompare(right.project) ||
        left.source.localeCompare(right.source) ||
        left.date.localeCompare(right.date),
    );
}

export function aggregateDashboardSourceSessions(
  sessions: readonly {
    source: string;
    startedAt: string;
    turns: number;
    editTurns: number;
    subagentCalls: number;
  }[],
) {
  const counts = new Map<
    string,
    { count: number; turns: number; editTurns: number; subagentCalls: number }
  >();
  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    if (date == null) continue;
    const key = `${session.source}\u0000${date}`;
    const current = counts.get(key) ?? {
      count: 0,
      turns: 0,
      editTurns: 0,
      subagentCalls: 0,
    };
    current.count += 1;
    current.turns += session.turns;
    current.editTurns += session.editTurns;
    current.subagentCalls += session.subagentCalls;
    counts.set(key, current);
  }
  return [...counts.entries()]
    .map(([key, aggregate]) => {
      const [source, date] = key.split("\u0000");
      return { source: source!, date: date!, ...aggregate };
    })
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.date.localeCompare(right.date),
    );
}

function toDashboardEvent(
  event: {
    source: DashboardUsageEvent["source"];
    timestamp: string;
    model: string;
    project: string;
    inputTokens: number;
    cachedInputTokens: number;
    cacheCreationInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    measurement?: DashboardUsageEvent["measurement"];
    context?: DashboardUsageEvent["context"] & { commands?: unknown };
  },
  classifications: ReadonlyMap<string, DashboardProjectClassification>,
): DashboardUsageEvent {
  const classification = classifications.get(event.project);
  return {
    source: event.source,
    timestamp: event.timestamp,
    model: event.model,
    project: classification?.label ?? projectKey(event.project),
    projectKind: classification?.kind ?? "workspace",
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    outputTokens: event.outputTokens,
    reasoningOutputTokens: event.reasoningOutputTokens,
    totalTokens: event.totalTokens,
    ...(event.measurement == null ? {} : { measurement: event.measurement }),
    ...(event.context
      ? {
          context: {
            ...(event.context.textResponse !== undefined
              ? { textResponse: event.context.textResponse }
              : {}),
            ...(event.context.tools ? { tools: event.context.tools } : {}),
            ...(event.context.skills ? { skills: event.context.skills } : {}),
            ...(event.context.toolOutputs
              ? { toolOutputs: event.context.toolOutputs }
              : {}),
          },
        }
      : {}),
  };
}

export function toDashboardSnapshot(
  snapshot: LocalUsageSnapshot,
  classifications: ReadonlyMap<
    string,
    DashboardProjectClassification
  > = new Map(),
): DashboardUsageSnapshot {
  return {
    generatedAt: snapshot.generatedAt,
    mode: snapshot.mode,
    sources: snapshot.sources.map(
      ({
        source,
        available,
        detected,
        filesConsidered,
        filesRead,
        filesReused,
        filesParsed,
        malformedLines,
        events,
      }) => ({
        source,
        available,
        ...(detected === undefined ? {} : { detected }),
        filesConsidered,
        filesRead,
        filesReused,
        filesParsed,
        malformedLines,
        events,
      }),
    ),
    events: snapshot.events,
    totals: snapshot.totals,
    bySource: snapshot.bySource,
    byModel: snapshot.byModel,
    byProject: snapshot.byProject.flatMap((row) => {
      const classification = classifications.get(row.key);
      if (
        classification?.kind !== undefined &&
        classification.kind !== "workspace"
      ) {
        return [];
      }
      return [{ ...row, key: classification?.label ?? projectKey(row.key) }];
    }),
    daily: snapshot.daily,
    details: snapshot.details.map((event) =>
      toDashboardEvent(event, classifications),
    ),
    recent: snapshot.recent.map((event) =>
      toDashboardEvent(event, classifications),
    ),
  };
}

function sourceEvidence(event: DashboardUsageEvent) {
  // Antigravity-style transcript estimates are intentionally model-level only.
  // Their numeric total cannot establish a message, tool, output, skill, or
  // reasoning attribution.
  if (event.measurement === "estimated") {
    return {
      textResponses: false,
      toolCalls: false,
      skillCalls: false,
      toolOutputCalls: false,
      reasoningTokens: false,
      systemPromptTokens: false,
    };
  }
  if (event.source === "claude-code") {
    return {
      textResponses: true,
      toolCalls: true,
      skillCalls: true,
      toolOutputCalls: event.context?.toolOutputs !== undefined,
      reasoningTokens: false,
      systemPromptTokens: false,
    };
  }
  if (event.source === "codex") {
    return {
      textResponses: true,
      toolCalls: true,
      skillCalls: true,
      toolOutputCalls: true,
      reasoningTokens: true,
      systemPromptTokens: false,
    };
  }
  return {
    textResponses: event.context?.textResponse !== undefined,
    toolCalls: event.context?.tools !== undefined,
    skillCalls: event.context?.skills !== undefined,
    toolOutputCalls: event.context?.toolOutputs !== undefined,
    reasoningTokens: event.reasoningOutputTokens > 0,
    systemPromptTokens: false,
  };
}

/**
 * Reduce the scanner result to the V2 browser contract. This is intentionally
 * separate from the compatibility snapshot: V2 has no raw session identifier,
 * command, path, diagnostics or nested context value/name payload.
 */
export function toDashboardV2Snapshot(input: {
  readonly snapshot: DashboardUsageSnapshot;
  readonly skills: import("./contracts.ts").DashboardSkillSummary;
  readonly sessions: import("./contracts.ts").DashboardSessionsSummary;
  readonly pricingAvailable: boolean;
  /** Server-only installation probing is reduced to ids before this DTO. */
  readonly installedToolIds?: ReadonlySet<string>;
  /**
   * Real counts for the three "output" KPI cards. Each metric is either
   * available (with a real count) or honestly unavailable — never a fabricated
   * number.
   */
  readonly outputAvailability: DashboardV2OutputAvailability;
}): DashboardV2Snapshot {
  const sourceStatus = new Map(
    input.snapshot.sources.map((source) => [source.source, source]),
  );
  const tools = PUBLIC_TOOL_MANIFEST.tools.map((tool) => {
    const source = sourceStatus.get(tool.id as DashboardUsageEvent["source"]);
    return {
      id: tool.id,
      name: tool.name,
      ...(tool.icon ? { icon: tool.icon } : {}),
      ...(tool.color ? { color: tool.color } : {}),
      available: source?.available ?? false,
      usageSupport: tool.capabilities.usage,
      // Usage-log roots and installation roots are intentionally separate:
      // `~/.claude` can be present while `.claude/projects` has no recent
      // usage records. Only this aggregate boolean crosses into the browser;
      // no detected path is exposed.
      detected:
        (source?.detected ?? source?.available ?? false) ||
        input.installedToolIds?.has(tool.id) === true,
    };
  });
  return {
    generatedAt: input.snapshot.generatedAt,
    mode: input.snapshot.mode,
    tools,
    skills: input.skills,
    sessions: input.sessions,
    pricingAvailable: input.pricingAvailable,
    outputAvailability: input.outputAvailability,
    events: input.snapshot.details.map((event) => ({
      source: event.source,
      timestamp: event.timestamp,
      model: event.model,
      project: event.project,
      projectKind: event.projectKind,
      inputTokens: event.inputTokens,
      cachedInputTokens: event.cachedInputTokens,
      cacheCreationInputTokens: event.cacheCreationInputTokens,
      outputTokens: event.outputTokens,
      reasoningOutputTokens: event.reasoningOutputTokens,
      totalTokens: event.totalTokens,
      ...(event.measurement == null ? {} : { measurement: event.measurement }),
      context: {
        textResponses: event.context?.textResponse ? 1 : 0,
        toolCalls:
          event.context?.tools?.reduce(
            (total, item) => total + item.calls,
            0,
          ) ?? 0,
        tools:
          event.context?.tools?.map((tool) => ({
            name: tool.name,
            category: tool.category,
            calls: tool.calls,
          })) ?? [],
        skillCalls:
          event.context?.skills?.reduce(
            (total, item) => total + item.calls,
            0,
          ) ?? 0,
        toolOutputCalls: event.context?.toolOutputs?.calls ?? 0,
      },
      evidence: sourceEvidence(event),
    })),
  };
}

export type DashboardApiResponse = DashboardModuleContract;

/**
 * Resolve the three "output" KPI counts from real sources. Security runs come
 * from the monitoring heartbeat's security summary; distillation and daily
 * reports come from the composition root's persisted knowledge/report stores.
 * A metric without a persistent source is honestly unavailable (never a
 * fabricated number).
 */
async function resolveOutputAvailability(
  monitoringValue: MonitoringStatus | undefined,
): Promise<DashboardV2OutputAvailability> {
  const securitySummary = monitoringValue?.security;
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const root = await getCompositionRoot();
  const [distillationCount, distillationBreakdown, reportsCount] =
    await Promise.allSettled([
      root.distillation.count(),
      root.distillation.counts(),
      root.reports.countByKind(),
    ]);
  return {
    securityRuns: {
      count: securitySummary?.assessedAssetCount ?? null,
      available: securitySummary != null,
    },
    distillationOutputs: {
      count:
        distillationCount.status === "fulfilled"
          ? distillationCount.value
          : null,
      available:
        distillationCount.status === "fulfilled" &&
        distillationCount.value != null,
    },
    distillationBreakdown: {
      capability:
        distillationBreakdown.status === "fulfilled"
          ? distillationBreakdown.value.capability
          : null,
      memory:
        distillationBreakdown.status === "fulfilled"
          ? distillationBreakdown.value.memory
          : null,
    },
    dailyReports: {
      count:
        reportsCount.status === "fulfilled" ? reportsCount.value.daily : null,
      available:
        reportsCount.status === "fulfilled" && reportsCount.value.daily != null,
    },
    weeklyReports: {
      count:
        reportsCount.status === "fulfilled" ? reportsCount.value.weekly : null,
      available:
        reportsCount.status === "fulfilled" &&
        reportsCount.value.weekly != null,
    },
    monthlyReports: {
      count:
        reportsCount.status === "fulfilled" ? reportsCount.value.monthly : null,
      available:
        reportsCount.status === "fulfilled" &&
        reportsCount.value.monthly != null,
    },
  };
}

/** Server-only query adapter. No scanner, pricing rules, or filesystem details cross this boundary. */
export async function loadDashboardReadModel(
  locale: Locale,
): Promise<DashboardReadModel> {
  const { snapshot, pricing, skills, sessions, monitoring, v2, error } =
    await buildDashboardV2Snapshot(locale);
  const projectModel = createProjectUsageReadModel(
    {
      events: snapshot.details.filter(
        (event) =>
          event.projectKind !== "quick-conversation" &&
          event.projectKind !== "unknown",
      ),
    },
    { estimateEventCost },
  );
  const insightSnapshot = createInsightsApplication().buildSnapshot({
    usage: {
      observedAt: snapshot.generatedAt,
      events: snapshot.events,
      totalTokens: snapshot.totals.totalTokens,
    },
  });
  // Reading this service is strictly cache-only. No provider call can occur
  // during route loading; the POST insight action is the only refresh path.
  const aiInsight = getDashboardAIInsightService().read();
  return createDashboardApplication().read({
    snapshot,
    error,
    skills,
    sessions,
    monitoring,
    pricing,
    locale,
    projectCount: projectModel.projects.length,
    activeInsightCount: insightSnapshot.insights.filter(
      (insight) => insight.status === "active",
    ).length,
    aiInsight,
    v2,
  });
}

/**
 * Builds the browser-safe V2 snapshot once, sharing the heavy scan between the
 * legacy read model and the compact summary projector (P1-T1-03). No scanner,
 * pricing rules, or filesystem details cross this boundary.
 */
export async function buildDashboardV2Snapshot(locale: Locale): Promise<{
  readonly v2: DashboardV2Snapshot;
  readonly snapshot: import("./contracts.ts").DashboardUsageSnapshot;
  readonly pricing: import("../../lib/pricing/types.ts").PricingSnapshot | null;
  readonly skills: import("./contracts.ts").DashboardSkillSummary;
  readonly sessions: import("./contracts.ts").DashboardSessionsSummary;
  readonly monitoring: MonitoringStatus | null;
  readonly error: string | null;
}> {
  // T7-08: read the unified Usage snapshot (O(1), never scans on the query
  // path). Empty state triggers a NON-BLOCKING background refresh through the
  // unified task runtime (T3-11): the loader returns the shell immediately
  // while the collector runs (design §4.3 and loader rule 4 — an empty
  // snapshot must not stall the first response). The same non-blocking
  // refresh fires when the snapshot is STALE (age > policy freshness): in the
  // web runtime there is no scheduler to refresh it, so the page keeps
  // polling and the next loader round carries fresh data without a manual
  // reload.
  const { getCompositionRoot: getRootForUsage } =
    await import("../../app/composition.server.ts");
  const { usageSnapshot } = await getRootForUsage();
  await usageSnapshot.ensureHydrated();
  let latest = usageSnapshot.readLatest();
  if (latest.data == null) {
    void usageSnapshot.requestRefresh({ reason: "empty" }).catch(() => {});
    latest = usageSnapshot.readLatest();
  } else if (latest.status === "stale") {
    void usageSnapshot.requestRefresh({ reason: "stale" }).catch(() => {});
  }
  const usageResult =
    latest.data != null
      ? { status: "fulfilled" as const, value: latest.data }
      : {
          status: "rejected" as const,
          reason: new Error("empty usage snapshot"),
        };
  const rawSnapshot =
    usageResult.status === "fulfilled"
      ? usageResult.value
      : createEmptyUsageSnapshot();
  const [pricingResult, monitoringResult] = await Promise.allSettled([
    getPricingSnapshot({
      data: [...new Set(rawSnapshot.details.map((event) => event.model))],
    }),
    getMonitoringStatus(),
  ]);

  // T4-00: sessions/skills/installations read the shared domain snapshots
  // (O(1) — no scanner, no wsl.exe, no PATH probing on the query path).
  const { sessionSnapshot, skillSnapshot, installationSnapshot } =
    await getRootForUsage();
  const [initialSessionLatest, skillLatest, installationLatest] =
    await Promise.all([
      sessionSnapshot.ensureHydrated().then(() => sessionSnapshot.readLatest()),
      skillSnapshot.ensureHydrated().then(() => skillSnapshot.readLatest()),
      installationSnapshot
        .ensureHydrated()
        .then(() => installationSnapshot.readLatest()),
    ]);
  let sessionLatest = initialSessionLatest;
  const usageSources = [
    ...new Set(rawSnapshot.details.map((event) => event.source)),
  ];
  const sessionSources = [
    ...new Set(
      sessionLatest.data?.sessions.map((session) => session.source) ?? [],
    ),
  ];
  if (
    shouldRefreshDashboardSessions({
      status: sessionLatest.status,
      generatedAt: sessionLatest.generatedAt,
      sessionSources,
      usageSources,
    })
  ) {
    // Refresh inline when a valid old snapshot predates a session-capable
    // source (notably DSH), so the current dashboard response is correct.
    sessionLatest = await sessionSnapshot.refreshNow();
  }
  // Mirror the sessions-page empty-state (loader rule 4): when no session
  // snapshot exists yet, fire a NON-BLOCKING refresh through the unified task
  // runtime instead of stalling the first dashboard response. The page keeps
  // polling while sessions are unavailable, so real counts appear within the
  // next loader round without a manual reload.
  if (sessionLatest.data == null) {
    void sessionSnapshot.requestRefresh({ reason: "empty" }).catch(() => {});
  } else if (sessionLatest.status === "stale") {
    // Serve last-known-good data without blocking the page, but make sure a
    // scanner/parser/registry upgrade or an expired cache is collected now.
    void sessionSnapshot.requestRefresh({ reason: "stale" }).catch(() => {});
  }
  const hasSessionData = sessionLatest.data != null;
  const sessionSummaries = sessionLatest.data?.sessions ?? [];
  const skillsResult = {
    status: "fulfilled" as const,
    value: {
      skills:
        skillLatest.data?.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          lastUsedAt: skill.lastUsedAt,
          sizeBytes: skill.sizeBytes,
          tokenEstimate: skill.tokenEstimate,
          installations: skill.installations.map((installation) => ({
            agent: installation.agent,
            installedAt: installation.installedAt,
            modifiedAt: installation.modifiedAt,
            version: installation.version,
            source: installation.source,
            updateStatus: installation.updateStatus,
            updateReason: installation.updateReason,
          })),
        })) ?? [],
      generatedAt: skillLatest.data?.generatedAt ?? null,
    },
  };
  const sessionsResult = {
    status: "fulfilled" as const,
    value: {
      sessions: sessionSummaries,
      generatedAt: sessionLatest.generatedAt ?? null,
    },
  };
  const installationsResult = {
    status: "fulfilled" as const,
    value: (installationLatest.data?.facts ?? []).map((fact) => ({
      id: fact.id,
      installed: fact.installed,
      detectedPaths: fact.paths,
    })),
  };
  const projectRefs = [
    ...rawSnapshot.details.map((event) => event.project),
    ...(sessionsResult.status === "fulfilled"
      ? sessionsResult.value.sessions.map(
          (session) => session.projectRef ?? session.projectKey,
        )
      : []),
  ];
  // P3-T3-06: resolve from the persisted classification index (O(1), no
  // filesystem probing on the query path).
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const { classificationService } = await getCompositionRoot();
  const projectClassifications =
    await classificationService.resolve(projectRefs);
  // A usage snapshot can predate the classification index (for example after
  // an app upgrade). Keep this response useful through the safe fallback in
  // `toDashboardSnapshot`, while backfilling only the raw usage refs in the
  // background so later responses can restore verified workspace filtering.
  const missingUsageRefs = [
    ...new Set(
      rawSnapshot.details
        .map((event) => event.project)
        .filter((ref) => !projectClassifications.has(ref)),
    ),
  ];
  if (missingUsageRefs.length > 0) {
    void classificationService
      .classifyIncrementally(missingUsageRefs)
      .catch(() => {});
  }
  const snapshot = toDashboardSnapshot(rawSnapshot, projectClassifications);
  const skills =
    skillsResult.status === "fulfilled"
      ? {
          available: true,
          count: skillsResult.value.skills.length,
          generatedAt: skillsResult.value.generatedAt,
        }
      : { available: false, count: 0, generatedAt: null };
  // `available` means real session data was observed: a missing snapshot (or a
  // failed read) reports unavailable instead of a fabricated zero, so the
  // dashboard can keep polling until the background refresh lands.
  const sessions =
    sessionsResult.status === "fulfilled" && hasSessionData
      ? {
          available: true,
          generatedAt: sessionsResult.value.generatedAt,
          byProjectDay: aggregateDashboardProjectSessions(
            sessionsResult.value.sessions,
            projectClassifications,
          ),
          bySourceDay: aggregateDashboardSourceSessions(
            sessionsResult.value.sessions,
          ),
        }
      : {
          available: false,
          generatedAt: null,
          byProjectDay: [],
          bySourceDay: [],
        };
  const pricing =
    pricingResult.status === "fulfilled" ? pricingResult.value : null;
  const installedToolIds =
    installationsResult.status === "fulfilled"
      ? new Set(
          installationsResult.value
            .filter((installation) => installation.installed)
            .map((installation) => installation.id),
        )
      : undefined;
  const v2 = toDashboardV2Snapshot({
    snapshot,
    skills,
    sessions,
    pricingAvailable: pricing != null,
    installedToolIds,
    outputAvailability: await resolveOutputAvailability(
      monitoringResult.status === "fulfilled"
        ? monitoringResult.value
        : undefined,
    ),
  });
  return {
    v2,
    snapshot,
    pricing,
    skills,
    sessions,
    monitoring:
      monitoringResult.status === "fulfilled" ? monitoringResult.value : null,
    error:
      usageResult.status === "rejected"
        ? usageResult.reason instanceof Error
          ? usageResult.reason.message
          : getMessage(
              catalogs[locale],
              "dashboard.onboarding.localReadFailed",
              brandParams,
            )
        : null,
  };
}
