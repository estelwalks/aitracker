import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveNpmSpawn } from "../scripts/npm-spawn.mjs";

// Env-var names below mirror src/lib/app-config.ts ENV (plain JS cannot import
// the config); check-app-config-sync.mjs cross-checks them on every check:i18n.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillScannerRoot = resolve(projectRoot, "../skill-scanner");
const viteOptimizationMetadata = join(
  projectRoot,
  "node_modules/.vite/deps/_metadata.json",
);
const host = process.env.AITRACKER_DEV_HOST ?? "127.0.0.1";
const port = process.env.AITRACKER_DEV_PORT ?? "5173";
const origin = `http://${host}:${port}`;
const children = new Set();
const desktopBrokerToken = randomUUID();
let shuttingDown = false;

const ignoredInputDirectories = new Set([
  ".git",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export const desktopViteWarmupPaths = Object.freeze([
  "/@vite/client",
  "/src/router.tsx",
  "/src/routeTree.gen.ts",
]);

/**
 * A clean Windows checkout may spend well over one minute optimizing Vite's
 * dependency graph. These limits apply only to the development launcher; the
 * packaged application's workspace startup policy is unchanged.
 */
export const desktopDevColdStartTimeoutMs = 300_000;
export const desktopDevProbeTimeoutMs = 5_000;
const desktopDevPollIntervalMs = 500;

/** Pure timestamp decision used by both incremental prepare stages. */
export function shouldRebuild(inputModifiedAt, outputModifiedTimes) {
  return (
    outputModifiedTimes.length === 0 ||
    outputModifiedTimes.some((modifiedAt) => modifiedAt == null) ||
    inputModifiedAt > Math.min(...outputModifiedTimes)
  );
}

export function isElectronCompilerInput(fileName) {
  return fileName.endsWith(".ts") || fileName.endsWith(".cts");
}

async function newestModifiedAt(path) {
  let details;
  try {
    details = await stat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  if (!details.isDirectory()) return details.mtimeMs;

  const entries = await readdir(path, { withFileTypes: true });
  const times = await Promise.all(
    entries
      .filter(
        (entry) =>
          !entry.isDirectory() || !ignoredInputDirectories.has(entry.name),
      )
      .map((entry) => newestModifiedAt(join(path, entry.name))),
  );
  return Math.max(details.mtimeMs, ...times);
}

async function outputModifiedTimes(paths) {
  return Promise.all(
    paths.map(async (path) => {
      try {
        return (await stat(path)).mtimeMs;
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    }),
  );
}

async function inputsModifiedAt(paths) {
  return Math.max(...(await Promise.all(paths.map(newestModifiedAt))));
}

async function runCommand(
  executable,
  argumentsList,
  environment = process.env,
) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(executable, argumentsList, {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", rejectPromise);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(
        new Error(
          `${executable} ${argumentsList.join(" ")} failed (${signal ?? code})`,
        ),
      );
    });
  });
}

async function runNpmCommand(argumentsList, environment = process.env) {
  const invocation = resolveNpmSpawn(argumentsList, { environment });
  await runCommand(
    invocation.executable,
    invocation.argumentsList,
    environment,
  );
}

async function prepareIfStale({ label, inputs, outputs, build }) {
  const [inputModifiedAt, outputTimes] = await Promise.all([
    inputsModifiedAt(inputs),
    outputModifiedTimes(outputs),
  ]);
  if (!shouldRebuild(inputModifiedAt, outputTimes)) {
    console.log(`[desktop:prepare] ${label} is up to date`);
    return false;
  }
  console.log(`[desktop:prepare] rebuilding ${label}`);
  await build();
  return true;
}

