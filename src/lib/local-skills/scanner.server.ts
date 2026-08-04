import {
  cp,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { createHash } from "node:crypto";

import type { LocalUsageEvent } from "../local-usage/types.ts";
import { AI_TOOLS } from "../tools/catalog.ts";
import {
  SKILL_AGENTS,
  type BatchUninstallResult,
  type LocalSkill,
  type SkillAgent,
  type SkillDailyPoint,
  type SkillHealth,
  type SkillInstallation,
  type SkillSource,
  type SkillSnapshot,
  type SkillSyncResult,
  type SkillUpdateStatus,
} from "./types.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;
const RECENT_WINDOW_DAYS = 7;
const TRUSTTOOLS_DIR = join(homedir(), ".trusttools");
const BLACKLIST_FILE = join(TRUSTTOOLS_DIR, "skill-blacklist.json");
const ORIGINS_FILE = join(TRUSTTOOLS_DIR, "skill-origins.json");
const MARKET_TEMP_DIR = join(TRUSTTOOLS_DIR, "tmp");
const MARKET_API = "https://ai.trusttools.cn/api/skills";
const MARKET_EVIDENCE_TTL_MS = 5 * 60 * 1_000;

interface MarketOrigin {
  source: SkillSource & { kind: "market" };
  installedAt: string;
  localVersion: string | null;
  installedRemoteVersion: string | null;
  installedRemoteUpdatedAt: string | null;
  latestRemoteVersion: string | null;
  latestRemoteUpdatedAt: string | null;
  checkedAt: string | null;
}

interface MarketOriginsFile {
  version: 1;
  installations: Record<string, MarketOrigin>;
}

export interface MarketSkillOriginInput {
  name: string;
  slug: string;
  repoOwner: string;
  repoName: string;
  repoPath: string;
  version?: string | null;
  updatedAt?: string | null;
}

/**
 * Skill root suffix per agent label, derived from the catalog. Keyed by
 * `SkillAgent` (the tool `nameZh`); value is the HOME-relative skill dir.
 */
export const SKILL_ROOT_SUFFIXES = Object.fromEntries(
  AI_TOOLS.filter((tool) => tool.skillRootSuffix !== null).map((tool) => [
    tool.nameZh,
    tool.skillRootSuffix,
  ]),
) as Record<SkillAgent, string>;

export interface HealthThresholds {
  lowFrequencyCount?: number;
  dozeDays?: number;
  deadDays?: number;
}

interface ScanOptions {
  homeDirectory?: string;
  now?: Date;
  trusttoolsDirectory?: string;
  usageEvents?: LocalUsageEvent[];
  healthThresholds?: HealthThresholds;
}

function rootsFor(homeDirectory: string): Record<SkillAgent, string> {
  return Object.fromEntries(
    SKILL_AGENTS.map((agent) => [
      agent,
      join(homeDirectory, SKILL_ROOT_SUFFIXES[agent]),
    ]),
  ) as Record<SkillAgent, string>;
}

function cleanScalar(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseFrontmatter(content: string): Record<string, string> {
  const normalized = content.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return {};
  const result: Record<string, string> = {};
  let index = 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === "---") break;
    if (/^\s/u.test(line) || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) {
      index += 1;
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const rawValue = line.slice(separator + 1);
    const trimmedValue = rawValue.trim();

    // YAML block scalars: ">" folded, "|" literal (with optional chomping "+/-").
    const blockMatch = trimmedValue.match(/^([>|])([+-]?)$/u);
    if (blockMatch) {
      const indicator = blockMatch[1];
      const collected: string[] = [];
      let blockIndent: number | null = null;
      index += 1;
      while (index < lines.length) {
        const nextLine = lines[index];
        if (nextLine.trim() === "---") break;
        if (nextLine.trim() === "") {
          collected.push("");
          index += 1;
          continue;
        }
        const nextIndent = nextLine.search(/\S/u);
        if (nextIndent <= 0) break;
        if (blockIndent === null) blockIndent = nextIndent;
        collected.push(nextLine.slice(blockIndent));
        index += 1;
      }
      const joined =
        indicator === ">"
          ? collected.join(" ").replace(/\s+/gu, " ").trim()
          : collected.join("\n").trim();
      if (joined) result[key] = joined;
      continue;
    }

    const value = cleanScalar(rawValue);
    if (value && !value.startsWith("[") && !value.startsWith("{"))
      result[key] = value;
    index += 1;
  }
  return result;
}

async function readSkillManifest(
  path: string,
): Promise<Record<string, string>> {
  try {
    const details = await lstat(path);
    const manifestPath = details.isFile() ? path : join(path, "SKILL.md");
    return parseFrontmatter(await readFile(manifestPath, "utf8"));
  } catch {
    return {};
  }
}

function frontmatterSource(
  frontmatter: Record<string, string>,
): SkillSource | null {
  const value =
    frontmatter.source ??
    frontmatter.repository ??
    frontmatter.repo ??
    frontmatter.homepage ??
    null;
  if (!value) return null;
  return {
    kind: "frontmatter",
    label: value,
    url: /^https?:\/\//iu.test(value) ? value : null,
    repoOwner: null,
    repoName: null,
    repoPath: null,
    slug: null,
  };
}

async function readOrigins(
  filePath = ORIGINS_FILE,
): Promise<MarketOriginsFile> {
  try {
    const parsed = JSON.parse(
      await readFile(filePath, "utf8"),
    ) as MarketOriginsFile;
    if (parsed.version !== 1 || typeof parsed.installations !== "object")
      throw new Error();
    return parsed;
  } catch {
    return { version: 1, installations: {} };
  }
}

async function writeOrigins(
  value: MarketOriginsFile,
  filePath = ORIGINS_FILE,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, JSON.stringify(value, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
}

function normalizedVersion(value: string | null | undefined): number[] | null {
  if (!value) return null;
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/iu);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(local: string, remote: string): number | null {
  const localParts = normalizedVersion(local);
  const remoteParts = normalizedVersion(remote);
  if (!localParts || !remoteParts) return null;
  for (let index = 0; index < 3; index += 1) {
    if (remoteParts[index] > localParts[index]) return 1;
    if (remoteParts[index] < localParts[index]) return -1;
  }
  return 0;
}

function updateEvidence(input: {
  version: string | null;
  origin: MarketOrigin | undefined;
}): {
  status: SkillUpdateStatus;
  reason: string;
} {
  if (!input.origin)
    return { status: "unknown", reason: "没有可比较的远端来源证据" };

  const localVersion = input.version ?? input.origin.localVersion;
  const remoteVersion = input.origin.latestRemoteVersion;
  if (localVersion && remoteVersion) {
    const comparison = compareVersions(localVersion, remoteVersion);
    if (comparison === 1) {
      return {
        status: "available",
        reason: `远端版本 ${remoteVersion} 高于本地 ${localVersion}`,
      };
    }
    if (comparison === 0) {
      return {
        status: "current",
        reason: `本地版本与远端 ${remoteVersion} 一致`,
      };
    }
    if (comparison === -1) {
      return {
        status: "current",
        reason: `远端版本 ${remoteVersion} 未高于本地 ${localVersion}`,
      };
    }
  }

  const installedTime = Date.parse(input.origin.installedRemoteUpdatedAt ?? "");
  const latestTime = Date.parse(input.origin.latestRemoteUpdatedAt ?? "");
  if (Number.isFinite(installedTime) && Number.isFinite(latestTime)) {
    if (latestTime > installedTime) {
      return {
        status: "available",
        reason: "市场记录在本次安装后有真实更新时间",
      };
    }
    return { status: "current", reason: "市场更新时间未晚于本次安装证据" };
  }
  return { status: "unknown", reason: "远端未提供可比较的版本或更新时间" };
}

interface HealthThresholdsResolved {
  lowFrequencyCount: number;
  dozeDays: number;
  deadDays: number;
}

const DEFAULT_HEALTH_THRESHOLDS: HealthThresholdsResolved = {
  lowFrequencyCount: 5,
  dozeDays: 30,
  deadDays: 90,
};

function resolvedHealthThresholds(
  raw?: HealthThresholds,
): HealthThresholdsResolved {
  if (!raw) return DEFAULT_HEALTH_THRESHOLDS;
  return {
    lowFrequencyCount:
      raw.lowFrequencyCount != null &&
      Number.isFinite(raw.lowFrequencyCount) &&
      raw.lowFrequencyCount >= 0
        ? raw.lowFrequencyCount
        : DEFAULT_HEALTH_THRESHOLDS.lowFrequencyCount,
    dozeDays:
      raw.dozeDays != null && Number.isFinite(raw.dozeDays) && raw.dozeDays > 0
        ? raw.dozeDays
        : DEFAULT_HEALTH_THRESHOLDS.dozeDays,
    deadDays:
      raw.deadDays != null &&
      Number.isFinite(raw.deadDays) &&
      raw.deadDays > (raw.dozeDays ?? DEFAULT_HEALTH_THRESHOLDS.dozeDays)
        ? raw.deadDays
        : DEFAULT_HEALTH_THRESHOLDS.deadDays,
  };
}

function healthFromLastUse(
  lastUsedAt: number,
  now: number,
  recentCalls: number,
  thresholds: HealthThresholdsResolved,
): { health: SkillHealth; reason: string } {
  const ageDays = Math.max(0, Math.floor((now - lastUsedAt) / DAY_MS));

  // Active: last used within RECENT_WINDOW_DAYS AND enough calls in that window
  if (
    ageDays <= RECENT_WINDOW_DAYS &&
    recentCalls >= thresholds.lowFrequencyCount
  ) {
    return {
      health: "active",
      reason: `最近 7 天调用 ${recentCalls} 次（活跃）`,
    };
  }

  // Low: used within dozeDays but doesn't meet active criteria
  if (ageDays <= thresholds.dozeDays) {
    if (ageDays <= RECENT_WINDOW_DAYS) {
      return {
        health: "low",
        reason: `7 天内仅 ${recentCalls} 次调用（需 ≥${thresholds.lowFrequencyCount} 次）`,
      };
    }
    return { health: "low", reason: `${ageDays} 天未调用` };
  }

  // Doze: last used between dozeDays and deadDays ago
  if (ageDays <= thresholds.deadDays) {
    return { health: "doze", reason: `${ageDays} 天未调用` };
  }

  // Dead: last used more than deadDays ago
  return { health: "dead", reason: `${ageDays} 天未调用` };
}

interface SkillUsageInfo {
  calls: number;
  recentCalls: number;
  lastUsedAt: number;
}

function skillUsageEvidence(
  events: LocalUsageEvent[],
  now: number,
): Map<string, SkillUsageInfo> {
  const evidence = new Map<string, SkillUsageInfo>();
  const recentThreshold = now - RECENT_WINDOW_DAYS * DAY_MS;
  for (const event of events) {
    const usedAt = Date.parse(event.timestamp);
    if (!Number.isFinite(usedAt)) continue;
    const isRecent = usedAt >= recentThreshold;
    for (const skill of event.context?.skills ?? []) {
      const key = skill.name.toLowerCase();
      const current = evidence.get(key) ?? {
        calls: 0,
        recentCalls: 0,
        lastUsedAt: 0,
      };
      current.calls += skill.calls;
      if (isRecent) current.recentCalls += skill.calls;
      current.lastUsedAt = Math.max(current.lastUsedAt, usedAt);
      evidence.set(key, current);
    }
  }
  return evidence;
}

/**
 * 按日聚合每个 Skill 的调用序列，用于「日均 / 使用趋势(↑↓−)」展示。
 *
 * 仅依赖已脱敏的 context.skills[].calls + 事件时间戳，不读取 Skill 内容。
 * 注意：当前仅 Codex 产 context.skills，其余来源序列为空（与 usageCount 同源限制）。
 */
function skillDailySeries(
  events: LocalUsageEvent[],
): Map<string, SkillDailyPoint[]> {
  const series = new Map<string, Map<string, number>>();
  for (const event of events) {
    const usedAt = Date.parse(event.timestamp);
    if (!Number.isFinite(usedAt)) continue;
    const date = localDateKeyFromMillis(usedAt);
    for (const skill of event.context?.skills ?? []) {
      const key = skill.name.toLowerCase();
      const byDate = series.get(key) ?? new Map<string, number>();
      byDate.set(date, (byDate.get(date) ?? 0) + skill.calls);
      series.set(key, byDate);
    }
  }
  const result = new Map<string, SkillDailyPoint[]>();
  for (const [key, byDate] of series) {
    result.set(
      key,
      [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, calls]) => ({ date, calls })),
    );
  }
  return result;
}

