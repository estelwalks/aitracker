import type {
  LocalTokenCounts,
  LocalUsageBreakdown,
  LocalUsageDaily,
  LocalUsageEvent,
  LocalUsageSourceSummary,
  LocalUsageTotals,
} from "../../../lib/local-usage/types.ts";
import type {
  UsageAggregateBucket,
  UsageSnapshotDto,
  UsageTrackerBucket,
} from "../contracts.ts";

const emptyCounts = (): LocalTokenCounts => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
});

const emptyTotals = (): LocalUsageTotals => ({ events: 0, ...emptyCounts() });

function addCounts(target: LocalTokenCounts, value: LocalTokenCounts): void {
  target.inputTokens += value.inputTokens;
  target.cachedInputTokens += value.cachedInputTokens;
  target.cacheCreationInputTokens += value.cacheCreationInputTokens;
  target.outputTokens += value.outputTokens;
  target.reasoningOutputTokens += value.reasoningOutputTokens;
  target.totalTokens += value.totalTokens;
}

function localDateKey(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function evidenceFor(event: LocalUsageEvent): UsageAggregateBucket["evidence"] {
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

function bucketKey(
  date: string,
  event: LocalUsageEvent,
  evidence: UsageAggregateBucket["evidence"],
): string {
  return [
    date,
    event.source,
    event.model || "unknown",
    event.project || "unknown",
    event.measurement ?? "observed",
    Number(evidence.textResponses),
    Number(evidence.toolCalls),
    Number(evidence.skillCalls),
    Number(evidence.toolOutputCalls),
    Number(evidence.reasoningTokens),
    Number(evidence.systemPromptTokens),
  ].join("\0");
}

type MutableTrackerBucket = UsageTrackerBucket & {
  inputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  events: number;
  calls: number;
};

function addTrackerFact(
  buckets: Map<string, MutableTrackerBucket>,
  input: {
    event: LocalUsageEvent;
    date: string;
    dimension: UsageTrackerBucket["dimension"];
    identity: string;
    label: string;
    calls: number;
    share?: number;
  },
): void {
  const share = input.share ?? 1;
  const key = [
    input.dimension,
    input.date,
    input.event.source,
    input.identity,
  ].join("\0");
  const current = buckets.get(key) ?? {
    dimension: input.dimension,
    date: input.date,
    source: input.event.source,
    identity: input.identity,
    label: input.label,
    events: 0,
    calls: 0,
    ...emptyCounts(),
  };
  current.events += 1;
  current.calls += input.calls;
  current.inputTokens += input.event.inputTokens * share;
  current.cachedInputTokens += input.event.cachedInputTokens * share;
  current.cacheCreationInputTokens +=
    input.event.cacheCreationInputTokens * share;
  current.outputTokens += input.event.outputTokens * share;
  current.reasoningOutputTokens += input.event.reasoningOutputTokens * share;
  current.totalTokens += input.event.totalTokens * share;
  buckets.set(key, current);
}

function addTrackerFacts(
  buckets: Map<string, MutableTrackerBucket>,
  event: LocalUsageEvent,
  date: string,
): void {
  addTrackerFact(buckets, {
    event,
    date,
    dimension: "project",
    identity: event.project || "unknown",
    label: event.project || "unknown",
    calls: 0,
  });
  if (event.sessionId?.trim()) {
    addTrackerFact(buckets, {
      event,
      date,
      dimension: "session",
      identity: event.sessionId,
      label: event.sessionId,
      calls: 0,
    });
  }
  const skills = (event.context?.skills ?? []).filter(
    (skill) => skill.calls > 0,
  );
  const totalCalls = skills.reduce((sum, skill) => sum + skill.calls, 0);
  for (const skill of skills) {
    addTrackerFact(buckets, {
      event,
      date,
      dimension: "skill",
      identity: `${event.source}\0${skill.name}`,
      label: skill.name,
      calls: skill.calls,
      share: skill.calls / totalCalls,
    });
  }
}

/** Converts a scanner snapshot into the only shape retained by the runtime. */
export function compactUsageSnapshot(
  snapshot: UsageSnapshotDto,
): UsageSnapshotDto {
  if (
    snapshot.aggregateBuckets !== undefined &&
    snapshot.trackerBuckets !== undefined
  ) {
    return { ...snapshot, details: [], recent: [] };
  }
  type MutableBucket = Omit<UsageAggregateBucket, "context"> & {
    events: number;
    latestTimestamp: string;
    inputTokens: number;
    cachedInputTokens: number;
    cacheCreationInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
    context: {
      textResponses: number;
      toolCalls: number;
      tools: UsageAggregateBucket["context"]["tools"];
      skillCalls: number;
      toolOutputCalls: number;
    };
    toolsByKey: Map<
      string,
      {
        name: string;
        category: UsageAggregateBucket["context"]["tools"][number]["category"];
        calls: number;
      }
    >;
  };
  const buckets = new Map<string, MutableBucket>();
  const trackerBuckets = new Map<string, MutableTrackerBucket>();
  for (const event of snapshot.details) {
    const date = localDateKey(event.timestamp);
    if (date == null) continue;
    addTrackerFacts(trackerBuckets, event, date);
    const evidence = evidenceFor(event);
    const key = bucketKey(date, event, evidence);
    const current = buckets.get(key) ?? {
      date,
      latestTimestamp: event.timestamp,
      source: event.source,
      model: event.model || "unknown",
      project: event.project || "unknown",
      measurement: event.measurement ?? "observed",
      events: 0,
      ...emptyCounts(),
      context: {
        textResponses: 0,
        toolCalls: 0,
        tools: [],
        skillCalls: 0,
        toolOutputCalls: 0,
      },
      evidence,
      toolsByKey: new Map(),
    };
    current.events += 1;
    addCounts(current, event);
    if (event.timestamp > current.latestTimestamp) {
      current.latestTimestamp = event.timestamp;
    }
    current.context.textResponses += event.context?.textResponse ? 1 : 0;
    current.context.toolCalls +=
      event.context?.tools?.reduce((sum, tool) => sum + tool.calls, 0) ?? 0;
    current.context.skillCalls +=
      event.context?.skills?.reduce((sum, skill) => sum + skill.calls, 0) ?? 0;
    current.context.toolOutputCalls += event.context?.toolOutputs?.calls ?? 0;
    for (const tool of event.context?.tools ?? []) {
      const toolKey = `${tool.name}\0${tool.category}`;
      const aggregate = current.toolsByKey.get(toolKey) ?? {
        name: tool.name,
        category: tool.category,
        calls: 0,
      };
      aggregate.calls += tool.calls;
      current.toolsByKey.set(toolKey, aggregate);
    }
    buckets.set(key, current);
  }
  const aggregateBuckets = [...buckets.values()]
    .map(({ toolsByKey, ...bucket }) => ({
      ...bucket,
      context: {
        ...bucket.context,
        tools: [...toolsByKey.values()].sort(
          (left, right) =>
            left.name.localeCompare(right.name) ||
            left.category.localeCompare(right.category),
        ),
      },
    }))
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.source.localeCompare(right.source) ||
        left.model.localeCompare(right.model) ||
        left.project.localeCompare(right.project),
    );
  return {
    ...snapshot,
    aggregateBuckets,
    trackerBuckets: [...trackerBuckets.values()].sort(
      (left, right) =>
        left.dimension.localeCompare(right.dimension) ||
        left.date.localeCompare(right.date) ||
        left.identity.localeCompare(right.identity) ||
        left.source.localeCompare(right.source),
    ),
    details: [],
    recent: [],
  };
}

function addBreakdown(
  map: Map<string, LocalUsageTotals>,
  key: string,
  bucket: UsageAggregateBucket,
): void {
  const totals = map.get(key) ?? emptyTotals();
  totals.events += bucket.events;
  addCounts(totals, bucket);
  map.set(key, totals);
}

function serializeBreakdown(
  map: Map<string, LocalUsageTotals>,
): LocalUsageBreakdown[] {
  return [...map.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort(
      (left, right) =>
        right.totalTokens - left.totalTokens ||
        left.key.localeCompare(right.key),
    );
}

/** Rebuilds the public aggregate contract without materializing raw events. */
export function buildUsageSnapshotFromProjection(input: {
  readonly generatedAt: string;
  readonly sources: LocalUsageSourceSummary[];
  readonly buckets: readonly UsageAggregateBucket[];
  readonly trackerBuckets?: readonly UsageTrackerBucket[];
}): UsageSnapshotDto {
  const totals = emptyTotals();
  const bySource = new Map<string, LocalUsageTotals>();
  const byModel = new Map<string, LocalUsageTotals>();
  const byProject = new Map<string, LocalUsageTotals>();
  const daily = new Map<string, LocalUsageTotals>();
  const dailyBySource = new Map<string, Record<string, LocalTokenCounts>>();
  for (const bucket of input.buckets) {
    totals.events += bucket.events;
    addCounts(totals, bucket);
    addBreakdown(bySource, bucket.source, bucket);
    addBreakdown(byModel, bucket.model, bucket);
    addBreakdown(byProject, bucket.projectRefHash ?? bucket.project, bucket);
    addBreakdown(daily, bucket.date, bucket);
    const sourceRows = dailyBySource.get(bucket.date) ?? {};
    const counts = sourceRows[bucket.source] ?? emptyCounts();
    addCounts(counts, bucket);
    sourceRows[bucket.source] = counts;
    dailyBySource.set(bucket.date, sourceRows);
  }
  const dailyRows: LocalUsageDaily[] = [...daily.entries()]
    .map(([date, day]) => ({
      date,
      ...day,
      bySource: dailyBySource.get(date) ?? {},
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
  return {
    generatedAt: input.generatedAt,
    mode: totals.events > 0 ? "real" : "empty",
    sources: input.sources,
    events: totals.events,
    totals,
    bySource: serializeBreakdown(bySource),
    byModel: serializeBreakdown(byModel),
    byProject: serializeBreakdown(byProject),
    daily: dailyRows,
    details: [],
    recent: [],
    aggregateBuckets: [...input.buckets],
    trackerBuckets: [...(input.trackerBuckets ?? [])],
  };
}
