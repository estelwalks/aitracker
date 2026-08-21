import { sha256Hex } from "../../../lib/crypto/sha256.ts";
import { catalogs, getMessage } from "../../../lib/i18n/messages.ts";
import { normalizeLocale } from "../../../lib/i18n/locale.ts";
import { INSIGHT_ACTIONS } from "./action-registry.ts";
import {
  INSIGHT_SURFACE_IDS,
  type InsightCandidate,
  type InsightEnvelope,
  type InsightEnvelopeLine,
  type InsightEvidence,
  type InsightEvidenceBundle,
  type InsightMode,
  type InsightScope,
  type InsightSeverity,
  type InsightSurfaceId,
  type PageInsightAdapter,
} from "./contracts.ts";
import { getPageRuleConfig } from "./rule-registry.ts";

const EVIDENCE_ID_RE = /^[A-Za-z0-9._:-]{1,120}$/;
const PATH_START_RE = /^(?:\/|[A-Za-z]:\\|\\)/;
const SECRET_RE = /apiKey|Bearer|password|secret|credential/i;
const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  risk: 2,
  attention: 1,
  info: 0,
};

export function isInsightSurfaceId(value: unknown): value is InsightSurfaceId {
  return (
    typeof value === "string" &&
    (INSIGHT_SURFACE_IDS as readonly string[]).includes(value)
  );
}

/**
 * Validate evidence leaves without throwing. Evidence values must be plain
 * scalars, ids must be opaque, and string values must never carry filesystem
 * paths or credential material.
 */
export function validateEvidenceBundle(
  bundle: InsightEvidenceBundle,
): string[] {
  const errors: string[] = [];
  for (const item of bundle.evidence) {
    if (!EVIDENCE_ID_RE.test(item.id)) {
      errors.push(`evidence.id.invalid:${item.id}`);
    }
    const value = item.value;
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      errors.push(`evidence.value.type:${item.id}`);
    }
    if (typeof value === "string") {
      if (PATH_START_RE.test(value)) {
        errors.push(`evidence.value.path:${item.id}`);
      }
      if (SECRET_RE.test(value)) {
        errors.push(`evidence.value.secret:${item.id}`);
      }
    }
  }
  return errors;
}

/** Validate candidate invariants against a bundle and the action registry. */
export function validateCandidates(
  bundle: InsightEvidenceBundle,
  candidates: readonly InsightCandidate[],
): string[] {
  const errors: string[] = [];
  const evidenceIds = new Set(bundle.evidence.map((item) => item.id));
  const seenIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.id)) {
      errors.push(`candidate.id.duplicate:${candidate.id}`);
    }
    seenIds.add(candidate.id);
    if (
      candidate.severity !== "info" &&
      candidate.severity !== "attention" &&
      candidate.severity !== "risk"
    ) {
      errors.push(`candidate.severity.invalid:${candidate.id}`);
    }
    for (const ref of candidate.evidenceRefs) {
      if (!evidenceIds.has(ref)) {
        errors.push(`candidate.evidenceRef.missing:${candidate.id}:${ref}`);
      }
    }
    if (candidate.actionId !== undefined) {
      if (!candidate.allowedActionIds.includes(candidate.actionId)) {
        errors.push(`candidate.action.notAllowed:${candidate.id}`);
      }
      if (!(candidate.actionId in INSIGHT_ACTIONS)) {
        errors.push(`candidate.action.unknown:${candidate.id}`);
      }
    }
  }
  return errors;
}

/** Keep only candidates that pass validation, preserving their order. */
export function filterValidCandidates(
  bundle: InsightEvidenceBundle,
  candidates: readonly InsightCandidate[],
): readonly InsightCandidate[] {
  const invalidIds = new Set<string>();
  for (const error of validateCandidates(bundle, candidates)) {
    const id = error.split(":")[1];
    if (id) invalidIds.add(id);
  }
  return candidates.filter((candidate) => !invalidIds.has(candidate.id));
}

