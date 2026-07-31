import { createReadStream, promises as fs } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
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
  return pathFromBase === "" || (!pathFromBase.startsWith("..") && !pathFromBase.startsWith("/"));
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
    pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
  );

  if (request.method === "HEAD") {
    response.end();
  } else {
    createReadStream(assetPath).pipe(response);
  }

  return true;
}

async function readRequestBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === "GET" || request.method === "HEAD") {
    return undefined;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
}

async function sendFetchResponse(
  fetchResponse: Response,
  nodeResponse: ServerResponse,
): Promise<void> {
  nodeResponse.statusCode = fetchResponse.status;
  nodeResponse.statusMessage = fetchResponse.statusText;

  fetchResponse.headers.forEach((value, name) => {
    nodeResponse.setHeader(name, value);
  });

  const getSetCookie = (fetchResponse.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  if (getSetCookie) {
    const cookies = getSetCookie.call(fetchResponse.headers);
    if (cookies.length > 0) {
      nodeResponse.setHeader("set-cookie", cookies);
    }
  }

  const responseBody = await fetchResponse.arrayBuffer();
  nodeResponse.end(Buffer.from(responseBody));
}

export async function startLocalWebServer(webRoot: string): Promise<LocalWebServer> {
  const serverEntry = join(webRoot, "server", "index.mjs");
  const publicDirectory = join(webRoot, "public");
  const module = (await import(pathToFileURL(serverEntry).href)) as {
    default?: NitroHandler;
    middleware?: NitroNodeMiddleware;
  };
  const handler = module.default;
  const middleware = module.middleware;
  if (!handler?.fetch && !middleware) {
    throw new Error("TrustTools server build does not expose a fetch handler or Node middleware");
  }

  const server = createServer(async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const requestUrl = new URL(request.url ?? "/", origin);
      if (await servePublicAsset(request, response, publicDirectory, requestUrl.pathname)) {
        return;
      }
      if (middleware) {
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

      await sendFetchResponse(fetchResponse, response);
      void Promise.allSettled(pendingTasks);
    } catch (error) {
      console.error("Local web server request failed", error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      response.end("TrustTools local server error");
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
    throw new Error("Unable to resolve TrustTools local server address");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
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
