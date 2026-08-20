import { homedir } from "node:os";

import type { ModelConfig } from "skill-scanner";

import { ENV } from "../../../lib/app-config.ts";
import type { PreferenceValue } from "../../settings/infrastructure/sqlite-preference-repository.server.ts";
import { createNodeRuntimeIdentity } from "../../../platform/runtime/node-runtime-identity.ts";
import type {
  DesktopLocale,
  SecurityScanHistoryEntry,
  SecurityScanSchedule,
} from "../../../../electron/contracts";
import {
  handleSecurityHttpApi,
  SECURITY_API_PREFIX,
} from "../../../../electron/security-http-api";
import {
  SecurityScannerService,
  type SecretStoragePort,
  type SecurityScannerPersistence,
  type SecurityScannerServiceOptions,
} from "../../../../electron/security-scanner-service";
import {
  DESKTOP_HISTORY_KEY,
  DESKTOP_SCHEDULE_KEY,
  projectDesktopSecurityHistory,
} from "../../../app/desktop-state-broker.server.ts";
import { getCompositionRoot } from "../../../app/composition.server.ts";

/**
 * Browser-dev-only security backend.
 *
 * Vite/Nitro dev serves the app on a non-`127.0.0.1` origin, so the companion
 * security client (`browser-client.ts`) — which is gated on a
 * `http://127.0.0.1:*` origin — falls back to `null` there. This module is
 * wired into `src/server.ts` (the Nitro fetch handler) so `/api/security/*`
 * requests made against the dev server are served by the *same* production
 * `SecurityScannerService` the Electron desktop app uses. History, schedule,
 * and model configuration are obtained from the server-owned SQLite runtime;
 * this module never creates a second database writer or a file fallback.
 *
 * It is named `*.server.ts` so TanStack Start / Nitro keep it off the browser
 * bundle. The runtime-kind gate below additionally prevents activation inside
 * Electron, where `local-web-server.ts` already short-circuits
 * `/api/security/*` before this handler runs.
 */

/** Key used to mirror the singleton on `globalThis` so it survives Vite HMR. */
const DEV_SERVICE_GLOBAL = "__TRUSTTOOLS_SECURITY_DEV_SERVICE__";

/** Mirror of `electron/local-web-server.ts` `MAX_SECURITY_API_BODY_BYTES`. */
const MAX_SECURITY_API_BODY_BYTES = 64 * 1024;

/**
 * Current dev locale, derived from the latest request's `Accept-Language`.
 * The dev service's `locale()` reads this so scans started through the
 * browser companion API are reported in the browser's preferred language.
 */
let currentDevLocale: DesktopLocale = "zh-CN";

let devSecurityScanner: SecurityScannerService | null | undefined;

type DevSecurityServiceGlobal = Record<
  typeof DEV_SERVICE_GLOBAL,
  SecurityScannerService | undefined
>;

function readDevServiceCache(): SecurityScannerService | undefined {
  const g = globalThis as unknown as Partial<DevSecurityServiceGlobal>;
  return g[DEV_SERVICE_GLOBAL];
}

function writeDevServiceCache(value: SecurityScannerService | undefined): void {
  const g = globalThis as unknown as DevSecurityServiceGlobal;
  g[DEV_SERVICE_GLOBAL] = value;
}

/**
 * The scanner no longer owns API-key persistence. Model credentials are read
 * from the SQLite model-profile repository by `createDevScannerPersistence`.
 * This adapter only satisfies the scanner's capability port and performs no
 * filesystem or browser-storage access.
 */
export function createDevSecretStorage(): SecretStoragePort {
  return {
    isEncryptionAvailable: () => true,
    encrypt: (value) => Buffer.from(value, "utf8").toString("base64"),
    decrypt: (value) => Buffer.from(value, "base64").toString("utf8"),
  };
}

interface StoredModelProfile {
  readonly mode: "official" | "custom";
  readonly protocol: "openai" | "anthropic";
  readonly apiKey?: string;
  readonly endpoint?: string;
  readonly model?: string;
}

