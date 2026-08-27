import { randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { COOKIE_TOKEN_NAME } from "./app-config.js";
import {
  createStartupWarmupError,
  STARTUP_FAILURE_CODE_HEADER,
} from "./startup-failure.js";
import {
  handleSecurityHttpApi,
  SECURITY_API_PREFIX,
} from "./security-http-api.js";
import type { SecurityScannerService } from "./security-scanner-service.js";

interface NitroExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface NitroHandler {
  fetch(
    request: Request,
    environment: Record<string, unknown>,
    context: NitroExecutionContext,
  ): Promise<Response>;
}

type NitroNodeMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

export interface LocalWebServer {
  origin: string;
  capabilityToken: string;
  createBrowserBootstrapUrl(pathname?: string): string;
  /**
   * Starts the server-side desktop runtime without rendering an application
   * document. Used while Electron shows its native startup screen.
   */
  warmup(desktopBrokerToken: string): Promise<void>;
  close(): Promise<void>;
}

export interface LocalWebServerOptions {
  securityScanner?: SecurityScannerService;
}

const MAX_GENERAL_BODY_BYTES = 10 * 1024 * 1024;
const MAX_SECURITY_API_BODY_BYTES = 64 * 1024;
const MAX_CONCURRENT_SECURITY_REQUESTS = 16;
const MAX_BROWSER_BOOTSTRAP_TOKENS = 16;
const BROWSER_BOOTSTRAP_TTL_MS = 60_000;

const mimeTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function isInside(basePath: string, candidatePath: string): boolean {
  const pathFromBase = relative(basePath, candidatePath);
  return (
    pathFromBase === "" ||
    (!pathFromBase.startsWith("..") && !pathFromBase.startsWith("/"))
  );
}

async function servePublicAsset(
  request: IncomingMessage,
  response: ServerResponse,
  publicDirectory: string,
  pathname: string,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = normalize(decodedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const assetPath = resolve(publicDirectory, `.${requestedPath}`);

  if (!isInside(publicDirectory, assetPath)) {
    return false;
  }

  const stats = await fs.stat(assetPath).catch(() => null);
  if (!stats?.isFile()) {
    return false;
  }

  response.statusCode = 200;
  response.setHeader(
    "Content-Type",
    mimeTypes[extname(assetPath).toLowerCase()] ?? "application/octet-stream",
  );
  response.setHeader("Content-Length", stats.size);
  response.setHeader(
    "Cache-Control",
    pathname.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );

  if (request.method === "HEAD") {
    response.end();
  } else {
    createReadStream(assetPath).pipe(response);
  }

  return true;
}

async function readRequestBody(
  request: IncomingMessage,
  maximumBytes = MAX_GENERAL_BODY_BYTES,
): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maximumBytes) throw new RequestBodyTooLargeError();
    chunks.push(buffer);
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

class RequestBodyTooLargeError extends Error {}

/**
 * Capability-token cookie name. The renderer's SPA requests (TanStack Start
 * server-fn RPC and periodic snapshot-status refreshes) use same-origin fetch with relative
 * paths — they cannot carry `?token=` — so the token is mirrored into an
 * HttpOnly SameSite=Strict cookie on the first authenticated response and the
 * browser attaches it to every same-origin request automatically.
 */
const TOKEN_COOKIE_NAME = COOKIE_TOKEN_NAME;

type TokenStatus = "none" | "cookie" | "challenge";

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name.length > 0) cookies[name] = part.slice(eq + 1).trim();
  }
  return cookies;
}

