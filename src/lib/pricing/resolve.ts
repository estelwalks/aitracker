/**
 * Source-aware pricing resolver (docs §5.3, §5.4).
 *
 * Given a compiled registry, a lookup input (toolId + rawModel + occurredAt +
 * tokens) and the tool's pricing policy, produce a `PricingResolution` with a
 * confidence level and (when knowable) a nanoUSD cost. Unknown models are never
 * a silent $0 - they become `estimated`/`unpriced`/`not-billable` per the tool's
 * fallback profile.
 *
 * Matching order is fixed by the compiled index (scope precision > matcher
 * precision > priority > effective.from). Two rules matching at the same layer
 * is an ambiguity -> `unpriced`, never a random pick.
 */
import type {
  CompiledPricingRegistry,
  CompiledRule,
  NormalizedMatcher,
} from "./compile.ts";
import {
  type FallbackProfile,
  type PricingLookupInput,
  type PricingReason,
  type PricingResolution,
  type ToolPricingPolicy,
} from "./contracts.ts";
import { calculateCost } from "./calculate.ts";
import { normalizeModel } from "./normalize.ts";

const ESTIMATES_FLAG = "TRUSTTOOLS_PRICING_ESTIMATES";

function matcherReason(kind: NormalizedMatcher["kind"]): PricingReason {
  switch (kind) {
    case "exact":
      return "exact-match";
    case "alias":
      return "alias-match";
    case "prefix":
      return "prefix-match";
    case "suffix":
      return "suffix-match";
    case "token-sequence":
      return "token-sequence-match";
    case "any":
      return "fallback-estimated";
  }
}

function matchNormalized(when: NormalizedMatcher, model: string): boolean {
  switch (when.kind) {
    case "exact":
    case "alias":
      return model === when.value;
    case "prefix":
      return model === when.value || model.startsWith(`${when.value}-`);
    case "suffix":
      return model === when.value || model.endsWith(`-${when.value}`);
    case "token-sequence": {
      // Ordered subsequence of `-`-delimited segments.
      const segs = model.split("-");
      let i = 0;
      for (const seg of segs) {
        if (seg === when.tokens[i]) i += 1;
        if (i === when.tokens.length) return true;
      }
      return i === when.tokens.length;
    }
    case "any":
      return true;
  }
}

function ruleAppliesToTool(rule: CompiledRule, toolId: string): boolean {
  const scope = rule.scope;
  if (!scope || (!scope.toolIds?.length && !scope.providers?.length))
    return true; // global
  return scope.toolIds?.includes(toolId) ?? false;
}

function rateEffectiveAt(
  rate: NonNullable<CompiledRule["rate"]>,
  occurredAt: string,
): boolean {
  const date = occurredAt.slice(0, 10);
  const from = rate.effective.from;
  const to = rate.effective.to;
  if (date < from) return false;
  if (to !== null && date > to) return false;
  return true;
}

/** Whether the `api-generic-v1` estimated profile may be used (ops-gated). */
function estimatesEnabled(): boolean {
  return process.env[ESTIMATES_FLAG] === "1";
}

function applyProfile(
  profile: FallbackProfile,
  input: PricingLookupInput,
  normalizedModel: string,
  version: string,
  conversionRuleId: string,
  reason: PricingReason,
): PricingResolution {
  const base: PricingResolution = {
    rawModel: input.rawModel,
    normalizedModel,
    conversionRuleId,
    fallbackProfileId: profile.id,
    confidence: profile.confidence,
    reason,
    packageVersion: version,
    sourceLabel: profile.label,
  };
  if (profile.confidence === "estimated" && profile.usdNanoPerMillion) {
    // The generic API estimate is ops-gated; until confirmed, unknown models stay unpriced.
    if (!estimatesEnabled()) {
      return {
        ...base,
        confidence: "unpriced",
        reason: "unpriced",
        fallbackProfileId: profile.id,
      };
    }
    const cost = calculateCost(
      {
        id: profile.id,
        canonicalModelId: normalizedModel,
        effective: { from: "0000-01-01", to: null },
        usdNanoPerMillion: profile.usdNanoPerMillion,
        source: {
          kind: "community",
          label: profile.label,
          verifiedAt: "0000-01-01",
        },
      },
      input.tokens,
      {
        billingMode: "api-metered",
        fallbackProfileRef: profile.id,
        rulePackRefs: [],
        reasoningPolicy: "ignore",
      },
    );
    if (cost === null)
      return { ...base, confidence: "unpriced", reason: "unpriced" };
    return {
      ...base,
      knownUsdNano: cost.knownUsdNano,
      costBreakdown: cost.breakdown,
    };
  }
  return base;
}

