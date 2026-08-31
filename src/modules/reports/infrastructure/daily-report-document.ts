import type {
  ReportContext,
  ReportModelStats,
  ReportProjectStats,
  ReportSessionStats,
  ReportStats,
} from "../contracts.ts";
import type { Locale } from "../../../lib/i18n/locale";

const BAR_SIZE = 20;

interface DailyCopy {
  readonly empty: string;
  readonly noData: string;
  readonly reportTitle: string;
  readonly overview: string;
  readonly agentUsage: string;
  readonly projectAndConversation: string;
  readonly sessionRanking: string;
  readonly modelUsage: string;
  readonly tokenAndCache: string;
  readonly skillAndSecurity: string;
  readonly today: string;
  readonly yesterday: string;
  readonly tokenUsage: string;
  readonly estimatedCost: string;
  readonly sessions: string;
  readonly turns: string;
  readonly duration: string;
  readonly activeAgent: string;
  readonly activeProject: string;
  readonly agent: string;
  readonly tokens: string;
  readonly ratio: string;
  readonly cost: string;
  readonly activeDuration: string;
  readonly projectConversation: string;
  readonly type: string;
  readonly primaryAgent: string;
  readonly conversation: string;
  readonly project: string;
  readonly rounds: string;
  readonly status: string;
  readonly distilled: string;
  readonly normal: string;
  readonly model: string;
  readonly calls: string;
  readonly data: string;
  readonly totalTokens: string;
  readonly inputTokens: string;
  readonly outputTokens: string;
  readonly reasoningTokens: string;
  readonly cachedTokens: string;
  readonly cacheHitRate: string;
  readonly savings: string;
  readonly totalCost: string;
  readonly cacheHit: string;
  readonly installedSkill: string;
  readonly distilledSkill: string;
  readonly memories: string;
  readonly workflows: string;
  readonly completedScan: string;
  readonly pendingScan: string;
  readonly riskSkill: string;
  readonly attention: string;
  readonly stable: string;
  readonly footer: string;
}

