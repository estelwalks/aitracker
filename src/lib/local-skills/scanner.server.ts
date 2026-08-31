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
import { APP_DATA_DIR, MARKET_API_BASE } from "../app-config";
import { AppError } from "../errors";
import { AI_TOOLS } from "../tools/catalog.ts";
import { RUNTIME_POLICY } from "../../app/runtime-policy.generated.ts";
import { getTool } from "../tool-registry/registry.ts";
import {
  detectToolExecutables,
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
  type BatchUninstallFailure,
  type BatchUninstallResult,
  type LocalSkill,
  type SkillAgent,
  type SkillForm,
  type SkillInstallation,
  type SkillSource,
  type SkillSnapshot,
  type SkillSyncResult,
  type SyncFailure,
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

const MARKET_API = `${MARKET_API_BASE}/external-api/v1/skills`;
// Market-evidence freshness comes from the public runtime policy source
// (`skillMarketEvidence.freshForMinutes`); the old 5-minute magic constant
// has been removed (T0-05).
const MARKET_EVIDENCE_TTL_MS =
  RUNTIME_POLICY.snapshotPolicies.skillMarketEvidence.freshForMinutes *
  60 *
  1_000;

/** Text-ish extensions whose content counts toward the token estimate. */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".sh",
  ".css",
]);
/** Per-file cap when reading content (both measure and detail view). */
const MAX_TEXT_BYTES = 1_024 * 1_024;

/**
 * Walk a skill directory and compute its total byte size plus the character
 * count of readable text files (used to estimate context tokens). Dot entries
 * and symbolic links are skipped; unreadable files only count their size.
 */
async function measureSkillDirectory(
  root: string,
  signal?: AbortSignal,
): Promise<{ sizeBytes: number; chars: number }> {
  let sizeBytes = 0;
  let chars = 0;
  const stack = [root];
  while (stack.length > 0) {
    signal?.throwIfAborted();
    const directory = stack.pop()!;
    let handle;
    try {
      handle = await opendir(directory);
    } catch {
      continue; // Missing/unreadable directory: skip.
    }
    for await (const entry of handle) {
      signal?.throwIfAborted();
      if (entry.name.startsWith(".")) continue;
      const entryPath = join(directory, entry.name);
      let entryStat;
      try {
        entryStat = await lstat(entryPath);
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink()) continue;
      if (entryStat.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entryStat.isFile()) continue;
      sizeBytes += entryStat.size;
      const extension = entry.name.includes(".")
        ? entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()
        : "";
      if (TEXT_EXTENSIONS.has(extension) && entryStat.size <= MAX_TEXT_BYTES) {
        try {
          chars += (await readFile(entryPath, "utf8")).length;
        } catch {
          // Unreadable/binary: size already counted.
        }
      }
    }
  }
  return { sizeBytes, chars };
}

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

export interface SkillStateRepository {
  readOrigins(): Promise<MarketOriginsFile>;
  writeOrigins(value: MarketOriginsFile): Promise<void>;
  readBlacklist(): Promise<string[]>;
  writeBlacklist(names: string[]): Promise<void>;
}

const SKILL_STATE_NAMESPACE = "skill-state";
const ORIGINS_STATE_KEY = "market-origins";
const BLACKLIST_STATE_KEY = "blacklist";

async function defaultSkillStateRepository(): Promise<SkillStateRepository> {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  const cache = (await getCompositionRoot()).database.features.httpCache;
  return {
    async readOrigins() {
      const stored = (
        await cache.get<MarketOriginsFile>(
          SKILL_STATE_NAMESPACE,
          ORIGINS_STATE_KEY,
        )
      )?.payload ?? { version: 1, installations: {} };
      return {
        ...stored,
        installations: Object.fromEntries(
          Object.entries(stored.installations).map(([key, origin]) => [
            key,
            {
              ...origin,
              source: {
                ...origin.source,
                url: `https://github.com/${origin.source.repoOwner}/${origin.source.repoName}`,
              },
            },
          ]),
        ),
      };
    },
    async writeOrigins(value) {
      const now = Date.now();
      const stored = {
        ...value,
        installations: Object.fromEntries(
          Object.entries(value.installations).map(([key, origin]) => [
            key,
            {
              ...origin,
              source: { ...origin.source, url: null },
            },
          ]),
        ),
      };
      await cache.put({
        namespace: SKILL_STATE_NAMESPACE,
        key: ORIGINS_STATE_KEY,
        payload: stored,
        fetchedAtMs: now,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
      });
    },
    async readBlacklist() {
      return (
        (await cache.get<string[]>(SKILL_STATE_NAMESPACE, BLACKLIST_STATE_KEY))
          ?.payload ?? []
      );
    },
    async writeBlacklist(names) {
      const now = Date.now();
      await cache.put({
        namespace: SKILL_STATE_NAMESPACE,
        key: BLACKLIST_STATE_KEY,
        payload: [...new Set(names)].sort(),
        fetchedAtMs: now,
        expiresAtMs: Number.MAX_SAFE_INTEGER,
      });
    },
  };
}

