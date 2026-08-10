/**
 * Route-first pricing resolver (audit P1-1, docs §5.3, §5.4, §6).
 *
 * A price is owned by a *billing route*, never by an AI tool. The resolver
 * therefore:
 *
 * 1. Selects the billing route from log evidence (`PricingLookupInput.evidence`,
 *    e.g. `{ endpoint: "https://api.deepseek.com" }`) via `routeSelectionRules`
 *    (equals/contains/present - restricted matching only), falling back to a
 *    `contains` check of `billingRoutes[].endpointEvidence` values against the
 *    route's `provider`.
 * 2. Queries the selected route's model rates: `scope.billingRouteIds` filter
 *    (empty = unrestricted), `rate.billingRouteId === selected route`, region
 *    (absent = "global") and the effective window.
 * 3. When NO route evidence exists, rate matching is restricted to routes
 *    declared `reference: true` (billing-routes.json) and the resolution is
 *    `estimated` (reason `no-route-evidence`) - a reference price, never an
 *    exact/official bill. Evidence-不足时绝不默认采用「模型官方价」.
 * 4. Keeps the full evidence chain: rawModel / normalizedModel /
 *    canonicalModelId / conversionRuleId / rateRuleId / billingRouteId /
 *    routeSelectionRuleId / packageVersion / confidence / reason / sourceLabel.
 *
 * Fallback behavior comes solely from the packaged JSON (fallback-profiles +
 * `reference` declarations); no environment variable can rewrite it.
 * `api-generic-v1` is `estimated` in the JSON, so estimates are the default
 * behavior (`reviewRequired: true` stays as a data marker, not a runtime gate).
 *
 * Matching order is fixed by the compiled index (scope precision > matcher
 * precision > priority > effective.from). Two rules matching at the same layer
 * is an ambiguity -> the fallback profile, never a random pick.
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
} from "./contracts.ts";
import { calculateCost, type TokenSemantics } from "./calculate.ts";
import { normalizeModel } from "./normalize.ts";

/**
 * Resolver options computed by the caller (the pricing module has no reverse
 * import of the tool registry). `fallbackProfileId` derives from the tool's
 * usage capability (usage-capable -> `api-generic-v1`; a profile-less tool is
 * `notBillable`); `reasoningIncludedInOutput` comes from the tool's
 * `modelObservation.tokenSemantics`.
 */
export interface ResolveOptions {
  /** Fallback profile applied when no rule matches. Default `api-generic-v1`. */
  fallbackProfileId?: string;
  /** Tools without a usage plan are never billed (`not-billable`). */
  notBillable?: boolean;
  /** Tool provider (for `scope.providers` rules); absent = never matches provider-scoped rules. */
  toolProvider?: string;
  /** Usage-parsing semantics for the cost calculator. */
  reasoningIncludedInOutput?: boolean;
}

interface RouteSelection {
  routeId: string;
  routeSelectionRuleId?: string;
}

interface ResolvedOptions {
  fallbackProfileId: string;
  notBillable: boolean;
  toolProvider: string | undefined;
  reasoningIncludedInOutput: boolean;
}

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