const COPY: Record<Locale, DailyCopy> = {
  "zh-CN": {
    empty: "暂无",
    noData: "今日暂无 AI 使用记录。",
    reportTitle: "AITracker 日报",
    overview: "今日概览",
    agentUsage: "Agent 使用",
    projectAndConversation: "项目与对话",
    sessionRanking: "会话排行",
    modelUsage: "模型使用",
    tokenAndCache: "Token 与缓存",
    skillAndSecurity: "Skill 与安全",
    today: "今日",
    yesterday: "较昨日",
    tokenUsage: "Token 消耗",
    estimatedCost: "估算成本",
    sessions: "会话",
    turns: "对话轮次",
    duration: "有效时长",
    activeAgent: "活跃 Agent",
    activeProject: "活跃项目",
    agent: "Agent",
    tokens: "Tokens",
    ratio: "占比",
    cost: "成本",
    activeDuration: "有效时长",
    projectConversation: "项目 / 对话",
    type: "类型",
    primaryAgent: "主要 Agent",
    conversation: "对话",
    project: "项目",
    rounds: "轮次",
    status: "状态",
    distilled: "建议蒸馏",
    normal: "正常",
    model: "模型",
    calls: "调用",
    data: "数据",
    totalTokens: "总 Tokens",
    inputTokens: "输入 Tokens",
    outputTokens: "输出 Tokens",
    reasoningTokens: "推理 Tokens",
    cachedTokens: "缓存 Tokens",
    cacheHitRate: "缓存命中率",
    savings: "预计节省",
    totalCost: "总成本",
    cacheHit: "缓存命中",
    installedSkill: "新安装 Skill",
    distilledSkill: "新增蒸馏 Skill",
    memories: "新增记忆",
    workflows: "新增工作流",
    completedScan: "完成安全扫描",
    pendingScan: "待扫描",
    riskSkill: "风险 Skill",
    attention: "今日关注",
    stable: "今日 AI 使用整体平稳，暂无需要特别关注的事项。",
    footer:
      "Token 可能包含内部 Agent 调用；报告仅根据 AITracker 当前可采集的数据生成。",
  },
  "en-US": {
    empty: "N/A",
    noData: "No AI usage recorded today.",
    reportTitle: "AITracker Daily Report",
    overview: "Today's overview",
    agentUsage: "Agent usage",
    projectAndConversation: "Projects and conversations",
    sessionRanking: "Session ranking",
    modelUsage: "Model usage",
    tokenAndCache: "Tokens and cache",
    skillAndSecurity: "Skills and security",
    today: "Today",
    yesterday: "Yesterday",
    tokenUsage: "Token usage",
    estimatedCost: "Estimated cost",
    sessions: "Sessions",
    turns: "Turns",
    duration: "Active duration",
    activeAgent: "Active agents",
    activeProject: "Active projects",
    agent: "Agent",
    tokens: "Tokens",
    ratio: "Share",
    cost: "Cost",
    activeDuration: "Active duration",
    projectConversation: "Project / conversation",
    type: "Type",
    primaryAgent: "Primary agent",
    conversation: "Conversation",
    project: "Project",
    rounds: "Turns",
    status: "Status",
    distilled: "Distill candidate",
    normal: "Normal",
    model: "Model",
    calls: "Calls",
    data: "Data",
    totalTokens: "Total tokens",
    inputTokens: "Input tokens",
    outputTokens: "Output tokens",
    reasoningTokens: "Reasoning tokens",
    cachedTokens: "Cached tokens",
    cacheHitRate: "Cache hit rate",
    savings: "Estimated savings",
    totalCost: "Total cost",
    cacheHit: "Cache hits",
    installedSkill: "New Skills installed",
    distilledSkill: "New distilled Skills",
    memories: "New memories",
    workflows: "New workflows",
    completedScan: "Security scans completed",
    pendingScan: "Pending scans",
    riskSkill: "Skills with risks",
    attention: "Today's highlights",
    stable:
      "AI usage was broadly steady today; there are no items requiring special attention.",
    footer:
      "Tokens may include internal Agent calls; this report is generated from data currently collected by AITracker.",
  },
  "ja-JP": {
    empty: "なし",
    noData: "本日の AI 利用記録はありません。",
    reportTitle: "AITracker 日報",
    overview: "今日の概要",
    agentUsage: "Agent 使用状況",
    projectAndConversation: "プロジェクトと会話",
    sessionRanking: "セッションランキング",
    modelUsage: "モデル使用状況",
    tokenAndCache: "Token とキャッシュ",
    skillAndSecurity: "Skill とセキュリティ",
    today: "今日",
    yesterday: "前日比",
    tokenUsage: "Token 使用量",
    estimatedCost: "推定コスト",
    sessions: "セッション",
    turns: "対話ターン",
    duration: "アクティブ時間",
    activeAgent: "アクティブ Agent",
    activeProject: "アクティブプロジェクト",
    agent: "Agent",
    tokens: "Tokens",
    ratio: "割合",
    cost: "コスト",
    activeDuration: "アクティブ時間",
    projectConversation: "プロジェクト / 会話",
    type: "種類",
    primaryAgent: "主な Agent",
    conversation: "会話",
    project: "プロジェクト",
    rounds: "ターン",
    status: "状態",
    distilled: "蒸留候補",
    normal: "通常",
    model: "モデル",
    calls: "呼び出し",
    data: "データ",
    totalTokens: "合計 Tokens",
    inputTokens: "入力 Tokens",
    outputTokens: "出力 Tokens",
    reasoningTokens: "推論 Tokens",
    cachedTokens: "キャッシュ Tokens",
    cacheHitRate: "キャッシュヒット率",
    savings: "推定節約額",
    totalCost: "合計コスト",
    cacheHit: "キャッシュヒット",
    installedSkill: "新規インストール Skill",
    distilledSkill: "新規蒸留 Skill",
    memories: "新規メモリ",
    workflows: "新規ワークフロー",
    completedScan: "完了した安全スキャン",
    pendingScan: "未スキャン",
    riskSkill: "リスクのある Skill",
    attention: "今日のポイント",
    stable:
      "本日の AI 利用は概ね安定しており、特に注目すべき項目はありません。",
    footer:
      "Token には内部 Agent の呼び出しが含まれる場合があります。レポートは AITracker が現在収集できるデータに基づきます。",
  },
  "ko-KR": {
    empty: "없음",
    noData: "오늘은 AI 사용 기록이 없습니다.",
    reportTitle: "AITracker 일일 보고서",
    overview: "오늘의 개요",
    agentUsage: "Agent 사용",
    projectAndConversation: "프로젝트 및 대화",
    sessionRanking: "세션 순위",
    modelUsage: "모델 사용",
    tokenAndCache: "Token 및 캐시",
    skillAndSecurity: "Skill 및 보안",
    today: "오늘",
    yesterday: "전일 대비",
    tokenUsage: "Token 사용량",
    estimatedCost: "예상 비용",
    sessions: "세션",
    turns: "대화 턴",
    duration: "활성 시간",
    activeAgent: "활성 Agent",
    activeProject: "활성 프로젝트",
    agent: "Agent",
    tokens: "Tokens",
    ratio: "비중",
    cost: "비용",
    activeDuration: "활성 시간",
    projectConversation: "프로젝트 / 대화",
    type: "유형",
    primaryAgent: "주요 Agent",
    conversation: "대화",
    project: "프로젝트",
    rounds: "턴",
    status: "상태",
    distilled: "증류 후보",
    normal: "정상",
    model: "모델",
    calls: "호출",
    data: "데이터",
    totalTokens: "총 Tokens",
    inputTokens: "입력 Tokens",
    outputTokens: "출력 Tokens",
    reasoningTokens: "추론 Tokens",
    cachedTokens: "캐시 Tokens",
    cacheHitRate: "캐시 적중률",
    savings: "예상 절감액",
    totalCost: "총 비용",
    cacheHit: "캐시 적중",
    installedSkill: "새로 설치한 Skill",
    distilledSkill: "새 증류 Skill",
    memories: "새 메모리",
    workflows: "새 워크플로",
    completedScan: "완료된 보안 검사",
    pendingScan: "검사 대기",
    riskSkill: "위험 Skill",
    attention: "오늘의 주요 내용",
    stable:
      "오늘 AI 사용은 전반적으로 안정적이며, 특별히 주의할 항목이 없습니다.",
    footer:
      "Token에는 내부 Agent 호출이 포함될 수 있으며, 이 보고서는 AITracker가 현재 수집할 수 있는 데이터를 기반으로 생성되었습니다.",
  },
};

