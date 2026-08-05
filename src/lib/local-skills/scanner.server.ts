import {
  appendFile,
  cp,
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
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
  detectToolInstallations,
  type ToolInstallationFact,
} from "../tools/detection.server.ts";
import {
  DEFAULT_MARKERS,
  DEFAULT_MAX_DEPTH,
  type SkillAgentRule,
} from "./agent-rules.ts";
import {
  SKILL_AGENT_RULES,
  SKILL_ROOT_SUFFIXES,
} from "./skill-rules.server.ts";
import {
  SKILL_AGENTS,
  type BatchUninstallResult,
  type LocalSkill,
  type SkillAgent,
  type SkillInstallation,
  type SkillSource,
  type SkillSnapshot,
  type SkillSyncResult,
  type SkillUpdateStatus,
} from "./types.ts";

/** Compatibility re-export (label → write root); kept for existing importers. */
export { SKILL_ROOT_SUFFIXES };

/**
 * Resolve each agent's skill roots against a home directory. When a rule has
 * `envHome` and the corresponding env var is a non-empty string, the env value
 * replaces the directory part of each root (the tool's home directory) while
 * keeping the last path segment: `join(envValue, basename(suffix))`. Empty
 * strings are treated as unset and fall back to `join(home, suffix)`.
 *
 * Server-only (node:path); lives here so the shared `agent-rules.ts` stays
 * importable in the browser bundle.
 */
export function resolveAgentRoots(
  home: string,
  env: Record<string, string | undefined>,
): Record<string, string[]> {
  const roots: Record<string, string[]> = {};
  // SKILL_AGENTS mirrors SKILL_AGENT_RULES order, so index alignment holds.
  for (const [i, rule] of SKILL_AGENT_RULES.entries()) {
    const envValue = rule.envHome == null ? undefined : env[rule.envHome];
    const overridden = envValue !== undefined && envValue !== "";
    roots[SKILL_AGENTS[i]] = rule.roots.map((suffix) =>
      overridden ? join(envValue, basename(suffix)) : join(home, suffix),
    );
  }
  return roots;
}

const TRUSTTOOLS_DIR = join(homedir(), ".trusttools");
const BLACKLIST_FILE = join(TRUSTTOOLS_DIR, "skill-blacklist.json");
const ORIGINS_FILE = join(TRUSTTOOLS_DIR, "skill-origins.json");
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
 * Skill discovery rule per agent label, keyed by `SkillAgent` (the tool
 * `nameZh`). Used to walk each agent's root(s) with the right markers/depth.
 */
const RULE_BY_AGENT: ReadonlyMap<string, SkillAgentRule> = new Map(
  SKILL_AGENT_RULES.map((rule) => {
    const tool = AI_TOOLS.find((candidate) => candidate.id === rule.toolId);
    return [tool?.nameZh ?? rule.toolId, rule] as const;
  }),
);

interface ScanOptions {
  homeDirectory?: string;
  now?: Date;
  trusttoolsDirectory?: string;
  usageEvents?: LocalUsageEvent[];
  env?: Record<string, string | undefined>;
}

