import type { ElectronMessages } from "./i18n.js";

export const STARTUP_FAILURE_CODE_HEADER = "x-trusttools-startup-failure-code";

export type StartupFailureCode =
  | "database.access-denied"
  | "database.already-open"
  | "database.busy"
  | "database.capability-mismatch"
  | "database.corrupt"
  | "database.integrity-check-failed"
  | "database.io-failure"
  | "database.journal-not-wal"
  | "database.migration-checksum"
  | "database.migration-reverted"
  | "startup.unavailable";

const STARTUP_FAILURE_CODES = new Set<StartupFailureCode>([
  "database.access-denied",
  "database.already-open",
  "database.busy",
  "database.capability-mismatch",
  "database.corrupt",
  "database.integrity-check-failed",
  "database.io-failure",
  "database.journal-not-wal",
  "database.migration-checksum",
  "database.migration-reverted",
  "startup.unavailable",
]);

export function normalizeStartupFailureCode(
  value: unknown,
): StartupFailureCode {
  return typeof value === "string" &&
    STARTUP_FAILURE_CODES.has(value as StartupFailureCode)
    ? (value as StartupFailureCode)
    : "startup.unavailable";
}

export function startupFailureCodeFromError(
  error: unknown,
): StartupFailureCode {
  if (error == null || typeof error !== "object") return "startup.unavailable";
  return normalizeStartupFailureCode(
    (error as { startupFailureCode?: unknown }).startupFailureCode,
  );
}

export function createStartupWarmupError(
  status: number,
  code: unknown,
): Error & { readonly startupFailureCode: StartupFailureCode } {
  const error = new Error(
    `TrustTools workspace warmup failed with HTTP ${String(status)}`,
  ) as Error & { startupFailureCode: StartupFailureCode };
  error.startupFailureCode = normalizeStartupFailureCode(code);
  return error;
}

export function startupFailureDialogMessage(
  messages: ElectronMessages["dialog"]["startupFailure"],
  error: unknown,
): string {
  const code = startupFailureCodeFromError(error);
  return `${messages.message}\n\n${messages.details[code]}\n${messages.diagnosticCode.replace("{code}", code)}`;
}
