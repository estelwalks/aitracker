import type {
  DashboardModuleContract,
  DashboardReadModel,
  DashboardUsageEvent,
  DashboardUsageSnapshot,
} from "./contracts";
import { createEmptyUsageSnapshot } from "../../lib/local-usage/presentation.ts";
import { getLocalUsageSnapshot } from "../../lib/local-usage/get-local-usage.ts";
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

function projectKey(project: string): string {
  const normalized = project.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!normalized || normalized === "~" || normalized === "unknown")
    return normalized || "unknown";
  return normalized.split("/").filter(Boolean).at(-1) ?? "unknown";
}

function toDashboardEvent(event: {
  source: DashboardUsageEvent["source"];
  timestamp: string;
  model: string;
  project: string;
  sessionId?: string;
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
    ...(event.sessionId ? { sessionId: event.sessionId } : {}),
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
  const [skillsResult, pricingResult, sessionsResult] =
    await Promise.allSettled([
      getLocalSkills(),
      getPricingSnapshot({
        data: [...new Set(snapshot.details.map((event) => event.model))],
      }),
      import("../sessions/query/api.server.ts").then(({ getSessionsQuery }) =>
        getSessionsQuery(),
      ),
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
    skills:
      skillsResult.status === "fulfilled"
        ? {
            available: true,
            count: skillsResult.value.skills.length,
            generatedAt: skillsResult.value.generatedAt,
          }
        : { available: false, count: 0, generatedAt: null },
    sessions:
      sessionsResult.status === "fulfilled"
        ? {
            available: true,
            generatedAt: sessionsResult.value.generatedAt,
            records: sessionsResult.value.sessions.map((session) => ({
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              durationMs: session.durationMs,
              turns: session.turns,
              editTurns: session.editTurns,
            })),
          }
        : { available: false, generatedAt: null, records: [] },
    pricing: pricingResult.status === "fulfilled" ? pricingResult.value : null,
    locale,
    projectCount: projectModel.projects.length,
    activeInsightCount: insightSnapshot.insights.filter(
      (insight) => insight.status === "active",
    ).length,
  });
}
