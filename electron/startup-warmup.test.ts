import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { COOKIE_TOKEN_NAME } from "./app-config.js";
import { startLocalWebServer } from "./local-web-server.js";

test("internal warmup calls the server entry without rendering a document", async () => {
  const testGlobal = globalThis as typeof globalThis & {
    __aitrackerWarmupRequest?: unknown;
  };
  const root = await mkdtemp(join(tmpdir(), "aitracker-startup-warmup-"));
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(
    join(root, "server", "index.mjs"),
    `export default { fetch(request) {
      globalThis.__aitrackerWarmupRequest = {
        path: new URL(request.url).pathname,
        token: request.headers.get("x-aitracker-desktop-broker"),
        cookie: request.headers.get("cookie"),
      };
      return new Response(null, { status: 204 });
    } }`,
  );
  const server = await startLocalWebServer(root);
  try {
    await server.warmup("desktop-test-token");
    assert.deepEqual(testGlobal.__aitrackerWarmupRequest, {
      path: "/api/desktop-state/preferences",
      token: "desktop-test-token",
      cookie: `${COOKIE_TOKEN_NAME}=${server.capabilityToken}`,
    });
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    delete testGlobal.__aitrackerWarmupRequest;
  }
});

test("internal warmup supports a middleware-only production server entry", async () => {
  const testGlobal = globalThis as typeof globalThis & {
    __aitrackerMiddlewareWarmupRequest?: unknown;
  };
  const root = await mkdtemp(
    join(tmpdir(), "aitracker-startup-warmup-middleware-"),
  );
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(
    join(root, "server", "index.mjs"),
    `export function middleware(request, response) {
      globalThis.__aitrackerMiddlewareWarmupRequest = {
        path: new URL(request.url, "http://127.0.0.1").pathname,
        token: request.headers["x-aitracker-desktop-broker"],
        cookie: request.headers.cookie,
      };
      response.statusCode = 204;
      response.end();
    }`,
  );
  const server = await startLocalWebServer(root);
  try {
    await server.warmup("middleware-desktop-token");
    assert.deepEqual(testGlobal.__aitrackerMiddlewareWarmupRequest, {
      path: "/api/desktop-state/preferences",
      token: "middleware-desktop-token",
      cookie: `${COOKIE_TOKEN_NAME}=${server.capabilityToken}`,
    });
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    delete testGlobal.__aitrackerMiddlewareWarmupRequest;
  }
});

test("internal warmup rejects a non-2xx response", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "aitracker-startup-warmup-failure-"),
  );
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(
    join(root, "server", "index.mjs"),
    `export default { fetch() {
      return new Response("workspace initialization failed", {
        status: 503,
        headers: { "x-aitracker-startup-failure-code": "database.already-open" },
      });
    } }`,
  );
  const server = await startLocalWebServer(root);
  try {
    await assert.rejects(
      server.warmup("desktop-test-token"),
      (error: unknown) => {
        assert.match(String(error), /warmup failed with HTTP 503/);
        assert.equal(
          (error as { startupFailureCode?: unknown }).startupFailureCode,
          "database.already-open",
        );
        return true;
      },
    );
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("internal warmup rejects a missing desktop broker token", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-startup-warmup-token-"));
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(
    join(root, "server", "index.mjs"),
    `export default { fetch() { return new Response(null, { status: 204 }); } }`,
  );
  const server = await startLocalWebServer(root);
  try {
    await assert.rejects(server.warmup(""), /warmup token is unavailable/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("internal warmup waits for initialization tasks registered with waitUntil", async () => {
  const testGlobal = globalThis as typeof globalThis & {
    __aitrackerWarmupTaskCompleted?: boolean;
  };
  const root = await mkdtemp(join(tmpdir(), "aitracker-startup-warmup-task-"));
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(
    join(root, "server", "index.mjs"),
    `export default { fetch(_request, _environment, context) {
      context.waitUntil(new Promise((resolve) => setTimeout(() => {
        globalThis.__aitrackerWarmupTaskCompleted = true;
        resolve();
      }, 10)));
      return new Response(null, { status: 204 });
    } }`,
  );
  const server = await startLocalWebServer(root);
  try {
    await server.warmup("desktop-test-token");
    assert.equal(testGlobal.__aitrackerWarmupTaskCompleted, true);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    delete testGlobal.__aitrackerWarmupTaskCompleted;
  }
});