/** 本地时区日期键（YYYY-MM-DD），与 local-usage 的 localDateKey 口径一致。 */
function localDateKeyFromMillis(millis: number): string {
  const date = new Date(millis);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function safeSkillName(name: string): string {
  const trimmed = name.trim();
  if (
    trimmed.length === 0 ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    basename(trimmed) !== trimmed
  ) {
    throw new Error("Skill 名称不合法");
  }
  return trimmed;
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    !pathFromRoot.startsWith(`..${sep}`)
  );
}

async function assertManagedSkillPath(
  path: string,
  roots: Record<SkillAgent, string>,
): Promise<SkillAgent> {
  const resolvedPath = resolve(path);
  const matchingAgent = SKILL_AGENTS.find((agent) => {
    const pathFromRoot = relative(resolve(roots[agent]), resolvedPath);
    return (
      pathFromRoot !== "" &&
      !pathFromRoot.startsWith("..") &&
      !pathFromRoot.includes(sep)
    );
  });
  if (!matchingAgent) throw new Error("路径不属于受管 Skill 根目录");

  const [rootRealPath, candidateRealPath] = await Promise.all([
    realpath(roots[matchingAgent]),
    realpath(resolvedPath),
  ]);
  if (!isPathInside(rootRealPath, candidateRealPath)) {
    throw new Error("检测到越权路径或符号链接");
  }
  return matchingAgent;
}

function containsParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes("..");
}

async function assertNoSymbolicLinks(root: string): Promise<void> {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink()) throw new Error("市场 Skill 源不允许符号链接");
  if (!rootStat.isDirectory()) throw new Error("市场 Skill 源必须是目录");

  const directory = await opendir(root);
  for await (const entry of directory) {
    const entryPath = join(root, entry.name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink())
      throw new Error("市场 Skill 源不允许包含符号链接");
    if (entryStat.isDirectory()) await assertNoSymbolicLinks(entryPath);
  }
}

async function assertMarketSkillPath(path: string): Promise<void> {
  if (!isAbsolute(path) || containsParentTraversal(path)) {
    throw new Error("市场 Skill 源路径不合法");
  }

  const [temporaryRootRealPath, sourceRealPath] = await Promise.all([
    realpath(MARKET_TEMP_DIR),
    realpath(path),
  ]);
  const pathFromTemporaryRoot = relative(temporaryRootRealPath, sourceRealPath);
  const marketDirectory = pathFromTemporaryRoot.split(sep)[0];
  if (
    pathFromTemporaryRoot === "" ||
    pathFromTemporaryRoot.startsWith("..") ||
    !marketDirectory.startsWith("market-")
  ) {
    throw new Error("市场 Skill 源不属于受控临时目录");
  }

  await assertNoSymbolicLinks(path);
  const manifestPath = join(path, "SKILL.md");
  const manifestStat = await lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error("市场 Skill 根目录必须包含常规文件 SKILL.md");
  }
}