function agentInstallationFacts(
  facts: readonly ToolInstallationFact[],
): Record<SkillAgent, { installed: boolean; detectedPaths: string[] }> {
  const factsById = new Map(facts.map((fact) => [fact.id, fact]));
  return Object.fromEntries(
    SKILL_AGENTS.map((agent) => {
      const tool = AI_TOOLS.find((candidate) => candidate.nameZh === agent);
      const fact = tool == null ? undefined : factsById.get(tool.id);
      return [
        agent,
        {
          installed: fact?.installed ?? false,
          detectedPaths: fact?.detectedPaths ?? [],
        },
      ];
    }),
  ) as Record<SkillAgent, { installed: boolean; detectedPaths: string[] }>;
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
  markers: readonly string[] = DEFAULT_MARKERS,
): Promise<Record<string, string>> {
  try {
    const details = await lstat(path);
    let manifestPath = path;
    if (!details.isFile()) {
      const marker = await findMarker(path, markers);
      if (marker === null) return {};
      manifestPath = join(path, marker);
    }
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

interface SkillUsageInfo {
  lastUsedAt: number;
}

function skillUsageEvidence(
  events: LocalUsageEvent[],
): Map<string, SkillUsageInfo> {
  const evidence = new Map<string, SkillUsageInfo>();
  for (const event of events) {
    const usedAt = Date.parse(event.timestamp);
    if (!Number.isFinite(usedAt)) continue;
    for (const skill of event.context?.skills ?? []) {
      const key = skill.name.toLowerCase();
      const current = evidence.get(key);
      if (current == null || usedAt > current.lastUsedAt) {
        evidence.set(key, { lastUsedAt: usedAt });
      }
    }
  }
  return evidence;
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
  roots: Record<SkillAgent, string[]>,
): Promise<SkillAgent> {
  // `..` segments are rejected on the raw path (resolve() would collapse
  // them, hiding a traversal attempt).
  if (containsParentTraversal(path))
    throw new Error("路径不属于受管 Skill 根目录");

  const resolvedPath = resolve(path);
  let matchingRoot: string | null = null;
  let matchingAgent: SkillAgent | null = null;
  for (const agent of SKILL_AGENTS) {
    for (const root of roots[agent] ?? []) {
      const pathFromRoot = relative(resolve(root), resolvedPath);
      if (
        pathFromRoot === "" ||
        pathFromRoot === ".." ||
        pathFromRoot.startsWith(`..${sep}`) ||
        pathFromRoot.split(sep).includes("..")
      ) {
        continue;
      }
      matchingRoot = root;
      matchingAgent = agent;
      break;
    }
    if (matchingRoot !== null) break;
  }
  if (matchingAgent === null || matchingRoot === null) {
    throw new Error("路径不属于受管 Skill 根目录");
  }

  const [rootRealPath, candidateRealPath] = await Promise.all([
    realpath(matchingRoot),
    realpath(resolvedPath),
  ]);
  if (!isPathInside(rootRealPath, candidateRealPath)) {
    throw new Error("检测到越权路径或符号链接");
  }

  // 必须指向单个 Skill:含 marker 的目录,或 `.md` 文件。防止把集合目录/父
  // 目录(如 `~/.claude/skills/development`)当作卸载、安装或同步目标,导致
  // 整目录被 `rm -rf`/回收。
  const rule = RULE_BY_AGENT.get(matchingAgent);
  const markers = rule?.markers ?? DEFAULT_MARKERS;
  const entryStat = await lstat(candidateRealPath);
  const isSingleSkill =
    (entryStat.isDirectory() &&
      (await findMarker(candidateRealPath, markers)) !== null) ||
    (entryStat.isFile() && /\.md$/iu.test(basename(candidateRealPath)));
  if (!isSingleSkill) {
    throw new Error("目标不是受管的 Skill 目录");
  }
  return matchingAgent;
}

function containsParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes("..");
}

/**
 * 可注入的 home/trusttools 目录(与 ScanOptions 同构),供测试把全部 Skill
 * 操作隔离到临时根,避免触碰真实 `~/.claude/skills`。
 */
interface SkillOpOptions {
  homeDirectory?: string;
  trusttoolsDirectory?: string;
}

/** 解析注入的 `.trusttools` 目录:显式 trusttoolsDirectory 优先,否则跟随 homeDirectory。 */
function trusttoolsDirectoryFor(options: SkillOpOptions = {}): string {
  return resolve(
    options.trusttoolsDirectory ??
      join(options.homeDirectory ?? homedir(), ".trusttools"),
  );
}

/**
 * 可恢复删除:把目标整体 rename 进 TrustTools 回收目录并追加 JSONL 清单,
 * 取代不可逆的 `rm -rf`。清单即审计记录;`trusttoolsDirectory` 可注入
 * (测试用),默认 `~/.trusttools`。
 */
async function moveToTrash(
  targetPath: string,
  action: "uninstall" | "overwrite",
  options: SkillOpOptions = {},
): Promise<void> {
  const root = trusttoolsDirectoryFor(options);
  const trashDir = join(root, "trash", "skills");
  await mkdir(trashDir, { recursive: true, mode: 0o700 });

  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const base = basename(targetPath);
  const manifest = join(trashDir, "manifest.jsonl");
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    const suffix = attempt === 1 ? stamp : `${stamp}-${attempt}`;
    const trashPath = join(trashDir, `${base}-${suffix}`);
    try {
      await rename(targetPath, trashPath);
      // 清单与操作日志尽力而为,不因记账失败而回滚/误报删除失败。
      const record = {
        trashedAt: new Date().toISOString(),
        action,
        originalPath: resolve(targetPath),
        trashPath: resolve(trashPath),
      };
      await appendFile(manifest, `${JSON.stringify(record)}\n`, "utf8").catch(
        () => undefined,
      );
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw error;
    }
  }
  throw new Error("回收目录写入失败");
}

