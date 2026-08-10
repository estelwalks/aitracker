import { statfs } from "node:fs/promises";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { MAX_UNPACKED_BYTES } from "./archive.server.ts";
import { downloadAndInspectSkill } from "./archive.server.ts";
import type { TarEntry } from "./archive.server.ts";
import type {
  InstallSkillResult,
  MarketAgent,
  SkillDownloadInspection,
} from "./types.ts";
import type { SkillAgent } from "../local-skills/types.ts";
import { APP_DATA_DIR } from "../app-config";
import { AppError } from "../errors";

async function checkDiskSpace(
  requiredBytes: number,
  path: string,
): Promise<void> {
  try {
    const stats = await statfs(path);
    const freeBytes = stats.bavail * stats.bsize;
    if (freeBytes < requiredBytes) {
      throw new AppError("errors.market.install.diskFull");
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // statfs not available or path missing — skip check (best-effort)
  }
}

export interface InstallRequest {
  skill: SkillDownloadInspection["skill"];
  agents: MarketAgent[];
}

interface InstallDependencies {
  fetcher?: typeof fetch;
  tempRoot?: string;
  installFn?: (input: {
    sourcePath: string;
    targetAgent: SkillAgent;
    origin: InstallRequest["skill"];
  }) => Promise<void>;
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`);
}

function safeInstallName(value: string): string {
  const name = value.trim();
  if (
    name.length === 0 ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    basename(name) !== name
  ) {
    throw new AppError("errors.market.install.invalidName");
  }
  return name;
}

async function extractEntries(
  entries: TarEntry[],
  destination: string,
): Promise<void> {
  const destinationRealPath = await realpath(destination);
  for (const entry of entries) {
    const targetPath = resolve(destinationRealPath, entry.path);
    if (!isPathInside(destinationRealPath, targetPath)) {
      throw new AppError("errors.market.install.pathTraversal", {
        path: entry.path,
      });
    }
    if (entry.type === "directory") {
      await mkdir(targetPath, { recursive: true, mode: 0o700 });
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
    const parentRealPath = await realpath(dirname(targetPath));
    if (!isPathInside(destinationRealPath, parentRealPath)) {
      throw new AppError("errors.market.install.parentDirEscape", {
        path: entry.path,
      });
    }
    const alreadyExists = await lstat(targetPath)
      .then(() => true)
      .catch(() => false);
    if (alreadyExists) {
      throw new AppError("errors.market.install.duplicateEntry", {
        path: entry.path,
      });
    }
    await writeFile(targetPath, entry.content, { flag: "wx", mode: 0o600 });
  }
}

async function findSkillRoot(
  entries: TarEntry[],
  destination: string,
  skill: InstallRequest["skill"],
): Promise<string> {
  const candidates = entries
    .filter(
      (entry) =>
        entry.type === "file" &&
        basename(entry.path).toLocaleLowerCase() === "skill.md",
    )
    .map((entry) => dirname(entry.path));
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0)
    throw new AppError("errors.market.install.noSkillMd");

  const preferredNames = new Set([
    safeInstallName(skill.slug),
    safeInstallName(skill.name),
  ]);
  const preferred = uniqueCandidates.filter((candidate) =>
    preferredNames.has(basename(candidate)),
  );
  const selected =
    uniqueCandidates.length === 1
      ? uniqueCandidates[0]
      : preferred.length === 1
        ? preferred[0]
        : undefined;
  if (!selected) throw new AppError("errors.market.install.multipleSkillRoots");

  const destinationRealPath = await realpath(destination);
  const rootRealPath = await realpath(resolve(destinationRealPath, selected));
  if (!isPathInside(destinationRealPath, rootRealPath)) {
    throw new AppError("errors.market.install.rootOutsideTemp");
  }
  return rootRealPath;
}

async function defaultInstallFn(input: {
  sourcePath: string;
  targetAgent: SkillAgent;
  origin: InstallRequest["skill"];
}): Promise<void> {
  const { installMarketSkill } =
    await import("../local-skills/scanner.server.ts");
  await installMarketSkill(input);
}

export async function prepareSkillInstall(
  request: InstallRequest,
  dependencies: InstallDependencies = {},
): Promise<InstallSkillResult> {
  const temporaryParent =
    dependencies.tempRoot ?? join(homedir(), APP_DATA_DIR, "tmp");

  // Disk-space precheck: ensure at least MAX_UNPACKED_BYTES free before downloading
  await checkDiskSpace(MAX_UNPACKED_BYTES, homedir());

  await mkdir(temporaryParent, { recursive: true, mode: 0o700 });

  const downloaded = await downloadAndInspectSkill(request.skill, {
    fetcher: dependencies.fetcher,
  });
  if (!downloaded.inspection.scan.safe) {
    return {
      installed: false,
      reason: "scan-blocked",
      messageCode: "errors.market.outcome.scanBlocked",
      agents: request.agents,
      targets: request.agents.map((agent) => ({
        agent,
        installed: false,
        messageCode: "errors.market.outcome.targetBlocked",
      })),
      inspection: downloaded.inspection,
    };
  }

  const temporaryDirectory = await mkdtemp(join(temporaryParent, "market-"));

  try {
    await extractEntries(downloaded.entries, temporaryDirectory);
    const sourcePath = await findSkillRoot(
      downloaded.entries,
      temporaryDirectory,
      request.skill,
    );
    const installFn = dependencies.installFn ?? defaultInstallFn;
    const targets: InstallSkillResult["targets"] = [];
    for (const agent of request.agents) {
      try {
        await installFn({
          sourcePath,
          targetAgent: agent,
          origin: request.skill,
        });
        targets.push({
          agent,
          installed: true,
          messageCode: "market.outcome.success",
        });
      } catch (error) {
        const ui =
          error instanceof AppError
            ? { code: error.code, params: error.params }
            : null;
        targets.push({
          agent,
          installed: false,
          messageCode: ui?.code ?? "market.outcome.failed",
          messageParams: ui?.params,
        });
      }
    }

    const succeeded = targets.filter((target) => target.installed).length;
    const reason =
      succeeded === targets.length
        ? "installed"
        : succeeded === 0
          ? "failed"
          : "partial";
    return {
      installed: reason === "installed",
      reason,
      messageCode:
        reason === "installed"
          ? "errors.market.outcome.installedAll"
          : reason === "partial"
            ? "errors.market.outcome.partialCount"
            : "errors.market.outcome.failedAll",
      messageParams:
        reason === "installed"
          ? { count: succeeded }
          : reason === "partial"
            ? { succeeded, failed: targets.length - succeeded }
            : undefined,
      agents: request.agents,
      targets,
      inspection: downloaded.inspection,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
