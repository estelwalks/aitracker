import { readFile } from "node:fs/promises";

import type { CursorAccountPaths } from "./paths.server.ts";

/**
 * Enough of Cursor's signed-in state to call its account API. The access token
 * is a bearer credential: it is held in memory for one request and never
 * logged, persisted, or returned to the renderer.
 */
export interface CursorAccountSession {
  /** `WorkosCursorSessionToken=<userId>::<jwt>` for cursor.com. */
  readonly cookie: string;
  readonly userId: string;
}

export interface CursorAccountSessionDeps {
  /** Test seam: read the token from the state database. */
  readonly readAccessToken?: (
    stateDatabasePath: string,
  ) => Promise<string | null>;
  /** Test seam: read the CLI login subject. */
  readonly readCliSubject?: (cliConfigPath: string) => Promise<string | null>;
}

const ACCESS_TOKEN_SQL =
  "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'";

// WorkOS OAuth subject prefixes Cursor accepts as-is in the session cookie.
// Verified upstream against cursor.com/api/usage-summary.
const WORKOS_OAUTH_SUBJECT_PATTERN =
  /^(google-oauth2|github|oidc|auth0)\|[^|]+$/;
const NATIVE_SUBJECT_PATTERN = /\|(user_[A-Za-z0-9_]+)$/;

/**
 * Cursor stores the WorkOS subject in the CLI login state (and inside the JWT
 * as `sub`). Native email/password accounts are `auth0|user_…` and the cookie
 * wants just the `user_…` part; OAuth-bridged subjects keep their provider
 * prefix. Anything else is not a subject Cursor accepts.
 */
export function normalizeCursorAccountSubject(subject: unknown): string | null {
  if (typeof subject !== "string" || subject.length === 0) return null;
  const value = subject.trim();
  const native = NATIVE_SUBJECT_PATTERN.exec(value);
  if (native?.[1] != null) return native[1];
  if (WORKOS_OAUTH_SUBJECT_PATTERN.test(value)) return value;
  return null;
}

/** Reads `cursorAuth/accessToken` from Cursor's own state database. */
export async function readCursorAccessToken(
  stateDatabasePath: string,
): Promise<string | null> {
  let database: import("node:sqlite").DatabaseSync | undefined;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    database = new DatabaseSync(stateDatabasePath, { readOnly: true });
    const row = database.prepare(ACCESS_TOKEN_SQL).get() as
      { value?: unknown } | undefined;
    const raw = typeof row?.value === "string" ? row.value.trim() : "";
    if (raw.length === 0) return null;
    // Cursor writes the token as a bare string; tolerate a JSON-quoted value.
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try {
        const decoded = JSON.parse(raw) as unknown;
        return typeof decoded === "string" && decoded.length > 0
          ? decoded
          : null;
      } catch {
        return null;
      }
    }
    return raw;
  } catch {
    // A missing/renamed table, a locked database, or a Cursor version that
    // changed its storage all mean "no usable session", never a scan failure.
    return null;
  } finally {
    database?.close();
  }
}

/** Reads `authInfo.authId` from `~/.cursor/cli-config.json`. */
export async function readCursorCliSubject(
  cliConfigPath: string,
): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(cliConfigPath, "utf8")) as unknown;
    if (parsed == null || typeof parsed !== "object") return null;
    const authInfo = (parsed as { authInfo?: unknown }).authInfo;
    if (authInfo == null || typeof authInfo !== "object") return null;
    return normalizeCursorAccountSubject(
      (authInfo as { authId?: unknown }).authId,
    );
  } catch {
    return null;
  }
}

/**
 * Decodes the WorkOS subject from the access-token JWT. The payload is only
 * base64-decoded, never verified: Cursor has already signed us in locally and
 * the token is sent back to Cursor, not trusted for a local decision.
 */
export function readCursorJwtSubject(accessToken: string): string | null {
  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    ) as { sub?: unknown };
    return normalizeCursorAccountSubject(payload.sub);
  } catch {
    return null;
  }
}

/**
 * Builds the cursor.com session cookie from Cursor's local login state.
 * Returns null when Cursor is signed out or its state cannot be read.
 */
export async function readCursorAccountSession(
  paths: Pick<CursorAccountPaths, "stateDatabasePath" | "cliConfigPath">,
  deps: CursorAccountSessionDeps = {},
): Promise<CursorAccountSession | null> {
  const readAccessToken = deps.readAccessToken ?? readCursorAccessToken;
  const token = await readAccessToken(paths.stateDatabasePath);
  if (token == null || token.length < 10) return null;
  const readCliSubject = deps.readCliSubject ?? readCursorCliSubject;
  const userId =
    (await readCliSubject(paths.cliConfigPath)) ?? readCursorJwtSubject(token);
  if (userId == null) return null;
  return {
    cookie: `WorkosCursorSessionToken=${userId}%3A%3A${token}`,
    userId,
  };
}
