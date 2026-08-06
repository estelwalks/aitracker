/**
 * Pricing rule-pack compiler (v2 — P1-1 route dimension + P1-2 matcher
 * intersection ambiguity detection).
 *
 * Pure function: takes the already-Zod-validated `PricingPack[]` (from
 * pricing-definitions.generated.ts) + a version hash, expands rate/profile
 * references, normalizes matcher values once, detects conflicts, and builds a
 * deterministic sorted rule index for the resolver. No filesystem, no network,
 * no JSON parsing here. The route dimension (billing routes, route-selection
 * rules, model catalog) is global registry data and is imported from the same
 * generated module.
 *
 * Conflict policy (docs §5.4, §6 + P1-1/P1-2):
 * - Duplicate rate id / fallback profile id -> error.
 * - Unresolved rateRef / fallbackProfileRef -> error.
 * - Matcher value that normalizes to unsafe/empty -> error.
 * - Two rates for the SAME billingRouteId + canonicalModelId + region with
 *   overlapping effective dates -> error. The rate primary key is
 *   `billingRouteId + canonicalModelId + region + effective`, so different
 *   routes or regions never conflict and non-overlapping historical segments
 *   are legal.
 * - Two rules in the SAME ambiguity domain whose match sets intersect at the
 *   SAME matcher-precision layer -> error. The ambiguity domain is
 *   billingRouteId (from the rule's rate, or `scope.billingRouteIds` when set)
 *   × canonicalModelId (`convertTo`) × region × priority × effective interval,
 *   restricted to scopes that can apply to the same tool. Matchers at
 *   DIFFERENT precision (exact > alias > prefix > suffix > token-sequence >
 *   any) are never ambiguous: the fixed sort guarantees the more precise rule
 *   wins, which is the existing decision-tree contract. Intersection uses
 *   decidable set logic (`matchersIntersect`); pairs that cannot be proven
 *   disjoint are conservatively treated as intersecting — failing at build
 *   time is safer than depending on array order at runtime.
 * - Unreferenced rate / profile -> warning.
 * Sort keys stay fixed: scope precision > matcher precision > priority >
 * effective.from. Route/region are NOT sort keys: they delimit the ambiguity
 * domain, while route selection happens in the resolver before rule matching.
 */
import {
  MATCHER_PRECISION,
  type BillingRoute,
  type ConversionRule,
  type FallbackProfile,
  type ModelCatalogEntry,
  type ModelMatcher,
  type PricingPack,
  type RateRule,
  type RouteSelectionRule,
} from "./contracts.ts";
import { normalizeModel } from "./normalize.ts";
import {
  PRICING_BILLING_ROUTES,
  PRICING_MODEL_CATALOG,
  PRICING_ROUTE_SELECTION_RULES,
} from "./pricing-definitions.generated.ts";

export type CompileSeverity = "error" | "warning";

export interface CompileDiagnostic {
  severity: CompileSeverity;
  code: string;
  message: string;
}

export type ScopePrecision = 0 | 1 | 2 | 3; // 0 none, 1 global, 2 provider, 3 tool

/** Matcher with values already normalized by generic-normalize-v1. */
export type NormalizedMatcher =
  | { kind: "exact"; value: string }
  | { kind: "alias"; value: string }
  | { kind: "prefix"; value: string }
  | { kind: "suffix"; value: string }
  | { kind: "token-sequence"; tokens: readonly string[] }
  | { kind: "any" };

export interface CompiledRule extends ConversionRule {
  scopePrecision: ScopePrecision;
  matcherPrecision: number;
  /** Matcher with normalized value(s); the resolver compares against this. */
  normalizedWhen: NormalizedMatcher;
  /** Resolved rate (when rateRef present). */
  rate?: RateRule;
  /** Resolved fallback profile (when fallbackProfileRef present). */
  fallbackProfile?: FallbackProfile;
}

export interface CompiledPricingRegistry {
  version: string;
  rates: ReadonlyMap<string, RateRule>;
  profiles: ReadonlyMap<string, FallbackProfile>;
  /** Billing routes (P1-1); keyed by route id. */
  billingRoutes: ReadonlyMap<string, BillingRoute>;
  /** Route-selection rules (P1-1), sorted by priority desc, then id. */
  routeSelectionRules: readonly RouteSelectionRule[];
  /** Model catalog (P1-1); keyed by canonical model id. */
  modelCatalog: ReadonlyMap<string, ModelCatalogEntry>;
  rules: readonly CompiledRule[];
  diagnostics: readonly CompileDiagnostic[];
}

