// 原型演示数据（静态 Mock，不接后端）

export type Health = "active" | "low" | "doze" | "dead";

export const healthMeta: Record<
  Health,
  { label: string; color: string; dot: string }
> = {
  active: { label: "活跃", color: "text-ok", dot: "bg-ok" },
  low: { label: "低频", color: "text-warn", dot: "bg-warn" },
  doze: { label: "休眠", color: "text-doze", dot: "bg-doze" },
  dead: { label: "废弃", color: "text-danger", dot: "bg-danger" },
};

export const kpis = {
  todayTokens: 1234567,
  todayDelta: 12,
  monthCost: 89.32,
  monthBudget: 500,
  cacheSaved: 45.2,
  cacheHitRate: 68,
  skillsActive: 12,
  skillsTotal: 47,
  skillDist: { active: 8, low: 2, doze: 1, dead: 1 },
};

export const trendDaily = [
  { label: "07-21", claude: 820, codex: 310, cursor: 190, gemini: 70 },
  { label: "07-22", claude: 940, codex: 280, cursor: 220, gemini: 90 },
  { label: "07-23", claude: 760, codex: 360, cursor: 160, gemini: 60 },
  { label: "07-24", claude: 1120, codex: 420, cursor: 240, gemini: 110 },
  { label: "07-25", claude: 980, codex: 390, cursor: 300, gemini: 80 },
  { label: "07-26", claude: 1310, codex: 340, cursor: 210, gemini: 130 },
  { label: "07-27", claude: 1240, codex: 460, cursor: 280, gemini: 95 },
];

export const trendWeekly = [
  { label: "W26", claude: 5200, codex: 1900, cursor: 1100, gemini: 420 },
  { label: "W27", claude: 6100, codex: 2200, cursor: 1350, gemini: 510 },
  { label: "W28", claude: 5800, codex: 2450, cursor: 1200, gemini: 610 },
  { label: "W29", claude: 7170, codex: 2560, cursor: 1600, gemini: 635 },
];

export const trendMonthly = [
  { label: "3月", claude: 18200, codex: 7400, cursor: 4100, gemini: 1620 },
  { label: "4月", claude: 21100, codex: 8200, cursor: 4650, gemini: 1810 },
  { label: "5月", claude: 19800, codex: 9450, cursor: 5200, gemini: 2110 },
  { label: "6月", claude: 24170, codex: 10560, cursor: 5600, gemini: 2435 },
  { label: "7月", claude: 26270, codex: 11060, cursor: 6100, gemini: 2635 },
];

export const providerShare = [
  { name: "Claude", value: 62, color: "var(--color-chart-1)" },
  { name: "Codex", value: 18, color: "var(--color-chart-2)" },
  { name: "Cursor", value: 12, color: "var(--color-chart-3)" },
  { name: "Gemini", value: 5, color: "var(--color-chart-4)" },
  { name: "其他", value: 3, color: "var(--color-chart-5)" },
];

export const recentModels = [
  { name: "sonnet-4.6", tokens: "342K", pct: 100 },
  { name: "opus-4.7", tokens: "89K", pct: 26 },
  { name: "haiku-4.5", tokens: "56K", pct: 16 },
  { name: "deepseek-v4", tokens: "23K", pct: 7 },
];

export const activities = [
  {
    time: "10:23",
    tool: "Claude Code",
    model: "sonnet-4.6",
    tokens: "12,345",
    cost: "¥0.89",
  },
  {
    time: "10:15",
    tool: "Codex",
    model: "opus-4.7",
    tokens: "8,900",
    cost: "¥1.23",
  },
  {
    time: "09:58",
    tool: "Cursor",
    model: "deepseek-v4",
    tokens: "45,678",
    cost: "¥0.34",
  },
  {
    time: "09:41",
    tool: "Claude Code",
    model: "haiku-4.5",
    tokens: "6,210",
    cost: "¥0.08",
  },
  {
    time: "09:12",
    tool: "Gemini CLI",
    model: "gemini-3-pro",
    tokens: "18,004",
    cost: "¥0.42",
  },
  {
    time: "08:47",
    tool: "Claude Code",
    model: "sonnet-4.6",
    tokens: "23,118",
    cost: "¥1.64",
  },
  {
    time: "08:20",
    tool: "Codex",
    model: "opus-4.7",
    tokens: "4,092",
    cost: "¥0.57",
  },
  {
    time: "07:55",
    tool: "Kimi Code",
    model: "kimi-k3",
    tokens: "31,760",
    cost: "¥0.21",
  },
];

