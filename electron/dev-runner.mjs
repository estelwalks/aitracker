import { spawn } from "node:child_process";

const host = process.env.TRUSTTOOLS_DEV_HOST ?? "127.0.0.1";
const port = process.env.TRUSTTOOLS_DEV_PORT ?? "5173";
const origin = `http://${host}:${port}`;
const command = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let shuttingDown = false;

function startProcess(argumentsList, environment = process.env) {
  const child = spawn(command, argumentsList, {
    env: environment,
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForServer(url, timeoutMilliseconds = 60_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 250);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const vite = startProcess([
  "exec",
  "--",
  "vite",
  "dev",
  "--host",
  host,
  "--port",
  port,
  "--strictPort",
]);

vite.once("exit", (code) => shutdown(code ?? 1));

try {
  // Probe a small static asset. The document route intentionally performs the
  // first local-usage scan and can produce a multi-megabyte SSR response on a
  // machine with long history, which is not a reliable one-second readiness
  // check.
  await waitForServer(`${origin}/favicon.ico`);
  const electron = startProcess(["exec", "--", "electron", "."], {
    ...process.env,
    TRUSTTOOLS_DEV_URL: origin,
  });
  electron.once("exit", (code) => shutdown(code ?? 0));
} catch (error) {
  console.error(error);
  shutdown(1);
}