function ruleAppliesToTool(
  rule: CompiledRule,
  toolId: string,
  toolProvider: string | undefined,
): boolean {
  const scope = rule.scope;
  if (!scope || (!scope.toolIds?.length && !scope.providers?.length))
    return true; // global
  if (scope.toolIds?.length && !scope.toolIds.includes(toolId)) return false;
  if (
    scope.providers?.length &&
    (toolProvider === undefined || !scope.providers.includes(toolProvider))
  ) {
    return false;
  }
  return true;
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

/**
 * Route filter for a rule:
 * - Evidence mode (`routeId` set): the rule must be route-scoped to the
 *   selected route (empty `scope.billingRouteIds` = unrestricted) and its rate
 *   must be owned by the selected route with a matching region.
 * - Reference mode (`routeId` null): only rates owned by a route declared
 *   `reference: true` may price the event (reference price, not an official
 *   bill). Fallback-profile rules are route-agnostic.
 */
function ruleMatchesRoute(
  rule: CompiledRule,
  route: RouteSelection | null,
  registry: CompiledPricingRegistry,
): boolean {
  if (!rule.rate) return true;
  const scoped = rule.scope?.billingRouteIds;
  if (scoped && scoped.length > 0 && route === null) return false;
  if (
    scoped &&
    scoped.length > 0 &&
    route !== null &&
    !scoped.includes(route.routeId)
  ) {
    return false;
  }
  if (route !== null) {
    if (rule.rate.billingRouteId !== route.routeId) return false;
    const selected = registry.billingRoutes.get(route.routeId);
    const region = selected?.region?.default ?? "global";
    if ((rule.rate.region ?? "global") !== region) return false;
    return true;
  }
  const owner = registry.billingRoutes.get(rule.rate.billingRouteId);
  return owner?.reference === true;
}

/**
 * Select the billing route from log evidence (docs §5.4 + audit P1-1):
 * route-selection rules first (pre-sorted by priority desc), then an evidence
 * `contains` fallback over `billingRoutes[].endpointEvidence` values matched
 * against the route's `provider`. Returns `null` when there is no evidence or
 * no unambiguous route - callers then price via reference routes only.
 */
export function selectRoute(
  registry: CompiledPricingRegistry,
  evidence: Record<string, string> | undefined,
): RouteSelection | null {
  if (!evidence) return null;

  for (const rule of registry.routeSelectionRules) {
    const value = evidence[rule.when.field];
    if (value === undefined || value === "") continue;
    if (rule.when.equals !== undefined) {
      if (value === rule.when.equals) {
        return { routeId: rule.routeId, routeSelectionRuleId: rule.id };
      }
      continue;
    }
    if (rule.when.contains !== undefined) {
      if (value.includes(rule.when.contains)) {
        return { routeId: rule.routeId, routeSelectionRuleId: rule.id };
      }
      continue;
    }
    // `present` (schema guarantees exactly one of equals/contains/present).
    return { routeId: rule.routeId, routeSelectionRuleId: rule.id };
  }

  // Evidence-contains fallback: endpoint/baseUrl containing the route provider.
  const candidates: RouteSelection[] = [];
  for (const route of registry.billingRoutes.values()) {
    if (route.status === "retired" || !route.provider) continue;
    const needle = route.provider.toLowerCase();
    for (const field of route.endpointEvidence ?? []) {
      const value = evidence[field];
      if (value !== undefined && value.toLowerCase().includes(needle)) {
        candidates.push({ routeId: route.id });
        break;
      }
    }
  }
  if (candidates.length === 1) return candidates[0]!;
  return null; // 0 or multiple -> treat as "no route evidence"
}

function applyProfile(
  profile: FallbackProfile,
  input: PricingLookupInput,
  normalizedModel: string,
  version: string,
  conversionRuleId: string,
  reason: PricingReason,
  semantics: TokenSemantics,
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
    // The generic API estimate is the packaged-JSON default: `estimated` in
    // fallback-profiles.json means estimated - no environment variable gates it.
    // The synthetic rate carries the profile id as its route owner internally;
    // the resolution intentionally does NOT claim a billing route.
    const cost = calculateCost(
      {
        id: profile.id,
        canonicalModelId: normalizedModel,
        billingRouteId: profile.id,
        effective: { from: "0000-01-01", to: null },
        usdNanoPerMillion: profile.usdNanoPerMillion,
        source: {
          kind: "community",
          label: profile.label,
          verifiedAt: "0000-01-01",
        },
      },
      input.tokens,
      semantics,
    );
    if (cost === null)
      return { ...base, confidence: "unpriced", reason: "unpriced" };
    return {
      ...base,
      knownUsdNano: cost.knownUsdNano,
      cacheSavingsUsdNano: cost.cacheSavingsUsdNano,
      costBreakdown: cost.breakdown,
    };
  }
  return base;
}