async function isSkillEntry(path: string): Promise<boolean> {
  const entryStat = await lstat(path);
  if (entryStat.isSymbolicLink()) return false;
  if (entryStat.isFile()) return path.toLowerCase().endsWith(".md");
  if (!entryStat.isDirectory()) return false;
  try {
    return (await stat(join(path, "SKILL.md"))).isFile();
  } catch {
    return true;
  }
}

async function scanInstallations(
  roots: Record<SkillAgent, string>,
  origins: MarketOriginsFile,
): Promise<{
  installations: Map<string, SkillInstallation[]>;
  descriptions: Map<string, string | null>;
}> {
  const installations = new Map<string, SkillInstallation[]>();
  const descriptions = new Map<string, string | null>();
  await Promise.all(
    SKILL_AGENTS.map(async (agent) => {
      const root = roots[agent];
      try {
        const directory = await opendir(root);
        for await (const entry of directory) {
          if (entry.name.startsWith(".")) continue;
          const path = join(root, entry.name);
          if (!(await isSkillEntry(path))) continue;
          const details = await stat(path);
          const frontmatter = await readSkillManifest(path);
          const name = entry.isFile()
            ? entry.name.replace(/\.md$/i, "")
            : entry.name;
          if (!descriptions.has(name)) {
            descriptions.set(name, frontmatter.description ?? null);
          }
          const origin = origins.installations[resolve(path)];
          const version = frontmatter.version ?? origin?.localVersion ?? null;
          const evidence = updateEvidence({ version, origin });
          const current = installations.get(name) ?? [];
          current.push({
            agent,
            path,
            installedAt: new Date(
              details.birthtimeMs || details.ctimeMs,
            ).toISOString(),
            modifiedAt: details.mtime.toISOString(),
            version,
            source: origin?.source ?? frontmatterSource(frontmatter),
            updateStatus: evidence.status,
            updateReason: evidence.reason,
          });
          installations.set(name, current);
        }
      } catch {
        return;
      }
    }),
  );
  return { installations, descriptions };
}

