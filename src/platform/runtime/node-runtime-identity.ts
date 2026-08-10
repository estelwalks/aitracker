import {
  resolveRuntimeIdentity,
  type RuntimeIdentity,
  type RuntimeKind,
  type RuntimeMode,
  type RuntimePlatform,
} from "./contracts.ts";
import { ENV } from "../../lib/app-config";

/** Dependencies are injectable to keep runtime detection deterministic. */
export interface NodeRuntimeIdentityDependencies {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly versions?: Readonly<{ electron?: string }>;
}

/**
 * Node/Electron adapter. It only reads process metadata and the single
 * documented feature flag; it never resolves or reads a user directory.
 */
export function createNodeRuntimeIdentity(
  dependencies: NodeRuntimeIdentityDependencies = {},
): RuntimeIdentity {
  const env = dependencies.env ?? process.env;
  const platform = nodePlatformToRuntimePlatform(
    dependencies.platform ?? process.platform,
  );
  const kind = runtimeKindFromEnvironment(
    env,
    dependencies.versions ??
      (process.versions as unknown as Readonly<{ electron?: string }>),
  );
  const mode = runtimeModeFromEnvironment(env, kind);

  return resolveRuntimeIdentity({
    kind,
    mode,
    platform,
    enableBackgroundTasks: parseBooleanFlag(env[ENV.ENABLE_BACKGROUND_TASKS]),
  });
}

export function runtimeKindFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  versions: Readonly<{ electron?: string }> = {},
): RuntimeKind {
  const configured = env[ENV.RUNTIME];
  if (
    configured === "desktop" ||
    configured === "web" ||
    configured === "test"
  ) {
    return configured;
  }
  if (env.NODE_ENV === "test") return "test";
  if (versions.electron !== undefined) return "desktop";
  return "web";
}

export function runtimeModeFromEnvironment(
  env: Readonly<Record<string, string | undefined>>,
  kind: RuntimeKind,
): RuntimeMode {
  if (kind === "test" || env.NODE_ENV === "test") return "test";
  return env.NODE_ENV === "development" ? "development" : "production";
}

export function nodePlatformToRuntimePlatform(
  platform: NodeJS.Platform,
): RuntimePlatform {
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows";
  if (platform === "linux") return "linux";
  return "unknown";
}

/** Only the literal string `true` enables background tasks. */
export function parseBooleanFlag(
  value: string | undefined,
): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}