// 7×24 热力图：0-100 强度
export const heatmap: number[][] = Array.from({ length: 7 }, (_, d) =>
  Array.from({ length: 24 }, (_, h) => {
    const workday = d < 5 ? 1 : 0.45;
    const peak =
      Math.exp(-Math.pow(h - 10.5, 2) / 14) +
      0.8 * Math.exp(-Math.pow(h - 16, 2) / 12);
    const night = 0.35 * Math.exp(-Math.pow(h - 22.5, 2) / 8);
    const noise = ((d * 31 + h * 17) % 13) / 40;
    return Math.min(100, Math.round((peak + night + noise) * workday * 62));
  }),
);

export const weekdayLabels = [
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六",
  "周日",
];

export const tokenSummary = [
  { label: "总 Token", value: "3.62M" },
  { label: "总费用", value: "¥89.32" },
  { label: "输入 Token", value: "2.41M" },
  { label: "输出 Token", value: "0.78M" },
  { label: "缓存读", value: "0.36M" },
  { label: "缓存写", value: "0.07M" },
];

export type Row = {
  name: string;
  tokens: string;
  cost: string;
  share: number;
  cache: number;
  trend: "up" | "flat" | "down";
  children: { name: string; tokens: string; cost: string }[];
};

export const byProvider: Row[] = [
  {
    name: "Claude Code",
    tokens: "2.3M",
    cost: "¥45.20",
    share: 62,
    cache: 68,
    trend: "up",
    children: [
      { name: "sonnet-4.6", tokens: "1.62M", cost: "¥28.40" },
      { name: "opus-4.7", tokens: "0.51M", cost: "¥14.10" },
      { name: "haiku-4.5", tokens: "0.17M", cost: "¥2.70" },
    ],
  },
  {
    name: "Codex",
    tokens: "890K",
    cost: "¥18.70",
    share: 24,
    cache: 55,
    trend: "flat",
    children: [
      { name: "opus-4.7", tokens: "610K", cost: "¥13.90" },
      { name: "o5-mini", tokens: "280K", cost: "¥4.80" },
    ],
  },
  {
    name: "Cursor",
    tokens: "340K",
    cost: "¥5.20",
    share: 9,
    cache: 40,
    trend: "down",
    children: [
      { name: "deepseek-v4", tokens: "240K", cost: "¥2.10" },
      { name: "sonnet-4.6", tokens: "100K", cost: "¥3.10" },
    ],
  },
  {
    name: "Gemini CLI",
    tokens: "120K",
    cost: "¥2.60",
    share: 3,
    cache: 31,
    trend: "up",
    children: [{ name: "gemini-3-pro", tokens: "120K", cost: "¥2.60" }],
  },
  {
    name: "Kimi Code",
    tokens: "72K",
    cost: "¥0.62",
    share: 2,
    cache: 22,
    trend: "flat",
    children: [{ name: "kimi-k3", tokens: "72K", cost: "¥0.62" }],
  },
];

export const byProject: Row[] = [
  {
    name: "TrustTools V3.0",
    tokens: "1.9M",
    cost: "¥41.20",
    share: 52,
    cache: 71,
    trend: "up",
    children: [
      { name: "sonnet-4.6", tokens: "1.02M", cost: "¥18.60" },
      { name: "opus-4.7", tokens: "0.62M", cost: "¥16.40" },
      { name: "haiku-4.5", tokens: "0.16M", cost: "¥3.20" },
      { name: "o5-mini", tokens: "0.10M", cost: "¥3.00" },
    ],
  },
  {
    name: "内部工具链",
    tokens: "0.9M",
    cost: "¥22.40",
    share: 25,
    cache: 58,
    trend: "flat",
    children: [
      { name: "opus-4.7", tokens: "0.42M", cost: "¥11.60" },
      { name: "sonnet-4.6", tokens: "0.36M", cost: "¥8.10" },
      { name: "o5-mini", tokens: "0.12M", cost: "¥2.70" },
    ],
  },
  {
    name: "官网重构",
    tokens: "0.5M",
    cost: "¥15.10",
    share: 14,
    cache: 44,
    trend: "down",
    children: [
      { name: "sonnet-4.6", tokens: "0.26M", cost: "¥8.20" },
      { name: "deepseek-v4", tokens: "0.18M", cost: "¥4.30" },
      { name: "gemini-3-pro", tokens: "0.06M", cost: "¥2.60" },
    ],
  },
  {
    name: "未标记",
    tokens: "0.32M",
    cost: "¥10.62",
    share: 9,
    cache: 30,
    trend: "flat",
    children: [
      { name: "sonnet-4.6", tokens: "0.14M", cost: "¥4.80" },
      { name: "opus-4.7", tokens: "0.08M", cost: "¥3.10" },
      { name: "kimi-k3", tokens: "0.07M", cost: "¥1.62" },
      { name: "haiku-4.5", tokens: "0.03M", cost: "¥1.10" },
    ],
  },
];