function value(
  value: number | undefined,
  format: (value: number) => string,
  empty: string,
) {
  return value === undefined ? empty : format(value);
}

function tokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function cost(value: number | undefined, empty = "N/A"): string {
  return value === undefined ? empty : `¥${value.toFixed(2)}`;
}

function duration(value: number | undefined, empty = "N/A"): string {
  if (value === undefined) return empty;
  return value >= 60
    ? `${Math.floor(value / 60)}h ${value % 60}m`
    : `${value}m`;
}

function percent(value: number | undefined, empty = "N/A"): string {
  return value === undefined ? empty : `${(value * 100).toFixed(1)}%`;
}

function bar(ratio: number | undefined, empty = "N/A"): string {
  if (ratio === undefined) return empty;
  const filled = Math.max(0, Math.min(BAR_SIZE, Math.round(ratio * BAR_SIZE)));
  return `\`${"█".repeat(filled)}${"░".repeat(BAR_SIZE - filled)}\``;
}

function pctChange(
  today: number,
  yesterday: number | undefined,
  empty: string,
): string {
  if (yesterday === undefined) return empty;
  if (yesterday === 0) return today === 0 ? "0" : empty;
  const change = ((today - yesterday) / yesterday) * 100;
  return `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`;
}

function pctChangeDuration(
  today: number,
  yesterday: number | undefined,
  empty: string,
): string {
  if (yesterday === undefined) return empty;
  const delta = today - yesterday;
  return delta === 0
    ? "0"
    : `${delta >= 0 ? "+" : ""}${duration(Math.abs(delta), empty)}`;
}

function cell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function dateLabel(periodLabel: string): string {
  const match = periodLabel.match(/\d{4}-\d{2}-\d{2}/);
  return (match?.[0] ?? periodLabel.replace(/^今日\s*/, "")) || "N/A";
}

function sourceLabel(source: string, empty: string): string {
  return source.trim() || empty;
}

function displayCost(stats: ReportStats): number | undefined {
  return stats.costCny ?? stats.costUsd;
}

function topRows<T extends { tokens: number }>(rows: readonly T[], limit = 5) {
  return [...rows].sort((a, b) => b.tokens - a.tokens).slice(0, limit);
}

function modelsWithOther(
  rows: readonly ReportModelStats[],
  otherLabel: string,
) {
  const sorted = [...rows].sort((a, b) => b.tokens - a.tokens);
  if (sorted.length <= 5) return sorted;
  const top = sorted.slice(0, 5);
  const other = sorted.slice(5).reduce(
    (acc, row) => ({
      model: otherLabel,
      calls: acc.calls + row.calls,
      tokens: acc.tokens + row.tokens,
      costCny: (acc.costCny ?? 0) + (row.costCny ?? 0),
    }),
    { model: otherLabel, calls: 0, tokens: 0, costCny: 0 },
  );
  return [...top, other];
}