function applyFallback(
  registry: CompiledPricingRegistry,
  options: ResolvedOptions,
  input: PricingLookupInput,
  normalizedModel: string,
  conversionRuleId: string,
  reason: PricingReason,
): PricingResolution {
  const profile = registry.profiles.get(options.fallbackProfileId);
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
    { reasoningIncludedInOutput: options.reasoningIncludedInOutput },
  );
}

export function resolvePrice(
  registry: CompiledPricingRegistry,
  input: PricingLookupInput,
  options: ResolveOptions = {},
): PricingResolution {
  const opts: ResolvedOptions = {
    fallbackProfileId: options.fallbackProfileId ?? "api-generic-v1",
    notBillable: options.notBillable ?? false,
    toolProvider: options.toolProvider,
    // Pre-migration parity: reasoning tokens are not billed a second time.
    reasoningIncludedInOutput: options.reasoningIncludedInOutput ?? true,
  };
  const semantics: TokenSemantics = {
    reasoningIncludedInOutput: opts.reasoningIncludedInOutput,
  };

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

  if (opts.notBillable) {
    return {
      rawModel: input.rawModel,
      normalizedModel: normalized.normalizedModel,
      conversionRuleId: "generic-normalize-v1",
      confidence: "not-billable",
      reason: "no-policy",
      packageVersion: registry.version,
    };
  }

  // 1. Route selection (evidence -> route-selection rules -> contains fallback).
  const route = selectRoute(registry, input.evidence);
  const reference = route === null; // no route evidence -> reference price only

  // 2. Collect matching rules (registry.rules is pre-sorted by precedence).
  const matches: CompiledRule[] = [];
  for (const rule of registry.rules) {
    if (!ruleAppliesToTool(rule, input.toolId, opts.toolProvider)) continue;
    if (!matchNormalized(rule.normalizedWhen, normalized.normalizedModel))
      continue;
    if (rule.rate) {
      if (!rateEffectiveAt(rule.rate, input.occurredAt)) continue;
      if (!ruleMatchesRoute(rule, route, registry)) continue;
    }
    matches.push(rule);
  }

  if (matches.length > 0) {
    const top = matches[0]!;
    // Same-layer ambiguity (same scope/matcher precision/priority) -> refuse to
    // pick; degrade to the fallback profile instead of guessing.
    const sameLayer = matches.filter(
      (r) =>
        r.scopePrecision === top.scopePrecision &&
        r.matcherPrecision === top.matcherPrecision &&
        (r.priority ?? 0) === (top.priority ?? 0),
    );
    if (sameLayer.length > 1) {
      return applyFallback(
        registry,
        opts,
        input,
        normalized.normalizedModel,
        "generic-normalize-v1",
        "unpriced",
      );
    }

    const rule = top;
    if (rule.rate) {
      const cost = calculateCost(rule.rate, input.tokens, semantics);
      if (cost === null) {
        // cache-write tokens present but no cache-write price -> fallback.
        return applyFallback(
          registry,
          opts,
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
        billingRouteId: rule.rate.billingRouteId,
        ...(route?.routeSelectionRuleId
          ? { routeSelectionRuleId: route.routeSelectionRuleId }
          : {}),
        // Without route evidence the amount is a reference price, never exact.
        confidence: reference ? "estimated" : "exact",
        reason: reference
          ? "no-route-evidence"
          : matcherReason(rule.normalizedWhen.kind),
        packageVersion: registry.version,
        knownUsdNano: cost.knownUsdNano,
        cacheSavingsUsdNano: cost.cacheSavingsUsdNano,
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
        semantics,
      );
    }
  }

  // 3. No rule matched -> the caller-selected fallback profile (packaged JSON).
  return applyFallback(
    registry,
    opts,
    input,
    normalized.normalizedModel,
    "generic-normalize-v1",
    "no-rate-match",
  );
}
