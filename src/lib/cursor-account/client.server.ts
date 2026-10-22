import { fetchExternal } from "../http/external-request.server.ts";

/**
 * Cursor account usage export endpoint (undocumented first-party API, mirrored
 * from the reference implementation). The token strategy returns per-request
 * token counts; the default export returns dollar amounts only.
 */
export const CURSOR_USAGE_CSV_URL =
  "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens";

/** Only Cursor's own origins may receive the session cookie on a redirect. */
const CURSOR_REDIRECT_HOSTS = new Set(["cursor.com", "www.cursor.com"]);

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_CSV_BYTES = 32 * 1024 * 1024;

export const CURSOR_ACCOUNT_ERROR_CODES = {
  signInExpired: "cursor-account.sign-in-expired",
  requestFailed: "cursor-account.request-failed",
  timeout: "cursor-account.timeout",
  responseTooLarge: "cursor-account.response-too-large",
  untrustedRedirect: "cursor-account.untrusted-redirect",
} as const;

export type CursorAccountErrorCode =
  (typeof CURSOR_ACCOUNT_ERROR_CODES)[keyof typeof CURSOR_ACCOUNT_ERROR_CODES];

/** A stable, secret-free failure classification for the UI. */
export class CursorAccountError extends Error {
  readonly code: CursorAccountErrorCode;
  constructor(code: CursorAccountErrorCode, message: string) {
    super(message);
    this.name = "CursorAccountError";
    this.code = code;
  }
}

export interface FetchCursorUsageCsvOptions {
  readonly cookie: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function isTrustedCursorUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && CURSOR_REDIRECT_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function requestHeaders(cookie: string): Record<string, string> {
  return {
    Accept: "*/*",
    Cookie: cookie,
    Referer: "https://www.cursor.com/settings",
  };
}

function isTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function readCappedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_CSV_BYTES) {
    throw new CursorAccountError(
      CURSOR_ACCOUNT_ERROR_CODES.responseTooLarge,
      "Cursor usage export exceeds the supported size",
    );
  }
  const text = await response.text();
  if (text.length > MAX_CSV_BYTES) {
    throw new CursorAccountError(
      CURSOR_ACCOUNT_ERROR_CODES.responseTooLarge,
      "Cursor usage export exceeds the supported size",
    );
  }
  return text;
}

function assertOkStatus(status: number): void {
  if (status === 401 || status === 403) {
    throw new CursorAccountError(
      CURSOR_ACCOUNT_ERROR_CODES.signInExpired,
      "Cursor session expired; sign in again in Cursor",
    );
  }
  if (status !== 200) {
    throw new CursorAccountError(
      CURSOR_ACCOUNT_ERROR_CODES.requestFailed,
      `Cursor usage export returned ${status}`,
    );
  }
}

/**
 * Downloads the account usage export. Cursor answers signed-in requests with a
 * 200 and a redirect to `www.cursor.com` for some accounts, so a single
 * same-family hop is followed explicitly: the `Location` is resolved and
 * checked before the session cookie is forwarded, which keeps an
 * attacker-influenced header from leaking it to another origin.
 */
export async function fetchCursorUsageCsv(
  options: FetchCursorUsageCsvOptions,
): Promise<string> {
  const fetcher = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetchExternal(
      CURSOR_USAGE_CSV_URL,
      {
        method: "GET",
        headers: requestHeaders(options.cookie),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      },
      fetcher,
    );
  } catch (error) {
    if (isTimeout(error)) {
      throw new CursorAccountError(
        CURSOR_ACCOUNT_ERROR_CODES.timeout,
        "Cursor usage export timed out",
      );
    }
    throw new CursorAccountError(
      CURSOR_ACCOUNT_ERROR_CODES.requestFailed,
      "Cursor usage export request failed",
    );
  }

  const location = response.headers.get("location");
  const redirectStatus = [301, 302, 303, 307, 308].includes(response.status);
  if (redirectStatus) {
    if (location == null || !isTrustedCursorUrl(location)) {
      throw new CursorAccountError(
        CURSOR_ACCOUNT_ERROR_CODES.untrustedRedirect,
        "Cursor usage export redirected to an untrusted origin",
      );
    }
    try {
      // One hop only, and still `manual`: the cookie must never be forwarded
      // by the runtime to a redirect chain we have not inspected ourselves.
      response = await fetchExternal(
        location,
        {
          method: "GET",
          headers: requestHeaders(options.cookie),
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
        },
        fetcher,
      );
    } catch (error) {
      if (isTimeout(error)) {
        throw new CursorAccountError(
          CURSOR_ACCOUNT_ERROR_CODES.timeout,
          "Cursor usage export timed out",
        );
      }
      throw new CursorAccountError(
        CURSOR_ACCOUNT_ERROR_CODES.requestFailed,
        "Cursor usage export request failed",
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      throw new CursorAccountError(
        CURSOR_ACCOUNT_ERROR_CODES.untrustedRedirect,
        "Cursor usage export redirected more than once",
      );
    }
  }

  assertOkStatus(response.status);
  return readCappedText(response);
}
