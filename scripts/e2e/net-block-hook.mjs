// Offline-PC emulation hook for e2e.
//
// Loaded into the Vite dev-server process via `NODE_OPTIONS=--import=...`
// (see playwright.config.offline-warm.ts / playwright.config.offline-cold.ts).
// It replaces the process-global `fetch` so that every outbound request to a
// non-loopback host rejects immediately with a network-type error — exactly
// what a PC without internet produces (DNS/connect failure) — while the local
// dev server on 127.0.0.1 stays fully reachable.
//
// The browser context is deliberately NOT taken offline: the app under test
// only talks to 127.0.0.1, so page loads and server-function RPCs keep
// working; only the Node-side outbound calls (Security Market API, exchange
// rates, version check, ...) observe the network outage, which mirrors a real
// offline desktop where renderer ↔ local server traffic stays intact.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const originalFetch = globalThis.fetch;

function isLoopback(hostname) {
  if (LOOPBACK.has(hostname)) return true;
  // Vite/Node may emit URLs with a port in brackets handled by URL already;
  // bare IPv4 loopback variants are covered by 127.0.0.1 above.
  return hostname === "[::1]" || hostname === "0:0:0:0:0:0:0:1";
}

if (typeof originalFetch !== "function") {
  console.error(
    "[net-block-hook] global fetch unavailable; hook NOT installed",
  );
} else {
  globalThis.fetch = (input, init) => {
    let hostname = "";
    try {
      hostname = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input?.url ?? ""),
      ).hostname;
    } catch {
      // Not an absolute URL (e.g. a relative Request) — let the runtime handle it.
    }
    if (hostname && !isLoopback(hostname)) {
      return Promise.reject(
        Object.assign(
          new TypeError(`fetch failed — offline e2e hook blocks ${hostname}`),
          { cause: new Error(`getaddrinfo ENOTFOUND ${hostname}`) },
        ),
      );
    }
    return originalFetch.call(globalThis, input, init);
  };
  console.error(
    "[net-block-hook] offline fetch hook installed (non-loopback blocked)",
  );
}