function toModelConfig(
  profile: StoredModelProfile | null,
): ModelConfig | undefined {
  if (!profile?.apiKey) return undefined;
  const provider = profile.mode === "official" ? "openai" : profile.protocol;
  const endpoint =
    profile.mode === "official"
      ? "https://api.deepseek.com/v1"
      : (profile.endpoint ??
        (profile.protocol === "anthropic"
          ? "https://api.anthropic.com/v1"
          : "https://api.openai.com/v1"));
  const model = profile.mode === "official" ? "deepseek-chat" : profile.model;
  if (!model) throw new Error("Active model profile has no model");
  return {
    provider,
    endpoint,
    apiKey: profile.apiKey,
    liteModel: model,
    proModel: model,
    timeoutMs: 120_000,
    maxAgentTurns: 8,
  };
}

/** Server-process persistence adapter; all writes use the sole SQLite runtime. */
export function createDevScannerPersistence(): SecurityScannerPersistence {
  return {
    async readHistory() {
      const root = await getCompositionRoot();
      return structuredClone(
        (root.database.features.appPreferences.get(DESKTOP_HISTORY_KEY)
          ?.value ?? []) as unknown as SecurityScanHistoryEntry[],
      );
    },
    async writeHistory(entries) {
      const root = await getCompositionRoot();
      root.database.features.appPreferences.set({
        key: DESKTOP_HISTORY_KEY,
        value: projectDesktopSecurityHistory(entries),
        updatedAtMs: Date.now(),
      });
    },
    async clearHistory() {
      const root = await getCompositionRoot();
      root.database.features.appPreferences.remove(DESKTOP_HISTORY_KEY);
    },
    async readSchedule() {
      const root = await getCompositionRoot();
      return structuredClone(
        (root.database.features.appPreferences.get(DESKTOP_SCHEDULE_KEY)
          ?.value ?? null) as unknown as SecurityScanSchedule | null,
      );
    },
    async writeSchedule(schedule) {
      const root = await getCompositionRoot();
      root.database.features.appPreferences.set({
        key: DESKTOP_SCHEDULE_KEY,
        value: schedule as unknown as PreferenceValue,
        updatedAtMs: Date.now(),
      });
    },
    async modelConfig() {
      const root = await getCompositionRoot();
      const active = await root.modelProfiles.getActiveView();
      if (!active) return undefined;
      const profile = (await root.modelProfiles.getProfileForExecution(
        active.id,
      )) as StoredModelProfile | null;
      return toModelConfig(profile);
    },
  };
}

/**
 * Wraps the production Electron scanner service with web/dev defaults. Callers
 * may override `scanner`/`now`/`beforeOpenFile`/`env`/`secretStorage`/`locale`
 * for tests; `homeDirectory` is always required.
 */
export function createDevSecurityScannerService(
  options: Partial<SecurityScannerServiceOptions> & {
    readonly homeDirectory: string;
  },
): SecurityScannerService {
  return new SecurityScannerService({
    homeDirectory: options.homeDirectory,
    locale: options.locale ?? (() => currentDevLocale),
    env: options.env ?? process.env,
    secretStorage: options.secretStorage ?? createDevSecretStorage(),
    persistence: options.persistence ?? createDevScannerPersistence(),
    ...(options.now ? { now: options.now } : {}),
    ...(options.scanner ? { scanner: options.scanner } : {}),
    ...(options.beforeOpenFile
      ? { beforeOpenFile: options.beforeOpenFile }
      : {}),
  });
}

/**
 * Lazy singleton for the dev security service.
 *
 * Guard first: outside a web runtime (e.g. inside Electron, where the runtime
 * kind is `desktop`) this returns `null` so `/api/security/*` continues to be
 * owned by `local-web-server.ts`. The instance is cached on both the module and
 * `globalThis` (mirroring `getCompositionRoot`) so Vite HMR re-imports reuse
 * the same in-flight scanner state.
 */
