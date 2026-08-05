import { randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
  close(): Promise<void>;
}

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
): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

/**
 * Capability-token cookie name. The renderer's SPA requests (TanStack Start
 * server-fn RPC, the 5-second usage poll) use same-origin fetch with relative
 * paths — they cannot carry `?token=` — so the token is mirrored into an
 * HttpOnly SameSite=Strict cookie on the first authenticated response and the
 * browser attaches it to every same-origin request automatically.
 */
const TOKEN_COOKIE_NAME = "trusttools_token";

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
  if (parseCookies(request.headers.cookie)[TOKEN_COOKIE_NAME] === capabilityToken) {
    return "cookie";
  }

  const authHeader = request.headers.authorization;
  if (authHeader && authHeader === `Bearer ${capabilityToken}`) {
    return "challenge";
  }

  const customToken = request.headers["x-capability-token"];
  if (typeof customToken === "string" && customToken === capabilityToken) {
    return "challenge";
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const queryToken = url.searchParams.get("token");
  if (queryToken === capabilityToken) {
    return "challenge";
  }

  return "none";
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
): Promise<LocalWebServer> {
  const serverEntry = join(webRoot, "server", "index.mjs");
  const publicDirectory = join(webRoot, "public");
  const capabilityToken = randomUUID();
  const module = (await import(pathToFileURL(serverEntry).href)) as {
    default?: NitroHandler;
    middleware?: NitroNodeMiddleware;
  };
  const handler = module.default;
  const middleware = module.middleware;
  if (!handler?.fetch && !middleware) {
    throw new Error(
      "AITracker server build does not expose a fetch handler or Node middleware",
    );
  }

  const server = createServer(async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const requestUrl = new URL(request.url ?? "/", origin);
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
        const contentLength = parseInt(contentLengthHeader, 10);
        if (!Number.isNaN(contentLength) && contentLength > 10 * 1024 * 1024) {
          response.statusCode = 413;
          response.setHeader("Content-Type", "text/plain; charset=utf-8");
          response.end("Request body too large");
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
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("Unauthorized");
        return;
      }
      const challengeCookies =
        tokenStatus === "challenge" ? [tokenCookieHeader(capabilityToken)] : [];

      if (middleware) {
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

      await sendFetchResponse(fetchResponse, response, challengeCookies);
      void Promise.allSettled(pendingTasks);
    } catch (error) {
      console.error("Local web server request failed", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      response.end("AITracker local server error");
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to resolve AITracker local server address");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    capabilityToken,
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
