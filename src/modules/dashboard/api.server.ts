import type {
  DashboardModuleContract,
  DashboardReadModel,
  DashboardUsageEvent,
  DashboardUsageSnapshot,
} from "./contracts";
import { createEmptyUsageSnapshot } from "../../lib/local-usage/presentation.ts";
import { getLocalUsageSnapshot } from "../../lib/local-usage/get-local-usage.ts";
import { getLocalSessions } from "../../lib/local-sessions/server-fns.ts";
import { getLocalSkills } from "../../lib/local-skills/server-fns.ts";
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
import type { DashboardV2Snapshot } from "./contracts.ts";
import { getMonitoringStatus } from "../../app/monitoring-status.server.ts";

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
function aggregateDashboardProjectSessions(
  sessions: readonly {
    projectKey: string;
    source: string;
    startedAt: string;
  }[],
) {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    if (date == null) continue;
    const project = projectKey(session.projectKey);
    const key = `${project}\u0000${session.source}\u0000${date}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [project, source, date] = key.split("\u0000");
      return { project: project!, source: source!, date: date!, count };
    })
    .sort(
      (left, right) =>
        left.project.localeCompare(right.project) ||
        left.source.localeCompare(right.source) ||
        left.date.localeCompare(right.date),
    );
}

function aggregateDashboardSourceSessions(
  sessions: readonly { source: string; startedAt: string }[],
) {
  const counts = new Map<string, number>();
  for (const session of sessions) {
    const date = localDateKey(session.startedAt);
    if (date == null) continue;
    const key = `${session.source}\u0000${date}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [source, date] = key.split("\u0000");
      return { source: source!, date: date!, count };
    })
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.date.localeCompare(right.date),
    );
}

function toDashboardEvent(event: {
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
  context?: DashboardUsageEvent["context"] & { commands?: unknown };
}): DashboardUsageEvent {
  return {
    source: event.source,
    timestamp: event.timestamp,
    model: event.model,
    project: projectKey(event.project),
    inputTokens: event.inputTokens,
    cachedInputTokens: event.cachedInputTokens,
    cacheCreationInputTokens: event.cacheCreationInputTokens,
    outputTokens: event.outputTokens,
    reasoningOutputTokens: event.reasoningOutputTokens,
    totalTokens: event.totalTokens,
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
    byProject: snapshot.byProject.map((row) => ({
      ...row,
      key: projectKey(row.key),
    })),
    daily: snapshot.daily,
    details: snapshot.details.map(toDashboardEvent),
    recent: snapshot.recent.map(toDashboardEvent),
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
}): DashboardV2Snapshot {
  const sourceStatus = new Map(
    input.snapshot.sources.map((source) => [source.source, source]),
  );
  const tools = PUBLIC_TOOL_MANIFEST.tools.map((tool) => {
    const source = sourceStatus.get(tool.id as DashboardUsageEvent["source"]);
    return {
      id: tool.id,
      name: tool.nameZh,
      available: source?.available ?? false,
      detected: source?.detected ?? source?.available ?? false,
    };
  });
  return {
    generatedAt: input.snapshot.generatedAt,
    mode: input.snapshot.mode,
    tools,
    skills: input.skills,
    sessions: input.sessions,
    pricingAvailable: input.pricingAvailable,
    events: input.snapshot.details.map((event) => ({
      source: event.source,
      timestamp: event.timestamp,
      model: event.model,
      project: event.project,
      inputTokens: event.inputTokens,
      cachedInputTokens: event.cachedInputTokens,
      cacheCreationInputTokens: event.cacheCreationInputTokens,
      outputTokens: event.outputTokens,
      reasoningOutputTokens: event.reasoningOutputTokens,
      totalTokens: event.totalTokens,
      context: {
        textResponses: event.context?.textResponse ? 1 : 0,
        toolCalls:
          event.context?.tools?.reduce(
            (total, item) => total + item.calls,
            0,
          ) ?? 0,
        skillCalls:
          event.context?.skills?.reduce(
            (total, item) => total + item.calls,
            0,
          ) ?? 0,
        toolOutputCalls: event.context?.toolOutputs?.calls ?? 0,
      },
    })),
  };
}

export type DashboardApiResponse = DashboardModuleContract;

/** Server-only query adapter. No scanner, pricing rules, or filesystem details cross this boundary. */
export async function loadDashboardReadModel(
  locale: Locale,
): Promise<DashboardReadModel> {
  const usageResult = await Promise.resolve(getLocalUsageSnapshot()).then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason) => ({ status: "rejected" as const, reason }),
  );
  const rawSnapshot =
    usageResult.status === "fulfilled"
      ? usageResult.value
      : createEmptyUsageSnapshot();
  const snapshot = toDashboardSnapshot(rawSnapshot);
  const [skillsResult, pricingResult, sessionsResult, monitoringResult] =
    await Promise.allSettled([
      getLocalSkills(),
      getPricingSnapshot({
        data: [...new Set(snapshot.details.map((event) => event.model))],
      }),
      getLocalSessions({ data: {} }),
      getMonitoringStatus(),
    ]);
  const projectModel = createProjectUsageReadModel(
    { events: snapshot.details },
    { estimateEventCost },
  );
  const insightSnapshot = createInsightsApplication().buildSnapshot({
    usage: {
      observedAt: snapshot.generatedAt,
      events: snapshot.events,
      totalTokens: snapshot.totals.totalTokens,
    },
  });
  const skills =
    skillsResult.status === "fulfilled"
      ? {
          available: true,
          count: skillsResult.value.skills.length,
          generatedAt: skillsResult.value.generatedAt,
        }
      : { available: false, count: 0, generatedAt: null };
  const sessions =
    sessionsResult.status === "fulfilled"
      ? {
          available: true,
          generatedAt: sessionsResult.value.generatedAt,
          byProjectDay: aggregateDashboardProjectSessions(
            sessionsResult.value.sessions,
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
  return createDashboardApplication().read({
    snapshot,
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
    skills,
    sessions,
    monitoring:
      monitoringResult.status === "fulfilled" ? monitoringResult.value : null,
    pricing,
    locale,
    projectCount: projectModel.projects.length,
    activeInsightCount: insightSnapshot.insights.filter(
      (insight) => insight.status === "active",
    ).length,
    v2: toDashboardV2Snapshot({
      snapshot,
      skills,
      sessions,
      pricingAvailable: pricing != null,
    }),
  });
}
