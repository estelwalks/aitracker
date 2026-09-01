/**
 * Adapts `AIExecutorPort` (from ai-orchestration) to the reports module's
 * `ReportGenerationPort`. Mirrors the distillation adapter's structural-typing
 * approach: we declare a local interface compatible with `AIExecutorPort` so
 * reports does not need to import ai-orchestration's concrete contract (which
 * would tighten a module boundary that the verifier keeps intentionally loose).
 *
 * Status mapping is exhaustive over `AIExecutionStatus`:
 *   completed          → succeeded (daily body is fixed; other bodies use response.text)
 *   offline/fallback   → offline for daily; failed for weekly/monthly, which
 *                        must receive a real model response
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
import { safeReportText, templateForLocale } from "../domain.ts";
import type {
  ReportContext,
  ReportDefinition,
  ReportTemplateKind,
  ReportGenerationPort,
  ReportGenerationResult,
  ReportStats,
} from "../contracts.ts";
import type { Locale } from "../../../lib/i18n/locale";
import { aiSummaryTemplateFor } from "../templates.ts";
import { buildDailyReportDocument } from "./daily-report-document.ts";
import { buildPeriodicReportDocument } from "./periodic-report-document.ts";

/** Structurally compatible with ai-orchestration's `AIExecutorPort`. */
export interface ReportAIExecutor {
  execute(request: AIRequest): Promise<AIExecutionResult>;
}

const REPORT_TIMEOUT_MS = 300_000;
const REPORT_MODEL_ID = "report-generator";

const AI_SUMMARY_HEADING: Readonly<Record<Locale, string>> = {
  "zh-CN": "AI 总结",
  "en-US": "AI summary",
  "ja-JP": "AI 要約",
  "ko-KR": "AI 요약",
};

const FALLBACK_OFFLINE_TEXT =
  "Offline report fallback: no model response was available.";

const OUTPUT_LANGUAGE_INSTRUCTION: Record<Locale, string> = {
  "zh-CN":
    "输出语言要求：全文必须使用简体中文，包括标题、表头、状态、结论和建议。不要混入英文占位文案，专有名词、Agent、模型和项目名称除外。",
  "en-US":
    "Output language requirement: write the entire report in English, including every heading, table label, status, conclusion, and recommendation. Do not leave any Chinese placeholder text; proper nouns, Agent names, model names, and project names may remain unchanged.",
  "ja-JP":
    "出力言語要件：見出し、表の項目、状態、結論、提案を含むレポート全文を日本語で記述してください。中国語のプレースホルダーを残さず、固有名詞、Agent 名、モデル名、プロジェクト名のみ原文のままで構いません。",
  "ko-KR":
    "출력 언어 요구사항: 제목, 표 항목, 상태, 결론 및 제안을 포함한 보고서 전체를 한국어로 작성하세요. 중국어 자리표시자 문구를 남기지 말고 고유명사, Agent 이름, 모델 이름 및 프로젝트 이름만 원문을 유지할 수 있습니다.",
};

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

function fixedReportBody(
  definition: ReportDefinition,
  context: ReportContext,
  locale: Locale,
  templateKind?: ReportTemplateKind,
): string {
  return definition.kind === "daily"
    ? buildDailyReportDocument(context, locale)
    : buildPeriodicReportDocument(
        context,
        templateKind === "monthly" ? "monthly" : "weekly",
        locale,
      );
}

function hasReportUsage(stats: ReportStats): boolean {
  return (
    stats.sessions > 0 ||
    stats.turns > 0 ||
    stats.tokens > 0 ||
    (stats.bySource?.length ?? 0) > 0
  );
}