export const byModel: Row[] = [
  {
    name: "sonnet-4.6",
    tokens: "1.72M",
    cost: "¥31.50",
    share: 47,
    cache: 70,
    trend: "up",
    children: [
      { name: "TrustTools V3.0", tokens: "1.02M", cost: "¥18.60" },
      { name: "内部工具链", tokens: "0.36M", cost: "¥8.10" },
      { name: "官网重构", tokens: "0.20M", cost: "¥2.80" },
      { name: "未标记", tokens: "0.14M", cost: "¥2.00" },
    ],
  },
  {
    name: "opus-4.7",
    tokens: "1.12M",
    cost: "¥28.00",
    share: 31,
    cache: 61,
    trend: "up",
    children: [
      { name: "TrustTools V3.0", tokens: "0.62M", cost: "¥16.40" },
      { name: "内部工具链", tokens: "0.42M", cost: "¥8.50" },
      { name: "未标记", tokens: "0.08M", cost: "¥3.10" },
    ],
  },
  {
    name: "deepseek-v4",
    tokens: "0.24M",
    cost: "¥2.10",
    share: 7,
    cache: 38,
    trend: "down",
    children: [
      { name: "官网重构", tokens: "0.18M", cost: "¥1.60" },
      { name: "内部工具链", tokens: "0.06M", cost: "¥0.50" },
    ],
  },
  {
    name: "haiku-4.5",
    tokens: "0.17M",
    cost: "¥2.70",
    share: 5,
    cache: 74,
    trend: "flat",
    children: [
      { name: "TrustTools V3.0", tokens: "0.14M", cost: "¥2.20" },
      { name: "未标记", tokens: "0.03M", cost: "¥0.50" },
    ],
  },
];

export const tokenBreakdown = [
  { label: "07-23", input: 520, output: 180, cacheRead: 90, cacheWrite: 24 },
  { label: "07-24", input: 610, output: 210, cacheRead: 120, cacheWrite: 30 },
  { label: "07-25", input: 480, output: 190, cacheRead: 140, cacheWrite: 22 },
  { label: "07-26", input: 720, output: 260, cacheRead: 160, cacheWrite: 36 },
  { label: "07-27", input: 690, output: 240, cacheRead: 175, cacheWrite: 31 },
];

export const sessions = [
  { time: "07-27 10:23", model: "sonnet-4.6", tokens: "12,345", cost: "¥0.89" },
  { time: "07-27 10:15", model: "opus-4.7", tokens: "8,900", cost: "¥1.23" },
  {
    time: "07-27 09:58",
    model: "deepseek-v4",
    tokens: "45,678",
    cost: "¥0.34",
  },
  {
    time: "07-27 09:12",
    model: "gemini-3-pro",
    tokens: "18,004",
    cost: "¥0.42",
  },
  { time: "07-26 21:40", model: "sonnet-4.6", tokens: "33,210", cost: "¥2.31" },
  { time: "07-26 17:02", model: "haiku-4.5", tokens: "6,102", cost: "¥0.09" },
];

export type Skill = {
  id: string;
  name: string;
  health: Health;
  agents: string[];
  calls: number;
  daily: number;
  lastActive: string;
  trend: "up" | "flat" | "down";
  version: string;
  source: string;
  installedAt: string;
  installed: Record<string, boolean>;
  note?: string;
};

const agentList = ["Claude Code", "Codex", "Cursor", "Gemini"];

