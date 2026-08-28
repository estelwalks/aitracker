/**
 * ReportContextPort backed by the real SessionSnapshot and UsageSnapshot.
 * `collect` uses event-date usage aggregates for tokens/source/project
 * attribution and browser-safe session summaries for counts/turns/cost/edits/
 * duration inside the report's covered period — daily covers today, weekly
 * covers the current Mon–Sun week. Everything that crosses into the context
 * is an aggregate, never raw sessions, absolute paths or conversation content
 * (CLEAN_ROOM): project labels are sanitized by the usage snapshot, and no
 * session body/commands are ever read.
 *
 * A missing/empty snapshot degrades to a zero-stats context (honest empty
 * draft) rather than failing closed.
 */
import type {
  EvidenceRef,
  ReportContext,
  ReportContextPort,
  ReportDefinition,
  ReportPeriod,
  ReportStats,
} from "../contracts.ts";
import type { UsageSnapshotDto } from "../../usage/contracts.ts";
import { estimateUsageBucketCost } from "./usage-cost.ts";
import {
  dayKeyOf,
  periodEndDate,
  periodStartDate,
  weekKeyOf,
} from "../period.ts";

/** Minimal session shape the adapter reads (structural, no sessions import). */
export interface SnapshotSession {
  readonly source: string;
  readonly title: string;
  readonly projectKey: string;
  readonly startedAt: string;
  readonly turns: number;
  readonly editTurns: number;
  readonly totals: { readonly totalTokens: number };
  readonly cost: {
    readonly knownUsd: number;
    readonly estimatedUsd?: number;
  };
  readonly durationMs: number;
}

/** Structural subset of the sessions snapshot runtime the adapter needs. */
export interface ReportSnapshotReader {
  ensureHydrated(): Promise<void>;
  readLatest(): {
    readonly data: { readonly sessions?: readonly SnapshotSession[] } | null;
  };
}

/** Structural subset of the usage snapshot runtime used by reports. */
export interface ReportUsageSnapshotReader {
  ensureHydrated(): Promise<void>;
  readLatest(): { readonly data: UsageSnapshotDto | null };
}

export interface ReportContextAdapterOptions {
  readonly snapshot?: ReportSnapshotReader;
  /**
   * Event-based usage is authoritative for Tokens, Agent/source and project
   * attribution. Session snapshot remains authoritative for user-session
   * metrics (sessions, turns, edits and duration).
   */
  readonly usage?: ReportUsageSnapshotReader;
  /** Shared cached USD→CNY rate used by the Reports header. */
  readonly usdToCny?: () => number | Promise<number>;
  readonly now?: () => Date;
}

type SourceRow = {
  source: string;
  sessions: number;
  turns: number;
  tokens: number;
  costUsd: number;
  edits: number;
  durationMin: number;
};

/** Local-time `YYYY-MM-DD` of a session's startedAt (null when unparseable). */
function sessionDayKey(iso: string): string | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : dayKeyOf(date);
}

/**
 * Local-time range the report covers. With an explicit `period` it follows the
 * selected key (day/week/month); otherwise it falls back to the current day for
 * daily and the current Monday–Sunday week for weekly. Local-day keys keep the
 * report figures consistent with the archive's session density (also
 * local-time), so a generated report and the pills/calendar always agree.
 */
