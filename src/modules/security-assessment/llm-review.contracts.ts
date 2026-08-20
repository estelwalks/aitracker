/**
 * Browser-safe contracts for the optional LLM review supplement (M4).
 *
 * The review consumes a deliberately small, allowlisted aggregate only:
 * per-dimension hit counts, severity counts, verdict, asset kind and rule
 * version. It never receives source code, file contents, excerpts, paths,
 * project names, session/memory bodies, API keys or any other local text.
 *
 * The model output is validated server-side and attached as a read-only
 * `llmReview` supplement — it can never change the static verdict, hide
 * findings, or downgrade severity.
 */
import type { AssetKind, AssetVerdict } from "./contracts";
import type { SecurityRuleKind } from "../../lib/security/security-rule-kinds";
import type {
  SecurityRiskKind,
  SecuritySeverity,
  SecurityVerdict,
} from "./presentation/security-view";

/** Global preference key (boolean) controlling the optional LLM review. */
export const SECURITY_LLM_REVIEW_PREF_KEY = "tt.security.llmReview";

/**
 * Fixed English dimension vocabulary sent to the model. It maps 1:1 onto the
 * 11 static rule dimensions and is the only per-dimension data that leaves the
 * server: a hit flag plus a non-negative integer count. No names, excerpts,
 * paths or messages are ever included.
 */
export const SECURITY_LLM_DIMENSIONS = [
  "rce",
  "exfil",
  "secret",
  "persist",
  "destruct",
  "obfus",
  "inject",
  "privesc",
  "files",
  "network",
  "prompt",
] as const;
export type SecurityLlmDimension = (typeof SECURITY_LLM_DIMENSIONS)[number];

export interface SecurityLlmDimensionHit {
  readonly hit: boolean;
  readonly count: number;
}

/** The complete allowlist for the outbound provider payload. */
export interface SecurityLlmReviewAggregate {
  readonly dimensions: Readonly<
    Record<SecurityLlmDimension, SecurityLlmDimensionHit>
  >;
  readonly severityCounts: {
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly verdict: AssetVerdict;
  readonly assetKind: AssetKind;
  readonly rulesVersion: string;
}

export type SecurityLlmReviewConfidence = "low" | "medium" | "high";

export interface SecurityLlmReviewDimension {
  readonly kind: SecurityLlmDimension;
  /** Free-text analysis; no numbers, URLs, paths or commands. */
  readonly analysis: string;
}

/** Renderer-safe, read-only supplement. It never carries a verdict. */
export interface SecurityLlmReview {
  readonly summary: string;
  readonly dimensions: readonly SecurityLlmReviewDimension[];
  readonly confidence: SecurityLlmReviewConfidence;
  readonly reviewedAt: string;
  readonly modelLabel: string;
}

export type SecurityLlmReviewStatus =
  "reviewed" | "not-configured" | "disabled" | "degraded";

export interface SecurityLlmReviewResult {
  readonly status: SecurityLlmReviewStatus;
  readonly review: SecurityLlmReview | null;
}

export interface SecurityLlmReviewAvailability {
  readonly configured: boolean;
  readonly enabled: boolean;
}

/** Browser request: only an opaque identifier for an authoritative history row. */
export interface SecurityLlmReviewRequest {
  readonly historyEntryId: string;
}

/** Server-only input rebuilt from persisted security history. */
export interface SecurityLlmReviewAggregateRequest {
  readonly assetRef: string;
  readonly aggregate: SecurityLlmReviewAggregate;
}

const RISK_KIND_TO_DIMENSION: Record<SecurityRiskKind, SecurityLlmDimension> = {
  remote_execution: "rce",
  command_injection: "inject",
  data_exfiltration: "exfil",
  secret_access: "secret",
  persistence: "persist",
  destructive: "destruct",
  obfuscation: "obfus",
  privilege_escalation: "privesc",
  sensitive_file_access: "files",
  network_abuse: "network",
  prompt_injection: "prompt",
};

const CHINESE_KIND_TO_DIMENSION: Record<
  SecurityRuleKind,
  SecurityLlmDimension
> = {
  远程命令执行: "rce",
  数据泄露: "exfil",
  密钥泄露: "secret",
  持久化: "persist",
  破坏性操作: "destruct",
  代码混淆: "obfus",
  注入攻击: "inject",
  权限提升: "privesc",
  文件访问: "files",
  网络外联: "network",
  提示注入: "prompt",
};

/** Maps a presentation risk kind (desktop `SecurityReportView` findings). */
export function securityLlmDimensionOfRiskKind(
  kind: SecurityRiskKind,
): SecurityLlmDimension {
  return RISK_KIND_TO_DIMENSION[kind];
}

/** Maps a Chinese static-rule kind (`src/lib/security/scanner.ts`). */
export function securityLlmDimensionOfChineseKind(
  kind: SecurityRuleKind,
): SecurityLlmDimension {
  return CHINESE_KIND_TO_DIMENSION[kind];
}

const VERDICT_TO_ASSET_VERDICT: Record<SecurityVerdict, AssetVerdict> = {
  allow: "clean",
  warn: "suspicious",
  block: "dangerous",
  unknown: "unknown",
};

function emptyDimensions(): Record<
  SecurityLlmDimension,
  SecurityLlmDimensionHit
> {
  return {
    rce: { hit: false, count: 0 },
    exfil: { hit: false, count: 0 },
    secret: { hit: false, count: 0 },
    persist: { hit: false, count: 0 },
    destruct: { hit: false, count: 0 },
    obfus: { hit: false, count: 0 },
    inject: { hit: false, count: 0 },
    privesc: { hit: false, count: 0 },
    files: { hit: false, count: 0 },
    network: { hit: false, count: 0 },
    prompt: { hit: false, count: 0 },
  };
}

/**
 * Builds the sanitized aggregate from a renderer report. Only dimension
 * counts, severity counts, verdict, asset kind and rule version are kept —
 * findings, paths, excerpts, messages and source are discarded here.
 */
export function buildSecurityLlmReviewAggregate(input: {
  readonly verdict: SecurityVerdict;
  readonly rulesVersion: string;
  readonly assetKind?: AssetKind;
  readonly findings: readonly {
    kind: SecurityRiskKind;
    severity: SecuritySeverity;
  }[];
}): SecurityLlmReviewAggregate {
  const dimensions = emptyDimensions();
  const severityCounts = { high: 0, medium: 0, low: 0 };
  for (const finding of input.findings) {
    const dimension = RISK_KIND_TO_DIMENSION[finding.kind];
    if (dimension) {
      const hit = dimensions[dimension];
      dimensions[dimension] = { hit: true, count: hit.count + 1 };
    }
    if (finding.severity === "critical" || finding.severity === "high") {
      severityCounts.high += 1;
    } else if (finding.severity === "medium") {
      severityCounts.medium += 1;
    } else {
      severityCounts.low += 1;
    }
  }
  return {
    dimensions,
    severityCounts,
    verdict: VERDICT_TO_ASSET_VERDICT[input.verdict] ?? "unknown",
    assetKind: input.assetKind ?? "skill",
    rulesVersion: input.rulesVersion,
  };
}
