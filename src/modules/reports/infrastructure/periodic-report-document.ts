import type {
  ReportContext,
  ReportModelStats,
  ReportProjectStats,
  ReportSessionStats,
  ReportStats,
} from "../contracts.ts";
import type { Locale } from "../../../lib/i18n/locale";

const BAR_SIZE = 20;

type PeriodicKind = "weekly" | "monthly";

interface PeriodicCopy {
  readonly title: string;
  readonly period: string;
  readonly previous: string;
  readonly summary: string;
  readonly overview: string;
  readonly trend: string;
  readonly structure: string;
  readonly agents: string;
  readonly projects: string;
  readonly conversations: string;
  readonly models: string;
  readonly sessions: string;
  readonly tokens: string;
  readonly cost: string;
  readonly turns: string;
  readonly duration: string;
  readonly share: string;
  readonly type: string;
  readonly primaryAgent: string;
  readonly status: string;
  readonly normal: string;
  readonly distill: string;
  readonly attention: string;
  readonly stable: string;
  readonly reusable: string;
  readonly reusableText: string;
  readonly actions: string;
  readonly actionText: string;
  readonly project: string;
  readonly conversation: string;
  readonly model: string;
  readonly calls: string;
  readonly noData: string;
  readonly footer: string;
}

const COPY: Record<Locale, Record<PeriodicKind, PeriodicCopy>> = {
  "zh-CN": {
    weekly: {
      title: "AITracker 周报",
      period: "本周",
      previous: "较上周",
      summary: "本周总结",
      overview: "本周概览",
      trend: "使用趋势",
      structure: "项目与对话",
      agents: "Agent 使用",
      projects: "项目",
      conversations: "对话",
      models: "模型使用",
      sessions: "会话",
      tokens: "Tokens",
      cost: "成本",
      turns: "对话轮次",
      duration: "有效时长",
      share: "占比",
      type: "类型",
      primaryAgent: "主要 Agent",
      status: "状态",
      normal: "正常",
      distill: "建议蒸馏",
      attention: "本周关注",
      stable: "本周 AI 使用整体平稳，暂无需要特别关注的事项。",
      reusable: "值得沉淀",
      reusableText:
        "个会话存在重复任务或重复流程特征，可进一步检查是否适合蒸馏。",
      actions: "下周建议",
      actionText:
        "优先回看标记为“建议蒸馏”的会话，确认是否可以固化为 Skill、记忆或工作流。",
      project: "项目",
      conversation: "对话",
      model: "模型",
      calls: "调用",
      noData: "本周暂无 AI 使用记录。",
      footer:
        "Token 可能包含内部 Agent 调用；报告仅根据 AITracker 当前可采集的数据生成。",
    },
    monthly: {
      title: "AITracker 月报",
      period: "本月",
      previous: "较上月",
      summary: "本月总结",
      overview: "本月概览",
      trend: "使用趋势",
      structure: "项目与对话",
      agents: "Agent 使用",
      projects: "项目",
      conversations: "对话",
      models: "模型使用",
      sessions: "会话",
      tokens: "Tokens",
      cost: "成本",
      turns: "对话轮次",
      duration: "有效时长",
      share: "占比",
      type: "类型",
      primaryAgent: "主要 Agent",
      status: "状态",
      normal: "正常",
      distill: "建议蒸馏",
      attention: "本月关注",
      stable: "本月 AI 使用整体平稳，暂无需要特别关注的事项。",
      reusable: "值得沉淀",
      reusableText:
        "个会话存在重复任务或重复流程特征，可进一步检查是否适合蒸馏。",
      actions: "下月建议",
      actionText:
        "优先回看标记为“建议蒸馏”的会话，确认是否可以固化为 Skill、记忆或工作流。",
      project: "项目",
      conversation: "对话",
      model: "模型",
      calls: "调用",
      noData: "本月暂无 AI 使用记录。",
      footer:
        "Token 可能包含内部 Agent 调用；报告仅根据 AITracker 当前可采集的数据生成。",
    },
  },
  "en-US": {
    weekly: {
      title: "AITracker Weekly Report",
      period: "This week",
      previous: "vs. last week",
      summary: "This week's summary",
      overview: "This week's overview",
      trend: "Usage trends",
      structure: "Projects and conversations",
      agents: "Agent usage",
      projects: "Projects",
      conversations: "Conversations",
      models: "Model usage",
      sessions: "Sessions",
      tokens: "Tokens",
      cost: "Cost",
      turns: "Turns",
      duration: "Active duration",
      share: "Share",
      type: "Type",
      primaryAgent: "Primary agent",
      status: "Status",
      normal: "Normal",
      distill: "Distill candidate",
      attention: "This week's highlights",
      stable:
        "AI usage was broadly steady this week; there are no items requiring special attention.",
      reusable: "Reusable opportunities",
      reusableText:
        "sessions show repeated-task or repeated-workflow signals and can be checked for distillation.",
      actions: "Suggestions for next week",
      actionText:
        "Review sessions marked as distill candidates and check whether they can be consolidated into a Skill, memory, or workflow.",
      project: "Project",
      conversation: "Conversation",
      model: "Model",
      calls: "Calls",
      noData: "No AI usage was recorded this week.",
      footer:
        "Tokens may include internal Agent calls; this report is generated from data currently collected by AITracker.",
    },
    monthly: {
      title: "AITracker Monthly Report",
      period: "This month",
      previous: "vs. last month",
      summary: "This month's summary",
      overview: "This month's overview",
      trend: "Usage trends",
      structure: "Projects and conversations",
      agents: "Agent usage",
      projects: "Projects",
      conversations: "Conversations",
      models: "Model usage",
      sessions: "Sessions",
      tokens: "Tokens",
      cost: "Cost",
      turns: "Turns",
      duration: "Active duration",
      share: "Share",
      type: "Type",
      primaryAgent: "Primary agent",
      status: "Status",
      normal: "Normal",
      distill: "Distill candidate",
      attention: "This month's highlights",
      stable:
        "AI usage was broadly steady this month; there are no items requiring special attention.",
      reusable: "Reusable opportunities",
      reusableText:
        "sessions show repeated-task or repeated-workflow signals and can be checked for distillation.",
      actions: "Suggestions for next month",
      actionText:
        "Review sessions marked as distill candidates and check whether they can be consolidated into a Skill, memory, or workflow.",
      project: "Project",
      conversation: "Conversation",
      model: "Model",
      calls: "Calls",
      noData: "No AI usage was recorded this month.",
      footer:
        "Tokens may include internal Agent calls; this report is generated from data currently collected by AITracker.",
    },
  },
  "ja-JP": {
    weekly: {
      title: "AITracker 週報",
      period: "今週",
      previous: "前週比",
      summary: "今週のまとめ",
      overview: "今週の概要",
      trend: "利用トレンド",
      structure: "プロジェクトと会話",
      agents: "Agent 使用状況",
      projects: "プロジェクト",
      conversations: "会話",
      models: "モデル使用状況",
      sessions: "セッション",
      tokens: "Tokens",
      cost: "コスト",
      turns: "ターン",
      duration: "アクティブ時間",
      share: "割合",
      type: "種類",
      primaryAgent: "主な Agent",
      status: "状態",
      normal: "通常",
      distill: "蒸留候補",
      attention: "今週のポイント",
      stable:
        "今週の AI 利用は概ね安定しており、特に注目すべき項目はありません。",
      reusable: "蓄積の候補",
      reusableText:
        "件のセッションに繰り返し作業やフローの兆候があります。蒸留の対象になるか確認できます。",
      actions: "来週の提案",
      actionText:
        "蒸留候補のセッションを確認し、Skill、メモリ、ワークフローとして整理できるか確認してください。",
      project: "プロジェクト",
      conversation: "会話",
      model: "モデル",
      calls: "呼び出し",
      noData: "今週の AI 利用記録はありません。",
      footer:
        "Token には内部 Agent の呼び出しが含まれる場合があります。レポートは AITracker が現在収集できるデータに基づきます。",
    },
    monthly: {
      title: "AITracker 月報",
      period: "今月",
      previous: "前月比",
      summary: "今月のまとめ",
      overview: "今月の概要",
      trend: "利用トレンド",
      structure: "プロジェクトと会話",
      agents: "Agent 使用状況",
      projects: "プロジェクト",
      conversations: "会話",
      models: "モデル使用状況",
      sessions: "セッション",
      tokens: "Tokens",
      cost: "コスト",
      turns: "ターン",
      duration: "アクティブ時間",
      share: "割合",
      type: "種類",
      primaryAgent: "主な Agent",
      status: "状態",
      normal: "通常",
      distill: "蒸留候補",
      attention: "今月のポイント",
      stable:
        "今月の AI 利用は概ね安定しており、特に注目すべき項目はありません。",
      reusable: "蓄積の候補",
      reusableText:
        "件のセッションに繰り返し作業やフローの兆候があります。蒸留の対象になるか確認できます。",
      actions: "来月の提案",
      actionText:
        "蒸留候補のセッションを確認し、Skill、メモリ、ワークフローとして整理できるか確認してください。",
      project: "プロジェクト",
      conversation: "会話",
      model: "モデル",
      calls: "呼び出し",
      noData: "今月の AI 利用記録はありません。",
      footer:
        "Token には内部 Agent の呼び出しが含まれる場合があります。レポートは AITracker が現在収集できるデータに基づきます。",
    },
  },
  "ko-KR": {
    weekly: {
      title: "AITracker 주간 보고서",
      period: "이번 주",
      previous: "전주 대비",
      summary: "이번 주 요약",
      overview: "이번 주 개요",
      trend: "사용 추세",
      structure: "프로젝트 및 대화",
      agents: "Agent 사용",
      projects: "프로젝트",
      conversations: "대화",
      models: "모델 사용",
      sessions: "세션",
      tokens: "Tokens",
      cost: "비용",
      turns: "대화 턴",
      duration: "활성 시간",
      share: "비중",
      type: "유형",
      primaryAgent: "주요 Agent",
      status: "상태",
      normal: "정상",
      distill: "증류 후보",
      attention: "이번 주 주요 내용",
      stable:
        "이번 주 AI 사용은 전반적으로 안정적이며, 특별히 주의할 항목이 없습니다.",
      reusable: "축적 후보",
      reusableText:
        "개 세션에서 반복 작업 또는 반복 흐름의 신호가 보여 증류 대상으로 확인할 수 있습니다.",
      actions: "다음 주의 제안",
      actionText:
        "증류 후보로 표시된 세션을 확인하고 Skill, 메모리 또는 워크플로로 정리할 수 있는지 검토하세요.",
      project: "프로젝트",
      conversation: "대화",
      model: "모델",
      calls: "호출",
      noData: "이번 주 AI 사용 기록이 없습니다.",
      footer:
        "Token에는 내부 Agent 호출이 포함될 수 있으며, 이 보고서는 AITracker가 현재 수집할 수 있는 데이터를 기반으로 생성되었습니다.",
    },
    monthly: {
      title: "AITracker 월간 보고서",
      period: "이번 달",
      previous: "전월 대비",
      summary: "이번 달 요약",
      overview: "이번 달 개요",
      trend: "사용 추세",
      structure: "프로젝트 및 대화",
      agents: "Agent 사용",
      projects: "프로젝트",
      conversations: "대화",
      models: "모델 사용",
      sessions: "세션",
      tokens: "Tokens",
      cost: "비용",
      turns: "대화 턴",
      duration: "활성 시간",
      share: "비중",
      type: "유형",
      primaryAgent: "주요 Agent",
      status: "상태",
      normal: "정상",
      distill: "증류 후보",
      attention: "이번 달 주요 내용",
      stable:
        "이번 달 AI 사용은 전반적으로 안정적이며, 특별히 주의할 항목이 없습니다.",
      reusable: "축적 후보",
      reusableText:
        "개 세션에서 반복 작업 또는 반복 흐름의 신호가 보여 증류 대상으로 확인할 수 있습니다.",
      actions: "다음 달의 제안",
      actionText:
        "증류 후보로 표시된 세션을 확인하고 Skill, 메모리 또는 워크플로로 정리할 수 있는지 검토하세요.",
      project: "프로젝트",
      conversation: "대화",
      model: "모델",
      calls: "호출",
      noData: "이번 달 AI 사용 기록이 없습니다.",
      footer:
        "Token에는 내부 Agent 호출이 포함될 수 있으며, 이 보고서는 AITracker가 현재 수집할 수 있는 데이터를 기반으로 생성되었습니다.",
    },
  },
};

function tokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function cost(value: number | undefined): string {
  return value === undefined ? "N/A" : `¥${value.toFixed(2)}`;
}

function duration(value: number): string {
  return value >= 60
    ? `${Math.floor(value / 60)}h ${value % 60}m`
    : `${value}m`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function bar(value: number): string {
  const filled = Math.max(0, Math.min(BAR_SIZE, Math.round(value * BAR_SIZE)));
  return `\`${"█".repeat(filled)}${"░".repeat(BAR_SIZE - filled)}\``;
}

function cell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function displayCost(stats: ReportStats): number {
  return stats.costCny ?? stats.costUsd;
}

function cacheLabels(locale: Locale) {
  return {
    section:
      locale === "zh-CN"
        ? "Token 与缓存"
        : locale === "ja-JP"
          ? "Token とキャッシュ"
          : locale === "ko-KR"
            ? "Token 및 캐시"
            : "Tokens and cache",
    total:
      locale === "zh-CN"
        ? "总 Tokens"
        : locale === "ja-JP"
          ? "合計 Tokens"
          : locale === "ko-KR"
            ? "총 Tokens"
            : "Total tokens",
    cached:
      locale === "zh-CN"
        ? "缓存 Tokens"
        : locale === "ja-JP"
          ? "キャッシュ Tokens"
          : locale === "ko-KR"
            ? "캐시 Tokens"
            : "Cached tokens",
    rate:
      locale === "zh-CN"
        ? "缓存命中率"
        : locale === "ja-JP"
          ? "キャッシュヒット率"
          : locale === "ko-KR"
            ? "캐시 적중률"
            : "Cache hit rate",
    savings:
      locale === "zh-CN"
        ? "预计节省"
        : locale === "ja-JP"
          ? "推定節約額"
          : locale === "ko-KR"
            ? "예상 절감액"
            : "Estimated savings",
    hits:
      locale === "zh-CN"
        ? "缓存命中"
        : locale === "ja-JP"
          ? "キャッシュヒット"
          : locale === "ko-KR"
            ? "캐시 적중"
            : "Cache hits",
    date:
      locale === "zh-CN"
        ? "日期"
        : locale === "ja-JP"
          ? "日付"
          : locale === "ko-KR"
            ? "날짜"
            : "Date",
  };
}

function agentUnit(locale: Locale): string {
  return locale === "zh-CN"
    ? "个 Agent"
    : locale === "ja-JP"
      ? " Agent"
      : locale === "ko-KR"
        ? " Agent"
        : " active agents";
}

function metricLabel(locale: Locale): string {
  return locale === "zh-CN"
    ? "指标"
    : locale === "ja-JP"
      ? "指標"
      : locale === "ko-KR"
        ? "지표"
        : "Metric";
}

function count(value: number | undefined, fallback: number): string {
  return value !== undefined
    ? String(value)
    : fallback > 0
      ? String(fallback)
      : "N/A";
}

function sourceRows(stats: ReportStats) {
  return stats.bySource ?? [];
}

function projectCount(stats: ReportStats): number {
  return (
    stats.activeProjectCount ??
    stats.byProject?.length ??
    stats.projects?.length ??
    0
  );
}

function summaryLine(
  locale: Locale,
  period: string,
  agent: string | undefined,
  project: string | undefined,
): string {
  if (locale === "zh-CN")
    return `${period} AI 使用主要记录在 ${agent ?? "已记录的 Agent"}${project ? `，项目集中在 ${project}` : ""}。`;
  if (locale === "ja-JP")
    return `${period}の AI 利用は主に ${agent ?? "記録された Agent"}${project ? `、プロジェクトは ${project}` : ""} に記録されています。`;
  if (locale === "ko-KR")
    return `${period} AI 사용은 주로 ${agent ?? "기록된 Agent"}${project ? ` 및 ${project} 프로젝트` : ""}에 기록되었습니다.`;
  return `${period} AI usage was primarily recorded for ${agent ?? "the listed agents"}${project ? ` and the ${project} project` : ""}.`;
}

function periodLabel(label: string): string {
  const matches = label.match(/\d{4}-\d{2}-\d{2}/g);
  if (matches?.length) return matches.join(" - ");
  return (
    label.replace(/^(本周|本月|今週|今月|이번 주|이번 달)\s*/, "") || "N/A"
  );
}

function change(today: number, previous: number | undefined): string {
  if (previous === undefined) return "N/A";
  if (previous === 0) return today === 0 ? "0" : "N/A";
  return `${today >= previous ? "+" : ""}${(((today - previous) / previous) * 100).toFixed(1)}%`;
}

function top<T extends { tokens: number }>(rows: readonly T[], limit = 5): T[] {
  return [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, limit);
}

function overview(
  stats: ReportStats,
  copy: PeriodicCopy,
  locale: Locale,
): string[] {
  const previous = stats.yesterday;
  const rows = [
    [copy.tokens, tokens(stats.tokens), change(stats.tokens, previous?.tokens)],
    [
      copy.cost,
      cost(displayCost(stats)),
      change(displayCost(stats), previous?.costCny),
    ],
    [
      copy.sessions,
      String(stats.sessions),
      change(stats.sessions, previous?.sessions),
    ],
    [copy.turns, String(stats.turns), change(stats.turns, previous?.turns)],
    [
      copy.duration,
      duration(stats.durationMin),
      previous?.durationMin === undefined
        ? "N/A"
        : duration(stats.durationMin - previous.durationMin),
    ],
    [
      copy.agents,
      count(stats.activeAgentCount, sourceRows(stats).length),
      change(
        stats.activeAgentCount ?? sourceRows(stats).length,
        previous?.activeAgents,
      ),
    ],
    [
      copy.projects,
      count(stats.activeProjectCount, projectCount(stats)),
      change(
        stats.activeProjectCount ?? projectCount(stats),
        previous?.activeProjects,
      ),
    ],
  ];
  const hasPrevious = Boolean(previous);
  return [
    `| ${metricLabel(locale)} | ${copy.period}${hasPrevious ? ` | ${copy.previous}` : ""} |`,
    `| --- | ---: |${hasPrevious ? " ---: |" : ""}`,
    ...rows.map(
      ([label, value, delta]) =>
        `| ${label} | **${value}** |${hasPrevious ? ` ${delta} |` : ""}`,
    ),
  ];
}

function agentSection(stats: ReportStats, copy: PeriodicCopy): string[] {
  const rows = [...sourceRows(stats)].sort((a, b) => b.tokens - a.tokens);
  if (!rows.length) return [];
  const total = stats.tokens || rows.reduce((sum, row) => sum + row.tokens, 0);
  return [
    ...rows
      .slice(0, 5)
      .flatMap((row) => [
        `**${cell(row.source)}**`,
        `${bar(total ? row.tokens / total : 0)} **${percent(total ? row.tokens / total : 0)}**`,
        "",
      ]),
    `| ${copy.agents} | ${copy.sessions} | ${copy.tokens} | ${copy.share} | ${copy.cost} | ${copy.duration} |`,
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows
      .slice(0, 5)
      .map(
        (row) =>
          `| **${cell(row.source)}** | ${row.sessions} | **${tokens(row.tokens)}** | **${percent(total ? row.tokens / total : 0)}** | ${cost(row.costCny ?? row.costUsd)} | ${duration(row.durationMin)} |`,
      ),
  ];
}

function projectsSection(stats: ReportStats, copy: PeriodicCopy): string[] {
  const rows = top(stats.byProject ?? []);
  if (!rows.length) return [];
  const total = stats.tokens || rows.reduce((sum, row) => sum + row.tokens, 0);
  return [
    `| ${copy.structure} | ${copy.type} | ${copy.sessions} | ${copy.tokens} | ${copy.share} | ${copy.primaryAgent} |`,
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...rows.map(
      (row: ReportProjectStats) =>
        `| **${cell(row.label)}** | ${row.kind === "conversation" ? copy.conversation : copy.project} | ${row.sessions} | **${tokens(row.tokens)}** | ${percent(total ? row.tokens / total : 0)} | ${cell(row.source ?? "N/A")} |`,
    ),
  ];
}

function sessionsSection(stats: ReportStats, copy: PeriodicCopy): string[] {
  const rows = top(stats.sessionsDetail ?? [], 5);
  if (!rows.length) return [];
  return [
    `| ${copy.sessions} | ${copy.project} | ${copy.agents} | ${copy.turns} | ${copy.tokens} | ${copy.duration} | ${copy.status} |`,
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows.map(
      (row: ReportSessionStats) =>
        `| **${cell(row.title)}** | ${cell(row.project ?? "—")} | ${cell(row.source)} | **${row.turns}** | **${tokens(row.tokens)}** | ${duration(row.durationMin)} | ${row.repeated ? copy.distill : copy.normal} |`,
    ),
  ];
}

function modelsSection(stats: ReportStats, copy: PeriodicCopy): string[] {
  const rows = top(stats.byModel ?? []);
  if (!rows.length) return [];
  const total = stats.tokens || rows.reduce((sum, row) => sum + row.tokens, 0);
  return [
    ...rows.flatMap((row) => [
      `**${cell(row.model)}**`,
      `${bar(total ? row.tokens / total : 0)} **${percent(total ? row.tokens / total : 0)}**`,
      "",
    ]),
    `| ${copy.model} | ${copy.calls} | ${copy.tokens} | ${copy.share} | ${copy.cost} |`,
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row: ReportModelStats) =>
        `| ${cell(row.model)} | ${row.calls} | **${tokens(row.tokens)}** | **${percent(total ? row.tokens / total : 0)}** | ${cost(row.costCny)} |`,
    ),
  ];
}

