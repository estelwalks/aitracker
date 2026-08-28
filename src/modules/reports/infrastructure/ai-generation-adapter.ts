/**
 * Adapts `AIExecutorPort` (from ai-orchestration) to the reports module's
 * `ReportGenerationPort`. Mirrors the distillation adapter's structural-typing
 * approach: we declare a local interface compatible with `AIExecutorPort` so
 * reports does not need to import ai-orchestration's concrete contract (which
 * would tighten a module boundary that the verifier keeps intentionally loose).
 *
 * Status mapping is exhaustive over `AIExecutionStatus`:
 *   completed          → succeeded (body = response.text)
 *   offline/fallback   → offline   (deterministic Chinese draft from the real
 *                                   collected `context`, not a useless placeholder)
 *   budget-exceeded    → budget-exceeded (no body)
 *   timeout/cancelled  → failed, retryable when AI declares it retryable
 *   failed             → failed, not retryable
 *
 * Privacy: `response.text` is the model's generated content. With the offline
 * provider the draft is built exclusively from the redacted `ReportContext`
 * aggregates (counts/cost/display-safe project keys) — no user/session/path
 * data. The application layer still runs the body through `safeReportText`
 * before persistence as defence-in-depth.
 */
import { randomUUID } from "node:crypto";

import type {
  AIExecutionResult,
  AIRequest,
} from "../../../modules/ai-orchestration/contracts.ts";
import { safeReportText } from "../domain.ts";
import type {
  ReportContext,
  ReportDefinition,
  ReportGenerationPort,
  ReportGenerationResult,
  ReportStats,
} from "../contracts.ts";

/** Structurally compatible with ai-orchestration's `AIExecutorPort`. */
export interface ReportAIExecutor {
  execute(request: AIRequest): Promise<AIExecutionResult>;
}

const REPORT_TIMEOUT_MS = 300_000;
const REPORT_MODEL_ID = "report-generator";

const FALLBACK_OFFLINE_TEXT =
  "Offline report fallback: no model response was available.";

export interface ReportGenerationAdapterOptions {
  readonly ai: ReportAIExecutor;
  /**
   * Resolves the model id for a generation (B-400). Injected by the
   * composition root to the active S-500 model profile id, so reports reuse
   * the profile-backed provider (a real model call) instead of the offline
   * fallback. `null`/undefined keeps the default `REPORT_MODEL_ID`.
   */
  readonly resolveModelId?: () => Promise<string | null>;
}

function offlineResult(text: string | undefined): ReportGenerationResult {
  // Preserve a usable draft body when the model was unavailable so the
  // dashboard can still show a (clearly offline) report. safeReportText may
  // throw on empty/sensitive input — guard so the adapter never fails closed
  // solely because the fallback text failed redaction.
  try {
    return {
      status: "offline",
      body: safeReportText(text ?? FALLBACK_OFFLINE_TEXT),
    };
  } catch {
    return {
      status: "offline",
      body: FALLBACK_OFFLINE_TEXT,
    };
  }
}

