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
import { AI_TOOLS } from "../../lib/tools/catalog.ts";
import { detectToolInstallations } from "../../lib/tools/detection.server.ts";
import { homedir } from "node:os";
import { getDashboardAIInsightService } from "./ai-insight.server.ts";
import {
  classifyDashboardProjectRefs,
  type DashboardProjectClassification,
} from "./project-classification.server.ts";

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
    const projectRef = session.projectRef ?? session.projectKey;
    const classification = classifications.get(projectRef);
    if (
      classification?.kind !== undefined &&
      classification.kind !== "workspace"
    ) {
      continue;
    }
    const project = classification?.label ?? projectKey(projectRef);
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
  if (event.source === "claude-code") {
    return {
      textResponses: true,
      toolCalls: true,
      skillCalls: true,
      toolOutputCalls: false,
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
}): DashboardV2Snapshot {
  const sourceStatus = new Map(
    input.snapshot.sources.map((source) => [source.source, source]),
  );
  const tools = PUBLIC_TOOL_MANIFEST.tools.map((tool) => {
    const source = sourceStatus.get(tool.id as DashboardUsageEvent["source"]);
    return {
      id: tool.id,
      name: tool.name,
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
    outputAvailability: {
      securityRuns: { count: null, available: false },
      distillationOutputs: { count: null, available: false },
      dailyReports: { count: null, available: false },
    },
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
  const [
    skillsResult,
    pricingResult,
    sessionsResult,
    monitoringResult,
    installationsResult,
  ] = await Promise.allSettled([
    getLocalSkills(),
    getPricingSnapshot({
      data: [...new Set(rawSnapshot.details.map((event) => event.model))],
    }),
    getLocalSessions({ data: {} }),
    getMonitoringStatus(),
    // This probes declared installation roots only; it neither reads usage
    // logs nor allows concrete filesystem paths past this server adapter.
    detectToolInstallations(AI_TOOLS, homedir()),
  ]);
  const projectRefs = [
    ...rawSnapshot.details.map((event) => event.project),
    ...(sessionsResult.status === "fulfilled"
      ? sessionsResult.value.sessions.map(
          (session) => session.projectRef ?? session.projectKey,
        )
      : []),
  ];
  const projectClassifications =
    await classifyDashboardProjectRefs(projectRefs);
  const snapshot = toDashboardSnapshot(rawSnapshot, projectClassifications);
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
  });
  // Reading this service is strictly cache-only. No provider call can occur
  // during route loading; the POST insight action is the only refresh path.
  const aiInsight = getDashboardAIInsightService().read();
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
    aiInsight,
    v2,
  });
}
