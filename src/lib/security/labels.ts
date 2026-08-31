import type { MessageKey } from "../i18n/messages";

/**
 * Chinese is data: the filter/status/severity and other values of the security module use Chinese as a stable identifier of the data layer
 * (remain unchanged in scanner.ts / rules.ts / history.ts), the presentation layer is rendered when rendering through the following mapping
 * Translate into current language. The name / kind / message of the scanning rule belongs to the rule identifier and is not translated.
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

/** The "all" filter value does not have a corresponding verdict data value and is mapped separately. */
export const filterAllLabel: MessageKey = "security.verdict.all";