/** 追加一条 Skill 操作日志(尽力而为,不阻断主流程)。 */
async function appendSkillOpLog(
  entry: Record<string, unknown>,
  options: SkillOpOptions = {},
): Promise<void> {
  const root = trusttoolsDirectoryFor(options);
  const logFile = join(root, "logs", "skills-ops.log");
  await mkdir(dirname(logFile), { recursive: true, mode: 0o700 });
  await appendFile(
    logFile,
    `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
    "utf8",
  ).catch(() => undefined);
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

async function assertMarketSkillPath(
  path: string,
  options: { homeDirectory?: string; trusttoolsDirectory?: string } = {},
): Promise<void> {
  if (!isAbsolute(path) || containsParentTraversal(path)) {
    throw new Error("市场 Skill 源路径不合法");
  }

  // 受控临时根跟随注入的 trusttoolsDirectory(测试隔离),默认 ~/.trusttools/tmp。
  const temporaryRoot = join(trusttoolsDirectoryFor(options), "tmp");
  const [temporaryRootRealPath, sourceRealPath] = await Promise.all([
    realpath(temporaryRoot),
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

/**
 * Find the first existing marker file inside `directoryPath`, in `markers`
 * order (exact-case match). Returns the marker file name or `null`.
 */
async function findMarker(
  directoryPath: string,
  markers: readonly string[],
): Promise<string | null> {
  for (const marker of markers) {
    try {
      const markerStat = await stat(join(directoryPath, marker));
      if (markerStat.isFile()) return marker;
    } catch {
      // Missing (ENOENT) or unreadable — try the next marker.
    }
  }
  return null;
}

interface SkillWalkContext {
  agent: string;
  rule: SkillAgentRule;
  origins: MarketOriginsFile;
  installations: Map<string, SkillInstallation[]>;
  descriptions: Map<string, string | null>;
}

async function recordSkill(
  skillPath: string,
  marker: string,
  context: SkillWalkContext,
): Promise<void> {
  const details = await stat(skillPath);
  const frontmatter = await readSkillManifest(skillPath, [marker]);
  const name = frontmatter.name?.trim() || basename(skillPath) || "Skill";
  if (!context.descriptions.has(name)) {
    context.descriptions.set(name, frontmatter.description ?? null);
  }
  const origin = context.origins.installations[resolve(skillPath)];
  const version = frontmatter.version ?? origin?.localVersion ?? null;
  const evidence = updateEvidence({ version, origin });
  const current = context.installations.get(name) ?? [];
  current.push({
    agent: context.agent,
    path: skillPath,
    installedAt: new Date(details.birthtimeMs || details.ctimeMs).toISOString(),
    modifiedAt: details.mtime.toISOString(),
    version,
    source: origin?.source ?? frontmatterSource(frontmatter),
    updateStatus: evidence.status,
    updateReason: evidence.reason,
  });
  context.installations.set(name, current);
}

/**
 * Recursively discover skills under `directoryPath` (root depth = 0). A
 * directory containing a marker file is recorded as one skill and not
 * descended into; marker-less directories are descended into while
 * `depth + 1 < maxDepth`. Dot-prefixed entries and symbolic links are
 * skipped; bare markdown files are never skills. Entries are processed in
 * localeCompare order for deterministic output.
 */
async function walkSkillDirectory(
  directoryPath: string,
  depth: number,
  context: SkillWalkContext,
): Promise<void> {
  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch {
    return; // Missing/unreadable root: silently skipped.
  }

  const entries: { name: string; path: string }[] = [];
  for await (const entry of directory) {
    entries.push({ name: entry.name, path: join(directoryPath, entry.name) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    let entryStat;
    try {
      entryStat = await lstat(entry.path);
    } catch {
      continue; // Vanished between listing and stat.
    }
    if (entryStat.isSymbolicLink() || !entryStat.isDirectory()) continue;

    const marker = await findMarker(
      entry.path,
      context.rule.markers ?? DEFAULT_MARKERS,
    );
    if (marker !== null) {
      await recordSkill(entry.path, marker, context);
    } else if (depth + 1 < (context.rule.maxDepth ?? DEFAULT_MAX_DEPTH)) {
      await walkSkillDirectory(entry.path, depth + 1, context);
    }
  }
}

async function scanInstallations(
  roots: Record<SkillAgent, string[]>,
  origins: MarketOriginsFile,
): Promise<{
  installations: Map<string, SkillInstallation[]>;
  descriptions: Map<string, string | null>;
}> {
  const installations = new Map<string, SkillInstallation[]>();
  const descriptions = new Map<string, string | null>();
  await Promise.all(
    SKILL_AGENTS.map(async (agent) => {
      const rule = RULE_BY_AGENT.get(agent);
      if (rule === undefined) return;
      const context: SkillWalkContext = {
        agent,
        rule,
        origins,
        installations,
        descriptions,
      };
      for (const root of roots[agent] ?? []) {
        await walkSkillDirectory(root, 0, context);
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
  const roots = resolveAgentRoots(homeDirectory, options.env ?? process.env);
  const trusttoolsDirectory = options.trusttoolsDirectory ?? TRUSTTOOLS_DIR;
  const [origins, blacklist, installationFacts] = await Promise.all([
    readOrigins(join(trusttoolsDirectory, "skill-origins.json")),
    readBlacklist(join(trusttoolsDirectory, "skill-blacklist.json")),
    detectToolInstallations(AI_TOOLS, homeDirectory),
  ]);
  const agents = agentInstallationFacts(installationFacts);
  const { installations, descriptions } = await scanInstallations(
    roots,
    origins,
  );
  const usageEvidence = skillUsageEvidence(options.usageEvents ?? []);

  const skills: LocalSkill[] = [...installations.entries()]
    .map(([name, entries]) => {
      const usage = usageEvidence.get(name.toLowerCase());
      return {
        id: name,
        name,
        description: descriptions.get(name) ?? null,
        lastUsedAt:
          usage == null ? null : new Date(usage.lastUsedAt).toISOString(),
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
          lastUsedAt: skill.lastUsedAt,
          installations: skill.installations,
        })),
        blacklist,
      }),
    )
    .digest("hex");

  return {
    generatedAt: now.toISOString(),
    fingerprint,
    roots,
    agents,
    skills,
    blacklist,
  };
}

async function copySkillToAgent(
  input: {
    sourcePath: string;
    targetAgent: SkillAgent;
    overwrite?: boolean;
  },
  options: SkillOpOptions = {},
): Promise<string> {
  if (!SKILL_AGENTS.includes(input.targetAgent))
    throw new Error("目标 Agent 不受支持");

  const roots = resolveAgentRoots(
    options.homeDirectory ?? homedir(),
    process.env,
  );
  const name = safeSkillName(basename(input.sourcePath).replace(/\.md$/i, ""));
  if ((await readBlacklist()).includes(name))
    throw new Error("该 Skill 已被加入黑名单");

  const sourceStat = await lstat(input.sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error("不允许复制符号链接");
  const extension = sourceStat.isFile() ? ".md" : "";
  const targetRoot = roots[input.targetAgent][0];
  const targetPath = join(targetRoot, `${name}${extension}`);
  if (!isPathInside(targetRoot, targetPath)) throw new Error("目标路径不合法");

  // 自删防护:目标与源相同或互为祖先/子孙时,覆盖删除会连源一起毁掉
  // (例如把 `~/.claude/skills/foo` 同步回 Claude Code 自身)。
  const sourceResolved = resolve(input.sourcePath);
  const targetResolved = resolve(targetPath);
  if (
    sourceResolved === targetResolved ||
    isPathInside(sourceResolved, targetResolved) ||
    isPathInside(targetResolved, sourceResolved)
  ) {
    throw new Error("源与目标路径重叠，已阻止操作");
  }

  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const targetExists = await lstat(targetPath)
    .then(() => true)
    .catch(() => false);
  if (targetExists) {
    if (!input.overwrite) throw new Error("目标位置已存在同名 Skill");
    await moveToTrash(targetPath, "overwrite", options);
  }
  await cp(input.sourcePath, targetPath, {
    recursive: sourceStat.isDirectory(),
    errorOnExist: true,
  });
  return targetPath;
}

export async function installLocalSkill(
  input: {
    sourcePath: string;
    targetAgent: SkillAgent;
  },
  options: SkillOpOptions = {},
): Promise<void> {
  const roots = resolveAgentRoots(
    options.homeDirectory ?? homedir(),
    process.env,
  );
  await assertManagedSkillPath(input.sourcePath, roots);
  const targetPath = await copySkillToAgent(input, options);
  await appendSkillOpLog(
    {
      action: "install",
      agent: input.targetAgent,
      source: resolve(input.sourcePath),
      target: resolve(targetPath),
    },
    options,
  );
  const originsFile = join(
    trusttoolsDirectoryFor(options),
    "skill-origins.json",
  );
  const origins = await readOrigins(originsFile);
  const sourceOrigin = origins.installations[resolve(input.sourcePath)];
  if (sourceOrigin) {
    origins.installations[resolve(targetPath)] = {
      ...sourceOrigin,
      installedAt: new Date().toISOString(),
    };
    await writeOrigins(origins, originsFile);
  }
}

export async function installMarketSkill(
  input: {
    sourcePath: string;
    targetAgent: SkillAgent;
    origin?: MarketSkillOriginInput;
  },
  options: SkillOpOptions = {},
): Promise<void> {
  await assertMarketSkillPath(input.sourcePath, options);
  const frontmatter = await readSkillManifest(input.sourcePath);
  const targetPath = await copySkillToAgent(input, options);
  await appendSkillOpLog(
    {
      action: "install-market",
      agent: input.targetAgent,
      source: resolve(input.sourcePath),
      target: resolve(targetPath),
    },
    options,
  );
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
    trusttoolsDirectoryFor(options),
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
  options: SkillOpOptions = {},
): Promise<{ path: string }> {
  const roots = resolveAgentRoots(
    options.homeDirectory ?? homedir(),
    process.env,
  );
  await assertManagedSkillPath(path, roots);
  const target = resolve(path);
  await moveToTrash(target, "uninstall", options);
  return { path: target };
}

export async function batchUninstallLocalSkills(
  paths: string[],
  options: SkillOpOptions = {},
): Promise<BatchUninstallResult> {
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) throw new Error("至少选择一个 Skill");

  const succeeded: string[] = [];
  const failed: { path: string; error: string }[] = [];
  for (const path of uniquePaths) {
    try {
      const result = await uninstallLocalSkill(path, options);
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

export async function syncLocalSkill(
  input: {
    sourcePath: string;
    targetAgents: string[];
    onConflict: "overwrite" | "skip";
  },
  options: SkillOpOptions = {},
): Promise<SkillSyncResult> {
  const roots = resolveAgentRoots(
    options.homeDirectory ?? homedir(),
    process.env,
  );
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
      const targetPath = await copySkillToAgent(
        {
          sourcePath: input.sourcePath,
          targetAgent: agent,
          overwrite: input.onConflict === "overwrite",
        },
        options,
      );
      await appendSkillOpLog(
        {
          action: "sync",
          agent,
          source: resolve(input.sourcePath),
          target: resolve(targetPath),
          onConflict: input.onConflict,
        },
        options,
      );
      const originsFile = join(
        trusttoolsDirectoryFor(options),
        "skill-origins.json",
      );
      const origins = await readOrigins(originsFile);
      const sourceOrigin = origins.installations[resolve(input.sourcePath)];
      if (sourceOrigin) {
        origins.installations[resolve(targetPath)] = {
          ...sourceOrigin,
          installedAt: new Date().toISOString(),
        };
        await writeOrigins(origins, originsFile);
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
