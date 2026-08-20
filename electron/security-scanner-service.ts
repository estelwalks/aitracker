import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import {
  ModelConfigSchema,
  RISK_KINDS,
  ScanSkillReportSchema,
  scanSkill,
  type ModelConfig,
  type ScanSkillReport,
} from "skill-scanner";

import {
  SECURITY_SCAN_CYCLES,
  SECURITY_SCAN_SCOPES,
  type DesktopLocale,
  type SecurityRuntimeCapability,
  type SecurityScanCycle,
  type SecurityScanHistoryEntry,
  type SecurityScanMode,
  type SecurityScanReportDto,
  type SecurityScanSchedule,
  type SecurityScanScope,
  type SecurityScanStartRequest,
  type SecurityScanState,
  type SecurityScanTrigger,
  type SecuritySkillTarget,
} from "./contracts.js";

const MAX_FILES = 500;
const MAX_DEPTH = 6;
const MAX_FILE_BYTES = 1_000_000;
const MAX_TOTAL_BYTES = 20_000_000;
const MAX_HISTORY = 200;
const HISTORY_VERSION = 1;

interface SkillFile {
  path: string;
  content: string;
  isBinary?: boolean;
  byteSize?: number;
}

interface ManagedSkillRoot {
  agent: string;
  suffixes: readonly string[];
  envHome?: string;
}

const MANAGED_SKILL_ROOTS: readonly ManagedSkillRoot[] = [
  { agent: "Claude Code", suffixes: [".claude/skills"] },
  { agent: "Codex", suffixes: [".codex/skills"], envHome: "CODEX_HOME" },
  { agent: "Gemini CLI", suffixes: [".gemini/skills"] },
  { agent: "Cursor", suffixes: [".cursor/skills"] },
  {
    agent: "Antigravity",
    suffixes: [".gemini/antigravity/skills", ".gemini/antigravity-ide/skills"],
  },
  { agent: "OpenClaw", suffixes: [".openclaw/workspace/skills"] },
  { agent: "OpenCode", suffixes: [".config/opencode/skills"] },
  { agent: "Grok Build", suffixes: [".grok/skills"], envHome: "GROK_HOME" },
  { agent: "Hermes Agent", suffixes: [".hermes/skills"] },
];

interface TrustedSkill {
  readonly target: SecuritySkillTarget;
  readonly root: string;
}

interface HistoryDocument {
  version: 1;
  entries: SecurityScanHistoryEntry[];
}

export interface SecretStoragePort {
  isEncryptionAvailable(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export interface SecurityScannerServiceOptions {
  readonly homeDirectory: string;
  readonly locale: () => DesktopLocale;
  readonly secretStorage: SecretStoragePort;
  readonly persistence?: SecurityScannerPersistence;
  readonly env?: Record<string, string | undefined>;
  readonly now?: () => Date;
  readonly scanner?: typeof scanSkill;
  /** Deterministic TOCTOU test hook; production never supplies it. */
  readonly beforeOpenFile?: (path: string) => Promise<void>;
}

export interface SecurityScannerPersistence {
  readHistory(): Promise<SecurityScanHistoryEntry[]>;
  writeHistory(entries: readonly SecurityScanHistoryEntry[]): Promise<void>;
  clearHistory(): Promise<void>;
  readSchedule(): Promise<SecurityScanSchedule | null>;
  writeSchedule(schedule: SecurityScanSchedule): Promise<void>;
  modelConfig(): Promise<ModelConfig | undefined>;
}

interface CollectedSkill {
  files: SkillFile[];
  hostSkipped: SecurityScanReportDto["skippedFiles"];
}

/** Default automatic-scan schedule for a new SQLite database with no row. */
const DEFAULT_SCAN_SCHEDULE: SecurityScanSchedule = {
  enabled: true,
  cycle: "daily",
  time: "03:00",
  scope: "all",
  agents: [],
  dir: null,
  notify: false,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/u;

function parseSchedule(input: unknown): SecurityScanSchedule {
  if (input == null || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Scan schedule is required");
  const value = input as Record<string, unknown>;
  const allowed = new Set([
    "enabled",
    "cycle",
    "time",
    "scope",
    "notify",
    "agents",
    "dir",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new TypeError("Scan schedule contains unsupported fields");
  if (typeof value.enabled !== "boolean")
    throw new TypeError("Scan schedule enabled must be a boolean");
  const cycle = value.cycle;
  if (
    typeof cycle !== "string" ||
    !(SECURITY_SCAN_CYCLES as readonly string[]).includes(cycle)
  )
    throw new TypeError("Unsupported scan cycle");
  const time = value.time;
  if (typeof time !== "string" || !TIME_PATTERN.test(time))
    throw new TypeError("Scan schedule time must be a 24h HH:MM string");
  const scope = value.scope;
  if (
    typeof scope !== "string" ||
    !(SECURITY_SCAN_SCOPES as readonly string[]).includes(scope)
  )
    throw new TypeError("Unsupported scan scope");
  const agents = value.agents;
  if (
    !Array.isArray(agents) ||
    agents.some((item) => typeof item !== "string" || !item.trim())
  )
    throw new TypeError("Scan schedule agents must be an array of strings");
  const dir = value.dir;
  if (dir !== null && typeof dir !== "string")
    throw new TypeError("Scan schedule dir must be a string or null");
  const notify = value.notify;
  if (typeof notify !== "boolean")
    throw new TypeError("Scan schedule notify must be a boolean");
  return {
    enabled: value.enabled,
    cycle: cycle as SecurityScanCycle,
    time,
    scope: scope as SecurityScanScope,
    agents: [...new Set(agents.map((item) => item.trim()).filter(Boolean))],
    // Empty-string dir normalizes to null; `resolve("")` would hit the cwd.
    dir: typeof dir === "string" && dir.trim() === "" ? null : dir,
    notify,
  };
}

function skillRef(path: string): SecuritySkillTarget["skillRef"] {
  return `skill:${createHash("sha256").update(resolve(path)).digest("hex")}`;
}

function safeDisplayName(candidate: string, fallback: string): string {
  const cleaned = Array.from(candidate, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  })
    .join("")
    .trim();
  if (!cleaned || cleaned.includes("/") || cleaned.includes("\\"))
    return fallback.slice(0, 160) || "Skill";
  return cleaned.slice(0, 160);
}

function scanId(): `scan:${string}` {
  return `scan:${randomUUID()}`;
}

function isSafeRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 1024 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    path
      .split("/")
      .every((part) => part !== "" && part !== "." && part !== "..")
  );
}

function isWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!fromRoot.startsWith(`..${sep}`) &&
      fromRoot !== ".." &&
      !fromRoot.startsWith(sep))
  );
}