/** Normalize a matcher's value(s); returns null if any value is unsafe/empty. */
function normalizeMatcher(matcher: ModelMatcher): NormalizedMatcher | null {
  if (matcher.kind === "any") return { kind: "any" };
  if (matcher.kind === "token-sequence") {
    const tokens: string[] = [];
    for (const t of matcher.tokens) {
      const n = normalizeModel(t);
      if (!n.ok) return null;
      tokens.push(n.normalizedModel);
    }
    return { kind: "token-sequence", tokens };
  }
  const n = normalizeModel(matcher.value);
  if (!n.ok) return null;
  return { kind: matcher.kind, value: n.normalizedModel };
}

function scopePrecisionOf(scope: ConversionRule["scope"]): ScopePrecision {
  if (scope?.toolIds && scope.toolIds.length > 0) return 3;
  if (scope?.providers && scope.providers.length > 0) return 2;
  return 1;
}

function rangesOverlap(
  aFrom: string,
  aTo: string | null,
  bFrom: string,
  bTo: string | null,
): boolean {
  const aEnd = aTo ?? "9999-12-31";
  const bEnd = bTo ?? "9999-12-31";
  return aFrom <= bEnd && bFrom <= aEnd;
}

/** `alias` matchers carry `exact` semantics (P1-2). */
function exactValueOf(when: NormalizedMatcher): string | null {
  if (when.kind === "exact" || when.kind === "alias") return when.value;
  return null;
}