function periodRange(
  kind: ReportDefinition["kind"],
  period: ReportPeriod | undefined,
  now: Date,
): { from: string; to: string; label: string } {
  const granularity =
    period?.granularity ?? (kind === "daily" ? "day" : "week");
  const key =
    period?.key ?? (granularity === "day" ? dayKeyOf(now) : weekKeyOf(now));
  const start = periodStartDate(granularity, key);
  const today = dayKeyOf(now);
  if (!start) return { from: today, to: today, label: `今日 ${today}` };
  const end = periodEndDate(granularity, key);
  const from = dayKeyOf(start);
  const to = end ? dayKeyOf(new Date(end.getTime() - 1)) : from;
  const short = (s: string) =>
    `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
  if (granularity === "month") return { from, to, label: key };
  if (granularity === "week")
    return { from, to, label: `${short(from)} – ${short(to)}` };
  return { from, to, label: period ? key : `今日 ${key}` };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCostCny(n: number): string {
  return `¥${n.toFixed(2)}`;
}

function displayCostCny(cost: { costUsd: number; costCny?: number }): number {
  return cost.costCny ?? cost.costUsd;
}

function fmtDuration(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
}

type EventUsageStats = {
  tokens: number;
  costUsd: number;
  bySource: Map<string, number>;
  bySourceCost: Map<string, number>;
  projects: Map<string, number>;
  opaqueEditSources: Set<string>;
  hasEvents: boolean;
};

function emptyEventUsageStats(): EventUsageStats {
  return {
    tokens: 0,
    costUsd: 0,
    bySource: new Map(),
    bySourceCost: new Map(),
    projects: new Map(),
    opaqueEditSources: new Set(),
    hasEvents: false,
  };
}

function hasOpaqueExecutionTool(
  tools: readonly { readonly name: string }[],
): boolean {
  if (!Array.isArray(tools)) return false;
  return tools.some((tool) => {
    const name = tool.name.trim().toLowerCase();
    return name === "exec" || name === "shell" || name === "bash";
  });
}

function usageProjectLabel(
  projectLabel: string | undefined,
  project: string,
): string | null {
  const label = projectLabel?.trim();
  if (label) return label;
  const fallback = project.trim();
  // Persisted usage buckets normally have projectLabel. Do not expose a raw
  // absolute path if an older snapshot lacks that safe display field.
  if (!fallback || fallback.startsWith("/") || fallback.startsWith("~")) {
    return null;
  }
  return fallback;
}

function collectEventUsage(
  data: UsageSnapshotDto,
  range: { from: string; to: string },
): EventUsageStats {
  const result = emptyEventUsageStats();
  for (const daily of data.daily ?? []) {
    if (daily.date < range.from || daily.date > range.to) continue;
    const sourceEntries = Object.entries(daily.bySource ?? {});
    if (sourceEntries.length > 0) {
      for (const [source, counts] of sourceEntries) {
        result.tokens += counts.totalTokens;
        result.bySource.set(
          source,
          (result.bySource.get(source) ?? 0) + counts.totalTokens,
        );
      }
    } else {
      result.tokens += daily.totalTokens;
    }
    result.hasEvents =
      result.hasEvents || daily.events > 0 || daily.totalTokens > 0;
  }

  for (const bucket of data.aggregateBuckets ?? []) {
    if (bucket.date < range.from || bucket.date > range.to) continue;

    // Cost and source attribution do not depend on whether the bucket has a
    // browser-safe project label yet. Fresh in-memory snapshots can still
    // contain only the raw project reference; skipping the whole bucket here
    // made the report body show ¥0.00 while the reports header (which prices
    // the same buckets) showed the real amount.
    const costUsd = estimateUsageBucketCost(bucket);
    result.costUsd += costUsd;
    result.bySourceCost.set(
      bucket.source,
      (result.bySourceCost.get(bucket.source) ?? 0) + costUsd,
    );
    // Modern agent logs can collapse nested file tools into a generic
    // `exec`/shell wrapper. Counting every wrapper as an edit would wildly
    // overstate changes, while reporting zero claims precision we do not have.
    if (hasOpaqueExecutionTool(bucket.context.tools)) {
      result.opaqueEditSources.add(bucket.source);
    }
    result.hasEvents = true;

    const project = usageProjectLabel(bucket.projectLabel, bucket.project);
    if (!project) continue;
    result.projects.set(
      project,
      (result.projects.get(project) ?? 0) + bucket.totalTokens,
    );
  }
  return result;
}

function emptyStats(periodLabel: string): ReportStats {
  return {
    periodLabel,
    sessions: 0,
    turns: 0,
    tokens: 0,
    costUsd: 0,
    edits: 0,
    durationMin: 0,
    bySource: [],
    projects: [],
  };
}

export function createReportContextPort(
  options: ReportContextAdapterOptions = {},
): ReportContextPort {
  const now = options.now ?? (() => new Date());

  async function collectSessions(): Promise<readonly SnapshotSession[]> {
    const snapshot = options.snapshot;
    if (!snapshot) return [];
    try {
      await snapshot.ensureHydrated();
      return snapshot.readLatest().data?.sessions ?? [];
    } catch {
      return [];
    }
  }

  async function collectUsage(): Promise<UsageSnapshotDto | null> {
    const usage = options.usage;
    if (!usage) return null;
    try {
      await usage.ensureHydrated();
      return usage.readLatest().data;
    } catch {
      return null;
    }
  }

  /**
   * Build the redacted text handed to the model. Aggregates only (counts /
   * tokens / cost / edits / display-safe project keys) — no raw sessions,
   * absolute paths or conversation content. Includes a ready Markdown table so
   * the model reproduces the Agent detail table reliably.
   */
  function buildContextSummary(
    stats: ReportStats,
    projects: readonly string[],
    topProject?: string,
  ): string {
    const rows = stats.bySource;
    const editSummary =
      stats.editsComplete === false
        ? `代码改动数据不完整（已识别 ${stats.edits} 处）`
        : `代码改动 ${stats.edits} 处`;
    const lines: string[] = [
      `本时段共 ${stats.sessions} 场 AI 协作会话，覆盖 ${projects.length} 个项目，累计对话 ${stats.turns} 轮、${editSummary}，有效协作时长 ${fmtDuration(stats.durationMin)}。Token 消耗 ${fmtTokens(stats.tokens)}，估算成本 ${fmtCostCny(displayCostCny(stats))}。Token 按事件发生日统计（含内部 Agent 调用）；会话数、轮次和时长按用户会话统计，代码改动仅统计可识别的编辑工具调用。`,
    ];
    if (rows.length > 0) {
      lines.push("", "按 Agent 统计：");
      lines.push("| Agent | 会话 | Tokens | 成本 | 改动 | 时长 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const row of rows) {
        const edits = row.editsComplete === false ? "—" : String(row.edits);
        lines.push(
          `| ${row.source} | ${row.sessions} | ${fmtTokens(row.tokens)} | ${fmtCostCny(displayCostCny(row))} | ${edits} | ${fmtDuration(row.durationMin)} |`,
        );
      }
    } else {
      lines.push("", "本机尚未扫描到会话记录。");
    }
    if (projects.length > 0) lines.push(`\n项目：${projects.join("、")}`);
    if (topProject) lines.push(`主要精力集中在「${topProject}」。`);
    return lines.join("\n");
  }

  return {
    async collect(input: {
      readonly definition: ReportDefinition;
      readonly period?: ReportPeriod;
    }): Promise<ReportContext> {
      const nowValue = now();
      const range = periodRange(input.definition.kind, input.period, nowValue);
      const sessions = await collectSessions();
      const usageData = await collectUsage();
      const eventUsage = usageData
        ? collectEventUsage(usageData, range)
        : emptyEventUsageStats();
      const inRange = sessions.filter((s) => {
        const day = sessionDayKey(s.startedAt);
        return day !== null && day >= range.from && day <= range.to;
      });

      const bySourceMap = new Map<string, SourceRow>();
      const sessionCostBySource = new Map<string, number>();
      const projectCount = new Map<string, number>();
      for (const session of inRange) {
        const source = session.source || "unknown";
        const row = bySourceMap.get(source) ?? {
          source,
          sessions: 0,
          turns: 0,
          tokens: 0,
          costUsd: 0,
          edits: 0,
          durationMin: 0,
        };
        row.sessions += 1;
        row.turns += session.turns;
        row.tokens += session.totals.totalTokens;
        const sessionCostUsd =
          session.cost.knownUsd + (session.cost.estimatedUsd ?? 0);
        row.costUsd += sessionCostUsd;
        sessionCostBySource.set(
          source,
          (sessionCostBySource.get(source) ?? 0) + sessionCostUsd,
        );
        row.edits += session.editTurns;
        row.durationMin += Math.round(session.durationMs / 60_000);
        bySourceMap.set(source, row);
        if (session.projectKey) {
          projectCount.set(
            session.projectKey,
            (projectCount.get(session.projectKey) ?? 0) + 1,
          );
        }
      }

      // Keep session-derived metrics on each row, but replace token totals and
      // add usage-only sources (for example AIPY or internal Codex agents).
      // This makes the report reconcile with the Usage page while preserving
      // the user-facing session count and duration semantics.
      if (usageData) {
        for (const [source, tokens] of eventUsage.bySource) {
          const row = bySourceMap.get(source) ?? {
            source,
            sessions: 0,
            turns: 0,
            tokens: 0,
            costUsd: 0,
            edits: 0,
            durationMin: 0,
          };
          row.tokens = tokens;
          const usageCost = eventUsage.bySourceCost.get(source) ?? 0;
          // Some native usage records expose total tokens without a complete
          // input/output breakdown, or carry a model that cannot be priced.
          // In that case the session snapshot may still contain a usable cost;
          // do not overwrite it with a misleading zero.
          row.costUsd =
            usageCost > 0 ? usageCost : (sessionCostBySource.get(source) ?? 0);
          bySourceMap.set(source, row);
        }
        for (const row of bySourceMap.values()) {
          row.tokens = eventUsage.bySource.get(row.source) ?? 0;
          const usageCost = eventUsage.bySourceCost.get(row.source) ?? 0;
          row.costUsd =
            usageCost > 0
              ? usageCost
              : (sessionCostBySource.get(row.source) ?? 0);
        }
      }

      const allSourceRows = Array.from(bySourceMap.values());
      const bySource = allSourceRows
        // Details describe actual Token usage. Keep session totals separate so
        // a source with a session but no usage event never becomes a phantom
        // Agent row, even when the usage snapshot is unavailable.
        .filter((row) => row.tokens > 0)
        .sort((a, b) => b.tokens - a.tokens || b.sessions - a.sessions);
      const projectRanking =
        usageData && eventUsage.projects.size > 0
          ? eventUsage.projects
          : projectCount;
      const projects = Array.from(projectRanking.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([project]) => project)
        .slice(0, 6);
      const topProject = Array.from(projectRanking.entries()).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];

      let usdToCny = 1;
      try {
        const resolved = await options.usdToCny?.();
        if (
          typeof resolved === "number" &&
          Number.isFinite(resolved) &&
          resolved > 0
        ) {
          usdToCny = resolved;
        }
      } catch {
        // Keep USD accounting intact. A missing rate degrades to the previous
        // numeric display rather than making report generation fail.
      }
      const displayRows = bySource.map((row) => ({
        ...row,
        costCny: row.costUsd * usdToCny,
        editsComplete: !eventUsage.opaqueEditSources.has(row.source),
      }));
      const costUsd = bySource.reduce((a, x) => a + x.costUsd, 0);
      const editsComplete = displayRows.every((row) => row.editsComplete);
      const stats: ReportStats = {
        periodLabel: range.label,
        sessions: allSourceRows.reduce((a, x) => a + x.sessions, 0),
        turns: allSourceRows.reduce((a, x) => a + x.turns, 0),
        tokens: usageData
          ? eventUsage.tokens
          : bySource.reduce((a, x) => a + x.tokens, 0),
        costUsd,
        costCny: costUsd * usdToCny,
        edits: allSourceRows.reduce((a, x) => a + x.edits, 0),
        editsComplete,
        durationMin: allSourceRows.reduce((a, x) => a + x.durationMin, 0),
        bySource: displayRows,
        projects,
      };

      const summary = buildContextSummary(stats, projects, topProject);
      const observedAt = nowValue.toISOString();
      const evidence: EvidenceRef[] = [
        ...(inRange.length > 0 || eventUsage.hasEvents
          ? [
              {
                module: "usage" as const,
                ref: `usage:${range.from}`,
                observedAt,
              },
            ]
          : []),
      ];

      return { evidence, summary, stats };
    },
  };
}
