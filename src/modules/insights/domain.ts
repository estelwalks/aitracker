import type { Clock } from "../../platform/persistence/contracts.ts";
import type {
  EvidenceRef,
  Insight,
  InsightFreshness,
  InsightSeverity,
  InsightSnapshot,
  InsightsInput,
  StalePolicy,
} from "./contracts.ts";

const severityWeight: Record<InsightSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function safeRef(value: string): string {
  if (/^[A-Za-z0-9._:-]{1,120}$/.test(value)) return value;
  let hash = 2166136261;
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `opaque-${(hash >>> 0).toString(16)}`;
}

function evidence(
  module: EvidenceRef["module"],
  ref: string,
  observedAt: string,
): EvidenceRef {
  return { module, ref: safeRef(ref), observedAt };
}

function freshness(
  observedAt: string | undefined,
  now: number,
  policy: StalePolicy,
): InsightFreshness {
  if (!observedAt || Number.isNaN(Date.parse(observedAt))) return "unknown";
  return now - Date.parse(observedAt) <= policy.maxAgeMs ? "fresh" : "stale";
}

function makeInsight(
  value: Omit<Insight, "freshness" | "evidence"> & {
    module: EvidenceRef["module"];
    ref: string;
  },
  now: number,
  policy: StalePolicy,
): Insight {
  const { module, ref, ...publicValue } = value;
  return {
    ...publicValue,
    freshness: freshness(publicValue.observedAt, now, policy),
    evidence: [evidence(module, ref, publicValue.observedAt)],
  };
}

function overallFreshness(insights: readonly Insight[]): InsightFreshness {
  if (!insights.length) return "unknown";
  if (insights.some((item) => item.freshness === "stale")) return "stale";
  if (insights.every((item) => item.freshness === "unknown")) return "unknown";
  return "fresh";
}

/** Pure read-model projection; inputs must already be privacy-preserving summaries. */
export function buildInsightSnapshot(
  input: InsightsInput,
  options: {
    readonly clock?: Clock | (() => Date);
    readonly stalePolicy?: StalePolicy;
  } = {},
): InsightSnapshot {
  const clock = options.clock;
  const nowDate =
    typeof clock === "function" ? clock() : (clock?.now() ?? new Date());
  const now = nowDate.getTime();
  const policy = options.stalePolicy ?? { maxAgeMs: 24 * 60 * 60 * 1000 };
  const insights: Insight[] = [];

  if (input.usage) {
    const usage = input.usage;
    if (usage.events > 0) {
      insights.push(
        makeInsight(
          {
            id: "usage.activity",
            code: "usage.activity",
            severity: "info",
            status: "active",
            uncertainty: "none",
            titleKey: "insights.usageActivity",
            messageKey: "insights.usageActivitySummary",
            observedAt: usage.observedAt,
            module: "usage",
            ref: `events-${usage.events}`,
          },
          now,
          policy,
        ),
      );
    }
    if (
      usage.cost === undefined ||
      (usage.cost?.unknownEvents ?? 0) > 0 ||
      usage.cost?.complete === false
    ) {
      insights.push(
        makeInsight(
          {
            id: "usage.cost-uncertain",
            code: "usage.cost-uncertain",
            severity: "medium",
            status: "unknown",
            uncertainty: "high",
            titleKey: "insights.usageCostUncertain",
            messageKey: "insights.usageCostUncertainSummary",
            observedAt: usage.observedAt,
            module: "usage",
            ref: "pricing-coverage",
          },
          now,
          policy,
        ),
      );
    }
    if ((usage.failedSources ?? 0) > 0) {
      insights.push(
        makeInsight(
          {
            id: "usage.sources-failed",
            code: "usage.sources-failed",
            severity: "medium",
            status: "unknown",
            uncertainty: "partial",
            titleKey: "insights.usageSourcesFailed",
            messageKey: "insights.usageSourcesFailedSummary",
            observedAt: usage.observedAt,
            module: "usage",
            ref: "source-health",
          },
          now,
          policy,
        ),
      );
    }
  }

  if (input.security) {
    for (const finding of input.security.findings) {
      if (finding.status === "resolved") continue;
      insights.push(
        makeInsight(
          {
            id: `security.${safeRef(finding.ref)}`,
            code: "security.finding",
            severity: finding.severity,
            status: "active",
            uncertainty: input.security.truncated ? "partial" : "none",
            titleKey: "insights.securityFinding",
            messageKey: "insights.securityFindingSummary",
            observedAt: input.security.observedAt,
            module: "security",
            ref: finding.ref,
          },
          now,
          policy,
        ),
      );
    }
    if (input.security.truncated) {
      insights.push(
        makeInsight(
          {
            id: "security.scan-incomplete",
            code: "security.scan-incomplete",
            severity: "medium",
            status: "unknown",
            uncertainty: "high",
            titleKey: "insights.securityScanIncomplete",
            messageKey: "insights.securityScanIncompleteSummary",
            observedAt: input.security.observedAt,
            module: "security",
            ref: "scan-status",
          },
          now,
          policy,
        ),
      );
    }
  }

  if (input.jobs) {
    for (const run of input.jobs.runs) {
      if (run.status === "failed" || run.status === "abandoned") {
        insights.push(
          makeInsight(
            {
              id: `job.${safeRef(run.ref)}`,
              code: "job.failed",
              severity: "medium",
              status: "active",
              uncertainty: run.uncertainty ? "high" : "partial",
              titleKey: "insights.jobFailed",
              messageKey: "insights.jobFailedSummary",
              observedAt: input.jobs.observedAt,
              module: "tasks",
              ref: run.ref,
            },
            now,
            policy,
          ),
        );
      }
    }
  }

  if (input.knowledge) {
    if (input.knowledge.failed > 0)
      insights.push(
        makeInsight(
          {
            id: "knowledge.failed",
            code: "knowledge.failed",
            severity: "medium",
            status: "unknown",
            uncertainty: "partial",
            titleKey: "insights.knowledgeFailed",
            messageKey: "insights.knowledgeFailedSummary",
            observedAt: input.knowledge.observedAt,
            module: "knowledge",
            ref: "knowledge-status",
          },
          now,
          policy,
        ),
      );
    if (input.knowledge.unsafe > 0)
      insights.push(
        makeInsight(
          {
            id: "knowledge.unsafe",
            code: "knowledge.unsafe",
            severity: "high",
            status: "active",
            uncertainty: "none",
            titleKey: "insights.knowledgeUnsafe",
            messageKey: "insights.knowledgeUnsafeSummary",
            observedAt: input.knowledge.observedAt,
            module: "knowledge",
            ref: "security-verdict",
          },
          now,
          policy,
        ),
      );
  }

  const unique = new Map<string, Insight>();
  for (const item of insights)
    if (!unique.has(item.id)) unique.set(item.id, item);
  const ordered = [...unique.values()].sort(
    (a, b) =>
      severityWeight[b.severity] - severityWeight[a.severity] ||
      a.id.localeCompare(b.id),
  );
  return {
    generatedAt: nowDate.toISOString(),
    freshness: overallFreshness(ordered),
    insights: ordered,
  };
}