function applyFallback(
  registry: CompiledPricingRegistry,
  policy: ToolPricingPolicy,
  input: PricingLookupInput,
  normalizedModel: string,
  conversionRuleId: string,
  reason: PricingReason,
): PricingResolution {
  const profile = registry.profiles.get(policy.fallbackProfileRef);
  if (!profile) {
    return {
      rawModel: input.rawModel,
      normalizedModel,
      conversionRuleId,
      confidence: "unpriced",
      reason: "no-policy",
      packageVersion: registry.version,
    };
  }
  return applyProfile(
    profile,
    input,
    normalizedModel,
    registry.version,
    conversionRuleId,
    reason,
  );
}

export function resolvePrice(
  registry: CompiledPricingRegistry,
  input: PricingLookupInput,
  policy: ToolPricingPolicy,
): PricingResolution {
  const normalized = normalizeModel(input.rawModel);

  if (!normalized.ok) {
    return {
      rawModel: input.rawModel,
      normalizedModel: normalized.normalizedModel,
      conversionRuleId: "generic-normalize-v1",
      confidence: "unpriced",
      reason: "unsafe-model",
      packageVersion: registry.version,
    };
  }

  if (policy.billingMode === "unsupported") {
    return {
      rawModel: input.rawModel,
      normalizedModel: normalized.normalizedModel,
      conversionRuleId: "generic-normalize-v1",
      confidence: "not-billable",
      reason: "no-policy",
      packageVersion: registry.version,
    };
  }

  // Collect matching rules (registry.rules is pre-sorted by precedence).
  const matches: CompiledRule[] = [];
  for (const rule of registry.rules) {
    if (!ruleAppliesToTool(rule, input.toolId)) continue;
    if (!matchNormalized(rule.normalizedWhen, normalized.normalizedModel))
      continue;
    if (rule.rate && !rateEffectiveAt(rule.rate, input.occurredAt)) continue;
    matches.push(rule);
  }

  if (matches.length > 0) {
    const top = matches[0]!;
    // Same-layer ambiguity (same scope/matcher precision/priority) -> refuse to pick.
    const sameLayer = matches.filter(
      (r) =>
        r.scopePrecision === top.scopePrecision &&
        r.matcherPrecision === top.matcherPrecision &&
        (r.priority ?? 0) === (top.priority ?? 0),
    );
    if (sameLayer.length > 1) {
      return applyFallback(
        registry,
        policy,
        input,
        normalized.normalizedModel,
        "generic-normalize-v1",
        "unpriced",
      );
    }

    const rule = top;
    if (rule.rate) {
      const cost = calculateCost(rule.rate, input.tokens, policy);
      if (cost === null) {
        // cache-write tokens present but no cache-write price -> fallback.
        return applyFallback(
          registry,
          policy,
          input,
          normalized.normalizedModel,
          rule.id,
          "no-rate-match",
        );
      }
      return {
        rawModel: input.rawModel,
        normalizedModel: normalized.normalizedModel,
        ...(rule.convertTo ? { canonicalModelId: rule.convertTo } : {}),
        conversionRuleId: rule.id,
        rateRuleId: rule.rate.id,
        confidence: "exact",
        reason: matcherReason(rule.normalizedWhen.kind),
        packageVersion: registry.version,
        knownUsdNano: cost.knownUsdNano,
        costBreakdown: cost.breakdown,
        sourceLabel: rule.rate.source.label,
      };
    }
    if (rule.fallbackProfile) {
      return applyProfile(
        rule.fallbackProfile,
        input,
        normalized.normalizedModel,
        registry.version,
        rule.id,
        matcherReason(rule.normalizedWhen.kind),
      );
    }
  }

  // No rule matched -> tool fallback profile.
  return applyFallback(
    registry,
    policy,
    input,
    normalized.normalizedModel,
    "generic-normalize-v1",
    "no-rate-match",
  );
}
