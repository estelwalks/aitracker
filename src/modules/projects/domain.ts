import type {
  LocalTokenCounts,
  LocalUsageEvent,
} from "../../lib/local-usage/types";
import type { CostEstimate } from "../../lib/pricing";
import type { SessionRecord } from "../../lib/local-sessions/types";
import {
  UNKNOWN_PROJECT_ID,
  type ProjectIdentity,
  type ProjectReferencePlatform,
  type ProjectUsage,
  type ProjectUsageInput,
  type ProjectPricingPort,
} from "./contracts";

const EMPTY_TOKENS: LocalTokenCounts = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

const EMPTY_COST: CostEstimate = {
  knownUsd: 0,
  estimatedUsd: 0,
  cacheSavingsUsd: 0,
  pricedEvents: 0,
  estimatedEvents: 0,
  unknownEvents: 0,
  unknownModels: [],
  complete: true,
};

function canonicalReference(
  value: string,
  platform: ProjectReferencePlatform,
): string {
  let ref = value.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  if (!ref || ref === ".") return "";
  if (platform === "windows") {
    ref = ref.replace(
      /^([A-Z]):/,
      (_, drive: string) => `${drive.toLowerCase()}:`,
    );
    ref = ref.toLowerCase();
  }
  if (ref.length > 1) ref = ref.replace(/\/+$/, "");
  return ref;
}

function basename(ref: string): string {
  const value = ref.split("/").filter(Boolean).at(-1);
  return value || "Unknown project";
}

/** Stable grouping identity. Missing/blank references always share one bucket. */
export function projectIdentity(
  reference: string | null | undefined,
  platform: ProjectReferencePlatform = "posix",
): ProjectIdentity {
  const ref = canonicalReference(reference ?? "", platform);
  if (!ref)
    return {
      id: UNKNOWN_PROJECT_ID,
      displayName: "Unknown project",
      projectRef: null,
      known: false,
    };
  return {
    id: `project:${ref}`,
    displayName: basename(ref),
    projectRef: ref,
    known: true,
  };
}

export function eventProjectIdentity(
  event: LocalUsageEvent,
  platform?: ProjectReferencePlatform,
): ProjectIdentity {
  return projectIdentity(event.project, platform);
}

export function sessionProjectIdentity(
  session: SessionRecord,
  platform?: ProjectReferencePlatform,
): ProjectIdentity {
  return projectIdentity(session.projectRef || session.projectKey, platform);
}

function addTokens(
  left: LocalTokenCounts,
  right: LocalTokenCounts,
): LocalTokenCounts {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    cacheCreationInputTokens:
      left.cacheCreationInputTokens + right.cacheCreationInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningOutputTokens:
      left.reasoningOutputTokens + right.reasoningOutputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function mergeCost(left: CostEstimate, right: CostEstimate): CostEstimate {
  return {
    knownUsd: left.knownUsd + right.knownUsd,
    estimatedUsd: left.estimatedUsd + right.estimatedUsd,
    cacheSavingsUsd: left.cacheSavingsUsd + right.cacheSavingsUsd,
    pricedEvents: left.pricedEvents + right.pricedEvents,
    estimatedEvents: left.estimatedEvents + right.estimatedEvents,
    unknownEvents: left.unknownEvents + right.unknownEvents,
    unknownModels: [
      ...new Set([...left.unknownModels, ...right.unknownModels]),
    ],
    complete: left.complete && right.complete,
  };
}

function sessionCost(session: SessionRecord): CostEstimate {
  const cost = session.cost;
  return {
    knownUsd: cost.knownUsd,
    estimatedUsd: cost.estimatedUsd,
    cacheSavingsUsd: cost.cacheSavingsUsd,
    pricedEvents: cost.pricedEvents,
    estimatedEvents: cost.estimatedEvents,
    unknownEvents: cost.unknownEvents,
    unknownModels: [...cost.unknownModels],
    complete: cost.complete,
  };
}

interface Row {
  identity: ProjectIdentity;
  tokens: LocalTokenCounts;
  cost: CostEstimate;
  eventCount: number;
  sessionCount: number;
}

export function buildProjectUsageReadModel(
  input: ProjectUsageInput,
  pricing: ProjectPricingPort,
  platform: ProjectReferencePlatform = "posix",
): {
  generatedAt: string;
  projects: readonly ProjectUsage[];
  unknownProjectId: typeof UNKNOWN_PROJECT_ID;
} {
  const rows = new Map<string, Row>();
  const ensure = (identity: ProjectIdentity): Row => {
    const existing = rows.get(identity.id);
    if (existing) return existing;
    const created: Row = {
      identity,
      tokens: { ...EMPTY_TOKENS },
      cost: { ...EMPTY_COST, unknownModels: [] },
      eventCount: 0,
      sessionCount: 0,
    };
    rows.set(identity.id, created);
    return created;
  };

  for (const event of input.events ?? []) {
    const row = ensure(eventProjectIdentity(event, platform));
    row.tokens = addTokens(row.tokens, event);
    row.cost = mergeCost(row.cost, pricing.estimateEventCost(event));
    row.eventCount += 1;
  }

  // Session data is a count/read-model dimension. Add its cost only when no
  // usage event for that session exists, preventing the common double count.
  const eventSessionIds = new Set(
    (input.events ?? []).flatMap((event) =>
      event.sessionId ? [event.sessionId] : [],
    ),
  );
  for (const session of input.sessions ?? []) {
    const row = ensure(sessionProjectIdentity(session, platform));
    row.sessionCount += 1;
    if (!eventSessionIds.has(session.sessionId)) {
      row.tokens = addTokens(row.tokens, session.totals);
      row.cost = mergeCost(row.cost, sessionCost(session));
    }
  }

  const projects = [...rows.values()]
    .map((row) => ({
      ...row.identity,
      tokens: row.tokens,
      cost: row.cost,
      eventCount: row.eventCount,
      sessionCount: row.sessionCount,
    }))
    .sort(
      (a, b) =>
        b.tokens.totalTokens - a.tokens.totalTokens ||
        a.displayName.localeCompare(b.displayName) ||
        a.id.localeCompare(b.id),
    );
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    projects,
    unknownProjectId: UNKNOWN_PROJECT_ID,
  };
}
