import type {
  ReportDefinition,
  ReportDefinitionSummary,
  ReportDocument,
  ReportKind,
  ReportSummary,
} from "./contracts.ts";

export const BUILTIN_REPORT_DEFINITIONS: readonly ReportDefinition[] = [
  {
    definitionId: "reports.daily",
    kind: "daily",
    title: "Daily brief",
    template: {
      templateId: "reports.daily.default",
      version: 2,
      label: "Daily brief v2",
      template:
        "你是 AITracker 的日报生成助手。根据下方提供的「今日 AI 协作会话汇总」，写一份中文 Markdown 日报草稿。要求：\n" +
        "1. 全文用中文，Markdown 格式。\n" +
        "2. 结构固定，依次为：`## 今日摘要`（一段话，引用会话数、Token、成本、主要项目等真实数字）、`## Agent 使用详情`（表格，列：Agent | 会话 | Tokens | 成本 | 改动 | 时长，内容取自提供的汇总）、`## 蒸馏产出`（本时段高价值会话的蒸馏机会）、`## 安全概况`（安全与风险观察）、`## 明日建议`（2-3 条可执行建议）、末尾加块引用 `> 本报告由 AI 依据今日会话自动生成草稿，可直接编辑后保存。`\n" +
        "3. 只使用提供的真实数字；没有的项目如实写「暂无」，绝不编造。\n" +
        "4. 不出现任何路径、命令、密钥或会话正文。",
    },
    scheduleRef: {
      taskId: "reports.generate.daily",
      scheduleId: "reports.daily",
    },
    enabled: true,
  },
  {
    definitionId: "reports.weekly",
    kind: "weekly",
    title: "Weekly review",
    template: {
      templateId: "reports.weekly.default",
      version: 2,
      label: "Weekly review v2",
      template:
        "你是 AITracker 的周报生成助手。根据下方提供的「本周 AI 协作会话汇总」，写一份中文 Markdown 周报草稿。要求：\n" +
        "1. 全文用中文，Markdown 格式。\n" +
        "2. 结构固定，依次为：`## 本周摘要`（一段话，引用会话数、Token、成本、主要项目等真实数字）、`## Agent 使用详情`（表格，列：Agent | 会话 | Tokens | 成本 | 改动 | 时长，内容取自提供的汇总）、`## 蒸馏产出`（本周可沉淀的 Skill/记忆）、`## 安全概况`（安全与风险观察）、`## 下周建议`（2-3 条可执行建议）、末尾加块引用 `> 本报告由 AI 依据本周会话自动生成草稿，可直接编辑后保存。`\n" +
        "3. 只使用提供的真实数字；没有的项目如实写「暂无」，绝不编造。\n" +
        "4. 不出现任何路径、命令、密钥或会话正文。",
    },
    scheduleRef: {
      taskId: "reports.generate.weekly",
      scheduleId: "reports.weekly",
    },
    enabled: true,
  },
];

export function toReportSummary(
  document: ReportDocument,
  definition: ReportDefinition,
): ReportSummary {
  return {
    reportId: document.reportId,
    runId: document.runId,
    definitionId: document.definitionId,
    kind: definition.kind,
    status: document.status,
    title: document.title,
    generatedAt: document.generatedAt,
    templateVersion: document.templateVersion,
    evidence: document.evidence,
    assets: document.assets,
  };
}

export function toDefinitionSummary(
  definition: ReportDefinition,
): ReportDefinitionSummary {
  return {
    definitionId: definition.definitionId,
    kind: definition.kind,
    title: definition.title,
    templateVersion: definition.template.version,
    scheduleRef: definition.scheduleRef,
    enabled: definition.enabled,
  };
}

export function validKind(value: unknown): value is ReportKind {
  return value === "daily" || value === "weekly";
}

export function canTransition(
  from: ReportDocument["status"],
  to: ReportDocument["status"],
): boolean {
  return (
    (from === "draft" && to === "approved") ||
    ((from === "draft" || from === "approved") && to === "archived")
  );
}

/**
 * Storage boundary for report bodies. This is NOT a free choice: the `reports`
 * table carries `CHECK (length(body) BETWEEN 1 AND 60000)` in migration
 * `0001_initial_schema` (line ~583). SQLite cannot alter a CHECK on an existing
 * table, and the migration is checksum-validated against already-created
 * databases — so the durable limit stays 60,000 characters and `safeReportText`
 * keeps truncating here. The transport layer (server-fns) allows up to 2 MiB;
 * anything above the DB boundary is truncated explicitly and signalled via
 * `wasReportTextTruncated` instead of silently dropped (P1-10).
 */
export const REPORT_BODY_MAX = 60_000;

export function safeReportText(value: string, max = REPORT_BODY_MAX): string {
  const text = value.trim().slice(0, max);
  if (!text) throw new TypeError("report body is empty");
  if (
    /(?:\/Users\/|\/home\/|[A-Za-z]:\\|\\\\|\b(?:bearer|sk-|api[_-]?key|password|secret)\b)/i.test(
      text,
    )
  )
    throw new TypeError("report body contains sensitive data");
  return text;
}

/**
 * Explicit truncation signal (P1-10): true when `value` exceeds the storage
 * boundary and a persistence path would slice it. Callers surface this to the
 * user ("正文超过 60,000 字符将被截断") instead of truncating silently.
 */
export function wasReportTextTruncated(
  value: string,
  max = REPORT_BODY_MAX,
): boolean {
  return value.trim().length > max;
}