function sanitizeText(
  input: string | undefined,
  maximum: number,
  exactSecrets: readonly string[] = [],
): string | undefined {
  if (input == null) return undefined;
  let value = Array.from(input, (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  for (const secret of exactSecrets) {
    if (secret) value = value.split(secret).join("[redacted-secret]");
  }
  value = value
    .replace(
      /https?:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+/giu,
      "[redacted-secret]",
    )
    .replace(
      /\b(?:sk|key|token|secret)-[A-Za-z0-9_-]{8,}\b/gu,
      "[redacted-secret]",
    )
    .replace(
      /\bBearer\s+[A-Za-z0-9._~+/-]{8,}\b/giu,
      "Bearer [redacted-secret]",
    )
    .replace(
      /\b(api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]{4,}/giu,
      "$1=[redacted-secret]",
    )
    .replace(/file:\/\/\/?[^\s"'<>]+/giu, "[redacted-path]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s"'<>]+\\)*[^\s"'<>]*/gu, "[redacted-path]")
    .replace(/(^|[^:/])\/(?:[^/\s"'<>]+\/)*[^/\s"'<>]+/gmu, "$1[redacted-path]")
    .replace(/\s+/gu, " ")
    .trim();
  return value.slice(0, maximum);
}

function scannerSkipReasonCode(
  reason: string,
): SecurityScanReportDto["skippedFiles"][number]["reasonCode"] {
  const normalized = reason.toLowerCase();
  if (normalized.includes("binary")) return "binary";
  if (normalized.includes("large") || normalized.includes("size"))
    return "file-size-limit";
  return "scanner-skip";
}

const SKIP_REASON_CODES = new Set<
  SecurityScanReportDto["skippedFiles"][number]["reasonCode"]
>([
  "unavailable",
  "symlink",
  "depth-limit",
  "file-limit",
  "skill-size-limit",
  "file-size-limit",
  "binary",
  "scanner-skip",
]);

const EMPTY_TOKEN_USAGE = {
  status: "not_applicable" as const,
  requestCount: 0,
  reportedRequestCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  byModel: {},
  byBranch: {},
};

/**
 * Stable content hash over the collected files, mirroring the `skill-scanner`
 * package's `contentHash`: sorted relative paths + NUL + content. Two install
 * copies of the same skill (different absolute paths) produce the same hash,
 * so it is the dedup/skip key for unchanged skills.
 */
function contentHashOf(
  files: readonly { path: string; content: string }[],
): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path).update("\0").update(file.content);
  }
  return hash.digest("hex");
}

function sanitizeReport(
  report: ScanSkillReport | SecurityScanReportDto,
  exactSecrets: readonly string[] = [],
): SecurityScanReportDto {
  const rawSkipped = report.skippedFiles;
  const parsed = ScanSkillReportSchema.parse({
    ...report,
    // Renderer-safe history DTOs created before token usage became mandatory
    // do not expose accounting data. Keep them readable without weakening the
    // scanner's validation of newly returned reports.
    tokenUsage: "tokenUsage" in report ? report.tokenUsage : EMPTY_TOKEN_USAGE,
    skippedFiles: rawSkipped.map((item) => ({
      path: item.path,
      reason: item.reason,
    })),
  });
  const paths = [
    ...parsed.findings.map((item) => item.path),
    ...parsed.rules.flatMap((rule) => rule.matches.map((match) => match.path)),
    ...parsed.skippedFiles.map((item) => item.path),
  ];
  if (paths.some((path) => !isSafeRelativePath(path)))
    throw new Error("Scanner returned an unsafe path");
  return {
    status: parsed.status,
    mode: parsed.mode,
    verdict: parsed.verdict,
    riskScore: parsed.riskScore,
    rulesVersion:
      sanitizeText(parsed.rulesVersion, 128, exactSecrets) ?? "unknown",
    engineVersion:
      sanitizeText(parsed.engineVersion, 128, exactSecrets) ?? "unknown",
    locale: parsed.locale,
    contentHash: parsed.contentHash,
    scannedFiles: parsed.scannedFiles,
    threatLevel: parsed.threatLevel,
    threatLevelDisplay:
      sanitizeText(parsed.threatLevelDisplay, 120, exactSecrets) ??
      parsed.threatLevel,
    categories: Object.fromEntries(
      Object.entries(parsed.categories).map(([kind, bucket]) => [
        kind,
        {
          count: bucket.count,
          highestSeverity: bucket.highestSeverity,
          totalWeight: bucket.totalWeight,
          display: sanitizeText(bucket.display, 120, exactSecrets) ?? kind,
        },
      ]),
    ),
    summary: sanitizeText(parsed.summary, 1_000, exactSecrets) ?? "",
    findings: parsed.findings.map((finding) => ({
      id: finding.id,
      kind: finding.kind,
      severity: finding.severity,
      source: finding.source,
      kindDisplay:
        sanitizeText(finding.kindDisplay, 120, exactSecrets) ?? finding.kind,
      severityDisplay:
        sanitizeText(finding.severityDisplay, 80, exactSecrets) ??
        finding.severity,
      ...(finding.ruleId == null
        ? {}
        : {
            ruleId:
              sanitizeText(finding.ruleId, 128, exactSecrets) ?? "unknown",
          }),
      ruleName: sanitizeText(finding.ruleName, 240, exactSecrets) ?? "",
      message: sanitizeText(finding.message, 1_000, exactSecrets) ?? "",
      remediation: sanitizeText(finding.remediation, 1_000, exactSecrets) ?? "",
      weight: finding.weight,
      ...(finding.cweId == null
        ? {}
        : { cweId: sanitizeText(finding.cweId, 64, exactSecrets) }),
      ...(finding.bypassVerification == null
        ? {}
        : { bypassVerification: finding.bypassVerification }),
      path: finding.path,
      ...(finding.line == null ? {} : { line: finding.line }),
      ...(finding.excerpt == null
        ? {}
        : { excerpt: sanitizeText(finding.excerpt, 240, exactSecrets) }),
      ...(finding.fileHash == null ? {} : { fileHash: finding.fileHash }),
      ...(finding.reasoning == null
        ? {}
        : { reasoning: sanitizeText(finding.reasoning, 500, exactSecrets) }),
    })),
    rules: parsed.rules.map((rule) => ({
      ruleId: sanitizeText(rule.ruleId, 128, exactSecrets) ?? "unknown",
      ruleName: sanitizeText(rule.ruleName, 240, exactSecrets) ?? "",
      kind: rule.kind,
      severity: rule.severity,
      weight: rule.weight,
      ...(rule.cweId == null
        ? {}
        : { cweId: sanitizeText(rule.cweId, 64, exactSecrets) }),
      count: rule.count,
      matches: rule.matches.map((match) => ({
        path: match.path,
        ...(match.line == null ? {} : { line: match.line }),
        ...(match.excerpt == null
          ? {}
          : { excerpt: sanitizeText(match.excerpt, 240, exactSecrets) }),
        ...(match.fileHash == null ? {} : { fileHash: match.fileHash }),
      })),
    })),
    branches: parsed.branches.map((branch) => ({
      name: branch.name,
      status: branch.status,
      ...(branch.detail == null
        ? {}
        : { detail: sanitizeText(branch.detail, 240, exactSecrets) }),
    })),
    skippedFiles: parsed.skippedFiles.map((file, index) => ({
      path: file.path,
      reasonCode:
        "reasonCode" in rawSkipped[index] &&
        SKIP_REASON_CODES.has(rawSkipped[index].reasonCode)
          ? rawSkipped[index].reasonCode
          : scannerSkipReasonCode(file.reason),
      reason: sanitizeText(file.reason, 240, exactSecrets) ?? "scanner-skip",
    })),
  };
}

function parseHistoryEntry(
  value: unknown,
  exactSecrets: readonly string[] = [],
): SecurityScanHistoryEntry | null {
  if (value == null || typeof value !== "object" || Array.isArray(value))
    return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" ||
    typeof item.scanId !== "string" ||
    !/^scan:[a-f0-9-]{36}$/u.test(item.scanId) ||
    typeof item.skillRef !== "string" ||
    !/^skill:[a-f0-9]{64}$/u.test(item.skillRef) ||
    typeof item.skillName !== "string" ||
    (item.mode !== "quick" && item.mode !== "full") ||
    (item.trigger !== "manual" && item.trigger !== "automatic") ||
    !["zh-CN", "en-US", "ja-JP", "ko-KR"].includes(String(item.locale)) ||
    !["complete", "partial", "failed", "skipped", "cancelled"].includes(
      String(item.status),
    ) ||
    typeof item.startedAt !== "string" ||
    !Number.isFinite(Date.parse(item.startedAt)) ||
    typeof item.finishedAt !== "string" ||
    !Number.isFinite(Date.parse(item.finishedAt))
  )
    return null;
  let report: SecurityScanReportDto | undefined;
  if (item.report !== undefined) {
    try {
      report = sanitizeReport(item.report as ScanSkillReport, exactSecrets);
    } catch {
      return null;
    }
  }
  return {
    id: item.id.slice(0, 160),
    scanId: item.scanId as SecurityScanHistoryEntry["scanId"],
    skillRef: item.skillRef as SecurityScanHistoryEntry["skillRef"],
    skillName: safeDisplayName(item.skillName, "Skill"),
    mode: item.mode,
    trigger: item.trigger,
    locale: item.locale as DesktopLocale,
    status: item.status as SecurityScanHistoryEntry["status"],
    startedAt: item.startedAt,
    finishedAt: item.finishedAt,
    ...(report == null ? {} : { report }),
    ...(typeof item.errorCode === "string"
      ? { errorCode: item.errorCode.slice(0, 160) }
      : {}),
  };
}

function emptyState(): SecurityScanState {
  return {
    scanId: null,
    status: "idle",
    mode: null,
    trigger: null,
    locale: null,
    progress: {
      discovered: 0,
      queued: 0,
      started: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      percent: 0,
    },
    resultIds: [],
  };
}

function cloneState(state: SecurityScanState): SecurityScanState {
  return structuredClone(state);
}

export class SecurityScannerService {
  readonly #options: SecurityScannerServiceOptions;
  readonly #persistence: SecurityScannerPersistence;
  readonly #trusted = new Map<string, TrustedSkill>();
  #state = emptyState();
  #cancelRequested = false;
  #epoch = 0;
  #historyQueue: Promise<void> = Promise.resolve();
  #scheduleQueue: Promise<void> = Promise.resolve();
  #activeRun: Promise<void> | null = null;
  #clearing = false;

  constructor(options: SecurityScannerServiceOptions) {
    this.#options = options;
    const testPersistence = (
      options.secretStorage as SecretStoragePort & {
        readonly testPersistence?: SecurityScannerPersistence;
      }
    ).testPersistence;
    const persistence = options.persistence ?? testPersistence;
    if (!persistence)
      throw new Error("SQLite security scanner persistence is required");
    this.#persistence = persistence;
  }

  getRuntimeCapability(): SecurityRuntimeCapability {
    return {
      capability: "detection-only",
      activeDefense: false,
      monitorAvailable: true,
      evidence: "local-static-and-model-analysis",
      cancellation: "between-skills",
      riskKinds: [...RISK_KINDS],
    };
  }

  async listSkills(): Promise<SecuritySkillTarget[]> {
    const grouped = new Map<string, TrustedSkill>();
    for (const definition of MANAGED_SKILL_ROOTS) {
      for (const suffix of definition.suffixes) {
        const override =
          definition.envHome == null
            ? undefined
            : this.#options.env?.[definition.envHome];
        const root = override
          ? join(override, basename(suffix))
          : join(this.#options.homeDirectory, suffix);
        await this.#discoverRoot(root, definition.agent, grouped);
      }
    }
    for (const [ref, value] of grouped) this.#trusted.set(ref, value);
    return [...grouped.values()]
      .map((item) => item.target)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async registerSelectedDirectory(path: string): Promise<SecuritySkillTarget> {
    const root = resolve(path);
    const details = await lstat(root);
    if (details.isSymbolicLink() || !details.isDirectory())
      throw new Error("Selected Skill must be a real directory");
    const marker = await this.#findMarker(root);
    if (marker == null)
      throw new Error("Selected directory is missing SKILL.md");
    const target: SecuritySkillTarget = {
      skillRef: skillRef(root),
      name: this.#skillName(root),
      agents: [],
      modifiedAt: details.mtime.toISOString(),
      source: "selected",
    };
    this.#trusted.set(target.skillRef, { target, root });
    return structuredClone(target);
  }

  getStatus(): SecurityScanState {
    return cloneState(this.#state);
  }

  cancel(): { cancelled: boolean } {
    if (this.#state.status !== "running" && this.#state.status !== "cancelling")
      return { cancelled: false };
    this.#cancelRequested = true;
    this.#state.status = "cancelling";
    return { cancelled: true };
  }

  async start(input: unknown): Promise<SecurityScanState> {
    if (this.#clearing) throw new Error("Security scanner is being cleared");
    if (this.#state.status === "running" || this.#state.status === "cancelling")
      throw new Error("A security scan is already running");
    const request = this.#parseStartRequest(input);
    const startingEpoch = this.#epoch;
    if (request.mode === "full" && !(await this.#modelConfig())) {
      if (startingEpoch !== this.#epoch)
        throw new Error("Security scan was cleared");
      this.#state = {
        ...emptyState(),
        scanId: scanId(),
        status: "model-required",
        mode: request.mode,
        trigger: request.trigger,
        locale: this.#options.locale(),
        finishedAt: this.#now(),
        errorCode: "security.modelRequired",
      };
      return this.getStatus();
    }

    const discovered = await this.listSkills();
    if (startingEpoch !== this.#epoch)
      throw new Error("Security scan was cleared");
    const targets = this.#resolveTargets(discovered, {
      scope: request.scope,
      skillRef: request.skillRef,
    });
    return this.#executeScan(
      discovered,
      targets,
      request.mode,
      request.trigger,
    );
  }

  /**
   * Scope-based target selection. "single"/"all" mirror the public start
   * contract; "agent" narrows by skill agents, "dir" by skill root path prefix
   * (roots live only on the private #trusted map, so dir filtering consults it).
   */
  #resolveTargets(
    discovered: SecuritySkillTarget[],
    options: {
      scope: SecurityScanScope | "single";
      skillRef?: SecuritySkillTarget["skillRef"];
      agents?: readonly string[];
      dir?: string | null;
    },
  ): SecuritySkillTarget[] {
    switch (options.scope) {
      case "single": {
        const trusted = options.skillRef
          ? this.#trusted.get(options.skillRef)
          : undefined;
        return trusted ? [trusted.target] : [];
      }
      case "all":
        return discovered;
      case "agent": {
        const wanted = new Set(options.agents ?? []);
        if (wanted.size === 0) return [];
        return discovered.filter((target) =>
          target.agents.some((agent) => wanted.has(agent)),
        );
      }
      case "dir": {
        const dir = options.dir ? resolve(options.dir) : "";
        if (!dir) return [];
        // Exact match (user picked the skill dir itself) or path-prefix with a
        // separator so `/a/foo` never matches `/a/foobar/skill`.
        const prefix = dir.endsWith(sep) ? dir : `${dir}${sep}`;
        return discovered.filter((target) => {
          const trusted = this.#trusted.get(target.skillRef);
          return (
            trusted != null &&
            (trusted.root === dir || trusted.root.startsWith(prefix))
          );
        });
      }
    }
  }

  /** Run the scan over the already-resolved target list and wire completion. */
  #executeScan(
    discovered: SecuritySkillTarget[],
    targets: SecuritySkillTarget[],
    mode: SecurityScanMode,
    trigger: SecurityScanTrigger,
  ): SecurityScanState {
    if (targets.length === 0)
      throw new Error("No trusted Skill target was found");

    const id = scanId();
    const epoch = ++this.#epoch;
    const locale = this.#options.locale();
    const startedAt = this.#now();
    this.#cancelRequested = false;
    this.#state = {
      scanId: id,
      status: "running",
      mode,
      trigger,
      locale,
      startedAt,
      progress: {
        discovered: discovered.length,
        queued: targets.length,
        started: 0,
        completed: 0,
        failed: 0,
        skipped: 0,
        percent: 0,
      },
      resultIds: [],
    };
    const activeRun = this.#run(id, epoch, locale, targets, { mode, trigger });
    this.#activeRun = activeRun;
    void activeRun
      .catch(() => {
        if (!this.#isActive(id, epoch)) return;
        this.#state = {
          ...this.#state,
          status: "failed",
          finishedAt: this.#now(),
          errorCode: "security.scanFailed",
        };
        delete this.#state.currentSkill;
        this.#cancelRequested = false;
      })
      .finally(() => {
        if (this.#activeRun === activeRun) this.#activeRun = null;
      });
    return this.getStatus();
  }

  /**
   * Model-aware scheduler boundary: full when a model is configured, else quick.
   * Honors the persisted schedule's scope (all / agent / dir); an omitted
   * schedule scans everything (back-compat for existing callers and tests).
   */
  async startAutomaticScan(
    schedule?: SecurityScanSchedule,
  ): Promise<SecurityScanState> {
    if (this.#clearing) throw new Error("Security scanner is being cleared");
    if (this.#state.status === "running" || this.#state.status === "cancelling")
      throw new Error("A security scan is already running");
    const mode = (await this.#modelConfig()) ? "full" : "quick";
    const startingEpoch = this.#epoch;
    const discovered = await this.listSkills();
    if (startingEpoch !== this.#epoch)
      throw new Error("Security scan was cleared");
    const scope = schedule?.scope ?? "all";
    const targets = this.#resolveTargets(discovered, {
      scope,
      agents: scope === "agent" ? schedule?.agents : undefined,
      dir: scope === "dir" ? schedule?.dir : undefined,
    });
    return this.#executeScan(discovered, targets, mode, "automatic");
  }

  async history(): Promise<SecurityScanHistoryEntry[]> {
    return this.#withHistoryLock(async () =>
      structuredClone((await this.#readHistory()).entries),
    );
  }

  async clear(): Promise<void> {
    if (this.#clearing) throw new Error("Security scanner is being cleared");
    this.#clearing = true;
    const clearEpoch = ++this.#epoch;
    try {
      this.#cancelRequested = true;
      this.#state = emptyState();
      await this.#activeRun?.catch(() => undefined);
      await this.#withHistoryLock(() => this.#persistence.clearHistory());
      if (this.#epoch === clearEpoch) this.#cancelRequested = false;
    } finally {
      this.#clearing = false;
    }
  }

  async getScanSchedule(): Promise<SecurityScanSchedule> {
    return structuredClone(await this.#readSchedule());
  }

  async setScanSchedule(input: unknown): Promise<SecurityScanSchedule> {
    if (this.#clearing) throw new Error("Security scanner is being cleared");
    return this.#withScheduleLock(async () => {
      const parsed = parseSchedule(input);
      await this.#persistence.writeSchedule(parsed);
      return structuredClone(parsed);
    });
  }

  #parseStartRequest(input: unknown): Required<SecurityScanStartRequest> {
    if (input == null || typeof input !== "object" || Array.isArray(input))
      throw new TypeError("Security scan request is required");
    const value = input as Record<string, unknown>;
    const allowed = new Set(["scope", "skillRef", "mode", "trigger"]);
    if (Object.keys(value).some((key) => !allowed.has(key)))
      throw new TypeError("Security scan request contains unsupported fields");
    if (value.scope !== "single" && value.scope !== "all")
      throw new TypeError("Unsupported security scan scope");
    if (value.mode !== "quick" && value.mode !== "full")
      throw new TypeError("Unsupported security scan mode");
    const trigger = value.trigger ?? "manual";
    if (trigger !== "manual" && trigger !== "automatic")
      throw new TypeError("Unsupported security scan trigger");
    let ref = "" as SecuritySkillTarget["skillRef"];
    if (value.scope === "single") {
      if (
        typeof value.skillRef !== "string" ||
        !/^skill:[a-f0-9]{64}$/u.test(value.skillRef)
      )
        throw new TypeError("A valid opaque Skill reference is required");
      ref = value.skillRef as SecuritySkillTarget["skillRef"];
    }
    return { scope: value.scope, mode: value.mode, trigger, skillRef: ref };
  }

  async #run(
    id: `scan:${string}`,
    epoch: number,
    locale: DesktopLocale,
    targets: SecuritySkillTarget[],
    request: Required<Pick<SecurityScanStartRequest, "mode" | "trigger">>,
  ): Promise<void> {
    const newEntries: SecurityScanHistoryEntry[] = [];
    const config =
      request.mode === "full" ? await this.#modelConfig() : undefined;
    if (!this.#isActive(id, epoch)) return;
    // Last-known content hash per skill (latest complete scan). Unchanged
    // skills are skipped on automatic runs so repeated monitoring does not
    // waste model tokens/time re-analyzing the same content.
    const lastContentHash = new Map<string, string>();
    const lastFinishedAt = new Map<string, number>();
    for (const entry of (await this.#readHistory([])).entries) {
      if (entry.status !== "complete" || !entry.report) continue;
      const timestamp = Date.parse(entry.finishedAt);
      const previous = lastFinishedAt.get(entry.skillRef);
      if (previous !== undefined && previous >= timestamp) continue;
      lastFinishedAt.set(entry.skillRef, timestamp);
      lastContentHash.set(entry.skillRef, entry.report.contentHash);
    }
    for (const target of targets) {
      if (!this.#isActive(id, epoch)) return;
      if (this.#cancelRequested) {
        this.#state.progress.skipped +=
          targets.length - this.#state.progress.started;
        break;
      }
      const trusted = this.#trusted.get(target.skillRef);
      if (!trusted) continue;
      const itemStartedAt = this.#now();
      this.#state.progress.started += 1;
      this.#state.currentSkill = {
        skillRef: target.skillRef,
        name: target.name,
      };
      try {
        const collected = await this.#collect(trusted.root);
        if (!this.#isActive(id, epoch)) return;
        // Unchanged since the last complete automatic scan: skip re-analysis to
        // avoid wasting model tokens/time (manual runs always re-scan).
        if (
          request.trigger === "automatic" &&
          lastContentHash.get(target.skillRef) ===
            contentHashOf(collected.files)
        ) {
          this.#state.progress.skipped += 1;
          continue;
        }
        const report = await (this.#options.scanner ?? scanSkill)({
          mode: request.mode,
          locale,
          files: collected.files,
          ...(config == null ? {} : { model: config }),
        });
        if (!this.#isActive(id, epoch)) return;
        const dto = sanitizeReport(
          report,
          config?.apiKey ? [config.apiKey] : [],
        );
        if (collected.hostSkipped.length > 0) {
          dto.status = "partial";
          const hostPaths = new Set(
            collected.hostSkipped.map((item) => item.path),
          );
          dto.skippedFiles = [
            ...dto.skippedFiles.filter((item) => !hostPaths.has(item.path)),
            ...collected.hostSkipped,
          ];
          if (dto.findings.length === 0) dto.verdict = "unknown";
        }
        const status = dto.status;
        const entry: SecurityScanHistoryEntry = {
          id: `${id}:${target.skillRef.slice("skill:".length, "skill:".length + 16)}`,
          scanId: id,
          skillRef: target.skillRef,
          skillName: target.name,
          mode: request.mode,
          trigger: request.trigger,
          locale,
          status,
          startedAt: itemStartedAt,
          finishedAt: this.#now(),
          report: dto,
        };
        newEntries.push(entry);
        this.#state.progress.completed += 1;
        this.#state.resultIds.push(entry.id);
      } catch {
        if (!this.#isActive(id, epoch)) return;
        const entry: SecurityScanHistoryEntry = {
          id: `${id}:${target.skillRef.slice("skill:".length, "skill:".length + 16)}`,
          scanId: id,
          skillRef: target.skillRef,
          skillName: target.name,
          mode: request.mode,
          trigger: request.trigger,
          locale,
          status: "failed",
          startedAt: itemStartedAt,
          finishedAt: this.#now(),
          errorCode: "security.scanFailed",
        };
        newEntries.push(entry);
        this.#state.progress.failed += 1;
        this.#state.resultIds.push(entry.id);
      }
      const done =
        this.#state.progress.completed +
        this.#state.progress.failed +
        this.#state.progress.skipped;
      this.#state.progress.percent = Math.floor((done / targets.length) * 100);
    }
    if (!this.#isActive(id, epoch)) return;
    if (newEntries.length > 0)
      await this.#appendHistory(
        newEntries,
        config?.apiKey ? [config.apiKey] : [],
        () => this.#isActive(id, epoch),
      );
    if (!this.#isActive(id, epoch)) return;
    delete this.#state.currentSkill;
    this.#state.finishedAt = this.#now();
    if (this.#cancelRequested) this.#state.status = "cancelled";
    else if (this.#state.progress.failed === targets.length)
      this.#state.status = "failed";
    else if (
      this.#state.progress.failed > 0 ||
      newEntries.some((entry) => entry.status === "partial")
    )
      this.#state.status = "partial";
    else this.#state.status = "complete";
    this.#state.progress.percent = 100;
    this.#cancelRequested = false;
  }

  async #discoverRoot(
    root: string,
    agent: string,
    output: Map<string, TrustedSkill>,
  ): Promise<void> {
    const visit = async (directory: string, depth: number): Promise<void> => {
      let handle;
      try {
        handle = await opendir(directory);
      } catch {
        return;
      }
      const entries = [] as Array<{ name: string; path: string }>;
      for await (const entry of handle)
        entries.push({ name: entry.name, path: join(directory, entry.name) });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name.startsWith(".")) continue;
        let details;
        try {
          details = await lstat(entry.path);
        } catch {
          continue;
        }
        if (details.isSymbolicLink() || !details.isDirectory()) continue;
        const marker = await this.#findMarker(entry.path);
        if (marker) {
          const ref = skillRef(entry.path);
          const existing = output.get(ref);
          const agents = existing
            ? [...new Set([...existing.target.agents, agent])]
            : [agent];
          output.set(ref, {
            root: entry.path,
            target: {
              skillRef: ref,
              name: this.#skillName(entry.path),
              agents,
              modifiedAt: details.mtime.toISOString(),
              source: "discovered",
            },
          });
        } else if (depth + 1 < 3) await visit(entry.path, depth + 1);
      }
    };
    await visit(root, 0);
  }

  async #findMarker(root: string): Promise<string | null> {
    for (const marker of ["SKILL.md", "skill.md"]) {
      try {
        const details = await lstat(join(root, marker));
        if (!details.isSymbolicLink() && details.isFile()) return marker;
      } catch {
        /* missing */
      }
    }
    return null;
  }

  #skillName(root: string): string {
    // Never read marker contents during discovery: the marker can change after
    // lstat, while this already-contained directory basename cannot expose an
    // out-of-root file through a metadata TOCTOU swap.
    return safeDisplayName(
      basename(root).slice(0, 160),
      basename(root).slice(0, 160) || "Skill",
    );
  }

  async #collect(root: string): Promise<CollectedSkill> {
    const rootDetails = await lstat(root);
    if (rootDetails.isSymbolicLink() || !rootDetails.isDirectory())
      throw new Error("Skill root is not a trusted directory");
    const rootReal = await realpath(root);
    const [rootAfter, rootRealDetails] = await Promise.all([
      lstat(root),
      stat(rootReal),
    ]);
    if (
      rootAfter.isSymbolicLink() ||
      !rootAfter.isDirectory() ||
      rootAfter.dev !== rootRealDetails.dev ||
      rootAfter.ino !== rootRealDetails.ino
    )
      throw new Error("Skill root changed during validation");
    const files: SkillFile[] = [];
    const hostSkipped: SecurityScanReportDto["skippedFiles"] = [];
    let totalBytes = 0;
    let fileLimitReached = false;
    const skip = (
      path: string,
      reasonCode: SecurityScanReportDto["skippedFiles"][number]["reasonCode"],
    ) => hostSkipped.push({ path, reasonCode, reason: reasonCode });
    const visit = async (
      directory: string,
      depth: number,
      directoryLabel?: string,
    ): Promise<void> => {
      let handle;
      try {
        handle = await opendir(directory);
      } catch {
        if (directoryLabel == null)
          throw new Error("Skill directory is unreadable");
        skip(directoryLabel, "unavailable");
        return;
      }
      const entries = [] as Array<{ name: string; path: string }>;
      for await (const entry of handle)
        entries.push({ name: entry.name, path: join(directory, entry.name) });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (fileLimitReached) return;
        const relativePath = relative(rootReal, entry.path)
          .split(sep)
          .join("/");
        if (!isSafeRelativePath(relativePath))
          throw new Error("Unsafe Skill entry path");
        let details;
        try {
          details = await lstat(entry.path);
        } catch {
          skip(relativePath, "unavailable");
          continue;
        }
        if (details.isSymbolicLink()) {
          skip(relativePath, "symlink");
          continue;
        }
        if (details.isDirectory()) {
          if (depth >= MAX_DEPTH) skip(relativePath, "depth-limit");
          else {
            try {
              const directoryReal = await realpath(entry.path);
              if (!isWithin(rootReal, directoryReal)) {
                skip(relativePath, "symlink");
                continue;
              }
              await visit(directoryReal, depth + 1, relativePath);
            } catch {
              skip(relativePath, "unavailable");
            }
          }
          continue;
        }
        if (!details.isFile()) continue;
        if (files.length >= MAX_FILES) {
          skip(relativePath, "file-limit");
          fileLimitReached = true;
          return;
        }
        await this.#options.beforeOpenFile?.(entry.path);
        let fileHandle;
        try {
          fileHandle = await open(
            entry.path,
            fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
          );
          const opened = await fileHandle.stat();
          if (!opened.isFile()) {
            skip(relativePath, "unavailable");
            continue;
          }
          const pathReal = await realpath(entry.path);
          if (!isWithin(rootReal, pathReal)) {
            skip(relativePath, "symlink");
            continue;
          }
          const pathDetails = await stat(pathReal);
          if (
            pathDetails.dev !== opened.dev ||
            pathDetails.ino !== opened.ino
          ) {
            skip(relativePath, "unavailable");
            continue;
          }
          totalBytes += opened.size;
          if (totalBytes > MAX_TOTAL_BYTES) {
            skip(relativePath, "skill-size-limit");
            continue;
          }
          if (opened.size > MAX_FILE_BYTES) {
            files.push({
              path: relativePath,
              content: "",
              isBinary: true,
              byteSize: opened.size,
            });
            skip(relativePath, "file-size-limit");
            continue;
          }
          const buffer = await fileHandle.readFile();
          const binary = buffer.includes(0);
          files.push({
            path: relativePath,
            content: binary ? "" : buffer.toString("utf8"),
            isBinary: binary,
            byteSize: opened.size,
          });
          if (binary) skip(relativePath, "binary");
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          skip(relativePath, code === "ELOOP" ? "symlink" : "unavailable");
        } finally {
          await fileHandle?.close().catch(() => undefined);
        }
      }
    };
    await visit(rootReal, 0);
    if (files.length === 0) throw new Error("Skill has no readable files");
    return { files, hostSkipped };
  }

  async #readHistory(
    exactSecretsOverride: readonly string[] = [],
  ): Promise<HistoryDocument> {
    const entries = await this.#persistence.readHistory();
    return {
      version: HISTORY_VERSION,
      entries: entries
        .map((entry) => parseHistoryEntry(entry, exactSecretsOverride))
        .filter((entry): entry is SecurityScanHistoryEntry => entry != null)
        .slice(0, MAX_HISTORY),
    };
  }

  async #appendHistory(
    entries: SecurityScanHistoryEntry[],
    exactSecrets: readonly string[],
    isActive: () => boolean,
  ): Promise<void> {
    await this.#withHistoryLock(async () => {
      if (!isActive()) return;
      const current = await this.#readHistory(exactSecrets);
      if (!isActive()) return;
      await this.#persistence.writeHistory(
        [...entries.reverse(), ...current.entries].slice(0, MAX_HISTORY),
      );
    });
  }

  #isActive(id: `scan:${string}`, epoch: number): boolean {
    return this.#epoch === epoch && this.#state.scanId === id;
  }

  #withHistoryLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#historyQueue.then(operation, operation);
    this.#historyQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #withScheduleLock<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#scheduleQueue.then(operation, operation);
    this.#scheduleQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #readSchedule(): Promise<SecurityScanSchedule> {
    const stored = await this.#persistence.readSchedule();
    return stored == null
      ? { ...DEFAULT_SCAN_SCHEDULE }
      : parseSchedule(stored);
  }

  /**
   * Resolve the model to use for a full scan from the shared model-profile
   * store maintained by the settings page (S-500). The active profile (or the
   * first profile when none is marked) supplies the provider/endpoint/apiKey
   * and the single model id — security scans no longer carry their own model
   * configuration. Any read/parse/mapping failure yields `undefined`, which
   * callers treat as "no model available" (full scans become model-required).
   */
  async #modelConfig(): Promise<ModelConfig | undefined> {
    const value = await this.#persistence.modelConfig();
    return value == null ? undefined : ModelConfigSchema.parse(value);
  }

  #now(): string {
    return (this.#options.now?.() ?? new Date()).toISOString();
  }
}
