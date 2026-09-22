/**
 * 真实日志测试辅助（tests/real-data/helpers.ts）
 *
 * 数据源 = 开发机真实 agent 日志（~/.codex、~/.claude、~/.workbuddy、
 * ~/.gemini/antigravity、~/.aipyapp 等），不构造 fixture，不伪造数据。
 * 断言策略：语义不变量（加总一致、非负、排序、隐私契约）+ 观测记录；
 * 不写死会随时间漂移的魔数。真实日志缺失时由各测试文件诚实 skip。
 *
 * 说明：真实数据测试不并入 test:all（CI/他人机器无本机日志），由
 * `npm run test:real-data` 单独运行。
 */
import { existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { scanLocalUsage } from "../../src/lib/local-usage/scanner.server.ts";
import type {
  LocalUsageSnapshot,
  LocalUsageSourceSummary,
} from "../../src/lib/local-usage/types.ts";
import { compactUsageSnapshot } from "../../src/modules/usage/application/aggregate-projection.ts";
import type { UsageSnapshotDto } from "../../src/modules/usage/contracts.ts";
import { BUILTIN_REPORT_DEFINITIONS } from "../../src/modules/reports/domain.ts";
import type { ReportDefinition } from "../../src/modules/reports/contracts.ts";
import type { ReportContext } from "../../src/modules/reports/contracts.ts";
import {
  createReportContextPort,
  type SnapshotSession,
} from "../../src/modules/reports/infrastructure/usage-context-adapter.ts";

export const HOME = homedir();

/**
 * 检测真实日志是否可采集（任一主要数据目录存在且含日志文件即可）。
 * 不做深扫描，只做目录级探测，避免在无日志机器上白跑完整扫描。
 */
export function realLogsPresent(): boolean {
  const probeDirs = [
    join(HOME, ".codex", "sessions"),
    join(HOME, ".claude", "projects"),
    join(HOME, ".workbuddy", "projects"),
    join(HOME, ".gemini", "antigravity-cli"),
    join(HOME, ".aipyapp"),
  ];
  return probeDirs.some((dir) => {
    if (!existsSync(dir)) return false;
    try {
      return readdirSync(dir).length > 0;
    } catch {
      return false;
    }
  });
}

let snapshotPromise: Promise<LocalUsageSnapshot> | null = null;

/**
 * 真实主目录全量扫描（禁用持久缓存，保证结果可复现、无缓存干扰）。
 * 模块级单例：同一测试文件内多次调用只扫一次。
 */
export function realSnapshot(): Promise<LocalUsageSnapshot> {
  snapshotPromise ??= scanLocalUsage({
    homeDirectory: HOME,
    cacheDirectory: join(tmpdir(), "aitracker-real-data-cache"),
    platform: process.platform,
    now: new Date(),
    disablePersistentCache: true,
  });
  return snapshotPromise;
}

/** 真实扫描 → 运行时规范化形态（含 aggregateBuckets/trackerBuckets）。 */
export async function realCompactSnapshot(): Promise<UsageSnapshotDto> {
  return compactUsageSnapshot(await realSnapshot());
}

interface DbSessionRow {
  source_id: string;
  session_id: string;
  title: string;
  project_key: string;
  model_id: string | null;
  started_at_ms: number;
  duration_ms: number;
  turns: number;
  edit_turns: number;
  total_tokens: number;
  input_tokens: number;
  cached_input_tokens: number;
  cache_creation_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  known_microusd: number;
  estimated_microusd: number;
  cache_savings_microusd: number;
}

function rowToSession(row: DbSessionRow): SnapshotSession {
  return {
    sessionId: row.session_id,
    source: row.source_id,
    title: row.title,
    projectKey: row.project_key,
    model: row.model_id ?? null,
    startedAt: new Date(row.started_at_ms).toISOString(),
    turns: row.turns,
    editTurns: row.edit_turns,
    totals: {
      totalTokens: row.total_tokens,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      reasoningOutputTokens: row.reasoning_output_tokens,
      cachedInputTokens: row.cached_input_tokens,
      cacheCreationInputTokens: row.cache_creation_input_tokens,
    },
    cost: {
      knownUsd: row.known_microusd / 1e6,
      estimatedUsd: row.estimated_microusd / 1e6,
      cacheSavingsUsd: row.cache_savings_microusd / 1e6,
    },
    durationMs: row.duration_ms,
  };
}

/**
 * 从应用数据库读取最新快照的真实会话（只读）。数据库不存在或读取失败
 * 时返回空数组（报告链路会降级为仅 usage 维度，测试如实标注）。
 */
export function realSessionRows(): SnapshotSession[] {
  const dbPath = join(HOME, ".aitracker", "data", "aitracker.v1.db");
  if (!existsSync(dbPath)) return [];
  let db: DatabaseSync | null = null;
  try {
    // `immutable=1` keeps SQLite from taking write-side lock/journal paths
    // that are unavailable when the app database is opened by the sandbox.
    // This helper is read-only and tests must never modify the user's DB.
    const dbUri = `${pathToFileURL(dbPath).href}?mode=ro&immutable=1`;
    db = new DatabaseSync(dbUri, { readOnly: true });
    const latest = db
      .prepare(
        "SELECT snapshot_id FROM sessions ORDER BY started_at_ms DESC LIMIT 1",
      )
      .get() as { snapshot_id: string } | undefined;
    if (!latest) return [];
    const rows = db
      .prepare(
        `SELECT source_id, session_id, title, project_key, model_id,
                started_at_ms, duration_ms, turns, edit_turns,
                total_tokens, input_tokens, cached_input_tokens,
                cache_creation_input_tokens, output_tokens,
                reasoning_output_tokens, known_microusd, estimated_microusd,
                cache_savings_microusd
         FROM sessions WHERE snapshot_id = ?`,
      )
      .all(latest.snapshot_id) as unknown as DbSessionRow[];
    return rows.map(rowToSession);
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

/**
 * 最近一个**已完成**且有真实 token 消耗的日期（本地 YYYY-MM-DD），用于稳定选周期。
 * 刻意跳过今天：当天的会话仍在写入，项目归类尚未完成，用它会让
 * "周期内应有项目/会话" 这类断言随运行时刻随机失败。
 */
export async function lastActiveDate(): Promise<string | undefined> {
  const snap = await realSnapshot();
  const today = localKey(new Date());
  for (let i = snap.daily.length - 1; i >= 0; i -= 1) {
    const day = snap.daily[i]!;
    if (day.totalTokens > 0 && day.date !== today) return day.date;
  }
  return undefined;
}

async function toolCallsByDate(): Promise<Map<string, number>> {
  const compact = await realCompactSnapshot();
  const callsByDate = new Map<string, number>();
  for (const bucket of compact.aggregateBuckets ?? []) {
    const calls = bucket.context.tools.reduce(
      (sum, tool) => sum + tool.calls,
      0,
    );
    if (calls > 0) {
      callsByDate.set(bucket.date, (callsByDate.get(bucket.date) ?? 0) + calls);
    }
  }
  return callsByDate;
}

/**
 * 最近一个**已完成**且存在工具调用的日期。真实日志并不保证每个活跃日
 * 都包含工具元数据（例如纯用量记录或尚未完成分类的当天），所以测试工作
 * 画像时必须选择实际具备工具信号的日期，而不是假设最后一个活跃日一定
 * 同时具备工具与会话信息。
 */
export async function lastToolActiveDate(): Promise<string | undefined> {
  const callsByDate = await toolCallsByDate();
  const today = localKey(new Date());
  return [...callsByDate.keys()]
    .filter((date) => date < today)
    .sort()
    .at(-1);
}

/** 最近一个同时具备工具调用和已落库会话的已完成日期。 */
export async function lastWorkProfileDate(): Promise<string | undefined> {
  const callsByDate = await toolCallsByDate();
  const today = localKey(new Date());
  const sessionDates = new Set(
    realSessionRows()
      .map((session) => Date.parse(session.startedAt))
      .filter(Number.isFinite)
      .map((startedAt) => localKey(new Date(startedAt))),
  );
  return [...callsByDate.keys()]
    .filter((date) => date < today && sessionDates.has(date))
    .sort()
    .at(-1);
}

function mondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

const localKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/** 本地日期所在周的周一 / 所在月，用于构造有真实数据的 week/month 周期。 */
function weekKeyOf(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return localKey(mondayOf(new Date(y!, m! - 1, d!, 12)));
}

function monthKeyOf(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/**
 * 基于真实 daily 最后活跃日，选一个有真实数据的 day/week/month 周期。
 * 月报复用 weekly 定义 + month 周期（与 ai-generation-adapter 一致）。
 */
export async function activePeriodsForDate(date: string): Promise<{
  day: {
    definition: ReportDefinition;
    period: { granularity: "day"; key: string };
  };
  week: {
    definition: ReportDefinition;
    period: { granularity: "week"; key: string };
  };
  month: {
    definition: ReportDefinition;
    period: { granularity: "month"; key: string };
  };
}> {
  const dayDef = BUILTIN_REPORT_DEFINITIONS[0]!;
  const weekDef = BUILTIN_REPORT_DEFINITIONS[1]!;
  return {
    day: { definition: dayDef, period: { granularity: "day", key: date } },
    week: {
      definition: weekDef,
      period: { granularity: "week", key: weekKeyOf(date) },
    },
    month: {
      definition: weekDef,
      period: { granularity: "month", key: monthKeyOf(date) },
    },
  };
}

export async function activePeriods(): Promise<
  Awaited<ReturnType<typeof activePeriodsForDate>>
> {
  return activePeriodsForDate((await lastActiveDate()) ?? "1970-01-01");
}

/**
 * 用真实 usage（扫描+compact）+ 真实会话（db）构造 ReportContext。
 * period 可选：不传则由 adapter 回退当前周期；传入则按 key 聚合。
 */
export async function realReportContext(
  definition: ReportDefinition,
  period?: { granularity: "day" | "week" | "month"; key: string },
): Promise<ReportContext> {
  const dto = await realCompactSnapshot();
  const sessions = realSessionRows();
  const port = createReportContextPort({
    snapshot: {
      ensureHydrated: async () => undefined,
      readLatest: () => ({ data: { sessions } }),
    },
    usage: {
      ensureHydrated: async () => undefined,
      readLatest: () => ({ data: dto }),
    },
    now: () => new Date(),
  });
  return port.collect(period ? { definition, period } : { definition });
}

export const dailyDefinition = BUILTIN_REPORT_DEFINITIONS[0]!;
export const weeklyDefinition = BUILTIN_REPORT_DEFINITIONS[1]!;

/** 按源索引扫描摘要，便于矩阵断言。 */
export function sourceByKey(
  snap: LocalUsageSnapshot,
  source: string,
): LocalUsageSourceSummary | undefined {
  return snap.sources.find((s) => s.source === source);
}

export { test };
