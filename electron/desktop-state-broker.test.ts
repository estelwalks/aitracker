import assert from "node:assert/strict";
import test from "node:test";

import {
  compactSecurityHistoryForTransport,
  DesktopStateBroker,
  MAX_SECURITY_HISTORY_TRANSPORT_BYTES,
} from "./desktop-state-broker.js";
import { ENV } from "./app-config.js";
import type { SecurityScanHistoryEntry } from "./contracts.js";

function largeHistoryEntry(index: number): SecurityScanHistoryEntry {
  return {
    id: `scan:${String(index).padStart(8, "0")}-0000-0000-0000-000000000000:skill-${index}`,
    scanId: `scan:${String(index).padStart(8, "0")}-0000-0000-0000-000000000000`,
    skillRef: `skill:${String(index).padStart(64, "0")}`,
    skillName: `skill-${index}`,
    mode: "full",
    trigger: "manual",
    locale: "zh-CN",
    status: "complete",
    startedAt: "2026-08-21T00:00:00.000Z",
    finishedAt: "2026-08-21T00:00:01.000Z",
    report: {
      status: "complete",
      mode: "full",
      verdict: "warn",
      riskScore: 10,
      rulesVersion: "rules",
      engineVersion: "engine",
      locale: "zh-CN",
      contentHash: String(index),
      scannedFiles: 1,
      threatLevel: "medium",
      threatLevelDisplay: "medium",
      categories: {},
      summary: "summary",
      findings: Array.from({ length: 50 }, (_, findingIndex) => ({
        id: `finding-${findingIndex}`,
        kind: "data_exfiltration",
        severity: "low",
        source: "model",
        kindDisplay: "data exfiltration",
        severityDisplay: "low",
        ruleName: "r".repeat(240),
        message: "m".repeat(1_000),
        remediation: "x".repeat(1_000),
        weight: 1,
        path: "scripts/example.py",
        excerpt: "e".repeat(240),
        reasoning: "q".repeat(500),
      })),
      rules: Array.from({ length: 20 }, () => ({
        ruleId: "rule",
        ruleName: "rule",
        kind: "data_exfiltration",
        severity: "low",
        weight: 1,
        count: 1,
        matches: [],
      })),
      branches: Array.from({ length: 8 }, () => ({
        name: "static",
        status: "complete",
        detail: "d".repeat(240),
      })),
      skippedFiles: Array.from({ length: 500 }, () => ({
        path: "vendor/large-file.bin",
        reasonCode: "binary",
        reason: "s".repeat(240),
      })),
    },
  };
}

test("broker sends the fixed auth header and packaged capability cookie", async () => {
  const previous = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "test-broker-token";
  let request: Request | undefined;
  try {
    const broker = new DesktopStateBroker({
      origin: () => "http://127.0.0.1:3210",
      capabilityToken: () => "capability-token",
      fetchFn: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ "aitracker.theme": "dark" });
      },
    });
    assert.deepEqual(await broker.preferences(), {
      "aitracker.theme": "dark",
    });
    assert.equal(
      request?.url,
      "http://127.0.0.1:3210/api/desktop-state/preferences",
    );
    assert.equal(
      request?.headers.get("x-aitracker-desktop-broker"),
      "test-broker-token",
    );
    assert.equal(
      request?.headers.get("cookie"),
      "aitracker_token=capability-token",
    );
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});

