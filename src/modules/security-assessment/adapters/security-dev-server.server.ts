import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { APP_DATA_DIR, ENV } from "../../../lib/app-config.ts";
import { createNodeRuntimeIdentity } from "../../../platform/runtime/node-runtime-identity.ts";
import type { DesktopLocale } from "../../../../electron/contracts";
import {
  handleSecurityHttpApi,
  SECURITY_API_PREFIX,
} from "../../../../electron/security-http-api";
import {
  SecurityScannerService,
  type SecretStoragePort,
  type SecurityScannerServiceOptions,
} from "../../../../electron/security-scanner-service";

/**
 * Browser-dev-only security backend.
 *
 * Vite/Nitro dev serves the app on a non-`127.0.0.1` origin, so the companion
 * security client (`browser-client.ts`) — which is gated on a
 * `http://127.0.0.1:*` origin — falls back to `null` there. This module is
 * wired into `src/server.ts` (the Nitro fetch handler) so `/api/security/*`
 * requests made against the dev server are served by the *same* production
 * `SecurityScannerService` the Electron desktop app uses, with a dev-only
 * plaintext secret store and the *same* data directory (`~/.trusttools/`) —
 * the browser and the desktop app therefore read and write one shared scan
 * history (`security-scan-history.json`) and one shared scan schedule.
 *
 * Trade-off (accepted deliberately): the desktop app and the dev server each
 * serialize their own history appends in-process only, so if both processes
 * run a scan at the same moment the later atomic rename can overwrite the
 * other's most recent entries (files never corrupt). History entries are
 * written redacted, so cross-process reads need no shared secret.
 *
 * It is named `*.server.ts` so TanStack Start / Nitro keep it off the browser
 * bundle. The runtime-kind gate below additionally prevents activation inside
 * Electron, where `local-web-server.ts` already short-circuits
 * `/api/security/*` before this handler runs.
 */

/** Filename (inside `dataDirectory`) that holds the dev plaintext API key. */
const DEV_API_KEY_FILENAME = "security-dev-api-key";

/** Legacy isolated dev data directory (pre shared-history layout). */
const LEGACY_DEV_DATA_DIR = "security-dev";

/** Mirror of the scanner service's history cap. */
const MAX_HISTORY_ENTRIES = 200;

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
 * Dev-only secret storage. The raw key is persisted in plaintext under
 * `<dataDirectory>/security-dev-api-key` with mode `0o600`; there is no
 * Electron `safeStorage` in the web/dev runtime.
 *
 * The `SecretStoragePort` contract is synchronous, so the on-disk write is
 * fire-and-forget (via `node:fs/promises` `writeFile`) and `decrypt` reads
 * back through an in-memory mirror / synchronous `readFileSync` fallback.
 */
export function createDevSecretStorage(
  dataDirectory: string,
): SecretStoragePort {
  const keyPath = join(dataDirectory, DEV_API_KEY_FILENAME);
  // In-memory mirror so the synchronous port never depends on the async write.
  let cachedKey: string | undefined;

  return {
    // Dev-only: no Electron safeStorage.
    isEncryptionAvailable: () => true,
    encrypt(value: string): string {
      cachedKey = value;
      void mkdir(dataDirectory, { recursive: true, mode: 0o700 })
        .then(() =>
          writeFile(keyPath, value, { encoding: "utf8", mode: 0o600 }),
        )
        .catch(() => undefined);
      return Buffer.from(value, "utf8").toString("base64");
    },
    decrypt(value: string): string {
      if (cachedKey === undefined) {
        try {
          cachedKey = readFileSync(keyPath, "utf8");
        } catch {
          // Config may reference a key from before the dev store existed;
          // the value itself is the base64 of the raw key.
          cachedKey = Buffer.from(value, "base64").toString("utf8");
        }
      }
      return cachedKey;
    },
  };
}

/**
 * Wraps the production Electron scanner service with web/dev defaults. Callers
 * may override `scanner`/`now`/`beforeOpenFile`/`env`/`secretStorage`/`locale`
 * for tests; `homeDirectory`/`dataDirectory` are always required.
 */
export function createDevSecurityScannerService(
  options: Partial<SecurityScannerServiceOptions> & {
    readonly homeDirectory: string;
    readonly dataDirectory: string;
  },
): SecurityScannerService {
  return new SecurityScannerService({
    homeDirectory: options.homeDirectory,
    dataDirectory: options.dataDirectory,
    locale: options.locale ?? (() => currentDevLocale),
    env: options.env ?? process.env,
    secretStorage:
      options.secretStorage ?? createDevSecretStorage(options.dataDirectory),
    ...(options.now ? { now: options.now } : {}),
    ...(options.scanner ? { scanner: options.scanner } : {}),
    ...(options.beforeOpenFile
      ? { beforeOpenFile: options.beforeOpenFile }
      : {}),
  });
}

/**
 * One-time migration from the legacy isolated dev history
 * (`~/.trusttools/security-dev/security-scan-history.json`) into the shared
 * history file (`~/.trusttools/security-scan-history.json`), so scans made
 * through the old dev backend are not lost when the two histories merge.
 * Ids are deduplicated and the merged list is capped at the scanner service's
 * history limit. The legacy file is left in place untouched.
 *
 * Runs synchronously before the dev service singleton is constructed so a
 * scan can never race the merge, and failures are non-fatal (the service
 * still starts).
 */
export function migrateLegacyDevHistory(homeDirectory: string): void {
  const sharedPath = join(
    homeDirectory,
    APP_DATA_DIR,
    "security-scan-history.json",
  );
  const legacyPath = join(
    homeDirectory,
    APP_DATA_DIR,
    LEGACY_DEV_DATA_DIR,
    "security-scan-history.json",
  );
  let legacy: unknown;
  try {
    legacy = JSON.parse(readFileSync(legacyPath, "utf8"));
  } catch {
    return; // no legacy history to migrate
  }
  const legacyEntries = Array.isArray(
    (legacy as { entries?: unknown })?.entries,
  )
    ? (legacy as { entries: Array<{ id?: unknown }> }).entries
    : [];
  if (legacyEntries.length === 0) return;

  let sharedEntries: Array<{ id?: unknown }> = [];
  try {
    const shared = JSON.parse(readFileSync(sharedPath, "utf8")) as {
      entries?: Array<{ id?: unknown }>;
    };
    if (Array.isArray(shared.entries)) sharedEntries = shared.entries;
  } catch {
    // no shared history yet — migrate everything
  }
  const known = new Set(sharedEntries.map((entry) => entry.id));
  const missing = legacyEntries.filter((entry) => !known.has(entry.id));
  if (missing.length === 0) return;
  const merged = [...missing, ...sharedEntries].slice(0, MAX_HISTORY_ENTRIES);

  mkdirSync(dirname(sharedPath), { recursive: true, mode: 0o700 });
  const temporary = `${sharedPath}.${process.pid}.${randomUUID()}.migrate.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ version: 1, entries: merged }, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  renameSync(temporary, sharedPath);
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
  // Shared with the Electron client: the browser and the desktop app read and
  // write the same scan history and schedule. The one-time migration pulls the
  // legacy isolated dev history (security-dev/) into the shared file first.
  const dataDirectory = join(homeDirectory, APP_DATA_DIR);
  migrateLegacyDevHistory(homeDirectory);
  const service = createDevSecurityScannerService({
    homeDirectory,
    dataDirectory,
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
