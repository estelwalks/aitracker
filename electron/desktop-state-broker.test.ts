import assert from "node:assert/strict";
import test from "node:test";

import { DesktopStateBroker } from "./desktop-state-broker.js";
import { ENV } from "./app-config.js";

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
        return Response.json({ "trusttools.theme": "dark" });
      },
    });
    assert.deepEqual(await broker.preferences(), {
      "trusttools.theme": "dark",
    });
    assert.equal(
      request?.url,
      "http://127.0.0.1:3210/api/desktop-state/preferences",
    );
    assert.equal(
      request?.headers.get("x-trusttools-desktop-broker"),
      "test-broker-token",
    );
    assert.equal(
      request?.headers.get("cookie"),
      "trusttools_token=capability-token",
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
    assert.deepEqual(await broker.modelConfig(), {
      provider: "openai",
      endpoint: "http://127.0.0.1:11434/v1",
      apiKey: "test-key",
      liteModel: "local-model",
      proModel: "local-model",
      timeoutMs: 120_000,
      maxAgentTurns: 8,
    });
    assert.deepEqual(paths, ["/api/desktop-state/model-profile"]);
  } finally {
    if (previous == null) delete process.env[ENV.DESKTOP_BROKER_TOKEN];
    else process.env[ENV.DESKTOP_BROKER_TOKEN] = previous;
  }
});