async function readBlacklist(filePath = BLACKLIST_FILE): Promise<string[]> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter((item): item is string => typeof item === "string"),
          ),
        ].sort()
      : [];
  } catch {
    return [];
  }
}

async function writeBlacklist(
  names: string[],
  filePath = BLACKLIST_FILE,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(
    filePath,
    JSON.stringify([...new Set(names)].sort(), null, 2),
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
}

export async function scanLocalSkills(
  options: ScanOptions = {},
): Promise<SkillSnapshot> {
  const homeDirectory = options.homeDirectory ?? homedir();
  const now = options.now ?? new Date();
  const roots = rootsFor(homeDirectory);
  const trusttoolsDirectory = options.trusttoolsDirectory ?? TRUSTTOOLS_DIR;
  const [origins, blacklist] = await Promise.all([
    readOrigins(join(trusttoolsDirectory, "skill-origins.json")),
    readBlacklist(join(trusttoolsDirectory, "skill-blacklist.json")),
  ]);
  const { installations, descriptions } = await scanInstallations(
    roots,
    origins,
  );
  const usageEvidence = skillUsageEvidence(
    options.usageEvents ?? [],
    now.getTime(),
  );
  const dailySeries = skillDailySeries(options.usageEvents ?? []);
  const healthThresholds = resolvedHealthThresholds(options.healthThresholds);

  const skills: LocalSkill[] = [...installations.entries()]
    .map(([name, entries]) => {
      const usage = usageEvidence.get(name.toLowerCase());
      const status =
        usage == null
          ? {
              health: "unknown" as const,
              reason:
                "未发现结构化调用记录；无法判断活跃度，文件修改时间不作为调用证据",
            }
          : healthFromLastUse(
              usage.lastUsedAt,
              now.getTime(),
              usage.recentCalls,
              healthThresholds,
            );
      return {
        id: name,
        name,
        description: descriptions.get(name) ?? null,
        health: status.health,
        healthReason:
          usage == null
            ? status.reason
            : `${status.reason}；本地日志记录真实调用 ${usage.calls.toLocaleString()} 次`,
        lastUsedAt:
          usage == null ? null : new Date(usage.lastUsedAt).toISOString(),
        usageCount: usage?.calls ?? 0,
        daily: dailySeries.get(name.toLowerCase()) ?? [],
        installations: entries.sort((a, b) => a.agent.localeCompare(b.agent)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        skills: skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          health: skill.health,
          lastUsedAt: skill.lastUsedAt,
          usageCount: skill.usageCount,
          dailyTail: skill.daily?.slice(-1)[0]?.date ?? null,
          dailyPoints: skill.daily?.length ?? 0,
          installations: skill.installations,
        })),
        blacklist,
      }),
    )
    .digest("hex");

  return {
    generatedAt: now.toISOString(),
    fingerprint,
    healthBasis:
      "活跃度只依据本地日志中的结构化 Skill 调用；文件修改时间仅作安装信息展示。",
    roots,
    skills,
    blacklist,
  };
}