test("broker rejects HTTP failures and never returns a fallback value", async () => {
  const previous = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "test-broker-token";
  try {
    const broker = new DesktopStateBroker({
      origin: () => "http://127.0.0.1:3210",
      capabilityToken: () => undefined,
      fetchFn: async () => Response.json({ error: "failed" }, { status: 500 }),
    });
    await assert.rejects(broker.preferences(), /HTTP 500/u);
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});

test("broker persists scheduler cursor and run-level scan evidence", async () => {
  const previous = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "test-broker-token";
  const requests: Request[] = [];
  try {
    const broker = new DesktopStateBroker({
      origin: () => "http://127.0.0.1:3210",
      capabilityToken: () => undefined,
      fetchFn: async (input, init) => {
        const request = new Request(input, init);
        requests.push(request);
        if (request.url.endsWith("/security-scan-run/latest"))
          return Response.json(null);
        return Response.json({ ok: true });
      },
    });
    await broker.writeScheduleRuntime({
      scheduleFingerprint: "a".repeat(64),
      nextRunAt: "2026-08-25T03:00:00.000Z",
      pending: false,
      updatedAt: "2026-08-25T02:00:00.000Z",
    });
    await broker.writeRun({
      scanId: "scan:11111111-1111-4111-8111-111111111111",
      mode: "quick",
      trigger: "automatic",
      locale: "zh-CN",
      status: "complete",
      startedAt: "2026-08-25T02:00:00.000Z",
      finishedAt: "2026-08-25T02:00:01.000Z",
      discoveredCount: 1,
      queuedCount: 1,
      completedCount: 0,
      failedCount: 0,
      skippedCount: 1,
    });
    assert.equal(await broker.readLatestRun(), null);

    assert.deepEqual(
      requests.map((request) => [
        new URL(request.url).pathname,
        request.method,
      ]),
      [
        ["/api/desktop-state/scan-schedule-runtime", "PUT"],
        ["/api/desktop-state/security-scan-run", "PUT"],
        ["/api/desktop-state/security-scan-run/latest", "GET"],
      ],
    );
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});

test("history transport strips bulky evidence and stays below the broker limit", async () => {
  const previous = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "test-broker-token";
  let request: Request | undefined;
  try {
    const entries = Array.from({ length: 200 }, (_, index) =>
      largeHistoryEntry(index),
    );
    const compacted = compactSecurityHistoryForTransport(entries);
    assert.ok(compacted.length < entries.length);
    assert.ok(
      Buffer.byteLength(JSON.stringify({ entries: compacted }), "utf8") <=
        MAX_SECURITY_HISTORY_TRANSPORT_BYTES,
    );
    assert.equal(compacted[0]?.report?.findings.length, 50);
    assert.equal(compacted[0]?.report?.skippedFiles.length, 100);
    assert.equal("excerpt" in (compacted[0]?.report?.findings[0] ?? {}), false);
    assert.equal(
      "reasoning" in (compacted[0]?.report?.findings[0] ?? {}),
      false,
    );
    assert.equal(compacted[0]?.report?.rules.length, 0);

    const broker = new DesktopStateBroker({
      origin: () => "http://127.0.0.1:3210",
      capabilityToken: () => undefined,
      fetchFn: async (input, init) => {
        request = new Request(input, init);
        return Response.json({ ok: true });
      },
    });
    await broker.writeHistory(entries);
    const body = JSON.parse(await request!.text()) as {
      entries: SecurityScanHistoryEntry[];
    };
    assert.equal(body.entries.length, compacted.length);
    assert.ok(
      Buffer.byteLength(JSON.stringify(body), "utf8") <=
        MAX_SECURITY_HISTORY_TRANSPORT_BYTES + 64,
    );
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});

test("model config is unavailable when no model profile exists", async () => {
  const previous = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "test-broker-token";
  const paths: string[] = [];
  try {
    const broker = new DesktopStateBroker({
      origin: () => "http://127.0.0.1:3210",
      capabilityToken: () => undefined,
      fetchFn: async (input) => {
        const path = new URL(input instanceof Request ? input.url : input)
          .pathname;
        paths.push(path);
        return path.endsWith("/model-profile")
          ? Response.json(null)
          : Response.json({});
      },
    });
    assert.equal(await broker.modelConfig(), undefined);
    assert.deepEqual(paths, ["/api/desktop-state/model-profile"]);
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});

test("model config is returned whenever the shared model profile is configured", async () => {
  const previous = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "test-broker-token";
  const paths: string[] = [];
  try {
    const broker = new DesktopStateBroker({
      origin: () => "http://127.0.0.1:3210",
      capabilityToken: () => undefined,
      fetchFn: async (input) => {
        const path = new URL(input instanceof Request ? input.url : input)
          .pathname;
        paths.push(path);
        return path.endsWith("/model-profile")
          ? Response.json({
              mode: "custom",
              protocol: "openai",
              apiKey: "test-key",
              endpoint: "http://127.0.0.1:11434/v1",
              model: "local-model",
            })
          : Response.json({});
      },
    });
    const config = (await broker.modelConfig()) as Record<string, unknown>;
    const expected: Record<string, unknown> = {
      endpoint: "http://127.0.0.1:11434/v1",
      apiKey: "test-key",
      liteModel: "local-model",
      proModel: "local-model",
      timeoutMs: 120_000,
      maxAgentTurns: 8,
    };
    expected.provider = "openai-completions";
    assert.deepEqual(config, expected);
    assert.deepEqual(paths, ["/api/desktop-state/model-profile"]);
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});

test("desktop model config preserves the explicit Responses protocol for upgraded scanners", async () => {
  const previous = process.env[ENV.DESKTOP_BROKER_TOKEN];
  process.env[ENV.DESKTOP_BROKER_TOKEN] = "test-broker-token";
  try {
    const broker = new DesktopStateBroker({
      origin: () => "http://127.0.0.1:3210",
      capabilityToken: () => undefined,
      fetchFn: async (input) => {
        const path = new URL(input instanceof Request ? input.url : input)
          .pathname;
        return path.endsWith("/model-profile")
          ? Response.json({
              mode: "custom",
              protocol: "openai-responses",
              apiKey: "test-key",
              endpoint: "https://api.openai.com/v1",
              model: "gpt-5.2",
            })
          : Response.json({});
      },
    });
    const config = (await broker.modelConfig()) as Record<string, unknown>;
    assert.equal(config.provider, "openai-responses");
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});
