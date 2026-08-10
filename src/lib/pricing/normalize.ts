/**
 * Fixed generic model normalizer (generic-normalize-v1, docs §5.3).
 *
 * Pure, linear-time, cross-platform stable. The raw model is NEVER mutated -
 * callers keep `rawModel` for UI/diagnostics; only `normalizedModel` is used as
 * a stable matching key. Inputs with NUL/control chars or that normalize to an
 * empty string are rejected (`ok: false`) so the resolver returns `unpriced`
 * rather than matching against garbage.
 *
 * Steps: Unicode NFKC -> trim -> lowercase -> `_`/whitespace/`.` -> `-`
 *        -> collapse consecutive `-` -> strip leading/trailing `-`.
 */
import type { PricingReason } from "./contracts.ts";

export interface NormalizedModel {
  normalizedModel: string;
  ok: boolean;
  /** Present when `ok` is false. */
  reason?: PricingReason;
}

const CONTROL_OR_NUL = /\p{Cc}/u;

export function normalizeModel(rawModel: string): NormalizedModel {
  // NFKC first (compatibility decomposition -> canonical composition).
  let s = rawModel.normalize("NFKC");
  s = s.trim();
  s = s.toLowerCase();

  if (s === "" || CONTROL_OR_NUL.test(s)) {
    return { normalizedModel: s, ok: false, reason: "unsafe-model" };
  }

  // `_`, whitespace and `.` all become `-` separators.
  s = s.replaceAll("_", "-").replaceAll(/\s+/gu, "-").replaceAll(".", "-");
  // Collapse runs of `-` and strip leading/trailing `-`.
  s = s.replaceAll(/-{2,}/gu, "-").replaceAll(/^-+|-+$/gu, "");

  if (s === "") {
    return { normalizedModel: "", ok: false, reason: "unsafe-model" };
  }
  return { normalizedModel: s, ok: true };
}