async function copySkillToAgent(input: {
  sourcePath: string;
  targetAgent: SkillAgent;
  overwrite?: boolean;
}): Promise<string> {
  if (!SKILL_AGENTS.includes(input.targetAgent))
    throw new Error("目标 Agent 不受支持");

  const roots = rootsFor(homedir());
  const name = safeSkillName(basename(input.sourcePath).replace(/\.md$/i, ""));
  if ((await readBlacklist()).includes(name))
    throw new Error("该 Skill 已被加入黑名单");

  const sourceStat = await lstat(input.sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error("不允许复制符号链接");
  const extension = sourceStat.isFile() ? ".md" : "";
  const targetRoot = roots[input.targetAgent];
  const targetPath = join(targetRoot, `${name}${extension}`);
  if (!isPathInside(targetRoot, targetPath)) throw new Error("目标路径不合法");

  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const targetExists = await lstat(targetPath)
    .then(() => true)
    .catch(() => false);
  if (targetExists) {
    if (!input.overwrite) throw new Error("目标位置已存在同名 Skill");
    await rm(targetPath, { recursive: true, force: true });
  }
  await cp(input.sourcePath, targetPath, {
    recursive: sourceStat.isDirectory(),
    errorOnExist: true,
  });
  return targetPath;
}

export async function installLocalSkill(input: {
  sourcePath: string;
  targetAgent: SkillAgent;
}): Promise<void> {
  const roots = rootsFor(homedir());
  await assertManagedSkillPath(input.sourcePath, roots);
  const targetPath = await copySkillToAgent(input);
  const origins = await readOrigins();
  const sourceOrigin = origins.installations[resolve(input.sourcePath)];
  if (sourceOrigin) {
    origins.installations[resolve(targetPath)] = {
      ...sourceOrigin,
      installedAt: new Date().toISOString(),
    };
    await writeOrigins(origins);
  }
}

export async function installMarketSkill(
  input: {
    sourcePath: string;
    targetAgent: SkillAgent;
    origin?: MarketSkillOriginInput;
  },
  options: { trusttoolsDirectory?: string } = {},
): Promise<void> {
  await assertMarketSkillPath(input.sourcePath);
  const frontmatter = await readSkillManifest(input.sourcePath);
  const targetPath = await copySkillToAgent(input);
  if (!input.origin) return;

  const now = new Date().toISOString();
  const localVersion = frontmatter.version ?? input.origin.version ?? null;
  const source: SkillSource & { kind: "market" } = {
    kind: "market",
    label: `${input.origin.repoOwner}/${input.origin.repoName}`,
    url: `https://github.com/${input.origin.repoOwner}/${input.origin.repoName}`,
    repoOwner: input.origin.repoOwner,
    repoName: input.origin.repoName,
    repoPath: input.origin.repoPath,
    slug: input.origin.slug,
  };
  const originsFile = join(
    options.trusttoolsDirectory ?? TRUSTTOOLS_DIR,
    "skill-origins.json",
  );
  const origins = await readOrigins(originsFile);
  origins.installations[resolve(targetPath)] = {
    source,
    installedAt: now,
    localVersion,
    installedRemoteVersion: input.origin.version ?? localVersion,
    installedRemoteUpdatedAt: input.origin.updatedAt ?? null,
    latestRemoteVersion: input.origin.version ?? localVersion,
    latestRemoteUpdatedAt: input.origin.updatedAt ?? null,
    checkedAt: now,
  };
  await writeOrigins(origins, originsFile);
}

function marketRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalRemoteString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function refreshMarketSkillEvidence(
  options: {
    trusttoolsDirectory?: string;
    fetcher?: typeof fetch;
    now?: Date;
    force?: boolean;
  } = {},
): Promise<boolean> {
  const trusttoolsDirectory = options.trusttoolsDirectory ?? TRUSTTOOLS_DIR;
  const filePath = join(trusttoolsDirectory, "skill-origins.json");
  const origins = await readOrigins(filePath);
  const now = options.now ?? new Date();
  const dueOrigins = Object.entries(origins.installations).filter(
    ([, origin]) => {
      const checkedAt = Date.parse(origin.checkedAt ?? "");
      return (
        options.force ||
        !Number.isFinite(checkedAt) ||
        now.getTime() - checkedAt >= MARKET_EVIDENCE_TTL_MS
      );
    },
  );
  if (dueOrigins.length === 0) return false;

  let changed = false;
  const groups = new Map<string, Array<[string, MarketOrigin]>>();
  for (const entry of dueOrigins) {
    const current = groups.get(entry[1].source.slug ?? "") ?? [];
    current.push(entry);
    groups.set(entry[1].source.slug ?? "", current);
  }

  for (const [slug, entries] of groups) {
    if (!slug) continue;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    try {
      const url = new URL(MARKET_API);
      url.searchParams.set("page", "1");
      url.searchParams.set("limit", "20");
      url.searchParams.set("search", slug);
      const response = await (options.fetcher ?? fetch)(url, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const body = marketRecord(await response.json());
      const records = Array.isArray(body?.data)
        ? body.data.map(marketRecord).filter(Boolean)
        : [];
      for (const [path, origin] of entries) {
        const matching = records.find(
          (record) =>
            optionalRemoteString(record?.slug) === origin.source.slug &&
            optionalRemoteString(record?.repo_owner) ===
              origin.source.repoOwner &&
            optionalRemoteString(record?.repo_name) === origin.source.repoName,
        );
        if (!matching) continue;
        const latestVersion = optionalRemoteString(matching.version);
        const latestUpdatedAt = optionalRemoteString(matching.updated_at);
        const baselineMissing =
          origin.installedRemoteVersion === null &&
          origin.installedRemoteUpdatedAt === null;
        origins.installations[path] = {
          ...origin,
          installedRemoteVersion: baselineMissing
            ? latestVersion
            : origin.installedRemoteVersion,
          installedRemoteUpdatedAt: baselineMissing
            ? latestUpdatedAt
            : origin.installedRemoteUpdatedAt,
          latestRemoteVersion: latestVersion,
          latestRemoteUpdatedAt: latestUpdatedAt,
          checkedAt: now.toISOString(),
        };
        changed = true;
      }
    } catch {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }
  if (changed) await writeOrigins(origins, filePath);
  return changed;
}

export async function uninstallLocalSkill(
  path: string,
): Promise<{ path: string }> {
  const roots = rootsFor(homedir());
  await assertManagedSkillPath(path, roots);
  const target = resolve(path);
  await rm(target, { recursive: true, force: true });
  return { path: target };
}

export async function batchUninstallLocalSkills(
  paths: string[],
): Promise<BatchUninstallResult> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) throw new Error("至少选择一个 Skill");

  const succeeded: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const path of uniquePaths) {
    try {
      const result = await uninstallLocalSkill(path);
      succeeded.push(result.path);
    } catch (error) {
      failed.push({
        path,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  }
  return { succeeded, failed };
}

export async function syncLocalSkill(input: {
  sourcePath: string;
  targetAgents: string[];
  onConflict: "overwrite" | "skip";
}): Promise<SkillSyncResult> {
  const roots = rootsFor(homedir());
  await assertManagedSkillPath(input.sourcePath, roots);

  const succeeded: { agent: string; path: string }[] = [];
  const skipped: { agent: string; reason: "conflict" }[] = [];
  const failed: { agent: string; error: string }[] = [];

  for (const targetAgent of input.targetAgents) {
    if (!SKILL_AGENTS.includes(targetAgent as SkillAgent)) {
      failed.push({ agent: targetAgent, error: "目标 Agent 不受支持" });
      continue;
    }
    const agent = targetAgent as SkillAgent;
    try {
      const targetPath = await copySkillToAgent({
        sourcePath: input.sourcePath,
        targetAgent: agent,
        overwrite: input.onConflict === "overwrite",
      });
      const origins = await readOrigins();
      const sourceOrigin = origins.installations[resolve(input.sourcePath)];
      if (sourceOrigin) {
        origins.installations[resolve(targetPath)] = {
          ...sourceOrigin,
          installedAt: new Date().toISOString(),
        };
        await writeOrigins(origins);
      }
      succeeded.push({ agent, path: targetPath });
    } catch (error) {
      const message = error instanceof Error ? error.message : "未知错误";
      if (
        input.onConflict === "skip" &&
        message === "目标位置已存在同名 Skill"
      ) {
        skipped.push({ agent, reason: "conflict" });
      } else {
        failed.push({ agent, error: message });
      }
    }
  }
  return { succeeded, skipped, failed };
}

export async function setSkillBlacklisted(
  name: string,
  blocked: boolean,
): Promise<void> {
  const safeName = safeSkillName(name);
  const current = await readBlacklist();
  const next = blocked
    ? [...new Set([...current, safeName])]
    : current.filter((item) => item !== safeName);
  await writeBlacklist(next);
}