/** Does the exact/alias value `value` intersect matcher `when`? */
function exactIntersects(value: string, when: NormalizedMatcher): boolean {
  switch (when.kind) {
    case "exact":
    case "alias":
      return value === when.value;
    case "prefix":
      return value === when.value || value.startsWith(`${when.value}-`);
    case "suffix":
      return value === when.value || value.endsWith(`-${when.value}`);
    case "token-sequence": {
      // Ordered subsequence of `-`-delimited segments (mirrors resolve.ts).
      const segs = value.split("-");
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

/**
 * Decidable matcher-set intersection (P1-2). Semantics mirror `matchNormalized`
 * in resolve.ts. Every pair in the restricted matcher language is decidable;
 * pairs that cannot be proven disjoint are conservatively reported as
 * intersecting (build-time rejection beats runtime order dependence).
 *
 * Decision table (unit-tested in compile.test.ts):
 * - `any` intersects everything.
 * - exact/alias × exact/alias: intersect iff values are equal.
 * - exact × prefix: value equals the prefix or starts with `prefix-`.
 * - exact × suffix: value equals the suffix or ends with `-suffix`.
 * - exact × token-sequence: tokens form an ordered subsequence of the value.
 * - prefix × prefix: one is a segment-boundary prefix of the other.
 * - suffix × suffix: one is a segment-boundary suffix of the other.
 * - prefix × suffix, prefix × token-sequence, suffix × token-sequence,
 *   token-sequence × token-sequence: always intersect (`p-s`, `p-t1`, `t1-s`
 *   and the concatenation of both sequences are witnesses).
 */
export function matchersIntersect(
  a: NormalizedMatcher,
  b: NormalizedMatcher,
): boolean {
  if (a.kind === "any" || b.kind === "any") return true;
  const va = exactValueOf(a);
  const vb = exactValueOf(b);
  if (va !== null && vb !== null) return va === vb;
  if (va !== null) return exactIntersects(va, b);
  if (vb !== null) return exactIntersects(vb, a);
  if (a.kind === "prefix" && b.kind === "prefix") {
    return (
      a.value === b.value ||
      a.value.startsWith(`${b.value}-`) ||
      b.value.startsWith(`${a.value}-`)
    );
  }
  if (a.kind === "suffix" && b.kind === "suffix") {
    return (
      a.value === b.value ||
      a.value.endsWith(`-${b.value}`) ||
      b.value.endsWith(`-${a.value}`)
    );
  }
  // Remaining pairs (prefix×suffix, prefix×token-sequence, suffix×token-sequence,
  // token-sequence×token-sequence) always intersect.
  return true;
}

/**
 * Whether both rules can apply to the same tool (P1-2 ambiguity domain).
 * Disjoint tool-id sets or disjoint provider sets can never both match one
 * lookup; mixed/global scopes conservatively overlap.
 */
function scopesOverlap(a: CompiledRule, b: CompiledRule): boolean {
  const sa = a.scope?.toolIds;
  const sb = b.scope?.toolIds;
  if (sa && sa.length > 0 && sb && sb.length > 0) {
    if (!sa.some((t) => sb.includes(t))) return false;
  }
  const pa = a.scope?.providers;
  const pb = b.scope?.providers;
  if (pa && pa.length > 0 && pb && pb.length > 0) {
    if (!pa.some((p) => pb.includes(p))) return false;
  }
  return true;
}

/**
 * Billing routes a rule can apply to (P1-1): a non-empty `scope.billingRouteIds`
 * wins; otherwise the referenced rate's route; `null` = any route (wildcard).
 */
function ruleRouteIds(rule: CompiledRule): readonly string[] | null {
  const scoped = rule.scope?.billingRouteIds;
  if (scoped && scoped.length > 0) return scoped;
  if (rule.rate) return [rule.rate.billingRouteId];
  return null;
}

/**
 * Region a rule is constrained to (P1-1): the referenced rate's region
 * (absent = "global"); `null` = any region (wildcard).
 */
function ruleRegion(rule: CompiledRule): string | null {
  if (!rule.rate) return null;
  return rule.rate.region ?? "global";
}

/**
 * Effective validity of a rule: the referenced rate's interval; `null` = valid
 * at all times (wildcard, e.g. fallback-profile rules).
 */
function ruleInterval(
  rule: CompiledRule,
): { from: string; to: string | null } | null {
  return rule.rate?.effective ?? null;
}

/**
 * P1-2 ambiguity domain: billing route × canonical model × region × effective
 * interval. Two rules whose domains do not overlap can never both match one
 * lookup even when their matchers intersect.
 */
function domainsOverlap(a: CompiledRule, b: CompiledRule): boolean {
  if ((a.convertTo ?? null) !== (b.convertTo ?? null)) return false;
  const ra = ruleRouteIds(a);
  const rb = ruleRouteIds(b);
  if (ra !== null && rb !== null && !ra.some((r) => rb.includes(r))) {
    return false;
  }
  const ga = ruleRegion(a);
  const gb = ruleRegion(b);
  if (ga !== null && gb !== null && ga !== gb) return false;
  const ia = ruleInterval(a);
  const ib = ruleInterval(b);
  if (
    ia !== null &&
    ib !== null &&
    !rangesOverlap(ia.from, ia.to, ib.from, ib.to)
  ) {
    return false;
  }
  return true;
}

export function compilePricingRegistry(
  packs: readonly PricingPack[],
  version: string,
): CompiledPricingRegistry {
  const diagnostics: CompileDiagnostic[] = [];
  const rates = new Map<string, RateRule>();
  const profiles = new Map<string, FallbackProfile>();
  const usedRateIds = new Set<string>();
  const usedProfileIds = new Set<string>();
  /** Rule id -> owning pack id (for overlap diagnostics). */
  const rulePackIds = new Map<string, string>();

  const err = (code: string, message: string) =>
    diagnostics.push({ severity: "error", code, message });
  const warn = (code: string, message: string) =>
    diagnostics.push({ severity: "warning", code, message });

  // 1. Collect rates + profiles; detect duplicate ids.
  for (const pack of packs) {
    for (const rate of pack.rates) {
      if (rates.has(rate.id)) {
        err("duplicate-rate-id", `duplicate rate id "${rate.id}"`);
      }
      rates.set(rate.id, rate);
    }
    for (const profile of pack.fallbackProfiles ?? []) {
      if (profiles.has(profile.id)) {
        err(
          "duplicate-profile-id",
          `duplicate fallback profile id "${profile.id}"`,
        );
      }
      profiles.set(profile.id, profile);
    }
  }

  // 2. Two rates for the SAME billingRouteId + canonicalModelId + region with
  //    overlapping effective dates -> error. Different routes or regions never
  //    conflict; non-overlapping historical segments are legal.
  const byCanonical = new Map<string, RateRule[]>();
  for (const rate of rates.values()) {
    const list = byCanonical.get(rate.canonicalModelId) ?? [];
    list.push(rate);
    byCanonical.set(rate.canonicalModelId, list);
  }
  for (const [canonical, list] of byCanonical) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.billingRouteId !== b.billingRouteId) continue;
        if ((a.region ?? "global") !== (b.region ?? "global")) continue;
        if (
          rangesOverlap(
            a.effective.from,
            a.effective.to,
            b.effective.from,
            b.effective.to,
          )
        ) {
          err(
            "overlapping-rates",
            `rates "${a.id}" and "${b.id}" both price "${canonical}" on route "${a.billingRouteId}" (region ${a.region ?? "global"}) with overlapping dates`,
          );
        }
      }
    }
  }

  // 3. Resolve rule references, normalize matchers, build compiled rules.
  const compiled: CompiledRule[] = [];
  for (const pack of packs) {
    for (const rule of pack.rules) {
      rulePackIds.set(rule.id, pack.packId);
      const normalizedWhen = normalizeMatcher(rule.when);
      if (!normalizedWhen) {
        err(
          "unsafe-matcher-value",
          `rule "${rule.id}" has a matcher value that normalizes to unsafe/empty`,
        );
      }
      let rate: RateRule | undefined;
      let fallbackProfile: FallbackProfile | undefined;
      if (rule.rateRef) {
        rate = rates.get(rule.rateRef);
        if (!rate) {
          err(
            "unresolved-rate-ref",
            `rule "${rule.id}" references unknown rate "${rule.rateRef}"`,
          );
        } else {
          usedRateIds.add(rule.rateRef);
        }
      }
      if (rule.fallbackProfileRef) {
        fallbackProfile = profiles.get(rule.fallbackProfileRef);
        if (!fallbackProfile) {
          err(
            "unresolved-profile-ref",
            `rule "${rule.id}" references unknown fallback profile "${rule.fallbackProfileRef}"`,
          );
        } else {
          usedProfileIds.add(rule.fallbackProfileRef);
        }
      }
      compiled.push({
        ...rule,
        scopePrecision: scopePrecisionOf(rule.scope),
        matcherPrecision: MATCHER_PRECISION[rule.when.kind],
        normalizedWhen: normalizedWhen ?? {
          kind: "any",
        },
        rate,
        fallbackProfile,
      });
    }
  }

  // 4. Same-layer matcher intersection ambiguity detection (P1-2): same
  //    scope/matcher-precision/priority layer, overlapping applicability and
  //    route×model×region×interval domain, intersecting match sets.
  for (let i = 0; i < compiled.length; i += 1) {
    for (let j = i + 1; j < compiled.length; j += 1) {
      const a = compiled[i]!;
      const b = compiled[j]!;
      if (a.scopePrecision !== b.scopePrecision) continue;
      if (a.matcherPrecision !== b.matcherPrecision) continue;
      if ((a.priority ?? 0) !== (b.priority ?? 0)) continue;
      if (!scopesOverlap(a, b)) continue;
      if (!domainsOverlap(a, b)) continue;
      if (!matchersIntersect(a.normalizedWhen, b.normalizedWhen)) continue;
      err(
        "rule-overlap",
        `rules "${a.id}" (pack "${rulePackIds.get(a.id) ?? "?"}") and "${b.id}" (pack "${rulePackIds.get(b.id) ?? "?"}") overlap: intersecting matchers in the same route/model/region/priority layer`,
      );
    }
  }

  // 5. Unreferenced rate / profile -> warning.
  for (const rate of rates.values()) {
    if (!usedRateIds.has(rate.id)) {
      warn(
        "unreferenced-rate",
        `rate "${rate.id}" is not referenced by any rule`,
      );
    }
  }
  for (const profile of profiles.values()) {
    if (!usedProfileIds.has(profile.id)) {
      warn(
        "unreferenced-profile",
        `fallback profile "${profile.id}" is not referenced by any rule`,
      );
    }
  }

  // 6. Deterministic sort: scope precision, matcher precision, priority,
  //    effective.from. Route/region are deliberately NOT sort keys.
  compiled.sort((a, b) => {
    if (a.scopePrecision !== b.scopePrecision)
      return b.scopePrecision - a.scopePrecision;
    if (a.matcherPrecision !== b.matcherPrecision)
      return b.matcherPrecision - a.matcherPrecision;
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pb - pa;
    const fa = a.rate?.effective.from ?? "0000-01-01";
    const fb = b.rate?.effective.from ?? "0000-01-01";
    return fb.localeCompare(fa);
  });

  // 7. Route dimension (global registry data from the generated module).
  const billingRoutes = new Map<string, BillingRoute>(
    PRICING_BILLING_ROUTES.map((r) => [r.id, r] as const),
  );
  const modelCatalog = new Map<string, ModelCatalogEntry>(
    PRICING_MODEL_CATALOG.map((m) => [m.id, m] as const),
  );
  const routeSelectionRules = [...PRICING_ROUTE_SELECTION_RULES].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  );

  return {
    version,
    rates,
    profiles,
    billingRoutes,
    routeSelectionRules,
    modelCatalog,
    rules: compiled,
    diagnostics,
  };
}

/** True when no error-severity diagnostics are present. */
export function compileIsValid(registry: CompiledPricingRegistry): boolean {
  return registry.diagnostics.every((d) => d.severity !== "error");
}
