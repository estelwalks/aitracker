/**
 * ReportContextPort backed by the real SessionSnapshot. `collect` aggregates
 * the snapshot's browser-safe session summaries (counts/tokens/cost/edits by
 * source, display-safe project keys) inside the report's covered period —
 * daily covers today, weekly covers the current Mon–Sun week. Everything that
 * crosses into the context is an aggregate, never raw sessions, absolute paths
 * or conversation content (CLEAN_ROOM): project keys are already sanitized by
 * the snapshot, and no session body/commands are ever read.
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
  readonly cost: { readonly knownUsd: number };
  readonly durationMs: number;
}

/** Structural subset of the sessions snapshot runtime the adapter needs. */
export interface ReportSnapshotReader {
  ensureHydrated(): Promise<void>;
  readLatest(): {
    readonly data: { readonly sessions?: readonly SnapshotSession[] } | null;
  };
}

export interface ReportContextAdapterOptions {
  readonly snapshot?: ReportSnapshotReader;
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

function fmtCost(n: number): string {
  return `¥${n.toFixed(2)}`;
}

function fmtDuration(min: number): string {
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
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
    const lines: string[] = [
      `本时段共 ${stats.sessions} 场 AI 协作会话，覆盖 ${projects.length} 个项目，累计对话 ${stats.turns} 轮、代码改动 ${stats.edits} 处，有效协作时长 ${fmtDuration(stats.durationMin)}。Token 消耗 ${fmtTokens(stats.tokens)}，估算成本 ${fmtCost(stats.costUsd)}。`,
    ];
    if (rows.length > 0) {
      lines.push("", "按 Agent 统计：");
      lines.push("| Agent | 会话 | Tokens | 成本 | 改动 | 时长 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const row of rows) {
        lines.push(
          `| ${row.source} | ${row.sessions} | ${fmtTokens(row.tokens)} | ${fmtCost(row.costUsd)} | ${row.edits} | ${fmtDuration(row.durationMin)} |`,
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
      const inRange = sessions.filter((s) => {
        const day = sessionDayKey(s.startedAt);
        return day !== null && day >= range.from && day <= range.to;
      });

      const bySourceMap = new Map<string, SourceRow>();
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
        row.costUsd += session.cost.knownUsd;
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

      const bySource = Array.from(bySourceMap.values()).sort(
        (a, b) => b.sessions - a.sessions,
      );
      const projects = Array.from(projectCount.keys()).slice(0, 6);
      const topProject = Array.from(projectCount.entries()).sort(
        (a, b) => b[1] - a[1],
      )[0]?.[0];

      const stats: ReportStats = {
        periodLabel: range.label,
        sessions: bySource.reduce((a, x) => a + x.sessions, 0),
        turns: bySource.reduce((a, x) => a + x.turns, 0),
        tokens: bySource.reduce((a, x) => a + x.tokens, 0),
        costUsd: bySource.reduce((a, x) => a + x.costUsd, 0),
        edits: bySource.reduce((a, x) => a + x.edits, 0),
        durationMin: bySource.reduce((a, x) => a + x.durationMin, 0),
        bySource,
        projects,
      };

      const summary = buildContextSummary(stats, projects, topProject);
      const observedAt = nowValue.toISOString();
      const evidence: EvidenceRef[] = [
        ...(inRange.length > 0
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
