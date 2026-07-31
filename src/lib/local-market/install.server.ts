import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { downloadAndInspectSkill } from "./archive.server.ts";
import type { TarEntry } from "./archive.server.ts";
import type { InstallSkillResult, MarketAgent, SkillDownloadInspection } from "./types.ts";
import type { SkillAgent } from "../local-skills/types.ts";

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
    throw new Error("Skill 名称不合法");
  }
  return name;
}

async function extractEntries(entries: TarEntry[], destination: string): Promise<void> {
  const destinationRealPath = await realpath(destination);
  for (const entry of entries) {
    const targetPath = resolve(destinationRealPath, entry.path);
    if (!isPathInside(destinationRealPath, targetPath)) {
      throw new Error(`下载包包含路径穿越：${entry.path}`);
    }
    if (entry.type === "directory") {
      await mkdir(targetPath, { recursive: true, mode: 0o700 });
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true, mode: 0o700 });
    const parentRealPath = await realpath(dirname(targetPath));
    if (!isPathInside(destinationRealPath, parentRealPath)) {
      throw new Error(`下载包文件父目录越界：${entry.path}`);
    }
    try {
      await lstat(targetPath);
      throw new Error(`下载包包含重复条目：${entry.path}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("下载包包含重复条目")) throw error;
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
      (entry) => entry.type === "file" && basename(entry.path).toLocaleLowerCase() === "skill.md",
    )
    .map((entry) => dirname(entry.path));
  const uniqueCandidates = [...new Set(candidates)];
  if (uniqueCandidates.length === 0) throw new Error("下载包中未找到 SKILL.md");

  const preferredNames = new Set([safeInstallName(skill.slug), safeInstallName(skill.name)]);
  const preferred = uniqueCandidates.filter((candidate) => preferredNames.has(basename(candidate)));
  const selected =
    uniqueCandidates.length === 1
      ? uniqueCandidates[0]
      : preferred.length === 1
        ? preferred[0]
        : undefined;
  if (!selected) throw new Error("下载包包含多个 Skill 根目录，无法安全确定安装目标");

  const destinationRealPath = await realpath(destination);
  const rootRealPath = await realpath(resolve(destinationRealPath, selected));
  if (!isPathInside(destinationRealPath, rootRealPath)) {
    throw new Error("Skill 根目录越过临时目录边界");
  }
  return rootRealPath;
}

async function defaultInstallFn(input: {
  sourcePath: string;
  targetAgent: SkillAgent;
  origin: InstallRequest["skill"];
}): Promise<void> {
  const { installMarketSkill } = await import("../local-skills/scanner.server.ts");
  await installMarketSkill(input);
}

export async function prepareSkillInstall(
  request: InstallRequest,
  dependencies: InstallDependencies = {},
): Promise<InstallSkillResult> {
  const downloaded = await downloadAndInspectSkill(request.skill, {
    fetcher: dependencies.fetcher,
  });
  if (!downloaded.inspection.scan.safe) {
    return {
      installed: false,
      reason: "scan-blocked",
      message: "静态扫描发现高风险规则，已阻止安装。",
      agents: request.agents,
      targets: request.agents.map((agent) => ({
        agent,
        installed: false,
        message: "静态扫描未通过，未执行安装",
      })),
      inspection: downloaded.inspection,
    };
  }

  const temporaryParent = dependencies.tempRoot ?? join(homedir(), ".trusttools", "tmp");
  await mkdir(temporaryParent, { recursive: true, mode: 0o700 });
  const temporaryDirectory = await mkdtemp(join(temporaryParent, "market-"));

  try {
    await extractEntries(downloaded.entries, temporaryDirectory);
    const sourcePath = await findSkillRoot(downloaded.entries, temporaryDirectory, request.skill);
    const installFn = dependencies.installFn ?? defaultInstallFn;
    const targets: InstallSkillResult["targets"] = [];
    for (const agent of request.agents) {
      try {
        await installFn({ sourcePath, targetAgent: agent, origin: request.skill });
        targets.push({ agent, installed: true, message: "安装成功" });
      } catch (error) {
        targets.push({
          agent,
          installed: false,
          message: error instanceof Error ? error.message : "安装失败",
        });
      }
    }

    const succeeded = targets.filter((target) => target.installed).length;
    const reason =
      succeeded === targets.length ? "installed" : succeeded === 0 ? "failed" : "partial";
    return {
      installed: reason === "installed",
      reason,
      message:
        reason === "installed"
          ? `已成功安装到 ${succeeded} 个 Agent。`
          : reason === "partial"
            ? `${succeeded} 个 Agent 安装成功，${targets.length - succeeded} 个失败。`
            : "所有目标均安装失败。",
      agents: request.agents,
      targets,
      inspection: downloaded.inspection,
    };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}