function originKey(path: string): string {
  return createHash("sha256").update(resolve(path)).digest("hex");
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
  dataDirectory?: string;
  usageEvents?: LocalUsageEvent[];
  env?: Record<string, string | undefined>;
  /** P5-T5-03: real cancellation; checked before and during scans. */
  signal?: AbortSignal;
  /** Test seam for Windows-only deep cancellation behavior. */
  platform?: NodeJS.Platform;
  stateRepository?: SkillStateRepository;
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

async function skillState(options: {
  stateRepository?: SkillStateRepository;
}): Promise<SkillStateRepository> {
  return options.stateRepository ?? defaultSkillStateRepository();
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
    throw new AppError("errors.skills.invalidName");
  }
  return trimmed;
}

function isPathInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(resolve(root), resolve(candidate));
  return (
    pathFromRoot !== "" &&
    pathFromRoot !== ".." &&
    // Cross-drive paths: `relative()` returns the absolute target path on a
    // different drive (e.g. `D:\…` from `C:\…`), which is never inside.
    !isAbsolute(pathFromRoot) &&
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
    throw new AppError("errors.skills.pathOutsideManaged");

  const resolvedPath = resolve(path);
  let matchingRoot: string | null = null;
  let matchingAgent: SkillAgent | null = null;
  for (const agent of SKILL_AGENTS) {
    for (const root of roots[agent] ?? []) {
      const pathFromRoot = relative(resolve(root), resolvedPath);
      if (
        pathFromRoot === "" ||
        pathFromRoot === ".." ||
        // Cross-drive candidates (e.g. `D:\…` vs a `C:\…` root) produce an
        // absolute relative() result that must never count as "inside".
        isAbsolute(pathFromRoot) ||
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
    throw new AppError("errors.skills.pathOutsideManaged");
  }

  const [rootRealPath, candidateRealPath] = await Promise.all([
    realpath(matchingRoot),
    realpath(resolvedPath),
  ]);
  if (!isPathInside(rootRealPath, candidateRealPath)) {
    throw new AppError("errors.skills.symlinkEscape");
  }

  // Must point to a single Skill: directory containing marker, or `.md` file. Prevent putting collection directory/parent
  // Directories (such as `~/.claude/skills/development`) are used as uninstall, installation or synchronization targets, resulting in
  // The entire directory is recycled with `rm -rf`/.
  const rule = RULE_BY_AGENT.get(matchingAgent);
  const markers = rule?.markers ?? DEFAULT_MARKERS;
  const entryStat = await lstat(candidateRealPath);
  const isSingleSkill =
    (entryStat.isDirectory() &&
      (await findMarker(candidateRealPath, markers)) !== null) ||
    (entryStat.isFile() && /\.md$/iu.test(basename(candidateRealPath)));
  if (!isSingleSkill) {
    throw new AppError("errors.skills.notManagedDir");
  }
  return matchingAgent;
}

function containsParentTraversal(path: string): boolean {
  return path.split(/[\\/]+/u).includes("..");
}

/**
 * Injectable home/data directory (isomorphic with ScanOptions) for testing all Skills
 * Operations are isolated to temporary roots to avoid touching the real `~/.claude/skills`.
 */
interface SkillOpOptions {
  homeDirectory?: string;
  dataDirectory?: string;
  stateRepository?: SkillStateRepository;
}

/** Parse the injected data directory: explicit dataDirectory takes precedence, otherwise homeDirectory follows. */
function dataDirectoryFor(options: SkillOpOptions = {}): string {
  return resolve(
    options.dataDirectory ??
      join(options.homeDirectory ?? homedir(), APP_DATA_DIR),
  );
}

/**
 * Recoverable deletion: rename the entire target into the recycling directory and append the JSONL list.
 * Replaces irreversible `rm -rf`. The list is the audit record; `dataDirectory` can be injected
 * (for testing), default data directory.
 */
async function moveToTrash(
  targetPath: string,
  action: "uninstall" | "overwrite",
  options: SkillOpOptions = {},
): Promise<void> {
  const root = dataDirectoryFor(options);
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
      // The list and operation log will do their best to avoid rollback/false positive deletion failure due to accounting failure.
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
  throw new AppError("errors.skills.recycleWriteFailed");
}

/** Add a Skill operation log (do your best without blocking the main process). */
async function appendSkillOpLog(
  entry: Record<string, unknown>,
  options: SkillOpOptions = {},
): Promise<void> {
  const root = dataDirectoryFor(options);
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
  if (rootStat.isSymbolicLink())
    throw new AppError("errors.skills.marketSymlinkForbidden");
  if (!rootStat.isDirectory())
    throw new AppError("errors.skills.marketSourceNotDir");

  const directory = await opendir(root);
  for await (const entry of directory) {
    const entryPath = join(root, entry.name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink())
      throw new AppError("errors.skills.marketSourceSymlink");
    if (entryStat.isDirectory()) await assertNoSymbolicLinks(entryPath);
  }
}

async function assertMarketSkillPath(
  path: string,
  options: { homeDirectory?: string; dataDirectory?: string } = {},
): Promise<void> {
  if (!isAbsolute(path) || containsParentTraversal(path)) {
    throw new AppError("errors.skills.invalidSourcePath");
  }

  // The controlled temporary root follows the injected dataDirectory (test isolation), the default data directory /tmp.
  const temporaryRoot = join(dataDirectoryFor(options), "tmp");
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
    throw new AppError("errors.skills.sourceOutsideTemp");
  }

  await assertNoSymbolicLinks(path);
  const manifestPath = join(path, "SKILL.md");
  const manifestStat = await lstat(manifestPath);
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new AppError("errors.skills.marketRootNeedsSkillMd");
  }
}