export const skills: Skill[] = [
  {
    id: "git-helper",
    name: "git-helper",
    health: "active",
    agents: ["Claude Code"],
    calls: 47,
    daily: 6.7,
    lastActive: "2 小时前",
    trend: "up",
    version: "v1.2.0",
    source: "GitHub / anthropics",
    installedAt: "2026-06-15",
    installed: {
      "Claude Code": true,
      Codex: true,
      Cursor: false,
      Gemini: false,
    },
  },
  {
    id: "pdf-reader",
    name: "pdf-reader",
    health: "active",
    agents: ["Claude Code", "Codex"],
    calls: 32,
    daily: 4.6,
    lastActive: "5 小时前",
    trend: "up",
    version: "v0.9.4",
    source: "TrustTools 市场",
    installedAt: "2026-06-28",
    installed: {
      "Claude Code": true,
      Codex: true,
      Cursor: true,
      Gemini: false,
    },
  },
  {
    id: "code-review",
    name: "code-review",
    health: "low",
    agents: ["Codex"],
    calls: 8,
    daily: 0.3,
    lastActive: "6 天前",
    trend: "down",
    version: "v2.0.1",
    source: "GitHub / openai",
    installedAt: "2026-05-02",
    installed: {
      "Claude Code": false,
      Codex: true,
      Cursor: false,
      Gemini: false,
    },
  },
  {
    id: "api-doc-gen",
    name: "api-doc-gen",
    health: "doze",
    agents: ["Cursor"],
    calls: 2,
    daily: 0.06,
    lastActive: "41 天前",
    trend: "down",
    version: "v0.3.0",
    source: "本地导入",
    installedAt: "2026-03-11",
    installed: {
      "Claude Code": false,
      Codex: false,
      Cursor: true,
      Gemini: false,
    },
  },
  {
    id: "old-deploy",
    name: "old-deploy",
    health: "dead",
    agents: ["Claude Code"],
    calls: 0,
    daily: 0,
    lastActive: "112 天前",
    trend: "down",
    version: "v0.1.2",
    source: "本地导入",
    installedAt: "2025-12-20",
    installed: {
      "Claude Code": true,
      Codex: false,
      Cursor: false,
      Gemini: false,
    },
    note: "90 天+ 未使用",
  },
  {
    id: "sql-tuner",
    name: "sql-tuner",
    health: "low",
    agents: ["Claude Code", "Cursor"],
    calls: 11,
    daily: 0.4,
    lastActive: "3 天前",
    trend: "flat",
    version: "v1.0.0",
    source: "TrustTools 市场",
    installedAt: "2026-06-02",
    installed: {
      "Claude Code": true,
      Codex: false,
      Cursor: true,
      Gemini: false,
    },
  },
];

export { agentList };

export const marketSkills = [
  {
    name: "git-helper",
    desc: "Git 分支、提交、rebase 全流程助手",
    downloads: "2.3K",
    rating: 4.8,
    updated: "3 天前",
    safe: true,
    cat: "编码",
  },
  {
    name: "pdf-tool",
    desc: "批量解析 PDF 并抽取结构化表格",
    downloads: "1.8K",
    rating: 4.5,
    updated: "1 周前",
    safe: true,
    cat: "文档",
  },
  {
    name: "code-scan",
    desc: "静态代码风险扫描与依赖审计",
    downloads: "456",
    rating: 3.2,
    updated: "2 月前",
    safe: false,
    cat: "安全",
  },
  {
    name: "k8s-operator",
    desc: "集群巡检、滚动发布与回滚编排",
    downloads: "1.1K",
    rating: 4.6,
    updated: "5 天前",
    safe: true,
    cat: "运维",
  },
  {
    name: "test-gen",
    desc: "根据变更自动生成单元测试用例",
    downloads: "980",
    rating: 4.3,
    updated: "2 周前",
    safe: true,
    cat: "测试",
  },
  {
    name: "secret-hunter",
    desc: "扫描仓库中的硬编码密钥与凭证",
    downloads: "742",
    rating: 4.1,
    updated: "9 天前",
    safe: true,
    cat: "安全",
  },
  {
    name: "sql-tuner",
    desc: "慢查询分析与索引优化建议",
    downloads: "1.4K",
    rating: 4.7,
    updated: "4 天前",
    safe: true,
    cat: "编码",
  },
  {
    name: "docs-writer",
    desc: "从代码注释生成中文技术文档",
    downloads: "633",
    rating: 4.0,
    updated: "3 周前",
    safe: true,
    cat: "文档",
  },
  {
    name: "shell-runner",
    desc: "封装常用运维脚本的一键执行",
    downloads: "289",
    rating: 2.9,
    updated: "4 月前",
    safe: false,
    cat: "运维",
  },
];

export const marketCats = ["全部", "编码", "安全", "文档", "运维", "测试"];

