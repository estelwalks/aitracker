import assert from "node:assert/strict";
import test from "node:test";

import { APP_ID, SECURITY_CSRF_HEADER } from "../../../lib/app-config.ts";
import {
  CompanionSecurityClientError,
  connectBrowserSecurityClient,
  isCompanionOrigin,
} from "./browser-client.ts";

const location = {
  protocol: "http:",
  hostname: "127.0.0.1",
  origin: "http://127.0.0.1:49152",
};

const capability = {
  capability: "detection-only",
  activeDefense: false,
  monitorAvailable: true,
  evidence: "local-static-and-model-analysis",
  cancellation: "between-skills",
  riskKinds: ["remote_execution"],
};

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, { status });
}

test("companion probing is limited to the loopback origin", async () => {
  // Non-loopback and non-http origins are never companion-eligible.
  assert.equal(
    isCompanionOrigin({
      protocol: "https:",
      hostname: `${APP_ID}.example`,
      origin: `https://${APP_ID}.example`,
    }),
    false,
  );
  assert.equal(
    isCompanionOrigin({
      protocol: "http:",
      hostname: "192.168.1.10",
      origin: "http://192.168.1.10",
    }),
    false,
  );
  // Both `127.0.0.1` and `localhost` are loopback and accepted (the browser
  // dev server often binds/prints `localhost`).
  assert.equal(
    isCompanionOrigin({
      protocol: "http:",
      hostname: "127.0.0.1",
      origin: "http://127.0.0.1:49152",
    }),
    true,
  );
  assert.equal(
    isCompanionOrigin({
      protocol: "http:",
      hostname: "localhost",
      origin: "http://localhost:4173",
    }),
    true,
  );
  let calls = 0;
  const client = await connectBrowserSecurityClient({
    location: {
      protocol: "http:",
      hostname: "localhost",
      origin: "http://localhost:4173",
    },
    fetchFn: async () => {
      calls += 1;
      return jsonResponse(capability);
    },
  });
  assert.ok(client);
  assert.equal(client.transport, "companion");
  assert.equal(calls, 1);
});

test("probe uses only the same-origin authenticated companion endpoint", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const client = await connectBrowserSecurityClient({
    location,
    fetchFn: async (input, init) => {
      requests.push({ input, init });
      return jsonResponse(capability);
    },
  });
  assert.ok(client);
  assert.equal(client.transport, "companion");
  assert.equal(client.supportsDirectorySelection, false);
  assert.equal(requests[0]?.input, "/api/security/capability");
  assert.equal(requests[0]?.init?.credentials, "same-origin");
  assert.equal(requests[0]?.init?.mode, "same-origin");
  assert.equal(requests[0]?.init?.redirect, "error");
});

test("unavailable or malformed capability responses fail closed", async () => {
  const unauthorized = await connectBrowserSecurityClient({
    location,
    fetchFn: async () =>
      jsonResponse({ error: { code: "security.http.unauthorized" } }, 401),
  });
  const malformed = await connectBrowserSecurityClient({
    location,
    fetchFn: async () => jsonResponse({ activeDefense: true }),
  });
  assert.equal(unauthorized, null);
  assert.equal(malformed, null);
});

test("mutations send JSON with the companion CSRF header", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const idleState = {
    scanId: "scan:one",
    status: "running",
    mode: "quick",
    trigger: "manual",
    locale: "zh-CN",
    progress: {
      discovered: 1,
      queued: 1,
      started: 1,
      completed: 0,
      failed: 0,
      skipped: 0,
      percent: 0,
    },
    resultIds: [],
  };
  const client = await connectBrowserSecurityClient({
    location,
    fetchFn: async (input, init) => {
      requests.push({ input, init });
      if (input.endsWith("/capability")) return jsonResponse(capability);
      return jsonResponse(idleState, 202);
    },
  });
  assert.ok(client);
  await client.startScan({ scope: "all", mode: "quick", trigger: "manual" });
  const request = requests[1];
  assert.equal(request?.input, "/api/security/start");
  assert.equal(request?.init?.method, "POST");
  const headers = new Headers(request?.init?.headers);
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get(SECURITY_CSRF_HEADER), "1");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    scope: "all",
    mode: "quick",
    trigger: "manual",
  });
});

test("browser client never calls the native directory picker endpoint", async () => {
  let calls = 0;
  const client = await connectBrowserSecurityClient({
    location,
    fetchFn: async () => {
      calls += 1;
      return jsonResponse(capability);
    },
  });
  assert.ok(client);
  assert.equal(await client.selectSkillDirectory(), null);
  assert.equal(calls, 1);
});

test("model config response rejects leaked API key material", async () => {
  const client = await connectBrowserSecurityClient({
    location,
    fetchFn: async (input) => {
      if (input.endsWith("/capability")) return jsonResponse(capability);
      return jsonResponse({
        configured: true,
        provider: "openai",
        endpoint: "https://example.invalid/v1",
        liteModel: "lite",
        proModel: "pro",
        timeoutMs: 120_000,
        maxAgentTurns: 12,
        apiKeyConfigured: true,
        encryptionAvailable: true,
        apiKey: "must-not-cross-boundary",
      });
    },
  });
  assert.ok(client);
  await assert.rejects(
    client.getModelConfig(),
    (error: unknown) =>
      error instanceof CompanionSecurityClientError &&
      error.code === "security.http.invalid_response",
  );
});

test("automatic scans are rejected at the browser boundary", async () => {
  const client = await connectBrowserSecurityClient({
    location,
    fetchFn: async () => jsonResponse(capability),
  });
  assert.ok(client);
  await assert.rejects(
    client.startScan({ scope: "all", mode: "quick", trigger: "automatic" }),
  );
});
