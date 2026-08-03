import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const releaseDirectory = join(projectRoot, "release");
const electronBuilder = join(
  projectRoot,
  "node_modules",
  ".bin",
  "electron-builder",
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function findElectronCache(version) {
  if (process.platform !== "darwin") return null;

  const cacheRoot = join(homedir(), "Library", "Caches", "electron");
  if (!(await exists(cacheRoot))) return null;

  const zipNames = [
    `electron-v${version}-darwin-x64.zip`,
    `electron-v${version}-darwin-arm64.zip`,
  ];
  const entries = await readdir(cacheRoot, { withFileTypes: true });
  const candidates = [
    cacheRoot,
    ...entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(cacheRoot, entry.name)),
  ];
  const completeCaches = [];

  for (const candidate of candidates) {
    if (
      !(
        await Promise.all(zipNames.map((name) => exists(join(candidate, name))))
      ).every(Boolean)
    ) {
      continue;
    }
    const files = await Promise.all(
      zipNames.map((name) => stat(join(candidate, name))),
    );
    completeCaches.push({
      path: candidate,
      modifiedAt: Math.min(...files.map((file) => file.mtimeMs)),
    });
  }

  completeCaches.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return completeCaches[0]?.path ?? null;
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function formatMiB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function main() {
  if (process.platform !== "darwin") {
    throw new Error("macOS packages must be built on macOS");
  }

  console.log("\n[1/4] Cleaning previous release artifacts");
  await rm(releaseDirectory, { recursive: true, force: true });
  await mkdir(releaseDirectory, { recursive: true });

  console.log("\n[2/4] Building the latest web and Electron sources");
  await run("npm", ["run", "build:desktop"]);

  const electronPackage = JSON.parse(
    await readFile(
      join(projectRoot, "node_modules", "electron", "package.json"),
      "utf8",
    ),
  );
  const electronCache = await findElectronCache(electronPackage.version);
  const builderArgs = ["--mac", "--publish", "never"];
  if (electronCache) {
    console.log(
      `Using local Electron ${electronPackage.version} cache: ${electronCache}`,
    );
    builderArgs.push(`--config.electronDist=${electronCache}`);
  } else {
    console.log(
      `Local Electron ${electronPackage.version} dual-architecture cache not found; downloading.`,
    );
  }

  console.log("\n[3/4] Packaging Intel and Apple Silicon DMGs");
  await run(electronBuilder, builderArgs);

  const version = JSON.parse(
    await readFile(join(projectRoot, "package.json"), "utf8"),
  ).version;
  const artifacts = [
    {
      arch: "x64",
      dmg: join(releaseDirectory, `AITracker-${version}-x64.dmg`),
      app: join(releaseDirectory, "mac", "AITracker.app"),
    },
    {
      arch: "arm64",
      dmg: join(releaseDirectory, `AITracker-${version}-arm64.dmg`),
      app: join(releaseDirectory, "mac-arm64", "AITracker.app"),
    },
  ];

  console.log("\n[4/4] Verifying architectures, signatures, and disk images");
  for (const artifact of artifacts) {
    await run("file", [join(artifact.app, "Contents", "MacOS", "AITracker")]);
    await run("codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      artifact.app,
    ]);
    await run("hdiutil", ["verify", artifact.dmg]);
  }

  const checksumLines = [];
  for (const artifact of artifacts) {
    const checksum = await sha256(artifact.dmg);
    const size = (await stat(artifact.dmg)).size;
    checksumLines.push(`${checksum}  ${artifact.dmg.split("/").at(-1)}`);
    console.log(`${artifact.arch}: ${formatMiB(size)}  sha256=${checksum}`);
  }
  await writeFile(
    join(releaseDirectory, "SHA256SUMS.txt"),
    `${checksumLines.join("\n")}\n`,
    "utf8",
  );

  console.log("\nmacOS dual-architecture packaging completed successfully.");
}

main().catch((error) => {
  console.error(
    `\nPackaging failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
