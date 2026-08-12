import assert from "node:assert/strict";
import test from "node:test";

import type { SecurityScannerService } from "./security-scanner-service.js";
import {
  handleSecurityHttpApi,
  SECURITY_CSRF_HEADER,
  SECURITY_CSRF_VALUE,
} from "./security-http-api.js";

const origin = "http://127.0.0.1:43210";

function service(
  overrides: Record<string, unknown> = {},
): SecurityScannerService {
  return {
    getRuntimeCapability: () => ({ capability: "detection-only" }),
    listSkills: async () => [],
    getStatus: () => ({ status: "idle" }),
    history: async () => [],
    cancel: () => ({ cancelled: false }),
    getModelConfig: async () => ({ configured: false }),
    setModelConfig: async () => ({ configured: true, apiKeyConfigured: true }),
    start: async (input: unknown) => ({ status: "running", input }),
    ...overrides,
  } as unknown as SecurityScannerService;
}

function post(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`${origin}/api/security${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      [SECURITY_CSRF_HEADER]: SECURITY_CSRF_VALUE,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("GET routes return DTOs with no-store and no CORS", async () => {
  const response = await handleSecurityHttpApi(
    new Request(`${origin}/api/security/capability`),
    origin,
    service(),
  );
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { capability: "detection-only" });
  assert.equal(response?.headers.get("cache-control"), "no-store");
  assert.equal(response?.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response?.headers.get("access-control-allow-origin"), null);
});

test("mutations require exact Origin, CSRF, POST and JSON", async () => {
  for (const [request, code, status] of [
    [
      post("/cancel", {}, { origin: "http://evil.invalid" }),
      "security.http.invalid_origin",
      403,
    ],
    [
      post("/cancel", {}, { [SECURITY_CSRF_HEADER]: "wrong" }),
      "security.http.csrf_required",
      403,
    ],
    [
      post("/cancel", {}, { "content-type": "text/plain" }),
      "security.http.unsupported_media_type",
      415,
    ],
    [
      new Request(`${origin}/api/security/start`),
      "security.http.method_not_allowed",
      405,
    ],
  ] as const) {
    const response = await handleSecurityHttpApi(request, origin, service());
    assert.equal(response?.status, status);
    assert.deepEqual(await response?.json(), { error: { code } });
  }
});

test("HTTP start forces manual and rejects automatic trigger", async () => {
  let captured: unknown;
  const scanner = service({
    start: async (input: unknown) => {
      captured = input;
      return { status: "running" };
    },
  });
  const response = await handleSecurityHttpApi(
    post("/start", { scope: "all", mode: "quick" }),
    origin,
    scanner,
  );
  assert.equal(response?.status, 202);
  assert.deepEqual(captured, {
    scope: "all",
    mode: "quick",
    trigger: "manual",
  });

  const rejected = await handleSecurityHttpApi(
    post("/start", {
      scope: "all",
      mode: "quick",
      trigger: "automatic",
    }),
    origin,
    scanner,
  );
  assert.equal(rejected?.status, 400);
  assert.deepEqual(await rejected?.json(), {
    error: { code: "security.http.invalid_request" },
  });
});

test("model key is accepted in request but never echoed", async () => {
  const response = await handleSecurityHttpApi(
    post("/model-config", {
      provider: "openai",
      endpoint: "https://example.invalid/v1",
      apiKey: "HTTP-KEY-CANARY",
      liteModel: "lite",
      proModel: "pro",
    }),
    origin,
    service(),
  );
  const serialized = await response?.text();
  assert.equal(response?.status, 200);
  assert.equal(serialized?.includes("HTTP-KEY-CANARY"), false);
  assert.equal(serialized?.includes("apiKeyConfigured"), true);
});

test("model config supports authenticated GET on the same path", async () => {
  const response = await handleSecurityHttpApi(
    new Request(`${origin}/api/security/model-config`),
    origin,
    service(),
  );
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { configured: false });
});

test("start rejects extra keys instead of spreading them to the service", async () => {
  let called = false;
  const response = await handleSecurityHttpApi(
    post("/start", { scope: "all", mode: "quick", paths: ["/private"] }),
    origin,
    service({
      start: async () => {
        called = true;
        return {};
      },
    }),
  );
  assert.equal(response?.status, 400);
  assert.equal(called, false);
});

test("browser directory picker endpoint never accepts a path", async () => {
  const rejectedPath = await handleSecurityHttpApi(
    post("/select-skill-directory", { path: "/Users/private" }),
    origin,
    service(),
  );
  assert.equal(rejectedPath?.status, 400);
  assert.deepEqual(await rejectedPath?.json(), {
    error: { code: "security.http.invalid_request" },
  });
  const response = await handleSecurityHttpApi(
    post("/select-skill-directory", {}),
    origin,
    service(),
  );
  assert.equal(response?.status, 501);
  assert.deepEqual(await response?.json(), {
    error: { code: "security.http.native_picker_unavailable" },
  });
});
