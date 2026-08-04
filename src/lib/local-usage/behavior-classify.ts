import type {
  LocalUsageCommandDurationBucket,
  LocalUsageEvent,
} from "./types.ts";
import {
  buildContextBreakdown,
  type LocalUsageContextBreakdownRow,
} from "./context-breakdown.ts";

/**
 * 模型级行为意图分布（用于「模型详情」抽屉的行为条）。
 *
 * Clean-room 合规：输入仅为已脱敏的 tool/skill/command 聚合 + token 计数，
 * 不读取任何对话正文。分类纯启发式，基于 buildContextBreakdown 的 categories
 * 行占比与 commands 签名前缀。
 */

export interface ModelBehavior {
  /** 行为标签（中文）。 */
  label: string;
  /** 该行为在事件总量中的 Token 占比（0–1）。 */
  tokenShare: number;
  /** 该行为在事件数量中的占比（0–1）。 */
  eventShare: number;
}

const DEBUG_COMMAND_HINTS = ["diff", "grep", "log", "status", "test", "lint"];

function isDebugCommand(row: LocalUsageContextBreakdownRow): boolean {
  return DEBUG_COMMAND_HINTS.some((hint) => row.key.includes(hint));
}

/**
 * 把一个模型的若干事件归类为行为分布。
 *
 * 优先级判定（按事件逐条）：调试命令 > execution 代码改动 > browser/研究 >
 * agent 子智能体 > planning 规划 > 纯文本问答。每个事件只计入一个主行为，
 * tokenShare/eventShare 按事件权重与 token 量归一化。
 */
export function classifyModelBehaviors(
  events: LocalUsageEvent[],
): ModelBehavior[] {
  if (events.length === 0) return [];

  const buckets = new Map<string, { tokens: number; events: number }>();
  const bump = (label: string, tokens: number) => {
    const bucket = buckets.get(label) ?? { tokens: 0, events: 0 };
    bucket.tokens += tokens;
    bucket.events += 1;
    buckets.set(label, bucket);
  };

  let totalTokens = 0;
  for (const event of events) {
    totalTokens += event.totalTokens;
    const breakdown = buildContextBreakdown([event]);
    const categoryRow = (cat: string) =>
      breakdown.categories.find((row) => row.key === cat);
    const commandRows = breakdown.commands;

    if (commandRows.some(isDebugCommand)) {
      bump("调试", event.totalTokens);
    } else if ((categoryRow("execution")?.totalTokens ?? 0) > 0) {
      bump("代码生成/重构", event.totalTokens);
    } else if ((categoryRow("browser")?.totalTokens ?? 0) > 0) {
      bump("工具调用/研究", event.totalTokens);
    } else if ((categoryRow("agent")?.totalTokens ?? 0) > 0) {
      bump("子智能体", event.totalTokens);
    } else if ((categoryRow("planning")?.totalTokens ?? 0) > 0) {
      bump("规划", event.totalTokens);
    } else {
      bump("对话/问答", event.totalTokens);
    }
  }

  const eventCount = events.length;
  return [...buckets.entries()]
    .map(([label, stat]) => ({
      label,
      tokenShare: totalTokens > 0 ? stat.tokens / totalTokens : 0,
      eventShare: eventCount > 0 ? stat.events / eventCount : 0,
    }))
    .sort((a, b) => b.tokenShare - a.tokenShare);
}

/**
 * 从已采集的命令耗时分桶推算「典型命令耗时」标签。
 *
 * 数据来源是 Codex 的 context.commands[].duration 分桶（under-1s / 1s-10s /
 * 10s-60s / over-60s / unknown）。无 context 的来源返回 null，前端显示「—」。
 * 不引入新的日志解析；仅复用已脱敏聚合。
 */
export function typicalCommandLatency(
  events: LocalUsageEvent[],
): string | null {
  const order: LocalUsageCommandDurationBucket[] = [
    "under-1s",
    "1s-10s",
    "10s-60s",
    "over-60s",
  ];
  const labelOf: Record<string, string> = {
    "under-1s": "< 1s",
    "1s-10s": "1–10s",
    "10s-60s": "10–60s",
    "over-60s": "> 60s",
  };
  const counts = new Map<LocalUsageCommandDurationBucket, number>();
  for (const event of events) {
    for (const command of event.context?.commands ?? []) {
      if (command.calls <= 0) continue;
      counts.set(
        command.duration,
        (counts.get(command.duration) ?? 0) + command.calls,
      );
    }
  }
  let best: LocalUsageCommandDurationBucket | null = null;
  let bestCount = 0;
  for (const bucket of order) {
    const count = counts.get(bucket) ?? 0;
    if (count > bestCount) {
      best = bucket;
      bestCount = count;
    }
  }
  return best == null ? null : (labelOf[best] ?? null);
}