function equalToken(candidate: string | undefined, expected: string): boolean {
  if (candidate == null) return false;
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return (
    candidateBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

/**
 * Validate the capability token. Returns:
 *  - "cookie":    the HttpOnly cookie already matches (no Set-Cookie needed);
 *  - "challenge": token valid via query/header — response should set the
 *    cookie so subsequent same-origin requests carry it automatically;
 *  - "none":      unauthorized.
 */
function validateToken(
  request: IncomingMessage,
  capabilityToken: string,
): TokenStatus {
  if (
    equalToken(
      parseCookies(request.headers.cookie)[TOKEN_COOKIE_NAME],
      capabilityToken,
    )
  ) {
    return "cookie";
  }
  return "none";
}

function securityResponseHeaders(response: ServerResponse): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
}

function tokenCookieHeader(capabilityToken: string): string {
  return `${TOKEN_COOKIE_NAME}=${capabilityToken}; Path=/; HttpOnly; SameSite=Strict`;
}

async function sendFetchResponse(
  fetchResponse: Response,
  nodeResponse: ServerResponse,
  extraSetCookies: string[],
): Promise<void> {
  nodeResponse.statusCode = fetchResponse.status;
  nodeResponse.statusMessage = fetchResponse.statusText;

  fetchResponse.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") {
      nodeResponse.setHeader(name, value);
    }
  });

  // SSR HTML embeds the current route manifest and lazy-chunk references.
  // Never reuse an old document shell after an app update; the hashed assets
  // themselves remain safely immutable.
  if ((fetchResponse.headers.get("content-type") ?? "").includes("text/html")) {
    nodeResponse.setHeader("cache-control", "no-store");
  }

  const getSetCookie = (
    fetchResponse.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const cookies = [
    ...extraSetCookies,
    ...(getSetCookie ? getSetCookie.call(fetchResponse.headers) : []),
  ];
  if (cookies.length > 0) {
    nodeResponse.setHeader("set-cookie", cookies);
  }

  const responseBody = await fetchResponse.arrayBuffer();
  nodeResponse.end(Buffer.from(responseBody));
}

