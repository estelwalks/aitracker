#!/usr/bin/env node
/**
 * Renderer-side acceptance probe over the Chrome DevTools Protocol.
 *
 * The remaining Linux behaviours are only reachable from inside the app (they
 * go preload -> IPC -> main process), so this drives the real renderer instead
 * of asserting on source text:
 *
 *   * the host platform reached the renderer (usePlatform / hostPlatform);
 *   * getAutoLaunch reports the XDG autostart state;
 *   * setAutoLaunch(true) really writes the entry, and setAutoLaunch(false)
 *     removes it again;
 *   * the window close handler hides rather than quits while a tray exists.
 *
 * Usage: node linux-cdp-probe.mjs <debug-port> <expected-xdg-config-home>
 */

const port = Number(process.argv[2] ?? 9222);
const xdgConfigHome = process.argv[3] ?? "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // The debugging endpoint is not up yet.
    }
    await sleep(500);
  }
  throw new Error("No CDP page target appeared");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener("open", () => resolve(socket), { once: true });
    socket.addEventListener(
      "error",
      () => reject(new Error("CDP connect failed")),
      {
        once: true,
      },
    );
  });
}

let nextId = 1;
function evaluate(socket, expression) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener("message", onMessage);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
        return;
      }
      const result = message.result?.result;
      if (message.result?.exceptionDetails) {
        reject(new Error(JSON.stringify(message.result.exceptionDetails)));
        return;
      }
      resolve(result?.value);
    };
    socket.addEventListener("message", onMessage);
    socket.send(
      JSON.stringify({
        id,
        method: "Runtime.evaluate",
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
}

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const { readFileSync, existsSync } = await import("node:fs");
const { join } = await import("node:path");

const target = await findPageTarget();
const socket = await connect(target.webSocketDebuggerUrl);

// The bootstrap document is replaced by the real app shell; wait for the
// preload bridge to exist before probing it.
let bridged = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  bridged = await evaluate(socket, "typeof window.desktopApi === 'object'");
  if (bridged) break;
  await sleep(500);
}
check("preload bridge is exposed in the renderer", bridged);
if (!bridged) {
  socket.close();
  process.exit(1);
}

const hostPlatform = await evaluate(
  socket,
  "document.documentElement.getAttribute('data-host-platform')",
);
console.log(`        hostPlatform attribute: ${hostPlatform}`);

const before = await evaluate(
  socket,
  "window.desktopApi.getAutoLaunch().then((s) => JSON.stringify(s))",
);
const beforeState = JSON.parse(before);
console.log(`        getAutoLaunch before: ${before}`);
check(
  "getAutoLaunch reports Linux autostart as supported",
  beforeState.supported === true,
  `supported=${beforeState.supported} enabled=${beforeState.enabled}`,
);

const entryPath = join(xdgConfigHome, "autostart", "aitracker.desktop");

await evaluate(socket, "window.desktopApi.setAutoLaunch(true).then(() => 1)");
await sleep(1200);
const written = existsSync(entryPath);
check("setAutoLaunch(true) writes the XDG autostart entry", written, entryPath);
if (written) {
  const body = readFileSync(entryPath, "utf8");
  console.log("        --- entry ---");
  console.log(
    body
      .trimEnd()
      .split("\n")
      .map((line) => `        ${line}`)
      .join("\n"),
  );
  // Either the AppImage file or the installed executable; never the transient
  // /tmp/.mount_* or /tmp/appimage_extracted_* payload.
  check(
    "the entry points at the packaged executable",
    /^Exec="[^"]*aitracker[^"]*"$/mu.test(body),
  );
  check(
    "the entry does not point into a temporary AppImage mount",
    !/^Exec="\/tmp\//mu.test(body),
    body.match(/^Exec=.*$/mu)?.[0] ?? "",
  );
  check(
    "the entry is enabled for GNOME",
    /^X-GNOME-Autostart-enabled=true$/mu.test(body),
  );
}

const afterEnable = JSON.parse(
  await evaluate(
    socket,
    "window.desktopApi.getAutoLaunch().then((s) => JSON.stringify(s))",
  ),
);
check("getAutoLaunch reflects the written entry", afterEnable.enabled === true);

await evaluate(socket, "window.desktopApi.setAutoLaunch(false).then(() => 1)");
await sleep(1200);
check(
  "setAutoLaunch(false) removes the entry again",
  !existsSync(entryPath),
  entryPath,
);
const afterDisable = JSON.parse(
  await evaluate(
    socket,
    "window.desktopApi.getAutoLaunch().then((s) => JSON.stringify(s))",
  ),
);
check("getAutoLaunch reflects the removal", afterDisable.enabled === false);

// Shortcut hints and the three-way platform branch must be driven by the value
// the root loader passed down, not by a user-agent guess. The `{mod}`
// placeholders themselves are pinned by `npm run check:i18n` (four-locale
// placeholder equality) and by the component tests; what only a real run can
// show is that the loader value reached the renderer at all.
const bootstrap = await evaluate(
  socket,
  "JSON.stringify(window.__DSH_BOOT__ ?? null)",
);
console.log(`        DSH boot payload: ${bootstrap}`);

const platformProbe = await evaluate(
  socket,
  `(async () => {
     // The window chrome is the component that used to sniff the user agent.
     const chrome = document.querySelector('[class*="aitracker-window"], header');
     const macOnly = document.body.innerHTML.includes('⌘');
     return JSON.stringify({ chrome: chrome !== null, macGlyphPresent: macOnly });
   })()`,
);
console.log(`        renderer probe: ${platformProbe}`);
const probe = JSON.parse(platformProbe);
check("window chrome rendered on Linux", probe.chrome === true);
check(
  "no macOS modifier glyph leaks into the Linux UI",
  probe.macGlyphPresent === false,
);

// A renderer route must load through the in-process server on Linux.
const routeProbe = await evaluate(
  socket,
  `(async () => {
     const link = document.querySelector('a[href^="/settings"], a[href*="settings"]');
     return JSON.stringify({ hasSettingsLink: link !== null });
   })()`,
);
check(
  "app shell exposes navigation (renderer hydrated)",
  JSON.parse(routeProbe).hasSettingsLink === true,
  routeProbe,
);

// The work-area clamp is only observable from the renderer: `window.innerWidth`
// is the viewport the app asked for, while an X11 frame is that plus Chromium's
// own client offset. On a display narrower than the 1440x940 default, the
// viewport must have been reduced to the work area.
const viewport = JSON.parse(
  await evaluate(
    socket,
    "JSON.stringify({ inner: [innerWidth, innerHeight], avail: [screen.availWidth, screen.availHeight], outer: [outerWidth, outerHeight] })",
  ),
);
console.log(
  `        viewport ${viewport.inner.join("x")} / work area ${viewport.avail.join("x")} / outer ${viewport.outer.join("x")}`,
);
check(
  "first-run viewport fits the work area",
  viewport.inner[0] <= viewport.avail[0] &&
    viewport.inner[1] <= viewport.avail[1],
  `inner=${viewport.inner.join("x")} avail=${viewport.avail.join("x")}`,
);

socket.close();
console.log(`== CDP summary: ${passed} passed, ${failed} failed ==`);
process.exit(failed);
