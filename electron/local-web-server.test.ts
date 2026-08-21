import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { SecurityScannerService } from "./security-scanner-service.js";
import { startLocalWebServer } from "./local-web-server.js";
import { SECURITY_CSRF_HEADER } from "./security-http-api.js";

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "tt-local-web-"));
  await mkdir(join(root, "server"), { recursive: true });
  await mkdir(join(root, "public"), { recursive: true });
  await writeFile(
    join(root, "server", "index.mjs"),
    "export default { fetch() { return new Response('<html>app</html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }) } }",
  );
  return root;
}

function scanner(): SecurityScannerService {
  return {
    getRuntimeCapability: () => ({
      capability: "detection-only",
      activeDefense: false,
    }),
  } as unknown as SecurityScannerService;
}

function rawRequest(
  url: URL,
  options: { host?: string; headers?: Record<string, string>; body?: Buffer },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      {
        method: options.body ? "POST" : "GET",
        headers: {
          ...(options.host ? { host: options.host } : {}),
          ...options.headers,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

test("single-use browser bootstrap sets HttpOnly cookie and redirects clean", async () => {
  const root = await fixture();
  const server = await startLocalWebServer(root, {
    securityScanner: scanner(),
  });
  try {
    const bootstrap = server.createBrowserBootstrapUrl(
      "/security?locale=en-US",
    );
    const first = await fetch(bootstrap, { redirect: "manual" });
    assert.equal(first.status, 303);
    assert.equal(first.headers.get("location"), "/security?locale=en-US");
    assert.equal(first.headers.get("referrer-policy"), "no-referrer");
    assert.equal(first.headers.get("cache-control"), "no-store");
    assert.equal(first.headers.get("x-content-type-options"), "nosniff");
    const cookie = first.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/u);
    assert.match(cookie, /SameSite=Strict/u);
    assert.equal(cookie.includes("bootstrap"), false);
    assert.equal((await fetch(bootstrap, { redirect: "manual" })).status, 401);

    const capability = await fetch(`${server.origin}/api/security/capability`, {
      headers: { cookie: cookie.split(";")[0] ?? "" },
    });
    assert.equal(capability.status, 200);
    assert.equal(capability.headers.get("access-control-allow-origin"), null);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects wrong Host, unauthenticated API and oversized chunked body", async () => {
  const root = await fixture();
  const server = await startLocalWebServer(root, {
    securityScanner: scanner(),
  });
  try {
    const wrongHost = await rawRequest(
      new URL(`${server.origin}/api/security/capability`),
      { host: "evil.invalid" },
    );
    assert.equal(wrongHost.status, 421);

    const unauthorized = await fetch(
      `${server.origin}/api/security/capability`,
    );
    assert.equal(unauthorized.status, 401);
    assert.deepEqual(await unauthorized.json(), {
      error: { code: "security.http.unauthorized" },
    });

    const bootstrap = server.createBrowserBootstrapUrl();
    const authenticated = await fetch(bootstrap, { redirect: "manual" });
    const cookie = authenticated.headers.get("set-cookie")?.split(";")[0] ?? "";
    const oversized = await rawRequest(
      new URL(`${server.origin}/api/security/cancel`),
      {
        headers: {
          cookie,
          origin: server.origin,
          [SECURITY_CSRF_HEADER]: "1",
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
        body: Buffer.alloc(65 * 1024, 65),
      },
    );
    assert.equal(oversized.status, 413);
    assert.deepEqual(JSON.parse(oversized.body), {
      error: { code: "security.http.body_too_large" },
    });
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("does not cache SSR documents that contain the route manifest", async () => {
  const root = await fixture();
  const server = await startLocalWebServer(root, {
    securityScanner: scanner(),
  });
  try {
    const bootstrap = await fetch(
      server.createBrowserBootstrapUrl("/tracker"),
      {
        redirect: "manual",
      },
    );
    const cookie = bootstrap.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    assert.equal(bootstrap.status, 303);

    const document = await fetch(`${server.origin}/tracker`, {
      headers: { cookie },
    });
    assert.equal(document.status, 200);
    assert.equal(document.headers.get("cache-control"), "no-store");
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});