function overviewRows(stats: ReportStats, copy: DailyCopy): string[] {
  const previous = stats.yesterday;
  const rows: [string, string, string][] = [
    [
      copy.tokenUsage,
      tokens(stats.tokens),
      pctChange(stats.tokens, previous?.tokens, copy.empty),
    ],
    [
      copy.estimatedCost,
      cost(displayCost(stats), copy.empty),
      pctChange(displayCost(stats) ?? 0, previous?.costCny, copy.empty),
    ],
    [
      copy.sessions,
      String(stats.sessions),
      pctChange(stats.sessions, previous?.sessions, copy.empty),
    ],
    [
      copy.turns,
      String(stats.turns),
      pctChange(stats.turns, previous?.turns, copy.empty),
    ],
    [
      copy.duration,
      duration(stats.durationMin, copy.empty),
      pctChangeDuration(stats.durationMin, previous?.durationMin, copy.empty),
    ],
    [
      copy.activeAgent,
      stats.activeAgentCount !== undefined
        ? String(stats.activeAgentCount)
        : stats.bySource?.length
          ? String(stats.bySource.length)
          : copy.empty,
      pctChange(
        stats.activeAgentCount ?? stats.bySource?.length ?? 0,
        previous?.activeAgents,
        copy.empty,
      ),
    ],
    [
      copy.activeProject,
      stats.activeProjectCount !== undefined
        ? String(stats.activeProjectCount)
        : stats.byProject?.length
          ? String(stats.byProject.length)
          : stats.projects.length
            ? String(stats.projects.length)
            : copy.empty,
      pctChange(
        stats.activeProjectCount ??
          stats.byProject?.length ??
          stats.projects.length,
        previous?.activeProjects,
        copy.empty,
      ),
    ],
  ];
  const hasYesterday = Boolean(previous);
  return [
    `| ${copy.data} | ${copy.today} |${hasYesterday ? ` ${copy.yesterday} |` : ""}`,
    `| --- | ---: |${hasYesterday ? " ---: |" : ""}`,
    ...rows.map(
      ([label, today, change]) =>
        `| ${label} | **${today}** |${hasYesterday ? ` ${change} |` : ""}`,
    ),
  ];
}

function agentSection(stats: ReportStats, copy: DailyCopy): string[] {
  const rows = [...(stats.bySource ?? [])].sort((a, b) => b.tokens - a.tokens);
  if (rows.length === 0) return [copy.empty];
  const total = stats.tokens || rows.reduce((sum, row) => sum + row.tokens, 0);
  const lines: string[] = [];
  for (const row of rows.slice(0, 5)) {
    const ratio = total > 0 ? row.tokens / total : 0;
    lines.push(
      `**${sourceLabel(row.source, copy.empty)}**`,
      `${bar(ratio, copy.empty)} **${percent(ratio, copy.empty)}**`,
      "",
    );
  }
  if (rows.length > 5)
    lines.push(
      `**${copy.empty}**`,
      `${bar(undefined, copy.empty)} **${copy.empty}**`,
      "",
    );
  lines.push(
    `| ${copy.agent} | ${copy.sessions} | ${copy.tokens} | ${copy.ratio} | ${copy.cost} | ${copy.activeDuration} |`,
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.slice(0, 5).map((row) => {
      const ratio = total > 0 ? row.tokens / total : 0;
      const rowDuration =
        row.sessions === 0 && row.durationMin === 0
          ? "—"
          : duration(row.durationMin, copy.empty);
      return `| **${cell(sourceLabel(row.source, copy.empty))}** | ${row.sessions} | **${tokens(row.tokens)}** | **${percent(ratio, copy.empty)}** | ${cost(row.costCny, copy.empty)} | ${rowDuration} |`;
    }),
  );
  return lines;
}

function projectSection(stats: ReportStats, copy: DailyCopy): string[] {
  const rows = topRows(stats.byProject ?? []);
  if (rows.length === 0) return [copy.empty];
  const total = stats.tokens || rows.reduce((sum, row) => sum + row.tokens, 0);
  return [
    `| ${copy.projectConversation} | ${copy.type} | ${copy.sessions} | ${copy.tokens} | ${copy.ratio} | ${copy.primaryAgent} |`,
    "| --- | --- | ---: | ---: | ---: | --- |",
    ...rows.map(
      (row) =>
        `| **${cell(row.label)}** | ${row.kind === "conversation" ? copy.conversation : copy.project} | ${row.sessions} | **${tokens(row.tokens)}** | ${percent(total > 0 ? row.tokens / total : 0, copy.empty)} | ${cell(row.source ?? copy.empty)} |`,
    ),
  ];
}