export const scanHistory = [
  { date: "07-27", file: "git-helper.zip", verdict: "safe" as const, note: "" },
  {
    date: "07-26",
    file: "unknown-skill.zip",
    verdict: "danger" as const,
    note: "已删除",
  },
  {
    date: "07-25",
    file: "pdf-reader.zip",
    verdict: "warn" as const,
    note: "用户已安装",
  },
  {
    date: "07-22",
    file: "k8s-operator.tar.gz",
    verdict: "safe" as const,
    note: "",
  },
  {
    date: "07-19",
    file: "shell-runner.zip",
    verdict: "warn" as const,
    note: "未安装",
  },
];

export const scanSteps = [
  "解压归档并建立文件索引",
  "远程命令执行检测",
  "密钥泄露扫描",
  "破坏性操作检测",
  "提示注入分析",
  "AI 审查意见生成",
];

export const memorySources = [
  {
    name: "Claude Code",
    count: 45,
    children: [
      { name: "项目A", count: 23 },
      { name: "项目B", count: 15 },
      { name: "其他", count: 7 },
    ],
  },
  { name: "Codex", count: 38, children: [] },
  { name: "Cursor", count: 25, children: [] },
  { name: "Cline", count: 12, children: [] },
  { name: "自定义目录", count: 8, children: [] },
];

export const memories = [
  {
    title: "我是一个产品经理",
    body: "我是一个产品经理，偏好先看结论再看论证。输出文档时请先给一句话结论，再展开三点论据，最后附风险与下一步。中文优先，术语保留英文原词。",
    date: "2026-07-27",
    ago: "2 天前",
    source: "Claude Code",
    project: "TrustTools V3.0",
  },
  {
    title: "前端自研 + 底层借鉴",
    body: "前端自研 + 底层借鉴：UI 层全部自己写，数据采集层参考 TokenTracker 的解析实现，价格表走 LiteLLM。不要直接依赖上游 UI 组件。",
    date: "2026-07-26",
    ago: "3 天前",
    source: "Codex",
    project: "TrustTools V3.0",
  },
  {
    title: "命名规范",
    body: "Skill 命名统一小写连字符，禁止下划线。版本号跟随 git tag，不手写 package 版本。",
    date: "2026-07-24",
    ago: "5 天前",
    source: "Cursor",
    project: "内部工具链",
  },
  {
    title: "数据存储位置",
    body: "所有本地数据写入 ~/.trusttools/，SQLite 单文件，不要散落到用户目录其他位置。清除数据必须二次确认。",
    date: "2026-07-21",
    ago: "8 天前",
    source: "Claude Code",
    project: "TrustTools V3.0",
  },
  {
    title: "安全检测口径",
    body: "包内所有 Skill 均被后台标记为安全才显示 🔒，只要有一个未标记就显示 ⚠️。危险结论必须给出可读的理由。",
    date: "2026-07-18",
    ago: "11 天前",
    source: "Cline",
    project: "内部工具链",
  },
  {
    title: "会议纪要：预算预警",
    body: "预算预警按日/周/月三档配置，阈值 80/90/100%，只在 Dashboard 内提醒，不做系统级弹窗打扰。",
    date: "2026-07-15",
    ago: "14 天前",
    source: "Codex",
    project: "官网重构",
  },
];

// ===== 模型下钻：Token 构成 / 行为分布 / 单价 =====
export type ModelDetail = {
  composition: { label: string; value: number; cost: string; color: string }[];
  behaviors: { label: string; tokens: string; cost: string; share: number }[];
  pricing: {
    input: string;
    output: string;
    cacheRead: string;
    cacheWrite: string;
  };
  avgLatency: string;
  calls: string;
  avgPerCall: string;
};

