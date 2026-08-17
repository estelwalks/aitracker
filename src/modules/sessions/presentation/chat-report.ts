import type { MessageKey, MessageParams } from "../../../lib/i18n/messages.ts";
import type { SessionSummary, SessionTranscriptMessage } from "../contracts.ts";

/**
 * Pure, locale-agnostic report/segment builders (Story S-300). They generate
 * markdown text for the 生成简报 modal and the 蒸馏所选 flow from the selected
 * session's metadata + transcript messages. All user-facing copy is resolved
 * through the injected i18n label resolver — no hardcoded strings here.
 */

export type ReportLabel = <K extends MessageKey>(
  key: K,
  params?: MessageParams<K>,
) => string;

export interface ReportInput {
  session: Pick<
    SessionSummary,
    | "title"
    | "source"
    | "projectKey"
    | "model"
    | "startedAt"
    | "turns"
    | "editTurns"
    | "totals"
  >;
  messages: readonly SessionTranscriptMessage[];
  /** Localized date label (e.g. format.formatDate(startedAt)). */
  dateLabel: string;
  /** Preformatted token strings (locale-aware). */
  tokensTotal: string;
  tokensIn: string;
  tokensOut: string;
  /** Localized model label (model ?? t("common.unknown")). */
  modelLabel: string;
  /** Localized generic reusable-experience bullets. */
  experienceItems: readonly string[];
}

export interface ReportStats {
  messages: number;
  asks: number;
  answers: number;
  thinkingCount: number;
}

export function buildReportStats(
  messages: readonly SessionTranscriptMessage[],
): ReportStats {
  const asks = messages.filter((message) => message.role === "user").length;
  const answers = messages.filter(
    (message) => message.role === "assistant",
  ).length;
  const thinkingCount = messages.filter(
    (message) => message.thinking != null && message.thinking.length > 0,
  ).length;
  return { messages: messages.length, asks, answers, thinkingCount };
}

function clampLine(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

/** Message highlights: one numbered line per message, role-prefixed. */
function highlightsSection(
  messages: readonly SessionTranscriptMessage[],
  label: ReportLabel,
): string[] {
  return messages.map((message, index) => {
    const roleLabel =
      message.role === "user"
        ? label("sessions.transcript.ask")
        : label("sessions.transcript.answer");
    return `${index + 1}. [${roleLabel}] ${clampLine(message.text, 60)}`;
  });
}

function conclusionsSection(
  messages: readonly SessionTranscriptMessage[],
  label: ReportLabel,
): string[] {
  const answers = messages.filter((message) => message.role === "assistant");
  if (answers.length === 0) {
    return [`- ${label("sessions.transcript.reportNoConclusions")}`];
  }
  return answers.map((message) => `- ${clampLine(message.text, 80)}`);
}

function reasoningSection(
  messages: readonly SessionTranscriptMessage[],
  label: ReportLabel,
): string[] {
  const thinking = messages
    .map((message) => message.thinking)
    .filter((value): value is string => value != null && value.length > 0);
  if (thinking.length === 0) {
    return [`- ${label("sessions.transcript.reportNoReasoning")}`];
  }
  return thinking.map((value) => `- ${clampLine(value, 80)}`);
}

/**
 * Markdown report for one session: 会话数/工具/项目/消息数/token 统计 +
 * 消息要点（+ 提炼结论 / 推理线索）。
 */
export function buildReportText(
  input: ReportInput,
  label: ReportLabel,
): string {
  const stats = buildReportStats(input.messages);
  const overview = [
    `${label("sessions.transcript.reportStatSessions")}：1`,
    `${label("sessions.transcript.reportStatTools")}：${input.session.source}`,
    `${label("sessions.transcript.reportStatProjects")}：${input.session.projectKey}`,
    `${label("sessions.transcript.reportStatMessages")}：${stats.messages}（${label("sessions.transcript.ask")} ${stats.asks} · ${label("sessions.transcript.answer")} ${stats.answers}）`,
    `${label("sessions.transcript.reportStatTokens")}：${input.tokensTotal}（in ${input.tokensIn} / out ${input.tokensOut}）`,
  ];
  return [
    `# ${label("sessions.transcript.reportTitle")} · ${input.dateLabel}`,
    "",
    `> ${input.session.source} · ${input.session.projectKey} · ${input.modelLabel}`,
    "",
    `## ${label("sessions.transcript.reportOverview")}`,
    ...overview.map((line) => `- ${line}`),
    "",
    `## ${label("sessions.transcript.reportHighlights")}`,
    ...highlightsSection(input.messages, label),
    "",
    `## ${label("sessions.transcript.reportConclusions")}`,
    ...conclusionsSection(input.messages, label),
    "",
    `## ${label("sessions.transcript.reportReasoning")}`,
    ...reasoningSection(input.messages, label),
  ].join("\n");
}

/** Markdown segment payload for the 蒸馏所选 flow (prototype segmentMarkdown). */
export function buildSegmentMarkdown(
  input: ReportInput & { messages: readonly SessionTranscriptMessage[] },
  label: ReportLabel,
): string {
  const stats = buildReportStats(input.messages);
  return [
    `# ${label("sessions.transcript.segmentTitle")} · ${clampLine(input.session.title, 30)}`,
    "",
    `> ${label("sessions.transcript.segmentScope", {
      count: stats.messages,
      asks: stats.asks,
      answers: stats.answers,
    })}`,
    "",
    `## ${label("sessions.transcript.reportHighlights")}`,
    ...highlightsSection(input.messages, label),
    "",
    `## ${label("sessions.transcript.reportConclusions")}`,
    ...conclusionsSection(input.messages, label),
    "",
    `## ${label("sessions.transcript.reportReasoning")}`,
    ...reasoningSection(input.messages, label),
    "",
    `## ${label("sessions.transcript.reportExperience")}`,
    ...input.experienceItems.map((item) => `- ${item}`),
  ].join("\n");
}