function sessionSection(stats: ReportStats, copy: DailyCopy): string[] {
  const rows = topRows(stats.sessionsDetail ?? [], 5);
  if (rows.length === 0) return [copy.empty];
  return [
    `| ${copy.sessions} | ${copy.project} | ${copy.agent} | ${copy.rounds} | ${copy.tokens} | ${copy.duration} | ${copy.status} |`,
    "| --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows.map(
      (row) =>
        `| **${cell(row.title)}** | ${cell(row.project ?? "—")} | ${cell(row.source)} | **${row.turns}** | **${tokens(row.tokens)}** | ${duration(row.durationMin, copy.empty)} | ${row.repeated ? copy.distilled : copy.normal} |`,
    ),
  ];
}

function modelSection(stats: ReportStats, copy: DailyCopy): string[] {
  const rows = modelsWithOther(stats.byModel ?? [], copy.empty);
  if (rows.length === 0) return [copy.empty];
  const total = stats.tokens || rows.reduce((sum, row) => sum + row.tokens, 0);
  const lines: string[] = [];
  for (const row of rows) {
    const ratio = total > 0 ? row.tokens / total : 0;
    lines.push(
      `**${cell(row.model)}**`,
      `${bar(ratio, copy.empty)} **${percent(ratio, copy.empty)}**`,
      "",
    );
  }
  lines.push(
    `| ${copy.model} | ${copy.calls} | ${copy.tokens} | ${copy.ratio} | ${copy.cost} |`,
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${cell(row.model)} | ${row.calls} | **${tokens(row.tokens)}** | **${percent(total > 0 ? row.tokens / total : 0, copy.empty)}** | ${cost(row.costCny, copy.empty)} |`,
    ),
  );
  return lines;
}

function cacheSection(stats: ReportStats, copy: DailyCopy): string[] {
  const cache = stats.cache;
  if (!cache) return [copy.empty];
  const rate = cache.cacheHitRate;
  return [
    `| ${copy.data} | ${copy.data} |`,
    "| --- | ---: |",
    `| ${copy.totalTokens} | ${value(cache.totalTokens, tokens, copy.empty)} |`,
    `| ${copy.inputTokens} | ${value(cache.inputTokens, tokens, copy.empty)} |`,
    `| ${copy.outputTokens} | ${value(cache.outputTokens, tokens, copy.empty)} |`,
    `| ${copy.reasoningTokens} | ${value(cache.reasoningTokens, tokens, copy.empty)} |`,
    `| ${copy.cachedTokens} | ${value(cache.cachedTokens, tokens, copy.empty)} |`,
    `| ${copy.cacheHitRate} | ${percent(rate, copy.empty)} |`,
    `| ${copy.savings} | ${cost(cache.savingsCny, copy.empty)} |`,
    `| ${copy.totalCost} | ${cost(displayCost(stats), copy.empty)} |`,
    ...(rate === undefined
      ? []
      : [
          "",
          `${copy.cacheHit} ${bar(rate, copy.empty)} **${percent(rate, copy.empty)}**`,
        ]),
  ];
}

function attentionSection(stats: ReportStats, copy: DailyCopy): string[] {
  const items: string[] = [];
  const agent = [...(stats.bySource ?? [])].sort(
    (a, b) => b.tokens - a.tokens,
  )[0];
  if (agent && stats.tokens > 0) {
    items.push(`**${items.length + 1}. ${cell(agent.source)}**\\
${copy.tokens} share: **${percent(agent.tokens / stats.tokens, copy.empty)}**.`);
  }
  const project = stats.byProject?.[0];
  if (project && stats.tokens > 0) {
    items.push(`**${items.length + 1}. ${cell(project.label)}**\\
${copy.tokens} share: **${percent(project.tokens / stats.tokens, copy.empty)}** (${project.kind === "conversation" ? copy.conversation : copy.project}).`);
  }
  const session = stats.sessionsDetail?.[0];
  if (session && stats.sessionsDetail && stats.sessionsDetail.length > 1) {
    items.push(`**${items.length + 1}. ${copy.sessions}**\\
「${cell(session.title)}」 · **${tokens(session.tokens)} ${copy.tokens}** · ${session.turns} ${copy.rounds} · ${duration(session.durationMin, copy.empty)}.`);
  }
  if (stats.cache?.cacheHitRate !== undefined && stats.cache.cachedTokens) {
    items.push(`**${items.length + 1}. ${copy.cacheHit}**\\
${copy.cacheHitRate}: **${percent(stats.cache.cacheHitRate, copy.empty)}** · **${tokens(stats.cache.cachedTokens)} ${copy.tokens}**.`);
  }
  if (items.length === 0) return [`> ${copy.stable}`];
  return items.slice(0, 4);
}

/**
 * Strict daily report document. This renderer is intentionally independent of
 * model output: headings, tables, ordering and fallback values are fixed.
 */
export function buildDailyReportDocument(
  context: ReportContext,
  locale: Locale = "zh-CN",
): string {
  const copy = COPY[locale];
  const stats = context.stats;
  const hasUsage = Boolean(
    stats &&
    (stats.sessions > 0 ||
      stats.turns > 0 ||
      stats.tokens > 0 ||
      stats.costUsd > 0 ||
      stats.bySource?.length ||
      stats.byProject?.length ||
      stats.byModel?.length),
  );
  if (!stats || !hasUsage) return `# ${copy.reportTitle}\n\n${copy.noData}`;

  const date = dateLabel(stats.periodLabel);
  const activeAgents =
    (stats.activeAgentCount ?? stats.bySource?.length)
      ? String(stats.activeAgentCount ?? stats.bySource?.length)
      : copy.empty;
  const headline =
    locale === "zh-CN"
      ? `> **${tokens(stats.tokens)} Tokens** · **${cost(displayCost(stats), copy.empty)}** · **${stats.sessions} 场会话** · **${stats.turns} 轮对话** · **${duration(stats.durationMin, copy.empty)}** · **${activeAgents} 个 Agent**`
      : locale === "ja-JP"
        ? `> **${tokens(stats.tokens)} Tokens** · **${cost(displayCost(stats), copy.empty)}** · **${stats.sessions} セッション** · **${stats.turns} ターン** · **${duration(stats.durationMin, copy.empty)}** · **${activeAgents} Agent**`
        : locale === "ko-KR"
          ? `> **${tokens(stats.tokens)} Tokens** · **${cost(displayCost(stats), copy.empty)}** · **${stats.sessions} 세션** · **${stats.turns} 턴** · **${duration(stats.durationMin, copy.empty)}** · **${activeAgents} Agent**`
          : `> **${tokens(stats.tokens)} Tokens** · **${cost(displayCost(stats), copy.empty)}** · **${stats.sessions} sessions** · **${stats.turns} turns** · **${duration(stats.durationMin, copy.empty)}** · **${activeAgents} active agents**`;
  return [
    `# ${copy.reportTitle}`,
    "",
    `**${date}**`,
    "",
    headline,
    "",
    "---",
    "",
    `## ${copy.overview}`,
    "",
    ...overviewRows(stats, copy),
    "",
    "---",
    "",
    `## ${copy.agentUsage}`,
    "",
    ...agentSection(stats, copy),
    "",
    "---",
    "",
    `## ${copy.projectAndConversation}`,
    "",
    ...projectSection(stats, copy),
    "",
    "---",
    "",
    `## ${copy.sessionRanking}`,
    "",
    ...sessionSection(stats, copy),
    "",
    "---",
    "",
    `## ${copy.modelUsage}`,
    "",
    ...modelSection(stats, copy),
    "",
    "---",
    "",
    `## ${copy.tokenAndCache}`,
    "",
    ...cacheSection(stats, copy),
    "",
    "---",
    "",
    `## ${copy.skillAndSecurity}`,
    "",
    `| ${copy.data} | ${copy.today} |`,
    "| --- | ---: |",
    `| ${copy.installedSkill} | ${copy.empty} |`,
    `| ${copy.distilledSkill} | ${copy.empty} |`,
    `| ${copy.memories} | ${copy.empty} |`,
    `| ${copy.workflows} | ${copy.empty} |`,
    `| ${copy.completedScan} | ${copy.empty} |`,
    `| ${copy.pendingScan} | ${copy.empty} |`,
    `| ${copy.riskSkill} | ${copy.empty} |`,
    "",
    "---",
    "",
    `## ${copy.attention}`,
    "",
    ...attentionSection(stats, copy),
    "",
    "---",
    "",
    `> ${copy.footer}`,
  ].join("\n");
}
