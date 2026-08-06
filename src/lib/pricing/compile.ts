/**
 * Pricing rule-pack compiler (v1.5).
 *
 * Pure function: takes the already-Zod-validated `PricingPack[]` (from
 * pricing-definitions.generated.ts) + a version hash, expands rate/profile
 * references, normalizes matcher values once, detects conflicts, and builds a
 * deterministic sorted rule index for the resolver. No filesystem, no network,
 * no JSON parsing here.
 *
 * Conflict policy (docs §5.4, §6):
 * - Duplicate rate id / fallback profile id -> error.
 * - Unresolved rateRef / fallbackProfileRef -> error.
 * - Matcher value that normalizes to unsafe/empty -> error.
 * - Two rules with the SAME normalized matcher, SAME scope, SAME priority and
 *   overlapping effective interval -> error (ambiguous; the compiler must fail
 *   rather than rely on array order).
 * - Two rates for the SAME canonicalModelId with overlapping effective dates ->
 *   error.
 * - Unreferenced rate / profile -> warning.
 * Sort keys are fixed: scope precision > matcher precision > priority >
 * effective.from. Array position is never a tie-breaker.
 */
import {
  MATCHER_PRECISION,
  type ConversionRule,
  type FallbackProfile,
  type ModelMatcher,
  type PricingPack,
  type RateRule,
} from "./contracts.ts";
import { normalizeModel } from "./normalize.ts";

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

/** Key identifying the "match space" of a rule for overlap detection. */
function matchKey(when: NormalizedMatcher): string {
  if (when.kind === "token-sequence") {
    return `token-sequence:${when.tokens.join("|")}`;
  }
  if (when.kind === "any") return "any";
  return `${when.kind}:${when.value}`;
}

function scopeKey(scope: ConversionRule["scope"]): string {
  if (!scope) return "global";
  const tools = (scope.toolIds ?? []).slice().sort().join(",");
  const provs = (scope.providers ?? []).slice().sort().join(",");
  return `t:${tools}|p:${provs}`;
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

export function compilePricingRegistry(
  packs: readonly PricingPack[],
  version: string,
): CompiledPricingRegistry {
  const diagnostics: CompileDiagnostic[] = [];
  const rates = new Map<string, RateRule>();
  const profiles = new Map<string, FallbackProfile>();
  const usedRateIds = new Set<string>();
  const usedProfileIds = new Set<string>();

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

  // 2. Two rates for the same canonicalModelId with overlapping effective dates.
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
            `rates "${a.id}" and "${b.id}" both price "${canonical}" on overlapping dates`,
          );
        }
      }
    }
  }

  // 3. Resolve rule references, normalize matchers, build compiled rules.
  const compiled: CompiledRule[] = [];
  for (const pack of packs) {
    for (const rule of pack.rules) {
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

  // 4. Same normalized matcher + scope + priority + overlapping effective -> overlap error.
  for (let i = 0; i < compiled.length; i += 1) {
    for (let j = i + 1; j < compiled.length; j += 1) {
      const a = compiled[i]!;
      const b = compiled[j]!;
      if (
        matchKey(a.normalizedWhen) === matchKey(b.normalizedWhen) &&
        scopeKey(a.scope) === scopeKey(b.scope) &&
        (a.priority ?? 0) === (b.priority ?? 0)
      ) {
        const aHas = !!a.rate;
        const bHas = !!b.rate;
        const overlap =
          aHas && bHas
            ? rangesOverlap(
                a.rate!.effective.from,
                a.rate!.effective.to,
                b.rate!.effective.from,
                b.rate!.effective.to,
              )
            : !aHas && !bHas;
        if (overlap) {
          err(
            "rule-overlap",
            `rules "${a.id}" and "${b.id}" overlap (same matcher, scope, priority, effective interval)`,
          );
        }
      }
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

  // 6. Deterministic sort: scope precision, matcher precision, priority, effective.from.
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

  return { version, rates, profiles, rules: compiled, diagnostics };
}

/** True when no error-severity diagnostics are present. */
export function compileIsValid(registry: CompiledPricingRegistry): boolean {
  return registry.diagnostics.every((d) => d.severity !== "error");
}
