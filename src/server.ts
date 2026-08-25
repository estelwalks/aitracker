import "./lib/error-capture";

import { ensureBackgroundRuntimeStarted } from "./app/bootstrap.server.ts";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleDesktopStateBrokerRequest } from "./app/desktop-state-broker.server.ts";
import {
  STARTUP_FAILURE_CODE_HEADER,
  startupFailureCode,
} from "./app/startup-diagnostics.server.ts";

// SECURITY_API_PREFIX must stay in sync with electron/security-http-api.ts.
const SECURITY_API_PREFIX = "/api/security";
const NO_STORE = "no-store";

type ServerEntry = {
  fetch: (
    request: Request,
    env: unknown,
    ctx: unknown,
  ) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(
  request: Request,
  response: Response,
): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(
    consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`),
  );
  return new Response(renderErrorPage(request.url), {
    status: 500,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": NO_STORE,
    },
  });
}

/**
 * Application documents, route-loader responses and server-function responses
 * can all contain a deployment-specific route/function manifest or live local
 * usage data. Never let a browser reuse them after an update; only static,
 * content-addressed assets are cacheable and Nitro serves those outside this
 * application entry.
 */
export function markDynamicResponseNoStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", NO_STORE);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as {
      unhandled?: unknown;
      message?: unknown;
    };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

/**
 * Lazily serves the browser-dev security backend (`/api/security/*`).
 *
 * The dev backend pulls in `skill-scanner` through `electron/security-scanner-service.ts`,
 * which reads its `dist/prompts/*.md` resources at module load. Importing it
 * statically here would put that whole module graph in the SSR entry, so every
 * route (including `/`) would evaluate the scanner and depend on its built
 * resources being present. A dynamic import scoped to the security prefix keeps
 * the scanner out of the module graph for all other requests — it only loads
 * when an actual `/api/security/*` request arrives.
 */
async function maybeHandleSecurityDevRequest(
  request: Request,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(`${SECURITY_API_PREFIX}/`)) return null;
  const { handleSecurityDevRequest } =
    await import("./modules/security-assessment/adapters/security-dev-server.server.ts");
  return handleSecurityDevRequest(request);
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      // First-run collectors form the desktop startup barrier: the main
      // document opens only after its local workspace data is ready. Web
      // development resolves this bootstrap to a policy no-op.
      await ensureBackgroundRuntimeStarted();
      const desktopState = await handleDesktopStateBrokerRequest(request);
      if (desktopState) return desktopState;
      const security = await maybeHandleSecurityDevRequest(request);
      if (security) return security;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      const normalized = await normalizeCatastrophicSsrResponse(
        request,
        response,
      );
      return markDynamicResponseNoStore(normalized);
    } catch (error) {
      console.error(error);
      const headers = new Headers({
        "content-type": "text/html; charset=utf-8",
        "cache-control": NO_STORE,
      });
      // The Electron warmup request must distinguish an unavailable database
      // from a generic server failure. This stable code contains neither a
      // path nor a driver message and is emitted only when startup fails.
      if (new URL(request.url).pathname === "/api/desktop-state/preferences") {
        headers.set(STARTUP_FAILURE_CODE_HEADER, startupFailureCode(error));
      }
      return new Response(renderErrorPage(request.url), {
        status: 500,
        headers,
      });
    }
  },
};
