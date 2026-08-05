import type { MessageKey } from "../i18n/messages";

/**
 * 中文即数据：安全模块的过滤器/状态/严重度等值以中文作为数据层的稳定标识
 * （scanner.ts / rules.ts / history.ts 中保持不变），展示层通过以下映射在渲染时
 * 翻译成当前语言。扫描规则的 name / kind / message 属于规则标识，不翻译。
 */
export const severityLabels: Record<string, MessageKey> = {
  高危: "security.severity.high",
  中危: "security.severity.medium",
  低危: "security.severity.low",
};

export const verdictLabels: Record<string, MessageKey> = {
  安全: "security.verdict.safe",
  可疑: "security.verdict.suspicious",
  危险: "security.verdict.dangerous",
};

export const sourceLabels: Record<string, MessageKey> = {
  内置规则: "security.source.builtin",
  用户规则: "security.source.custom",
};

export const phaseLabels: Record<string, MessageKey> = {
  空闲: "security.phase.idle",
  扫描中: "security.phase.scanning",
  已完成: "security.phase.done",
};

/** “全部”筛选值没有对应的 verdict 数据值，单独映射。 */
export const filterAllLabel: MessageKey = "security.verdict.all";
