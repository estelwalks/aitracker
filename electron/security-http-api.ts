import { SECURITY_CSRF_HEADER } from "./app-config.js";
import type { SecurityScannerService } from "./security-scanner-service.js";

export const SECURITY_API_PREFIX = "/api/security";
export { SECURITY_CSRF_HEADER };
export const SECURITY_CSRF_VALUE = "1";

type SecurityHttpService = Pick<
  SecurityScannerService,
  | "listSkills"
  | "start"
  | "getStatus"
  | "history"
  | "cancel"
  | "getScanSchedule"
  | "getScanScheduleStatus"
  | "setScanSchedule"
  | "getRuntimeCapability"
>;

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function failure(code: string, status: number): Response {
  return json({ error: { code } }, status);
}

function method(request: Request, expected: "GET" | "POST"): Response | null {
  if (request.method === expected) return null;
  return failure("security.http.method_not_allowed", 405);
}

async function jsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^application\/json(?:\s*;|$)/u.test(contentType)) {
    throw new SecurityHttpError("security.http.unsupported_media_type", 415);
  }
  try {
    return await request.json();
  } catch {
    throw new SecurityHttpError("security.http.invalid_json", 400);
  }
}

class SecurityHttpError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

function stableServiceError(error: unknown): SecurityHttpError {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("already running"))
    return new SecurityHttpError("security.http.scan_conflict", 409);
  if (message.includes("No trusted Skill"))
    return new SecurityHttpError("security.http.no_skills", 404);
  if (message.includes("cleared"))
    return new SecurityHttpError("security.http.scan_cancelled", 409);
  return new SecurityHttpError("security.http.invalid_request", 400);
}

function authorizeMutation(request: Request, expectedOrigin: string): void {
  if (request.headers.get("origin") !== expectedOrigin) {
    throw new SecurityHttpError("security.http.invalid_origin", 403);
  }
  if (request.headers.get(SECURITY_CSRF_HEADER) !== SECURITY_CSRF_VALUE) {
    throw new SecurityHttpError("security.http.csrf_required", 403);
  }
}

/**
 * Same-origin HTTP adapter for external browsers. Authentication is performed
 * by local-web-server before this adapter is reached; this layer owns the
 * stricter API method, Origin/CSRF and JSON contracts only.
 */
export async function handleSecurityHttpApi(
  request: Request,
  expectedOrigin: string,
  service: SecurityHttpService,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${SECURITY_API_PREFIX}/`)) return null;

  try {
    const route = pathname.slice(SECURITY_API_PREFIX.length);
    const allowedMethods =
      route === "/scan-schedule"
        ? ["GET", "POST"]
        : route === "/start" ||
            route === "/cancel" ||
            route === "/select-skill-directory"
          ? ["POST"]
          : ["GET"];
    if (!allowedMethods.includes(request.method))
      return failure("security.http.method_not_allowed", 405);
    const mutation =
      route === "/start" ||
      route === "/cancel" ||
      route === "/select-skill-directory" ||
      (route === "/scan-schedule" && request.method === "POST");
    if (mutation) authorizeMutation(request, expectedOrigin);

    switch (route) {
      case "/capability":
        if (request.method !== "GET") return method(request, "GET");
        return json(service.getRuntimeCapability());
      case "/skills":
        if (request.method !== "GET") return method(request, "GET");
        return json(await service.listSkills());
      case "/status":
        if (request.method !== "GET") return method(request, "GET");
        return json(service.getStatus());
      case "/history":
        if (request.method !== "GET") return method(request, "GET");
        return json(await service.history());
      case "/scan-schedule":
        if (request.method === "GET")
          return json(await service.getScanSchedule());
        if (request.method !== "POST") return method(request, "POST");
        return json(await service.setScanSchedule(await jsonBody(request)));
      case "/scan-schedule-status":
        if (request.method !== "GET") return method(request, "GET");
        return json(await service.getScanScheduleStatus());
      case "/start": {
        if (request.method !== "POST") return method(request, "POST");
        const input = await jsonBody(request);
        if (input == null || typeof input !== "object" || Array.isArray(input))
          throw new SecurityHttpError("security.http.invalid_request", 400);
        const fields = input as Record<string, unknown>;
        const allowed = new Set(["scope", "skillRef", "mode", "trigger"]);
        if (Object.keys(fields).some((key) => !allowed.has(key)))
          throw new SecurityHttpError("security.http.invalid_request", 400);
        if (fields.trigger != null && fields.trigger !== "manual")
          throw new SecurityHttpError("security.http.invalid_request", 400);
        return json(
          await service.start({
            scope: fields.scope,
            ...(fields.skillRef === undefined
              ? {}
              : { skillRef: fields.skillRef }),
            mode: fields.mode,
            trigger: "manual",
          }),
          202,
        );
      }
      case "/cancel": {
        if (request.method !== "POST") return method(request, "POST");
        const input = await jsonBody(request);
        if (
          input == null ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).length !== 0
        )
          throw new SecurityHttpError("security.http.invalid_request", 400);
        return json(service.cancel());
      }
      case "/select-skill-directory":
        if (request.method !== "POST") return method(request, "POST");
        {
          const input = await jsonBody(request);
          if (
            input == null ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            Object.keys(input).length !== 0
          )
            throw new SecurityHttpError("security.http.invalid_request", 400);
        }
        return failure("security.http.native_picker_unavailable", 501);
      default:
        return failure("security.http.not_found", 404);
    }
  } catch (error) {
    const stable =
      error instanceof SecurityHttpError ? error : stableServiceError(error);
    return failure(stable.code, stable.status);
  }
}