function normalizeAISummary(value: string): string | null {
  try {
    const summary = safeReportText(value, 2_400)
      .split(/\r?\n/u)
      .filter((line) => !/^\s*(?:#{1,6}\s|```|\|.*\|\s*$)/u.test(line))
      .map((line) => line.replace(/^\s*>\s?/u, ""))
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
    return summary || null;
  } catch {
    return null;
  }
}

function insertAISummary(
  body: string,
  summary: string,
  locale: Locale,
): string {
  const section = `## ${AI_SUMMARY_HEADING[locale]}\n\n${summary}`;
  const firstSection = body.indexOf("\n## ");
  if (firstSection < 0) return `${body}\n\n${section}`;
  return `${body.slice(0, firstSection)}\n\n${section}${body.slice(firstSection)}`;
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

function modelRequiredFailure(): ReportGenerationResult {
  return {
    status: "failed",
    errorCode: "errors.reports.generationFailed",
    retryable: true,
  };
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
 * Deterministic offline report draft built from the real collected context.
 * Every figure comes from the redacted `context` aggregates — never fabricated,
 * never raw sessions or paths. The model path uses the locale-specific prompt;
 * this path keeps the same language selection when no model is available.
 */
export function buildOfflineReportDraft(
  definition: ReportDefinition,
  context: ReportContext,
  locale: Locale = "zh-CN",
): string {
  const period =
    definition.kind === "daily"
      ? { zh: "今日", en: "today", ja: "今日", ko: "오늘" }
      : definition.kind === "weekly"
        ? { zh: "本周", en: "this week", ja: "今週", ko: "이번 주" }
        : { zh: "本月", en: "this month", ja: "今月", ko: "이번 달" };
  const next: Record<Locale, string> =
    definition.kind === "daily"
      ? {
          "zh-CN": "明日",
          "en-US": "tomorrow",
          "ja-JP": "明日",
          "ko-KR": "내일",
        }
      : definition.kind === "weekly"
        ? {
            "zh-CN": "下周",
            "en-US": "next week",
            "ja-JP": "来週",
            "ko-KR": "다음 주",
          }
        : {
            "zh-CN": "下月",
            "en-US": "next month",
            "ja-JP": "来月",
            "ko-KR": "다음 달",
          };
  const headingsByKind: Record<
    ReportTemplateKind,
    Record<Locale, readonly string[]>
  > = {
    daily: {
      "zh-CN": [
        "今日总结",
        "使用概览",
        "今日重点",
        "沉淀与产出",
        "安全情况",
        "明日建议",
      ],
      "en-US": [
        "Today's summary",
        "Usage overview",
        "Key points",
        "Reusable output",
        "Security",
        "Suggestions for tomorrow",
      ],
      "ja-JP": [
        "今日のまとめ",
        "利用概要",
        "今日のポイント",
        "成果と蓄積",
        "セキュリティ状況",
        "明日の提案",
      ],
      "ko-KR": [
        "오늘의 요약",
        "사용 개요",
        "오늘의 주요 내용",
        "축적 및 결과",
        "보안 상황",
        "내일의 제안",
      ],
    },
    weekly: {
      "zh-CN": [
        "本周总结",
        "使用趋势",
        "本周重点发现",
        "沉淀与产出",
        "安全情况",
        "下周建议",
      ],
      "en-US": [
        "This week's summary",
        "Usage trends",
        "Key findings this week",
        "Reusable output",
        "Security",
        "Suggestions for next week",
      ],
      "ja-JP": [
        "今週のまとめ",
        "利用トレンド",
        "今週の主な発見",
        "成果と蓄積",
        "セキュリティ状況",
        "来週の提案",
      ],
      "ko-KR": [
        "이번 주 요약",
        "사용 추세",
        "이번 주 주요 발견",
        "축적 및 결과",
        "보안 상황",
        "다음 주의 제안",
      ],
    },
    monthly: {
      "zh-CN": [
        "本月总结",
        "使用趋势",
        "消耗与效率观察",
        "本月沉淀",
        "安全情况",
        "下月建议",
      ],
      "en-US": [
        "This month's summary",
        "Usage trends",
        "Consumption and efficiency observations",
        "Assets consolidated this month",
        "Security",
        "Suggestions for next month",
      ],
      "ja-JP": [
        "今月のまとめ",
        "利用トレンド",
        "消費と効率の観察",
        "今月の蓄積",
        "セキュリティ状況",
        "来月の提案",
      ],
      "ko-KR": [
        "이번 달 요약",
        "사용 추세",
        "소비 및 효율 관찰",
        "이번 달의 축적",
        "보안 상황",
        "다음 달의 제안",
      ],
    },
  };
  const headings = headingsByKind[definition.kind][locale];
  const stats = context.stats ?? emptyStats(period.zh);
  const hasUsage =
    stats.sessions > 0 ||
    stats.turns > 0 ||
    stats.tokens > 0 ||
    stats.costUsd > 0 ||
    stats.edits > 0 ||
    stats.durationMin > 0 ||
    stats.bySource.some(
      (row) => row.sessions > 0 || row.tokens > 0 || row.costUsd > 0,
    ) ||
    stats.projects.length > 0;
  if (!hasUsage) {
    const empty = {
      "zh-CN": [
        `## ${definition.kind === "daily" ? "今日总结" : definition.kind === "weekly" ? "本周总结" : "本月总结"}`,
        `${period.zh}暂无可用于生成${definition.kind === "daily" ? "日报" : definition.kind === "weekly" ? "周报" : "月报"}的 AI 使用数据。`,
      ],
      "en-US": [
        `## ${definition.kind === "daily" ? "Today's summary" : definition.kind === "weekly" ? "This week's summary" : "This month's summary"}`,
        `There is no AI usage data available for ${period.en}'s report.`,
      ],
      "ja-JP": [
        `## ${definition.kind === "daily" ? "今日のまとめ" : definition.kind === "weekly" ? "今週のまとめ" : "今月のまとめ"}`,
        `${period.ja}のレポートを作成できる AI 利用データはありません。`,
      ],
      "ko-KR": [
        `## ${definition.kind === "daily" ? "오늘의 요약" : definition.kind === "weekly" ? "이번 주 요약" : "이번 달 요약"}`,
        `${period.ko} 보고서를 생성할 수 있는 AI 사용 데이터가 없습니다.`,
      ],
    }[locale];
    return empty.join("\n");
  }
  const top = stats.projects[0];
  const projects = stats.projects.join(locale === "zh-CN" ? "、" : ", ") || "—";
  const hasEdits = stats.edits > 0;
  const editSummary = hasEdits
    ? stats.editsComplete === false
      ? locale === "zh-CN"
        ? `、代码改动数据不完整（已识别 ${stats.edits} 处）`
        : `, ${stats.edits} edits identified; edit data is incomplete`
      : locale === "zh-CN"
        ? `、代码改动 ${stats.edits} 处`
        : `, ${stats.edits} edits`
    : "";
  const tableHeader: Record<Locale, string> = {
    "zh-CN": hasEdits
      ? "| Agent | 会话 | Tokens | 成本 | 改动 | 时长 |"
      : "| Agent | 会话 | Tokens | 成本 | 时长 |",
    "en-US": hasEdits
      ? "| Agent | Sessions | Tokens | Cost | Edits | Duration |"
      : "| Agent | Sessions | Tokens | Cost | Duration |",
    "ja-JP": hasEdits
      ? "| Agent | セッション | Tokens | コスト | 変更 | 時間 |"
      : "| Agent | セッション | Tokens | コスト | 時間 |",
    "ko-KR": hasEdits
      ? "| Agent | 세션 | Tokens | 비용 | 변경 | 시간 |"
      : "| Agent | 세션 | Tokens | 비용 | 시간 |",
  };
  const tableSeparator = hasEdits
    ? "| --- | --- | --- | --- | --- | --- |"
    : "| --- | --- | --- | --- | --- |";
  const table =
    `${tableHeader[locale]}\n` +
    `${tableSeparator}\n` +
    (stats.bySource
      .map((row) => {
        const values = hasEdits
          ? `| ${row.source} | ${row.sessions} | ${fmtTokens(row.tokens)} | ${fmtCostCny(displayCostCny(row))} | ${row.editsComplete === false ? "—" : String(row.edits)} | ${fmtDuration(row.durationMin)} |`
          : `| ${row.source} | ${row.sessions} | ${fmtTokens(row.tokens)} | ${fmtCostCny(displayCostCny(row))} | ${fmtDuration(row.durationMin)} |`;
        return values;
      })
      .join("\n") ||
      (hasEdits
        ? "| — | 0 | 0 | ¥0.00 | 0 | 0m |"
        : "| — | 0 | 0 | ¥0.00 | 0m |"));

  return [
    `## ${headings[0]}`,
    "",
    locale === "zh-CN"
      ? `${stats.periodLabel}，共完成 **${stats.sessions}** 场 AI 协作会话，覆盖 ${stats.projects.length} 个项目（${projects}），累计对话 ${stats.turns} 轮${editSummary}，有效协作时长 ${fmtDuration(stats.durationMin)}。Token 消耗 ${fmtTokens(stats.tokens)}，估算成本 ${fmtCostCny(displayCostCny(stats))}${top ? `。主要精力集中在「${top}」` : ""}。`
      : `${stats.periodLabel}: **${stats.sessions}** AI sessions across ${stats.projects.length} project(s) (${projects}), ${stats.turns} turns${editSummary}, ${fmtDuration(stats.durationMin)} of collaboration, ${fmtTokens(stats.tokens)} tokens, and ${fmtCostCny(displayCostCny(stats))}${top ? `. Main focus: “${top}”.` : "."}`,
    "",
    `## ${headings[1]}`,
    "",
    table,
    "",
    `## ${headings[2]}`,
    "",
    locale === "zh-CN" ? "- 暂无明显发现。" : "- No clear finding.",
    "",
    `## ${headings[3]}`,
    "",
    locale === "zh-CN"
      ? "- 今日暂无明确的沉淀机会。"
      : "- No clear opportunity to consolidate reusable assets.",
    "",
    `## ${headings[4]}`,
    "",
    locale === "zh-CN"
      ? "- 今日暂无安全相关数据。"
      : "- No security-related data is available for this period.",
    "",
    `## ${headings[5]}`,
    "",
    locale === "zh-CN"
      ? "- 暂无特别建议。"
      : `- No particular suggestion for ${next[locale]}.`,
    "",
    locale === "zh-CN"
      ? "> 本报告由 AITracker 根据实际 AI 使用数据自动生成，可编辑后保存。"
      : "> This report was generated by AITracker from the supplied AI usage data and can be edited before saving.",
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
      readonly locale?: Locale;
      readonly templateKind?: ReportTemplateKind;
    }): Promise<ReportGenerationResult> {
      const { definition, context, budgetUsd } = input;
      const locale = input.locale ?? "zh-CN";
      // The renderer always owns the report structure. A configured model may
      // add one bounded summary section, but it never controls tables, labels,
      // ordering or missing-data behaviour.
      if (context.stats) {
        const body = fixedReportBody(
          definition,
          context,
          locale,
          input.templateKind,
        );
        if (!hasReportUsage(context.stats)) {
          return { status: "succeeded", body };
        }

        let modelId = input.modelId;
        if (!modelId) {
          try {
            modelId = (await options.resolveModelId?.()) ?? undefined;
          } catch {
            modelId = undefined;
          }
        }
        if (!modelId || modelId === REPORT_MODEL_ID) {
          return { status: "succeeded", body };
        }

        const templateKind =
          input.templateKind ??
          (definition.kind === "daily" ? "daily" : "weekly");
        const prompt = aiSummaryTemplateFor(templateKind, locale);
        try {
          const aiResult = await options.ai.execute({
            requestId: randomUUID(),
            providerId: "profile",
            modelId,
            prompt: {
              id: prompt.templateId,
              version: prompt.version,
              template: prompt.template,
            },
            input: { text: body },
            budgetUsd,
            timeoutMs: REPORT_TIMEOUT_MS,
          });
          const summary =
            aiResult.summary.status === "completed" &&
            aiResult.response?.providerId !== "offline" &&
            aiResult.response?.text
              ? normalizeAISummary(aiResult.response.text)
              : null;
          return {
            status: "succeeded",
            body: summary ? insertAISummary(body, summary, locale) : body,
          };
        } catch {
          // AI enhancement is optional. A provider failure must not prevent the
          // fixed, data-backed report from being created and exported.
          return { status: "succeeded", body };
        }
      }
      const template = templateForLocale(
        definition,
        locale,
        input.templateKind,
      );
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
          id: template.templateId,
          version: template.version,
          template: `${template.template}\n\n${OUTPUT_LANGUAGE_INSTRUCTION[locale]}`,
        },
        input: { text: context.summary },
        budgetUsd,
        timeoutMs: REPORT_TIMEOUT_MS,
      };
      const result = await options.ai.execute(request);
      return mapResult(result, definition, context, locale);
    },
  };
}

function mapResult(
  result: AIExecutionResult,
  definition: ReportDefinition,
  context: ReportContext,
  locale: Locale,
): ReportGenerationResult {
  const { summary, response } = result;
  if (context.stats) {
    return {
      status: "succeeded",
      body:
        definition.kind === "daily"
          ? buildDailyReportDocument(context, locale)
          : buildPeriodicReportDocument(
              context,
              definition.kind === "weekly" ? "weekly" : "monthly",
              locale,
            ),
    };
  }
  switch (summary.status) {
    case "completed":
      // The offline provider is registered in the composition registry, so a
      // generation without a model profile resolves to it and reports
      // `completed`. Only daily reports may use the localized offline draft;
      // weekly/monthly reports require real model output.
      if (response?.providerId === "offline") {
        if (definition.kind !== "daily") return modelRequiredFailure();
        return offlineResult(
          buildOfflineReportDraft(definition, context, locale),
        );
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
      if (definition.kind !== "daily") return modelRequiredFailure();
      // Deterministic draft from the real collected context — a usable localized
      // report even when no model is configured or the model call failed.
      return offlineResult(
        buildOfflineReportDraft(definition, context, locale),
      );
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
