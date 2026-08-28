import { RISK_KINDS, SEVERITIES, THREAT_LEVELS, type LocaleKey } from "../types.js";
import zhCN from "./zh-CN.js";
import enUS from "./en-US.js";
import jaJP from "./ja-JP.js";
import koKR from "./ko-KR.js";

type RiskKindSlug = (typeof RISK_KINDS)[number];
type SeveritySlug = (typeof SEVERITIES)[number];
type ThreatLevelSlug = (typeof THREAT_LEVELS)[number];

export interface Messages {
  kind: Record<RiskKindSlug, string>;
  severity: Record<SeveritySlug, string>;
  threatLevel: Record<ThreatLevelSlug, string>;
  ruleName: Record<string, string>;
  ruleMessage: Record<string, string>;
  remediation: Record<RiskKindSlug, string>;
  /** Fallback name used when a model finding has no ruleName. */
  modelRuleName: string;
  fileCheck: Record<"file-01" | "file-02" | "file-03" | "file-04" | "file-05", { name: string; message: string; remediation: string }>;
  summary: { clean: string; found: string; listSeparator: string; sevItem: string };
}

const RESOURCES: Record<LocaleKey, Messages> = { "zh-CN": zhCN, "en-US": enUS, "ja-JP": jaJP, "ko-KR": koKR };

/** Returns the message resources for the given locale; falls back to en-US (then zh-CN) when the locale is missing. */
export function getMessages(locale: LocaleKey): Messages {
  return RESOURCES[locale] ?? RESOURCES["en-US"] ?? RESOURCES["zh-CN"];
}

/** `{key}` template interpolation; missing keys are kept verbatim. */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`));
}
