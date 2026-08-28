import { RULE_SEEDS } from "./rules.js";
import type { RiskKind, Severity } from "../types.js";

export const RULES_VERSION = "2026.08.11-knownsec-76";
export const ENGINE_VERSION = "0.2.0";

export interface StaticRule {
  id: string;
  kind: RiskKind;
  severity: Severity;
  pattern: string;
  weight: number;
  name: string;
  nameZh: string;
  message: string;
  messageZh: string;
  remediation: string;
  remediationZh: string;
  cweId?: string;
  fileTypes?: string[];
  bypassVerification?: boolean;
}

/** Language-independent static rule set; rule names/messages/remediation are pulled from i18n by request locale. */
export const STATIC_RULES: StaticRule[] = RULE_SEEDS;
