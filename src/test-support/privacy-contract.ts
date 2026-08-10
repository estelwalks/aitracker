/**
 * P0-05 browser/diagnostics disclosure contract.
 *
 * This test-support module has no I/O and intentionally does not inspect a
 * user's data directory. Feature DTO tests can reuse it to prove that their
 * constructed output is safe to serialize across the local HTTP boundary.
 */
import type { MessageKey } from "../lib/i18n/messages.ts";

/** Only translated `errors.*` keys are allowed to cross the UI error boundary. */
export type StableErrorCode = Extract<MessageKey, `errors.${string}`>;

/**
 * Small cross-module error-code directory for the P0 boundary. Module-specific
 * codes remain in the locale's `errors` namespace; new transport APIs must use
 * this type instead of serializing an exception sentence.
 */
export const P0_STABLE_ERROR_CODES = [
  "errors.generic",
  "errors.security.fileRequired",
  "errors.security.fileTypeInvalid",
  "errors.security.fileTooLarge",
  "errors.security.notTextFile",
  "errors.skills.installInvalid",
  "errors.skills.syncInvalid",
  "errors.sessions.filterInvalid",
  "errors.pricing.modelListInvalid",
  "errors.market.queryInvalid",
  "errors.market.installInvalid",
] as const satisfies readonly StableErrorCode[];

const STABLE_ERROR_CODE_SET = new Set<string>(P0_STABLE_ERROR_CODES);

/** Returns true for a code in the P0 cross-module directory. */
export function isP0StableErrorCode(value: unknown): value is StableErrorCode {
  return typeof value === "string" && STABLE_ERROR_CODE_SET.has(value);
}

/** Raw fields that must never be exposed in a public DTO, search result or log. */
export const FORBIDDEN_RAW_DTO_FIELDS = [
  "command",
  "resumecommand",
  "content",
  "rawcontent",
  "prompt",
  "response",
  "messages",
  "transcript",
  "sessionbody",
  "apikey",
  "api_key",
  "token",
  "accesstoken",
  "authorization",
  "password",
  "secret",
] as const;

const FORBIDDEN_RAW_DTO_FIELD_SET = new Set<string>(FORBIDDEN_RAW_DTO_FIELDS);

const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\bghp_[A-Za-z0-9]{12,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/i,
];

function isAbsoluteFilesystemPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

function logicalPath(parent: string, key: string | number): string {
  return typeof key === "number" ? `${parent}[${key}]` : `${parent}.${key}`;
}

/** A concrete disclosure finding; `path` is a logical DTO path, never a disk path. */
export interface DtoDisclosureViolation {
  path: string;
  kind: "absolute-path" | "credential" | "raw-field";
}

/**
 * Detects known secret/raw-content disclosures in an already-constructed DTO.
 * It is deliberately conservative: a relative `repoPath` or an HTTPS URL is
 * allowed, while only filesystem-absolute strings are rejected.
 */
export function findDtoDisclosureViolations(
  value: unknown,
): DtoDisclosureViolation[] {
  const violations: DtoDisclosureViolation[] = [];
  const visit = (candidate: unknown, path: string): void => {
    if (typeof candidate === "string") {
      if (isAbsoluteFilesystemPath(candidate)) {
        violations.push({ path, kind: "absolute-path" });
      }
      if (CREDENTIAL_PATTERNS.some((pattern) => pattern.test(candidate))) {
        violations.push({ path, kind: "credential" });
      }
      return;
    }
    if (Array.isArray(candidate)) {
      candidate.forEach((child, index) =>
        visit(child, logicalPath(path, index)),
      );
      return;
    }
    if (candidate === null || typeof candidate !== "object") return;

    for (const [key, child] of Object.entries(candidate)) {
      const childPath = logicalPath(path, key);
      // Optional compatibility fields may safely be null. A present value is
      // still rejected so no raw body/credential can cross the boundary.
      if (child != null && FORBIDDEN_RAW_DTO_FIELD_SET.has(key.toLowerCase())) {
        violations.push({ path: childPath, kind: "raw-field" });
      }
      visit(child, childPath);
    }
  };

  visit(value, "$");
  return violations;
}
