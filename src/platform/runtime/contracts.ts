/**
 * Runtime facts used by composition roots and background-work bootstrap.
 *
 * This module is deliberately free of Node, Electron, and browser globals so
 * callers can supply a deterministic identity in tests.
 */
export type RuntimeKind = "desktop" | "web" | "test";

export type RuntimeMode = "development" | "production" | "test";

export type RuntimePlatform = "macos" | "windows" | "linux" | "unknown";

export type BackgroundTasksDecisionReason =
  | "desktop-default-enabled"
  | "explicitly-enabled"
  | "explicitly-disabled"
  | "web-default-disabled"
  | "test-default-disabled"
  | "linux-planned"
  | "unsupported-platform";

export interface RuntimeIdentity {
  readonly kind: RuntimeKind;
  readonly mode: RuntimeMode;
  readonly platform: RuntimePlatform;
  /**
   * Whether the scheduler may be started. This is intentionally separate
   * from a future scheduler implementation so the identity can be evaluated
   * before any collector or user-directory access is constructed.
   */
  readonly backgroundTasksEnabled: boolean;
  readonly backgroundTasksReason: BackgroundTasksDecisionReason;
}

export interface RuntimeIdentityInput {
  readonly kind: RuntimeKind;
  readonly mode?: RuntimeMode;
  readonly platform?: RuntimePlatform;
  /**
   * An explicit local opt-in/opt-out. Undefined retains the safe runtime
   * default; it is never inferred from a filesystem location.
   */
  readonly enableBackgroundTasks?: boolean;
}

const SUPPORTED_DESKTOP_PLATFORMS: ReadonlySet<RuntimePlatform> = new Set([
  "macos",
  "windows",
]);

/**
 * Pure policy for scheduler startup. Linux is planned, so an opt-in cannot
 * accidentally turn scanning on there before its platform acceptance work.
 */
export function resolveRuntimeIdentity(
  input: RuntimeIdentityInput,
): RuntimeIdentity {
  const mode = input.mode ?? (input.kind === "test" ? "test" : "production");
  const platform = input.platform ?? "unknown";

  if (platform === "linux") {
    return identity(input.kind, mode, platform, false, "linux-planned");
  }

  if (!SUPPORTED_DESKTOP_PLATFORMS.has(platform)) {
    return identity(input.kind, mode, platform, false, "unsupported-platform");
  }

  if (input.enableBackgroundTasks === false) {
    return identity(input.kind, mode, platform, false, "explicitly-disabled");
  }

  if (input.enableBackgroundTasks === true) {
    return identity(input.kind, mode, platform, true, "explicitly-enabled");
  }

  if (input.kind === "desktop") {
    return identity(
      input.kind,
      mode,
      platform,
      true,
      "desktop-default-enabled",
    );
  }

  return identity(
    input.kind,
    mode,
    platform,
    false,
    input.kind === "web" ? "web-default-disabled" : "test-default-disabled",
  );
}

function identity(
  kind: RuntimeKind,
  mode: RuntimeMode,
  platform: RuntimePlatform,
  backgroundTasksEnabled: boolean,
  backgroundTasksReason: BackgroundTasksDecisionReason,
): RuntimeIdentity {
  return {
    kind,
    mode,
    platform,
    backgroundTasksEnabled,
    backgroundTasksReason,
  };
}