/**
 * Find the first existing marker file inside `directoryPath`, in `markers`
 * order (exact-case match). Returns the marker file name or `null`.
 */
async function findMarker(
  directoryPath: string,
  markers: readonly string[],
  signal?: AbortSignal,
): Promise<string | null> {
  for (const marker of markers) {
    signal?.throwIfAborted();
    try {
      const markerStat = await stat(join(directoryPath, marker));
      if (markerStat.isFile()) return marker;
    } catch {
      // Missing (ENOENT) or unreadable — try the next marker.
    }
  }
  return null;
}

/**
 * Skill manifest shape → product form. Imported/migrated Skills in the wild
 * use `form`, `type`, `kind`, or `format`; accept all of them so the shape
 * tabs do not silently classify every non-standard manifest as a package.
 */
function formOf(frontmatter: Record<string, string>): SkillForm {
  const raw = [
    frontmatter.form,
    frontmatter.type,
    frontmatter.kind,
    frontmatter.format,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .trim()
    .toLowerCase();
  if (raw.includes("workflow")) return "workflow";
  if (raw.includes("prompt")) return "prompt";
  return "package";
}

interface SkillWalkContext {
  agent: string;
  rule: SkillAgentRule;
  origins: MarketOriginsFile;
  installations: Map<string, SkillInstallation[]>;
  descriptions: Map<string, string | null>;
  forms: Map<string, SkillForm>;
  signal?: AbortSignal;
}

async function recordSkill(
  skillPath: string,
  marker: string,
  context: SkillWalkContext,
): Promise<void> {
  context.signal?.throwIfAborted();
  const details = await stat(skillPath);
  const frontmatter = await readSkillManifest(skillPath, [marker]);
  const name = frontmatter.name?.trim() || basename(skillPath) || "Skill";
  if (!context.descriptions.has(name)) {
    context.descriptions.set(name, frontmatter.description ?? null);
  }
  if (!context.forms.has(name)) {
    context.forms.set(name, formOf(frontmatter));
  }
  const origin = context.origins.installations[originKey(skillPath)];
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
    isDistilled: frontmatter["aitracker-origin"] === "distilled",
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
  context.signal?.throwIfAborted();
  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch {
    return; // Missing/unreadable root: silently skipped.
  }

  const entries: { name: string; path: string }[] = [];
  for await (const entry of directory) {
    context.signal?.throwIfAborted();
    entries.push({ name: entry.name, path: join(directoryPath, entry.name) });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    context.signal?.throwIfAborted();
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
      context.signal,
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
  signal?: AbortSignal,
): Promise<{
  installations: Map<string, SkillInstallation[]>;
  descriptions: Map<string, string | null>;
  forms: Map<string, SkillForm>;
}> {
  const installations = new Map<string, SkillInstallation[]>();
  const descriptions = new Map<string, string | null>();
  const forms = new Map<string, SkillForm>();
  await Promise.all(
    SKILL_AGENTS.map(async (agent) => {
      signal?.throwIfAborted();
      const rule = RULE_BY_AGENT.get(agent);
      if (rule === undefined) return;
      const context: SkillWalkContext = {
        agent,
        rule,
        origins,
        installations,
        descriptions,
        forms,
        signal,
      };
      for (const root of roots[agent] ?? []) {
        signal?.throwIfAborted();
        await walkSkillDirectory(root, 0, context);
      }
    }),
  );
  return { installations, descriptions, forms };
}

export async function scanLocalSkills(
  options: ScanOptions = {},
): Promise<SkillSnapshot> {
  options.signal?.throwIfAborted();
  const traversalSignal =
    (options.platform ?? process.platform) === "win32"
      ? options.signal
      : undefined;
  const homeDirectory = options.homeDirectory ?? homedir();
  const now = options.now ?? new Date();
  const roots = resolveAgentRoots(homeDirectory, options.env ?? process.env);
  const state = await skillState(options);
  const [origins, blacklist, installationFacts] = await Promise.all([
    state.readOrigins(),
    state.readBlacklist(),
    detectToolInstallations(
      AI_TOOLS,
      homeDirectory,
      undefined,
      traversalSignal,
    ),
  ]);
  const agents = agentInstallationFacts(installationFacts);
  const { installations, descriptions, forms } = await scanInstallations(
    roots,
    origins,
    traversalSignal,
  );
  const usageEvidence = skillUsageEvidence(options.usageEvents ?? []);

  const skills: LocalSkill[] = [...installations.entries()]
    .map(([name, entries]) => {
      const usage = usageEvidence.get(name.toLowerCase());
      return {
        id: name,
        name,
        description: descriptions.get(name) ?? null,
        form: forms.get(name) ?? null,
        lastUsedAt:
          usage == null ? null : new Date(usage.lastUsedAt).toISOString(),
        sizeBytes: 0,
        tokenEstimate: 0,
        installations: entries.sort((a, b) => a.agent.localeCompare(b.agent)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Measure each skill's directory from its first installation copy.
  // P5-T5-03: stop launching further directory I/O when cancelled.
  const measures = await Promise.all(
    skills.map(async (skill) => {
      traversalSignal?.throwIfAborted();
      const firstPath = skill.installations[0]?.path;
      if (!firstPath) return { sizeBytes: 0, tokenEstimate: 0 };
      const { sizeBytes, chars } = await measureSkillDirectory(
        firstPath,
        traversalSignal,
      );
      return { sizeBytes, tokenEstimate: Math.round(chars / 4) };
    }),
  );
  skills.forEach((skill, index) => {
    const measure = measures[index];
    if (measure) {
      skill.sizeBytes = measure.sizeBytes;
      skill.tokenEstimate = measure.tokenEstimate;
    }
  });

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        skills: skills.map((skill) => ({
          name: skill.name,
          description: skill.description,
          form: skill.form,
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

/** One readable file inside a skill directory (browser-safe path + content). */
export interface SkillFileEntry {
  /** Directory-relative path, e.g. `SKILL.md` or `references/usage.md`. */
  path: string;
  content: string;
}

/** Full skill directory listing resolved server-side for the detail view. */
export interface SkillFileList {
  name: string;
  /** Display root (the skill directory basename). */
  root: string;
  files: SkillFileEntry[];
}

/**
 * Read the real file tree of a locally installed skill. The skill is resolved
 * by name from a fresh scan (never from caller-supplied paths), verified
 * against the managed skill roots (rejecting traversal / symlink escape), then
 * walked recursively for readable text files. Binary files and files larger
 * than the text cap are skipped rather than read into memory.
 */
export async function readSkillFiles(
  name: string,
  options: ScanOptions = {},
): Promise<SkillFileList> {
  const safeName = safeSkillName(name);
  const snapshot = await scanLocalSkills(options);
  const skill = snapshot.skills.find((item) => item.name === safeName);
  const rootPath = skill?.installations[0]?.path;
  if (skill === undefined || rootPath === undefined)
    throw new AppError("errors.skills.notFound");

  await assertManagedSkillPath(rootPath, snapshot.roots);

  const files: SkillFileEntry[] = [];
  const stack = [rootPath];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    let handle;
    try {
      handle = await opendir(directory);
    } catch {
      continue;
    }
    for await (const entry of handle) {
      if (entry.name.startsWith(".")) continue;
      const entryPath = join(directory, entry.name);
      let entryStat;
      try {
        entryStat = await lstat(entryPath);
      } catch {
        continue;
      }
      if (entryStat.isSymbolicLink()) continue;
      if (entryStat.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entryStat.isFile() || entryStat.size > MAX_TEXT_BYTES) continue;
      const extension = entry.name.includes(".")
        ? entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase()
        : "";
      if (!TEXT_EXTENSIONS.has(extension)) continue;
      let content;
      try {
        content = await readFile(entryPath, "utf8");
      } catch {
        continue; // Unreadable/binary: skip.
      }
      files.push({
        path: relative(rootPath, entryPath),
        content,
      });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name: safeName, root: basename(rootPath), files };
}

/**
 * Pre-installation verification: The target tool must be truly installed, otherwise writing will be refused and a clear prompt will be given.
 *
 * The configuration directory of IDE tools (such as Cursor) may be leftover from the application or even written by the application.
 * The skill directory is created by the way, which is not enough to prove that the tool itself has been installed - so it is declared
 * IDE tools for `detection.executable` require that the corresponding executable file exists in PATH
 * (Cursor’s `cursor` command). The CLI tool follows the loose judgment of directory detection to avoid accidental damage.
 * Tools that are installed but do not have the CLI in PATH (e.g. Gemini CLI / Grok Build).
 *
 * Execute only under production home (without `homeDirectory` injected) - test injected temporary home does not
 * This verification is triggered to keep the isolated test independent of the real machine environment.
 */
export async function assertTargetToolInstalled(
  targetAgent: SkillAgent,
  options: SkillOpOptions = {},
): Promise<void> {
  // Isolated homes injected by tests/tools do not perform real environment verification.
  if (options.homeDirectory != null) return;
  const rule = RULE_BY_AGENT.get(targetAgent);
  const tool = rule
    ? AI_TOOLS.find((candidate) => candidate.id === rule.toolId)
    : undefined;
  if (!tool) return;
  if (tool.toolSurface !== "ide") return;
  const toolDef = getTool(tool.id);
  const executables = toolDef?.detection.executable ?? [];
  if (executables.length === 0) return;
  const found = await detectToolExecutables([tool]);
  if ((found.get(tool.id)?.length ?? 0) === 0) {
    throw new AppError("errors.skills.toolNotInstalled", {
      agent: targetAgent,
    });
  }
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
    throw new AppError("errors.skills.unsupportedAgent");

  // Tools that are not installed do not accept install/sync writes (e.g. have a residual ~/.cursor directory but no
  // When using Cursor, explicitly prompt that the tool is not installed instead of pretending to be successful).
  await assertTargetToolInstalled(input.targetAgent, options);

  const roots = resolveAgentRoots(
    options.homeDirectory ?? homedir(),
    process.env,
  );
  const name = safeSkillName(basename(input.sourcePath).replace(/\.md$/i, ""));
  if ((await (await skillState(options)).readBlacklist()).includes(name))
    throw new AppError("errors.skills.blacklisted");

  const sourceStat = await lstat(input.sourcePath);
  if (sourceStat.isSymbolicLink())
    throw new AppError("errors.skills.copySymlinkForbidden");
  const extension = sourceStat.isFile() ? ".md" : "";
  const targetRoot = roots[input.targetAgent][0];
  const targetPath = join(targetRoot, `${name}${extension}`);
  if (!isPathInside(targetRoot, targetPath))
    throw new AppError("errors.skills.invalidTargetPath");

  // Self-deletion protection: When the target and the source are the same or ancestors/descendants of each other, overwriting and deleting will destroy the source together.
  // (e.g. sync `~/.claude/skills/foo` back to Claude Code itself).
  const sourceResolved = resolve(input.sourcePath);
  const targetResolved = resolve(targetPath);
  if (
    sourceResolved === targetResolved ||
    isPathInside(sourceResolved, targetResolved) ||
    isPathInside(targetResolved, sourceResolved)
  ) {
    throw new AppError("errors.skills.overlappingPaths");
  }

  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  const targetExists = await lstat(targetPath)
    .then(() => true)
    .catch(() => false);
  if (targetExists) {
    if (!input.overwrite) throw new AppError("errors.skills.duplicateName");
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
  const state = await skillState(options);
  const origins = await state.readOrigins();
  const sourceOrigin = origins.installations[originKey(input.sourcePath)];
  if (sourceOrigin) {
    origins.installations[originKey(targetPath)] = {
      ...sourceOrigin,
      installedAt: new Date().toISOString(),
    };
    await state.writeOrigins(origins);
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
  const state = await skillState(options);
  const origins = await state.readOrigins();
  origins.installations[originKey(targetPath)] = {
    source,
    installedAt: now,
    localVersion,
    installedRemoteVersion: input.origin.version ?? localVersion,
    installedRemoteUpdatedAt: input.origin.updatedAt ?? null,
    latestRemoteVersion: input.origin.version ?? localVersion,
    latestRemoteUpdatedAt: input.origin.updatedAt ?? null,
    checkedAt: now,
  };
  await state.writeOrigins(origins);
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
    dataDirectory?: string;
    stateRepository?: SkillStateRepository;
    fetcher?: typeof fetch;
    now?: Date;
    force?: boolean;
  } = {},
): Promise<boolean> {
  const state = await skillState(options);
  const origins = await state.readOrigins();
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
  if (changed) await state.writeOrigins(origins);
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
  if (uniquePaths.length === 0)
    throw new AppError("errors.skills.noSkillSelected");

  const succeeded: string[] = [];
  const failed: BatchUninstallFailure[] = [];
  for (const path of uniquePaths) {
    try {
      const result = await uninstallLocalSkill(path, options);
      succeeded.push(result.path);
    } catch (error) {
      const ui =
        error instanceof AppError
          ? { code: error.code, params: error.params }
          : null;
      failed.push({
        path,
        errorCode: ui?.code ?? "errors.generic",
        errorParams: ui?.params,
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
  const failed: SyncFailure[] = [];

  for (const targetAgent of input.targetAgents) {
    if (!SKILL_AGENTS.includes(targetAgent as SkillAgent)) {
      failed.push({
        agent: targetAgent,
        errorCode: "errors.skills.unsupportedAgent",
      });
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
      const state = await skillState(options);
      const origins = await state.readOrigins();
      const sourceOrigin = origins.installations[originKey(input.sourcePath)];
      if (sourceOrigin) {
        origins.installations[originKey(targetPath)] = {
          ...sourceOrigin,
          installedAt: new Date().toISOString(),
        };
        await state.writeOrigins(origins);
      }
      succeeded.push({ agent, path: targetPath });
    } catch (error) {
      const ui =
        error instanceof AppError
          ? { code: error.code, params: error.params }
          : null;
      if (
        input.onConflict === "skip" &&
        ui?.code === "errors.skills.duplicateName"
      ) {
        skipped.push({ agent, reason: "conflict" });
      } else {
        failed.push({
          agent,
          errorCode: ui?.code ?? "errors.generic",
          errorParams: ui?.params,
        });
      }
    }
  }
  return { succeeded, skipped, failed };
}

export async function setSkillBlacklisted(
  name: string,
  blocked: boolean,
  options: SkillOpOptions = {},
): Promise<void> {
  const safeName = safeSkillName(name);
  const state = await skillState(options);
  const current = await state.readBlacklist();
  const next = blocked
    ? [...new Set([...current, safeName])]
    : current.filter((item) => item !== safeName);
  await state.writeBlacklist(next);
}
