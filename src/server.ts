import "./lib/error-capture";

import { ensureBackgroundRuntimeStarted } from "./app/bootstrap.server.ts";
import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

// SECURITY_API_PREFIX must stay in sync with electron/security-http-api.ts.
const SECURITY_API_PREFIX = "/api/security";

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
    headers: { "content-type": "text/html; charset=utf-8" },
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
      // The bootstrap is a no-op for web development by policy, while desktop
      // composition may inject the scheduler before the first SSR request.
      await ensureBackgroundRuntimeStarted();
      const security = await maybeHandleSecurityDevRequest(request);
      if (security) return security;
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(request, response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(request.url), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