function trendSection(
  stats: ReportStats,
  copy: PeriodicCopy,
  locale: Locale,
): string[] {
  if (!stats.trend?.length) return [];
  const labels = cacheLabels(locale);
  return [
    `| ${labels.date} | ${copy.tokens} | ${copy.cost} | ${copy.sessions} | ${copy.duration} |`,
    "| --- | ---: | ---: | ---: | ---: |",
    ...stats.trend.map(
      (row) =>
        `| ${cell(row.date)} | ${tokens(row.tokens)} | ${cost(row.costCny)} | ${row.sessions} | ${duration(row.durationMin)} |`,
    ),
  ];
}

function cacheSection(
  stats: ReportStats,
  copy: PeriodicCopy,
  locale: Locale,
): string[] {
  const cache = stats.cache;
  if (!cache) return [];
  const labels = cacheLabels(locale);
  const rows: string[] = [
    `| ${metricLabel(locale)} | ${copy.period} |`,
    "| --- | ---: |",
    `| ${labels.total} | ${cache.totalTokens === undefined ? "N/A" : tokens(cache.totalTokens)} |`,
    `| ${labels.cached} | ${cache.cachedTokens === undefined ? "N/A" : tokens(cache.cachedTokens)} |`,
    `| ${labels.rate} | ${cache.cacheHitRate === undefined ? "N/A" : percent(cache.cacheHitRate)} |`,
    `| ${labels.savings} | ${cost(cache.savingsCny)} |`,
  ];
  if (cache.cacheHitRate !== undefined)
    rows.push(
      "",
      `${labels.hits} ${bar(cache.cacheHitRate)} **${percent(cache.cacheHitRate)}**`,
    );
  return rows;
}