export function getDevSecurityScannerService(): SecurityScannerService | null {
  const identity = createNodeRuntimeIdentity();
  if (identity.kind !== "web") {
    devSecurityScanner = null;
    return null;
  }

  if (devSecurityScanner !== undefined) return devSecurityScanner;

  const cached = readDevServiceCache();
  if (cached) {
    devSecurityScanner = cached;
    return cached;
  }

  const homeDirectory = process.env[ENV.USAGE_HOME] ?? homedir();
  const service = createDevSecurityScannerService({
    homeDirectory,
  });
  devSecurityScanner = service;
  writeDevServiceCache(service);
  return service;
}

class RequestBodyTooLargeError extends Error {}

interface SecurityRequestBody {
  readonly text: string;
  readonly byteLength: number;
}

/** Mirrors `electron/local-web-server.ts` `readRequestBody` for the security API. */
async function readSecurityBody(
  request: Request,
): Promise<SecurityRequestBody | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (!request.body) return undefined;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SECURITY_API_BODY_BYTES) {
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) return { text: "", byteLength: 0 };
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), byteLength: total };
}

function securityErrorResponse(code: string, status: number): Response {
  return Response.json(
    { error: { code } },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

/**
 * Nitro fetch-handler hook for the browser-dev-only security backend.
 *
 * Returns `null` (deferring to the router) for any non-`/api/security/*` path
 * or when the dev service is unavailable (i.e. non-web runtime). Otherwise it
 * enforces the same 64 KiB body-size guard as the Electron local web server
 * and delegates to the shared pure HTTP adapter.
 */
export async function handleSecurityDevRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${SECURITY_API_PREFIX}/`)) return null;

  const service = getDevSecurityScannerService();
  if (!service) return null;

  // Track the browser's preferred language so scans report in that locale.
  localeFromAcceptLanguage(request.headers.get("accept-language"));

  // Mirror the Electron local-web-server security-API body-size guard.
  const declaredLength = request.headers.get("content-length");
  if (declaredLength != null) {
    const contentLength = /^\d+$/u.test(declaredLength)
      ? Number(declaredLength)
      : Number.NaN;
    if (!Number.isSafeInteger(contentLength)) {
      return securityErrorResponse("security.http.invalid_content_length", 400);
    }
    if (contentLength > MAX_SECURITY_API_BODY_BYTES) {
      return securityErrorResponse("security.http.body_too_large", 413);
    }
  }

  let body: SecurityRequestBody | undefined;
  try {
    body = await readSecurityBody(request);
  } catch {
    return securityErrorResponse("security.http.body_too_large", 413);
  }

  // Mirror the local-web-server content-length mismatch guard.
  if (declaredLength != null && body != null) {
    if (Number(declaredLength) !== body.byteLength) {
      return securityErrorResponse(
        "security.http.content_length_mismatch",
        400,
      );
    }
  }

  // The body was consumed above; rebuild a Request so `handleSecurityHttpApi`
  // can still read it. `request.headers` already carries Content-Type/CSRF.
  const apiRequest =
    body === undefined
      ? request
      : new Request(url, {
          method: request.method,
          headers: request.headers,
          body: body.text,
        });

  return handleSecurityHttpApi(apiRequest, url.origin, service);
}

/**
 * Parses the first `Accept-Language` tag into a `DesktopLocale`. The primary
 * language subtag is matched case-insensitively; anything unrecognized (or a
 * missing header) falls back to the Chinese-primary default.
 */
export function localeFromAcceptLanguage(header: string | null): DesktopLocale {
  const primary = header?.split(",")[0]?.trim().toLowerCase().split("-")[0];
  if (primary === "zh") currentDevLocale = "zh-CN";
  else if (primary === "en") currentDevLocale = "en-US";
  else if (primary === "ja") currentDevLocale = "ja-JP";
  else if (primary === "ko") currentDevLocale = "ko-KR";
  else currentDevLocale = "zh-CN";
  return currentDevLocale;
}
