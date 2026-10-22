import assert from "node:assert/strict";
import test from "node:test";

import {
  CURSOR_ACCOUNT_ERROR_CODES,
  CURSOR_USAGE_CSV_URL,
  CursorAccountError,
  fetchCursorUsageCsv,
} from "./client.server.ts";

const CSV = "Date,Model\n2026-03-20T06:56:12.521Z,composer-2-fast";

function response(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, { status, headers });
}

function errorCode(error: unknown): string | undefined {
  return error instanceof CursorAccountError ? error.code : undefined;
}

test("returns the export body for a signed-in request", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const csv = await fetchCursorUsageCsv({
    cookie: "session",
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init });
      return response(200, CSV);
    }) as typeof fetch,
  });
  assert.equal(csv, CSV);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, CURSOR_USAGE_CSV_URL);
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers.cookie, "session");
  // The application UA is always attached by the shared adapter.
  assert.match(String(headers["user-agent"]), /AITracker/u);
});

test("classifies an expired Cursor session", async () => {
  await assert.rejects(
    fetchCursorUsageCsv({
      cookie: "session",
      fetchImpl: (async () => response(401, "")) as typeof fetch,
    }),
    (error: unknown) =>
      errorCode(error) === CURSOR_ACCOUNT_ERROR_CODES.signInExpired,
  );
});

test("follows a same-family redirect but rejects a foreign one", async () => {
  const urls: string[] = [];
  const csv = await fetchCursorUsageCsv({
    cookie: "session",
    fetchImpl: (async (url) => {
      urls.push(String(url));
      if (urls.length === 1) {
        return response(302, "", {
          location:
            "https://www.cursor.com/api/dashboard/export-usage-events-csv",
        });
      }
      return response(200, CSV);
    }) as typeof fetch,
  });
  assert.equal(csv, CSV);
  assert.deepEqual(urls, [
    CURSOR_USAGE_CSV_URL,
    "https://www.cursor.com/api/dashboard/export-usage-events-csv",
  ]);

  const foreign: string[] = [];
  await assert.rejects(
    fetchCursorUsageCsv({
      cookie: "session",
      fetchImpl: (async (url) => {
        foreign.push(String(url));
        return response(302, "", { location: "https://evil.example/steal" });
      }) as typeof fetch,
    }),
    (error: unknown) =>
      errorCode(error) === CURSOR_ACCOUNT_ERROR_CODES.untrustedRedirect,
  );
  assert.equal(foreign.length, 1, "the cookie must never leave cursor.com");

  // A second redirect is refused instead of handed to the runtime's redirect
  // follower, which would forward the manually set cookie header.
  const chained: string[] = [];
  await assert.rejects(
    fetchCursorUsageCsv({
      cookie: "session",
      fetchImpl: (async (url) => {
        chained.push(String(url));
        if (chained.length === 1) {
          return response(302, "", {
            location:
              "https://www.cursor.com/api/dashboard/export-usage-events-csv",
          });
        }
        return response(302, "", { location: "https://evil.example/steal" });
      }) as typeof fetch,
    }),
    (error: unknown) =>
      errorCode(error) === CURSOR_ACCOUNT_ERROR_CODES.untrustedRedirect,
  );
  assert.equal(chained.length, 2);
});

test("classifies server errors, timeouts and oversized exports", async () => {
  await assert.rejects(
    fetchCursorUsageCsv({
      cookie: "session",
      fetchImpl: (async () => response(500, "")) as typeof fetch,
    }),
    (error: unknown) =>
      errorCode(error) === CURSOR_ACCOUNT_ERROR_CODES.requestFailed,
  );

  await assert.rejects(
    fetchCursorUsageCsv({
      cookie: "session",
      fetchImpl: (async () => {
        throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
      }) as unknown as typeof fetch,
    }),
    (error: unknown) => errorCode(error) === CURSOR_ACCOUNT_ERROR_CODES.timeout,
  );

  await assert.rejects(
    fetchCursorUsageCsv({
      cookie: "session",
      fetchImpl: (async () =>
        response(200, "x", {
          "content-length": String(64 * 1024 * 1024),
        })) as typeof fetch,
    }),
    (error: unknown) =>
      errorCode(error) === CURSOR_ACCOUNT_ERROR_CODES.responseTooLarge,
  );
});