export async function startLocalWebServer(
  webRoot: string,
  options: LocalWebServerOptions = {},
): Promise<LocalWebServer> {
  const serverEntry = join(webRoot, "server", "index.mjs");
  const publicDirectory = join(webRoot, "public");
  const capabilityToken = randomUUID();
  const browserBootstrapTokens = new Map<string, number>();
  let activeSecurityRequests = 0;
  const module = (await import(pathToFileURL(serverEntry).href)) as {
    default?: NitroHandler;
    middleware?: NitroNodeMiddleware;
  };
  const handler = module.default;
  const middleware = module.middleware;
  if (!handler?.fetch && !middleware) {
    throw new Error(
      "Server build does not expose a fetch handler or Node middleware",
    );
  }

  const server = createServer(async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const requestUrl = new URL(request.url ?? "/", origin);
      if (
        request.headers.host !== new URL(origin).host ||
        requestUrl.origin !== origin
      ) {
        response.statusCode = 421;
        securityResponseHeaders(response);
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("Misdirected Request");
        return;
      }

      // External browsers receive a single-use bootstrap URL from the native
      // tray. Consume it once, establish the HttpOnly cookie, then redirect to
      // a clean URL so no reusable capability remains in address/history.
      const browserBootstrap = requestUrl.searchParams.get("bootstrap");
      if (browserBootstrap != null) {
        const expiresAt = browserBootstrapTokens.get(browserBootstrap);
        browserBootstrapTokens.delete(browserBootstrap);
        if (expiresAt == null || expiresAt < Date.now()) {
          response.statusCode = 401;
          securityResponseHeaders(response);
          response.setHeader("referrer-policy", "no-referrer");
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("Unauthorized");
          return;
        }
        requestUrl.searchParams.delete("bootstrap");
        response.statusCode = 303;
        response.setHeader("set-cookie", tokenCookieHeader(capabilityToken));
        response.setHeader(
          "location",
          `${requestUrl.pathname}${requestUrl.search}${requestUrl.hash}`,
        );
        securityResponseHeaders(response);
        response.setHeader("referrer-policy", "no-referrer");
        response.end();
        return;
      }

      if (
        await servePublicAsset(
          request,
          response,
          publicDirectory,
          requestUrl.pathname,
        )
      ) {
        return;
      }

      // Reject oversized request bodies before reading them into memory.
      const contentLengthHeader = request.headers["content-length"];
      if (contentLengthHeader) {
        const contentLength = /^\d+$/u.test(contentLengthHeader)
          ? Number(contentLengthHeader)
          : Number.NaN;
        const isSecurityApi =
          requestUrl.pathname.startsWith(SECURITY_API_PREFIX);
        const maximum = isSecurityApi
          ? MAX_SECURITY_API_BODY_BYTES
          : MAX_GENERAL_BODY_BYTES;
        if (isSecurityApi && !Number.isSafeInteger(contentLength)) {
          response.statusCode = 400;
          securityResponseHeaders(response);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(
            '{"error":{"code":"security.http.invalid_content_length"}}',
          );
          return;
        }
        if (!Number.isNaN(contentLength) && contentLength > maximum) {
          response.statusCode = 413;
          securityResponseHeaders(response);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end('{"error":{"code":"security.http.body_too_large"}}');
          return;
        }
      }

      // All non-static routes require the capability token. A token supplied
      // via query/header additionally establishes the HttpOnly cookie so the
      // SPA's same-origin fetches (server-fn RPC, usage poll) authenticate
      // automatically.
      const tokenStatus = validateToken(request, capabilityToken);
      if (tokenStatus === "none") {
        response.statusCode = 401;
        if (requestUrl.pathname.startsWith(SECURITY_API_PREFIX)) {
          securityResponseHeaders(response);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end('{"error":{"code":"security.http.unauthorized"}}');
        } else {
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("Unauthorized");
        }
        return;
      }
      const challengeCookies =
        tokenStatus === "challenge" ? [tokenCookieHeader(capabilityToken)] : [];

      if (requestUrl.pathname.startsWith(SECURITY_API_PREFIX)) {
        if (!options.securityScanner) {
          response.statusCode = 503;
          securityResponseHeaders(response);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(
            '{"error":{"code":"security.http.service_unavailable"}}',
          );
          return;
        }
        if (request.headers["content-encoding"] != null) {
          response.statusCode = 415;
          securityResponseHeaders(response);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(
            '{"error":{"code":"security.http.content_encoding_unsupported"}}',
          );
          return;
        }
        if (activeSecurityRequests >= MAX_CONCURRENT_SECURITY_REQUESTS) {
          response.statusCode = 429;
          securityResponseHeaders(response);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.setHeader("retry-after", "1");
          response.end('{"error":{"code":"security.http.too_many_requests"}}');
          return;
        }
        activeSecurityRequests += 1;
        try {
          const body = await readRequestBody(
            request,
            MAX_SECURITY_API_BODY_BYTES,
          );
          const declaredLength = request.headers["content-length"];
          if (
            declaredLength != null &&
            Number(declaredLength) !== (body?.byteLength ?? 0)
          ) {
            response.statusCode = 400;
            securityResponseHeaders(response);
            response.setHeader(
              "Content-Type",
              "application/json; charset=utf-8",
            );
            response.end(
              '{"error":{"code":"security.http.content_length_mismatch"}}',
            );
            return;
          }
          const apiRequest = new Request(requestUrl, {
            method: request.method,
            headers: new Headers(request.headers as Record<string, string>),
            ...(body == null ? {} : { body: body.toString("utf8") }),
          });
          const apiResponse = await handleSecurityHttpApi(
            apiRequest,
            origin,
            options.securityScanner,
          );
          if (!apiResponse)
            throw new Error("Security API route was not handled");
          await sendFetchResponse(apiResponse, response, challengeCookies);
        } finally {
          activeSecurityRequests -= 1;
        }
        return;
      }

      if (middleware) {
        // Nitro's Node middleware writes the document response directly, so
        // apply the same policy as the fetch-based path above.
        if (request.method === "GET" || request.method === "HEAD") {
          response.setHeader("cache-control", "no-store");
        }
        if (challengeCookies.length > 0) {
          response.setHeader("set-cookie", challengeCookies);
        }
        await middleware(request, response);
        return;
      }

      const pendingTasks: Promise<unknown>[] = [];
      const body = await readRequestBody(request);
      const requestBody = body ? new Uint8Array(body.byteLength) : undefined;
      if (body && requestBody) {
        requestBody.set(body);
      }
      const fetchRequest = new Request(requestUrl, {
        method: request.method,
        headers: new Headers(request.headers as Record<string, string>),
        body: requestBody,
      });
      const fetchResponse = await handler!.fetch(
        fetchRequest,
        {},
        {
          waitUntil: (promise) => pendingTasks.push(promise),
          passThroughOnException: () => undefined,
        },
      );

      const isWorkspaceWarmup =
        requestUrl.pathname === "/api/desktop-state/preferences" &&
        typeof request.headers["x-aitracker-desktop-broker"] === "string";
      if (isWorkspaceWarmup) {
        // The loopback warmup response is a startup barrier. Direct-fetch test
        // and development builds may register initialization through
        // waitUntil, so settle that work before exposing a successful status.
        await Promise.all(pendingTasks);
      }
      await sendFetchResponse(fetchResponse, response, challengeCookies);
      if (!isWorkspaceWarmup) void Promise.allSettled(pendingTasks);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        response.statusCode = 413;
        securityResponseHeaders(response);
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end('{"error":{"code":"security.http.body_too_large"}}');
        return;
      }
      console.error("Local web server request failed", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        if ((request.url ?? "").includes(SECURITY_API_PREFIX)) {
          securityResponseHeaders(response);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end('{"error":{"code":"security.http.internal_error"}}');
          return;
        }
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      response.end("Local server error");
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve local server address");
  }
  const origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    capabilityToken,
    createBrowserBootstrapUrl(pathname = "/security") {
      const now = Date.now();
      for (const [token, expiresAt] of browserBootstrapTokens) {
        if (expiresAt < now) browserBootstrapTokens.delete(token);
      }
      while (browserBootstrapTokens.size >= MAX_BROWSER_BOOTSTRAP_TOKENS) {
        const oldest = browserBootstrapTokens.keys().next().value as
          string | undefined;
        if (oldest == null) break;
        browserBootstrapTokens.delete(oldest);
      }
      const bootstrap = randomUUID();
      browserBootstrapTokens.set(bootstrap, now + BROWSER_BOOTSTRAP_TTL_MS);
      const url = new URL(pathname, origin);
      if (url.origin !== origin)
        throw new TypeError("Browser bootstrap path must stay same-origin");
      url.searchParams.set("bootstrap", bootstrap);
      return url.href;
    },
    async warmup(desktopBrokerToken) {
      if (!desktopBrokerToken) {
        throw new Error("AITracker workspace warmup token is unavailable");
      }

      // Use the already-listening loopback server so packaged Nitro builds
      // that export only Node middleware follow exactly the same request path
      // as the application. This also invokes one server entry exactly once,
      // avoiding a direct-fetch + middleware double initialization.
      const response = await fetch(`${origin}/api/desktop-state/preferences`, {
        method: "GET",
        headers: {
          cookie: `${COOKIE_TOKEN_NAME}=${capabilityToken}`,
          "x-aitracker-desktop-broker": desktopBrokerToken,
        },
      });
      const startupFailureCode = response.headers.get(
        STARTUP_FAILURE_CODE_HEADER,
      );
      await response.body?.cancel();
      if (!response.ok) {
        throw createStartupWarmupError(response.status, startupFailureCode);
      }
    },
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
          } else {
            resolveClose();
          }
        });
      }),
  };
}
