/**
 * Shared "work profile" section for the daily / weekly / monthly report
 * documents.
 *
 * This is the only place where the report states *what the AI actually did*
 * during the period. It relies exclusively on the clean-room signals the
 * pipeline already aggregates — the semantic behavior mix, per-agent tool
 * activity and the covered session topics — and never on conversation
 * content, commands, file paths or tool parameters.
 *
 * Rendering it into the fixed document body (rather than only into the
 * adapter's context summary) is what makes the work visible in the exported
 * report *and* grounds the optional AI summary: the fixed body is verbatim
 * the input handed to the configured model, so the summary can finally
 * describe work instead of restating totals.
 */
import type { ReportBehaviorKey, ReportStats } from "../contracts.ts";

export interface WorkProfileCopy {
  /** Label preceding the behavior distribution, e.g. "行为构成". */
  readonly behaviors: string;
  /** Label preceding the per-agent tool table, e.g. "主要工具行为". */
  readonly tools: string;
  /** Column header for the agent column. */
  readonly agent: string;
  /** Column header for the tool-call column. */
  readonly calls: string;
  /** Label preceding the session topic list. */
  readonly topics: string;
  /** Shown when the period carries no work signal at all. */
  readonly empty: string;
  /** Item separator used inside one line (locale specific). */
  readonly separator: string;
  /** Colon used between a label and its value (locale specific). */
  readonly colon: string;
  /** Localized labels for the locale-neutral behavior keys. */
  readonly behaviorLabels: Readonly<Record<ReportBehaviorKey, string>>;
}

/** Localized behavior labels, shared by every report locale. */
export const WORK_PROFILE_BEHAVIOR_LABELS: Readonly<
  Record<string, Readonly<Record<ReportBehaviorKey, string>>>
> = {
  "zh-CN": {
    debug: "调试",
    execution: "代码生成/重构",
    research: "工具调用/研究",
    planning: "规划",
    subagent: "子智能体",
    skills: "技能",
    qa: "对话/问答",
  },
  "en-US": {
    debug: "Debugging",
    execution: "Code generation/refactor",
    research: "Tool use/research",
    planning: "Planning",
    subagent: "Sub-agents",
    skills: "Skills",
    qa: "Q&A",
  },
  "ja-JP": {
    debug: "デバッグ",
    execution: "コード生成/リファクタリング",
    research: "ツール利用/調査",
    planning: "計画",
    subagent: "サブエージェント",
    skills: "スキル",
    qa: "対話/質疑応答",
  },
  "ko-KR": {
    debug: "디버깅",
    execution: "코드 생성/리팩터링",
    research: "도구 사용/조사",
    planning: "계획",
    subagent: "하위 에이전트",
    skills: "스킬",
    qa: "대화/질의응답",
  },
};

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const MAX_BEHAVIORS = 3;
const MAX_SOURCES = 3;
const MAX_TOOLS_PER_SOURCE = 5;
const MAX_TOPICS = 5;

/**
 * Build the "what was done" section. Returns a single-line placeholder when
 * the period has no tool signal, so an empty day stays honest instead of
 * implying work that never happened.
 */
export function workProfileSection(
  stats: ReportStats,
  copy: WorkProfileCopy,
): string[] {
  const lines: string[] = [];

  const behaviors = (stats.behaviors ?? []).slice(0, MAX_BEHAVIORS);
  if (behaviors.length > 0) {
    const text = behaviors
      .map(
        (row) =>
          `${copy.behaviorLabels[row.key] ?? row.label} ${percent(row.tokenShare)}`,
      )
      .join(copy.separator);
    lines.push(`**${copy.behaviors}**${copy.colon}${text}`);
  }

  const toolRows = (stats.toolUsageBySource ?? []).slice(0, MAX_SOURCES);
  if (toolRows.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `**${copy.tools}**`,
      "",
      `| ${copy.agent} | ${copy.calls} |`,
      "| --- | --- |",
      ...toolRows.map((row) => {
        const tools = row.tools
          .slice(0, MAX_TOOLS_PER_SOURCE)
          .map((tool) => `${cell(tool.name)} ×${tool.calls}`)
          .join(copy.separator);
        return `| **${cell(row.source)}** | ${tools} |`;
      }),
    );
  }

  const topics = (stats.sessionsDetail ?? []).slice(0, MAX_TOPICS);
  if (topics.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `**${copy.topics}**${copy.colon}${topics
        .map((row) => cell(row.title))
        .join(copy.separator)}`,
    );
  }

  return lines.length > 0 ? lines : [copy.empty];
}
