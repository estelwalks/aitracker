/**
 * Cross-feature data lifecycle states. Keep this union free of transport or
 * domain-specific error details so it can safely be projected to the UI.
 */
export type UiDataStatus =
  | "fresh"
  | "stale"
  | "running"
  | "waiting-approval"
  | "failed"
  | "empty"
  | "offline"
  | "disabled";

export type StatusSeverity =
  "success" | "info" | "warning" | "danger" | "neutral";
export type StatusRole = "status" | "alert";
export type StatusAriaLive = "off" | "polite" | "assertive";

/** Status copy is deliberately a closed whitelist of i18n keys. */
export type StatusMessageKey =
  | "common.status.fresh"
  | "common.status.stale"
  | "common.status.running"
  | "common.status.waitingApproval"
  | "common.status.failed"
  | "common.status.empty"
  | "common.status.offline"
  | "common.status.disabled";

export interface StatusDefinition {
  readonly messageKey: StatusMessageKey;
  readonly severity: StatusSeverity;
  readonly role: StatusRole;
  readonly ariaLive: StatusAriaLive;
  readonly loading: boolean;
  readonly disabled: boolean;
}

export interface StatusViewModel extends StatusDefinition {
  readonly status: UiDataStatus;
}

export const STATUS_DEFINITIONS: Readonly<
  Record<UiDataStatus, StatusDefinition>
> = {
  fresh: {
    messageKey: "common.status.fresh",
    severity: "success",
    role: "status",
    ariaLive: "polite",
    loading: false,
    disabled: false,
  },
  stale: {
    messageKey: "common.status.stale",
    severity: "warning",
    role: "status",
    ariaLive: "polite",
    loading: false,
    disabled: false,
  },
  running: {
    messageKey: "common.status.running",
    severity: "info",
    role: "status",
    ariaLive: "polite",
    loading: true,
    disabled: false,
  },
  "waiting-approval": {
    messageKey: "common.status.waitingApproval",
    severity: "warning",
    role: "status",
    ariaLive: "polite",
    loading: false,
    disabled: false,
  },
  failed: {
    messageKey: "common.status.failed",
    severity: "danger",
    role: "alert",
    ariaLive: "assertive",
    loading: false,
    disabled: false,
  },
  empty: {
    messageKey: "common.status.empty",
    severity: "neutral",
    role: "status",
    ariaLive: "polite",
    loading: false,
    disabled: false,
  },
  offline: {
    messageKey: "common.status.offline",
    severity: "warning",
    role: "status",
    ariaLive: "polite",
    loading: false,
    disabled: false,
  },
  disabled: {
    messageKey: "common.status.disabled",
    severity: "neutral",
    role: "status",
    ariaLive: "off",
    loading: false,
    disabled: true,
  },
};

const FALLBACK_STATUS: UiDataStatus = "empty";

/** Build a stable, UI-safe view model; unknown runtime values degrade to empty. */
export function createStatusViewModel(
  status: UiDataStatus | string,
): StatusViewModel {
  const normalized = Object.hasOwn(STATUS_DEFINITIONS, status)
    ? (status as UiDataStatus)
    : FALLBACK_STATUS;
  return { status: normalized, ...STATUS_DEFINITIONS[normalized] };
}

export function isUiDataStatus(value: unknown): value is UiDataStatus {
  return typeof value === "string" && Object.hasOwn(STATUS_DEFINITIONS, value);
}