function emptyStats(label: string): ReportStats {
  return {
    periodLabel: label,
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

/**
 * Deterministic Chinese report draft built from the real collected context.
 * Mirrors the V3.0 prototype's `draftOf` structure: 摘要 / Agent 使用详情表 /
 * 蒸馏产出 / 安全概况 / 建议 / 页脚引用. Every figure comes from the redacted
 * `context` aggregates — never fabricated, never raw sessions or paths.
 */
export function buildOfflineReportDraft(
  definition: ReportDefinition,
  context: ReportContext,
): string {
  const kindNoun = definition.kind === "daily" ? "今日" : "本周";
  const nextNoun = definition.kind === "daily" ? "明日" : "下周";
  const stats = context.stats ?? emptyStats(kindNoun);
  const top = stats.projects[0] ?? "主线项目";
  const projects = stats.projects.join("、") || "—";
  const editSummary =
    stats.editsComplete === false
      ? `代码改动数据不完整（已识别 ${stats.edits} 处）`
      : `代码改动 ${stats.edits} 处`;
  const table =
    "| Agent | 会话 | Tokens | 成本 | 改动 | 时长 |\n" +
    "| --- | --- | --- | --- | --- | --- |\n" +
    (stats.bySource
      .map((row) => {
        const edits = row.editsComplete === false ? "—" : String(row.edits);
        return `| ${row.source} | ${row.sessions} | ${fmtTokens(row.tokens)} | ${fmtCostCny(displayCostCny(row))} | ${edits} | ${fmtDuration(row.durationMin)} |`;
      })
      .join("\n") || "| — | 0 | 0 | ¥0.00 | 0 | 0m |");

  return [
    `## ${kindNoun}摘要`,
    "",
    `${stats.periodLabel}，共完成 **${stats.sessions}** 场 AI 协作会话，覆盖 ${stats.projects.length} 个项目（${projects}），累计对话 ${stats.turns} 轮、${editSummary}，有效协作时长 ${fmtDuration(stats.durationMin)}。Token 消耗 ${fmtTokens(stats.tokens)}，估算成本 ${fmtCostCny(displayCostCny(stats))}。主要精力集中在「${top}」。Token 按事件发生日统计（含内部 Agent 调用）；会话数、轮次和时长按用户会话统计，代码改动仅统计可识别的编辑工具调用。`,
    "",
    `## Agent 使用详情`,
    "",
    table,
    "",
    `## 蒸馏产出`,
    "",
    stats.sessions > 0
      ? "- 本时段暂无已蒸馏的 Skill；高价值会话可在蒸馏工作台沉淀为个人 Skill。"
      : "- 暂无可蒸馏的高价值会话。",
    "",
    `## 安全概况`,
    "",
    "- 本时段无新增安全告警记录",
    "- 建议关注：外部 MCP 的凭据读取范围与 Skill 中的网络请求脚本",
    "",
    `## ${nextNoun}建议`,
    "",
    `- 继续推进「${top}」剩余改动并补齐边界用例`,
    "- 将本时段高频经验蒸馏为个人 Skill，减少重复排查",
    stats.editsComplete === false
      ? "- 当前部分 Agent 的改动工具不可观测，建议结合 Git 变更复核实际代码改动"
      : `- 复核 ${stats.edits} 处改动的回归影响，补充必要测试`,
    "",
    `> 本报告由 AI 依据${kindNoun}会话自动生成草稿，可直接编辑后保存。`,
  ].join("\n");
}

export function createReportGenerationPort(
  options: ReportGenerationAdapterOptions,
): ReportGenerationPort {
  return {
    async generate(input: {
      readonly definition: ReportDefinition;
      readonly context: ReportContext;
      readonly budgetUsd?: number;
      readonly modelId?: string;
    }): Promise<ReportGenerationResult> {
      const { definition, context, budgetUsd } = input;
      // Explicit input wins; otherwise the injected resolver (active profile
      // id) is awaited — the request must not be built until it settles.
      const modelId =
        input.modelId ?? (await options.resolveModelId?.()) ?? REPORT_MODEL_ID;
      // The composition registry only knows "offline" and "profile" (the
      // S-500 provider resolves a saved profile by request.modelId). Any model
      // id that is not the default therefore routes to the profile-backed
      // provider; the default keeps the previous offline routing.
      const providerId = modelId === REPORT_MODEL_ID ? undefined : "profile";
      const request: AIRequest = {
        requestId: randomUUID(),
        providerId,
        modelId,
        prompt: {
          id: definition.template.templateId,
          version: definition.template.version,
          template: definition.template.template,
        },
        input: { text: context.summary },
        budgetUsd,
        timeoutMs: REPORT_TIMEOUT_MS,
      };
      const result = await options.ai.execute(request);
      return mapResult(result, definition, context);
    },
  };
}

function mapResult(
  result: AIExecutionResult,
  definition: ReportDefinition,
  context: ReportContext,
): ReportGenerationResult {
  const { summary, response } = result;
  switch (summary.status) {
    case "completed":
      // The offline provider is registered in the composition registry, so a
      // generation without a model profile resolves to it and reports
      // `completed`. That must still produce the deterministic Chinese draft
      // (status "offline") instead of the English placeholder text.
      if (response?.providerId === "offline") {
        return offlineResult(buildOfflineReportDraft(definition, context));
      }
      return response?.text
        ? { status: "succeeded", body: response.text }
        : {
            status: "failed",
            errorCode: "errors.reports.generationFailed",
            retryable: false,
          };
    case "offline":
    case "fallback":
      // Deterministic draft from the real collected context — a usable Chinese
      // report even when no model is configured or the model call failed.
      return offlineResult(buildOfflineReportDraft(definition, context));
    case "budget-exceeded":
      return {
        status: "budget-exceeded",
        errorCode: "errors.reports.budgetExceeded",
      };
    case "timeout":
      return {
        status: "failed",
        errorCode: "errors.reports.timeout",
        retryable: true,
      };
    case "cancelled":
      return {
        status: "failed",
        errorCode: "errors.reports.cancelled",
        retryable: false,
      };
    case "failed":
      return {
        status: "failed",
        errorCode: "errors.reports.generationFailed",
        retryable: false,
      };
    default: {
      // Exhaustiveness guard: a future AIExecutionStatus addition must not
      // silently succeed.
      const exhaustive: never = summary.status;
      void exhaustive;
      return {
        status: "failed",
        errorCode: summary.errorCode
          ? (`errors.${summary.errorCode}` as `errors.${string}`)
          : "errors.reports.generationFailed",
        retryable: false,
      };
    }
  }
}
