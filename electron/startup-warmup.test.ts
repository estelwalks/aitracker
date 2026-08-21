import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startLocalWebServer } from "./local-web-server.js";

test("internal warmup calls the server entry without rendering a document", async () => {
  const testGlobal = globalThis as typeof globalThis & {
    __trusttoolsWarmupRequest?: unknown;
  };
  const root = await mkdtemp(join(tmpdir(), "tt-startup-warmup-"));
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(
    join(root, "server", "index.mjs"),
    `export default { fetch(request) {
      globalThis.__trusttoolsWarmupRequest = {
        path: new URL(request.url).pathname,
        token: request.headers.get("x-trusttools-desktop-broker"),
      };
      return new Response(null, { status: 204 });
    } }`,
  );
  const server = await startLocalWebServer(root);
  try {
    await server.warmup("desktop-test-token");
    assert.deepEqual(testGlobal.__trusttoolsWarmupRequest, {
      path: "/api/desktop-state/preferences",
      token: "desktop-test-token",
    });
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
    delete testGlobal.__trusttoolsWarmupRequest;
  }
});