export function buildPeriodicReportDocument(
  context: ReportContext,
  kind: PeriodicKind,
  locale: Locale = "zh-CN",
): string {
  const copy = COPY[locale][kind];
  const stats = context.stats;
  if (
    !stats ||
    (stats.sessions === 0 &&
      stats.turns === 0 &&
      stats.tokens === 0 &&
      !sourceRows(stats).length)
  ) {
    return `# ${copy.title}\n\n${copy.noData}`;
  }

  const repeated = (stats.sessionsDetail ?? []).filter((row) => row.repeated);
  const agent = [...sourceRows(stats)].sort((a, b) => b.tokens - a.tokens)[0];
  const project = top(stats.byProject ?? [])[0];
  const cache = cacheLabels(locale);
  const attention: string[] = [];
  if (agent && stats.tokens > 0)
    attention.push(
      `**${attention.length + 1}. ${cell(agent.source)}**\\\n${copy.tokens} share: **${percent(agent.tokens / stats.tokens)}**.`,
    );
  if (project && stats.tokens > 0)
    attention.push(
      `**${attention.length + 1}. ${cell(project.label)}**\\\n${copy.tokens} share: **${percent(project.tokens / stats.tokens)}**.`,
    );
  if (repeated.length)
    attention.push(
      `**${attention.length + 1}. ${copy.reusable}**\\\n${repeated.length} ${copy.reusableText}`,
    );
  if (stats.cache?.cacheHitRate !== undefined)
    attention.push(
      `**${attention.length + 1}. ${cache.hits}**\\\n${cache.rate}: **${percent(stats.cache.cacheHitRate)}**.`,
    );

  const sections: string[] = [
    `# ${copy.title}`,
    "",
    `**${periodLabel(stats.periodLabel)}**`,
    "",
    `> **${tokens(stats.tokens)} Tokens** · **${cost(displayCost(stats))}** · **${stats.sessions} ${copy.sessions}** · **${stats.turns} ${copy.turns}** · **${duration(stats.durationMin)}** · **${count(stats.activeAgentCount, sourceRows(stats).length)}${agentUnit(locale)}**`,
    "",
    `## ${copy.summary}`,
    "",
    attention.length
      ? summaryLine(locale, copy.period, agent?.source, project?.label)
      : copy.stable,
    "",
    `## ${copy.overview}`,
    "",
    ...overview(stats, copy, locale),
  ];

  const append = (title: string, body: string[]) => {
    if (!body.length) return;
    sections.push("", `## ${title}`, "", ...body);
  };
  append(copy.agents, agentSection(stats, copy));
  append(copy.structure, projectsSection(stats, copy));
  append(copy.trend, trendSection(stats, copy, locale));
  append(copy.sessions, sessionsSection(stats, copy));
  append(copy.models, modelsSection(stats, copy));
  append(cache.section, cacheSection(stats, copy, locale));
  append(
    copy.attention,
    attention.length ? attention.slice(0, 4) : [`> ${copy.stable}`],
  );
  if (repeated.length) {
    append(copy.reusable, [`- ${repeated.length} ${copy.reusableText}`]);
    append(copy.actions, [`1. ${copy.actionText}`]);
  }
  sections.push("", `> ${copy.footer}`);
  return sections.join("\n");
}