export const modelDetail: Record<string, ModelDetail> = {
  "sonnet-4.6": {
    composition: [
      {
        label: "输入",
        value: 1120,
        cost: "¥12.40",
        color: "var(--color-chart-1)",
      },
      {
        label: "输出",
        value: 340,
        cost: "¥14.20",
        color: "var(--color-chart-2)",
      },
      {
        label: "推理(Reasoning)",
        value: 90,
        cost: "¥3.10",
        color: "var(--color-chart-4)",
      },
      {
        label: "缓存读",
        value: 148,
        cost: "¥1.30",
        color: "var(--color-chart-3)",
      },
      {
        label: "缓存写",
        value: 22,
        cost: "¥0.50",
        color: "var(--color-chart-5)",
      },
    ],
    behaviors: [
      { label: "代码生成", tokens: "0.72M", cost: "¥14.10", share: 42 },
      { label: "代码解释 / 问答", tokens: "0.41M", cost: "¥7.20", share: 24 },
      { label: "调试与报错分析", tokens: "0.29M", cost: "¥5.40", share: 17 },
      { label: "重构 / 批量编辑", tokens: "0.19M", cost: "¥3.30", share: 11 },
      { label: "工具调用 / 检索", tokens: "0.11M", cost: "¥1.50", share: 6 },
    ],
    pricing: {
      input: "¥0.011/K",
      output: "¥0.042/K",
      cacheRead: "¥0.0009/K",
      cacheWrite: "¥0.023/K",
    },
    avgLatency: "3.4s",
    calls: "1,284",
    avgPerCall: "1.34K",
  },
  "opus-4.7": {
    composition: [
      {
        label: "输入",
        value: 610,
        cost: "¥9.80",
        color: "var(--color-chart-1)",
      },
      {
        label: "输出",
        value: 290,
        cost: "¥12.60",
        color: "var(--color-chart-2)",
      },
      {
        label: "推理(Reasoning)",
        value: 121,
        cost: "¥4.40",
        color: "var(--color-chart-4)",
      },
      {
        label: "缓存读",
        value: 82,
        cost: "¥0.90",
        color: "var(--color-chart-3)",
      },
      {
        label: "缓存写",
        value: 17,
        cost: "¥0.30",
        color: "var(--color-chart-5)",
      },
    ],
    behaviors: [
      { label: "架构设计 / 方案", tokens: "0.38M", cost: "¥10.20", share: 34 },
      { label: "代码生成", tokens: "0.31M", cost: "¥8.10", share: 28 },
      { label: "调试与报错分析", tokens: "0.22M", cost: "¥5.30", share: 20 },
      { label: "代码审查", tokens: "0.13M", cost: "¥3.10", share: 12 },
      { label: "工具调用 / 检索", tokens: "0.08M", cost: "¥1.30", share: 6 },
    ],
    pricing: {
      input: "¥0.055/K",
      output: "¥0.21/K",
      cacheRead: "¥0.005/K",
      cacheWrite: "¥0.11/K",
    },
    avgLatency: "6.1s",
    calls: "492",
    avgPerCall: "2.28K",
  },
  "deepseek-v4": {
    composition: [
      {
        label: "输入",
        value: 168,
        cost: "¥1.10",
        color: "var(--color-chart-1)",
      },
      {
        label: "输出",
        value: 44,
        cost: "¥0.72",
        color: "var(--color-chart-2)",
      },
      {
        label: "推理(Reasoning)",
        value: 19,
        cost: "¥0.18",
        color: "var(--color-chart-4)",
      },
      {
        label: "缓存读",
        value: 8,
        cost: "¥0.08",
        color: "var(--color-chart-3)",
      },
      {
        label: "缓存写",
        value: 1,
        cost: "¥0.02",
        color: "var(--color-chart-5)",
      },
    ],
    behaviors: [
      { label: "行内补全", tokens: "0.12M", cost: "¥0.90", share: 50 },
      { label: "代码生成", tokens: "0.06M", cost: "¥0.62", share: 25 },
      { label: "代码解释 / 问答", tokens: "0.04M", cost: "¥0.38", share: 17 },
      { label: "调试与报错分析", tokens: "0.02M", cost: "¥0.20", share: 8 },
    ],
    pricing: {
      input: "¥0.0065/K",
      output: "¥0.016/K",
      cacheRead: "¥0.0007/K",
      cacheWrite: "¥0.008/K",
    },
    avgLatency: "1.2s",
    calls: "2,140",
    avgPerCall: "0.11K",
  },
  "haiku-4.5": {
    composition: [
      {
        label: "输入",
        value: 120,
        cost: "¥1.30",
        color: "var(--color-chart-1)",
      },
      {
        label: "输出",
        value: 32,
        cost: "¥1.02",
        color: "var(--color-chart-2)",
      },
      {
        label: "推理(Reasoning)",
        value: 4,
        cost: "¥0.10",
        color: "var(--color-chart-4)",
      },
      {
        label: "缓存读",
        value: 12,
        cost: "¥0.20",
        color: "var(--color-chart-3)",
      },
      {
        label: "缓存写",
        value: 2,
        cost: "¥0.08",
        color: "var(--color-chart-5)",
      },
    ],
    behaviors: [
      { label: "工具调用 / 检索", tokens: "0.07M", cost: "¥1.00", share: 41 },
      { label: "摘要 / 压缩上下文", tokens: "0.05M", cost: "¥0.80", share: 29 },
      { label: "代码解释 / 问答", tokens: "0.03M", cost: "¥0.55", share: 18 },
      { label: "行内补全", tokens: "0.02M", cost: "¥0.35", share: 12 },
    ],
    pricing: {
      input: "¥0.011/K",
      output: "¥0.032/K",
      cacheRead: "¥0.0009/K",
      cacheWrite: "¥0.014/K",
    },
    avgLatency: "0.9s",
    calls: "3,410",
    avgPerCall: "0.05K",
  },
};