export async function prepareDesktop() {
  await prepareIfStale({
    label: "skill-scanner",
    inputs: [
      join(skillScannerRoot, "src"),
      join(skillScannerRoot, "prompts"),
      join(skillScannerRoot, "scripts"),
      join(skillScannerRoot, "package.json"),
      join(skillScannerRoot, "package-lock.json"),
      join(skillScannerRoot, "tsconfig.json"),
      join(skillScannerRoot, "tsup.config.ts"),
    ],
    outputs: [
      join(skillScannerRoot, "dist/index.js"),
      join(skillScannerRoot, "dist/index.d.ts"),
      join(skillScannerRoot, "dist/cli.js"),
    ],
    build: () => runNpmCommand(["run", "build:skill-scanner"]),
  });

  const electronSourceInputs = (
    await readdir(join(projectRoot, "electron"), {
      withFileTypes: true,
    })
  )
    .filter((entry) => entry.isFile() && isElectronCompilerInput(entry.name))
    .map((entry) => join(projectRoot, "electron", entry.name));

  await prepareIfStale({
    label: "Electron",
    inputs: [
      ...electronSourceInputs,
      join(projectRoot, "tsconfig.electron.json"),
      join(projectRoot, "scripts/bundle-preload.mjs"),
      join(projectRoot, "package.json"),
      join(projectRoot, "package-lock.json"),
    ],
    outputs: [
      join(projectRoot, "build/electron/main.js"),
      join(projectRoot, "build/electron/preload.cjs"),
    ],
    build: async () => {
      await runNpmCommand([
        "exec",
        "--",
        "tsc",
        "-p",
        "tsconfig.electron.json",
      ]);
      await runCommand(process.execPath, ["scripts/bundle-preload.mjs"]);
    },
  });
}

function startProcess(argumentsList, environment = process.env) {
  const invocation = resolveNpmSpawn(argumentsList, { environment });
  const child = spawn(invocation.executable, invocation.argumentsList, {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

async function fetchReady(url, timeoutMilliseconds) {
  const response = await fetch(url, {
    headers: { accept: "text/html,application/xhtml+xml" },
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Vite returned ${response.status} for ${url}`);
  }
  return response;
}

async function waitForServer(
  url,
  timeoutMilliseconds = desktopDevColdStartTimeoutMs,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetchReady(url, desktopDevProbeTimeoutMs);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, desktopDevPollIntervalMs),
      );
    }
  }
  throw new Error(`Vite did not become ready at ${url}`);
}

/** Build same-origin static warmup URLs without touching a document route. */
export function createStaticWarmupUrls(
  baseUrl,
  paths = desktopViteWarmupPaths,
) {
  return paths.map((path) => new URL(path, baseUrl).href);
}

async function waitForOptimizationMetadata(
  timeoutMilliseconds = desktopDevColdStartTimeoutMs,
) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const metadata = await stat(viteOptimizationMetadata);
      if (metadata.isFile() && metadata.size > 0) return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error("Vite optimize metadata was not published");
}

async function warmStaticViteModules(baseUrl) {
  console.log("[desktop:ready] warming static Vite modules");
  await Promise.all(
    createStaticWarmupUrls(baseUrl).map(async (url) => {
      const moduleResponse = await fetchReady(
        url,
        desktopDevColdStartTimeoutMs,
      );
      await moduleResponse.body?.cancel();
    }),
  );
  console.log("[desktop:ready] static Vite modules are warm");
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(exitCode), 250);
}

export async function runDevDesktop() {
  await prepareDesktop();

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  const viteEnvironment = {
    ...process.env,
    AITRACKER_DESKTOP_BROKER_TOKEN: desktopBrokerToken,
  };

  const vite = startProcess(
    [
      "exec",
      "--",
      "vite",
      "dev",
      "--host",
      host,
      "--port",
      port,
      "--strictPort",
    ],
    viteEnvironment,
  );
  vite.once("exit", (code) => shutdown(code ?? 1));

  try {
    await waitForServer(`${origin}/favicon.ico`);
    await warmStaticViteModules(origin);
    // Vite automatically builds the explicit optimizeDeps.include batch while
    // serving these modules. Do not expose Electron to the module graph until
    // that generation has been published.
    await waitForOptimizationMetadata();
    const electron = startProcess(["exec", "--", "electron", "."], {
      ...process.env,
      AITRACKER_DEV_URL: origin,
      AITRACKER_DESKTOP_BROKER_TOKEN: desktopBrokerToken,
    });
    electron.once("exit", (code) => shutdown(code ?? 0));
  } catch (error) {
    console.error(error);
    shutdown(1);
  }
}

const executedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (executedPath === import.meta.url) {
  await runDevDesktop();
}