/**
 * Rank candidates: mandatory first, then severity risk > attention > info,
 * then the original (stable) order. Truncates to `maxLines`.
 */
export function rankCandidates(
  candidates: readonly InsightCandidate[],
  maxLines: number,
): readonly InsightCandidate[] {
  const sorted = [...candidates].sort((a, b) => {
    const mandatory =
      Number(b.mandatory ?? false) - Number(a.mandatory ?? false);
    if (mandatory !== 0) return mandatory;
    return SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
  });
  return sorted.slice(0, maxLines);
}

export interface ComposeRulesEnvelopeOptions {
  readonly adapter: PageInsightAdapter;
  readonly bundle: InsightEvidenceBundle;
  readonly locale: string;
  readonly mode: InsightMode;
  readonly enhancerAvailable: boolean;
  readonly autoEnhanceAuthorized?: boolean;
  readonly now: () => number;
}

/**
 * Project validated candidates into a rule-only envelope. `locale` is passed
 * through untouched — text resolution happens in the UI via `t()`.
 */
export function composeRulesEnvelope(
  options: ComposeRulesEnvelopeOptions,
): InsightEnvelope {
  const adapter = options.adapter;
  const bundle = options.bundle;
  const mode = options.mode;
  const candidates = filterValidCandidates(
    bundle,
    adapter.composeCandidates(bundle),
  );
  const maxLines = getPageRuleConfig(adapter.surfaceId).maxLines;
  const lines: InsightEnvelopeLine[] = rankCandidates(candidates, maxLines).map(
    (candidate) => ({
      id: candidate.id,
      severity: candidate.severity,
      key: candidate.factKey,
      params: candidate.factParams,
      source: "rules",
      ...(candidate.actionId !== undefined
        ? {
            action: {
              id: candidate.actionId,
              labelKey: INSIGHT_ACTIONS[candidate.actionId].labelKey,
            },
          }
        : {}),
    }),
  );

  const hasStale =
    bundle.partial === true ||
    bundle.evidence.some((item) => item.freshness === "stale");

  return {
    surfaceId: adapter.surfaceId,
    status: hasStale ? "stale" : "rules",
    lines,
    generatedAt: new Date(options.now()).toISOString(),
    source: "rules",
    canEnhance: options.enhancerAvailable && mode !== "rules",
    autoEnhance:
      options.enhancerAvailable &&
      mode === "enhanced-auto" &&
      options.autoEnhanceAuthorized === true,
  };
}

/** Resolve a candidate's fact text for the enhancer input. Unknown locales fall back to zh-CN. */
export function resolveFactText(
  locale: string,
  candidate: InsightCandidate,
): string {
  const catalog = catalogs[normalizeLocale(locale) ?? "zh-CN"];
  return getMessage(catalog, candidate.factKey, { ...candidate.factParams });
}

/** Deterministic key-order-independent JSON serialization over a whitelist projection. */
function stableStringify(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Canonical scope identity: only `range` and `entityId` participate. */
export function canonicalScopeHash(scope: InsightScope): string {
  return sha256Hex(
    stableStringify({
      range: scope.range ?? null,
      entityId: scope.entityId ?? null,
    }),
  );
}

function projectEvidence(item: InsightEvidence): Record<string, unknown> {
  return {
    id: item.id,
    kind: item.kind,
    value: item.value,
    unit: item.unit ?? null,
    freshness: item.freshness,
    sensitivity: item.sensitivity,
  };
}

/**
 * Semantic evidence identity over a whitelist of fields. Sampling timestamps
 * (`bundle.observedAt` and item `observedAt`) and extra fields do not affect
 * the hash; content, freshness, scope and completeness still do.
 */
export function evidenceHash(bundle: InsightEvidenceBundle): string {
  return sha256Hex(
    stableStringify({
      surfaceId: bundle.surfaceId,
      scope: {
        range: bundle.scope.range ?? null,
        entityId: bundle.scope.entityId ?? null,
      },
      evidence: bundle.evidence.map(projectEvidence),
      partial: bundle.partial ?? null,
    }),
  );
}