// ===== 通用下钻：任意维度（Provider / 项目 / 模型）都能给出构成、行为、单价 =====
function toK(v: string) {
  const n = parseFloat(v.replace(/[^\d.]/g, "")) || 0;
  return v.includes("M") ? n * 1000 : n;
}
function toYuan(v: string) {
  return parseFloat(v.replace(/[^\d.]/g, "")) || 0;
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100000;
  return h;
}
const money = (n: number) => `¥${n.toFixed(2)}`;
const kFmt = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(2)}M` : `${Math.round(n)}K`;

const behaviorSets: Record<string, string[]> = {
  provider: [
    "代码生成",
    "调试与报错分析",
    "重构 / 批量编辑",
    "工具调用 / 检索",
    "代码解释 / 问答",
  ],
  project: [
    "代码生成",
    "需求 / 方案讨论",
    "调试与报错分析",
    "测试与修复",
    "文档与注释",
  ],
  model: [
    "代码生成",
    "代码解释 / 问答",
    "调试与报错分析",
    "重构 / 批量编辑",
    "工具调用 / 检索",
  ],
};

/** 为任意行派生一份下钻明细；模型维度若已有精修数据则优先使用。 */
export function rowDetail(
  row: Row,
  dim: "provider" | "project" | "model",
): ModelDetail {
  if (modelDetail[row.name]) return modelDetail[row.name];

  const total = toK(row.tokens);
  const cost = toYuan(row.cost);
  const seed = hash(row.name);
  const cacheRatio = row.cache / 100;

  const cacheRead = total * cacheRatio * 0.22;
  const cacheWrite = total * cacheRatio * 0.04;
  const rest = total - cacheRead - cacheWrite;
  const outRatio = 0.2 + (seed % 9) / 100;
  const output = rest * outRatio;
  const reasoning = output * (0.15 + (seed % 13) / 100);
  const input = rest - output;

  const parts: {
    label: string;
    value: number;
    color: string;
    weight: number;
  }[] = [
    {
      label: "输入",
      value: input,
      color: "var(--color-chart-1)",
      weight: 0.25,
    },
    {
      label: "输出",
      value: output - reasoning,
      color: "var(--color-chart-2)",
      weight: 1,
    },
    {
      label: "推理(Reasoning)",
      value: reasoning,
      color: "var(--color-chart-4)",
      weight: 1.1,
    },
    {
      label: "缓存读",
      value: cacheRead,
      color: "var(--color-chart-3)",
      weight: 0.03,
    },
    {
      label: "缓存写",
      value: cacheWrite,
      color: "var(--color-chart-5)",
      weight: 0.5,
    },
  ];
  const wSum = parts.reduce((s, p) => s + p.value * p.weight, 0) || 1;
  const composition = parts.map((p) => ({
    label: p.label,
    value: Math.round(p.value),
    cost: money((cost * p.value * p.weight) / wSum),
    color: p.color,
  }));

  const labels = behaviorSets[dim];
  const rawShares = labels.map((_, i) => 40 - i * 7 + ((seed >> (i * 2)) % 6));
  const sum = rawShares.reduce((a, b) => a + b, 0);
  const behaviors = labels.map((label, i) => {
    const share = Math.round((rawShares[i] / sum) * 100);
    return {
      label,
      tokens: kFmt((total * share) / 100),
      cost: money((cost * share) / 100),
      share,
    };
  });

  const inRate = cost / Math.max(total, 1);
  const pricing = {
    input: `¥${(inRate * 0.45).toFixed(4)}/K`,
    output: `¥${(inRate * 2.6).toFixed(4)}/K`,
    cacheRead: `¥${(inRate * 0.05).toFixed(4)}/K`,
    cacheWrite: `¥${(inRate * 0.9).toFixed(4)}/K`,
  };

  const calls = 300 + (seed % 2600);
  return {
    composition,
    behaviors,
    pricing,
    avgLatency: `${(1 + (seed % 55) / 10).toFixed(1)}s`,
    calls: calls.toLocaleString(),
    avgPerCall: `${(total / calls).toFixed(2)}K`,
  };
}

// ===== 来源构成树（参考友商层级）：消息 / 推理 / 系统提示词 / 工具调用 / Agent / MCP / Skill =====
export type SourceNode = {
  label: string;
  tokens: number; // 单位 K
  color: string;
  children?: { label: string; tokens: number }[];
};
export type SourceTree = {
  nodes: SourceNode[];
  total: number;
  cacheHit: number; // %
  cacheReuse: number; // K
  cacheInput: number; // K
  counts: { skills: number; mcp: number; agents: number; memories: number };
};

/** 任意行（Provider / 项目 / 模型）都能派生一棵来源构成树 */
export function sourceTree(row: Row): SourceTree {
  const total = toK(row.tokens);
  const seed = hash(row.name);
  const w = (i: number, base: number) => base + ((seed >> (i * 3)) % 7) / 10;

  const msg = total * (w(0, 0.62) / 10 + 0.55);
  const messages = Math.min(msg, total * 0.8);
  const history = messages * (0.48 + (seed % 7) / 100);
  const userInput = messages * (0.44 - (seed % 5) / 100);
  const assistant = Math.max(messages - history - userInput, total * 0.004);

  const reasoning = total * (0.004 + (seed % 11) / 1000);
  const systemPrompt = total * ((seed % 3) / 1000);
  const toolCalls = total * (0.07 + (seed % 9) / 100);
  const agents = total * (0.004 + (seed % 5) / 1000);
  const mcp = total * (0.012 + (seed % 6) / 1000);
  const skills = Math.max(
    total - messages - reasoning - systemPrompt - toolCalls - agents - mcp,
    total * 0.005,
  );

  const nodes: SourceNode[] = [
    {
      label: "会话消息 Messages",
      tokens: messages,
      color: "var(--color-chart-1)",
      children: [
        { label: "对话历史 Conversation history", tokens: history },
        { label: "用户输入 User input", tokens: userInput },
        { label: "助手回复 Assistant response", tokens: assistant },
      ],
    },
    {
      label: "推理 Reasoning",
      tokens: reasoning,
      color: "var(--color-chart-4)",
    },
    {
      label: "系统提示词 System prompt",
      tokens: systemPrompt,
      color: "var(--color-chart-5)",
    },
    {
      label: "工具调用 Tool calls",
      tokens: toolCalls,
      color: "var(--color-chart-2)",
      children: [
        { label: "Read / Grep 检索", tokens: toolCalls * 0.42 },
        { label: "Edit / Write 编辑", tokens: toolCalls * 0.33 },
        { label: "Bash 执行", tokens: toolCalls * 0.17 },
        { label: "Web 抓取", tokens: toolCalls * 0.08 },
      ],
    },
    {
      label: "自定义 Agent Custom agents",
      tokens: agents,
      color: "var(--color-chart-3)",
      children: [
        { label: "code-reviewer", tokens: agents * 0.56 },
        { label: "test-runner", tokens: agents * 0.44 },
      ],
    },
    {
      label: "MCP 服务 MCP servers",
      tokens: mcp,
      color: "var(--color-chart-2)",
      children: [
        { label: "filesystem", tokens: mcp * 0.5 },
        { label: "postgres", tokens: mcp * 0.31 },
        { label: "playwright", tokens: mcp * 0.19 },
      ],
    },
    {
      label: "Skill 注入 Skills",
      tokens: skills,
      color: "var(--color-chart-4)",
      children: [
        { label: "pdf-processing", tokens: skills * 0.38 },
        { label: "git-workflow", tokens: skills * 0.34 },
        { label: "api-docs", tokens: skills * 0.28 },
      ],
    },
  ];

  const cacheHit = row.cache;
  return {
    nodes,
    total,
    cacheHit,
    cacheReuse: total * (cacheHit / 100) * 0.5,
    cacheInput: total * 0.98,
    counts: {
      skills: 12 + (seed % 54),
      mcp: seed % 4,
      agents: (seed >> 3) % 3,
      memories: (seed >> 5) % 6,
    },
  };
}
