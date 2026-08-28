/**
 * Frozen pre-migration baseline of every tool fact source.
 *
 * Captured 2026-08-05 on branch `feature/init` (commits b093014 / 5995c49),
 * BEFORE the tool-registry migration touches any consumer. This is the
 * canonical "before" reference: M2-M5 parity tests assert the registry derives
 * values identical to this snapshot.
 *
 * NEVER edit these values to make a test pass. A diff means the migration
 * changed behavior and must either be fixed or explained in an `expected-diff`
 * note with owner + approval. This file is immutable once committed.
 */

export type BaselineUsageMode = "native" | "adapter" | "unsupported";

export interface BaselineTool {
  id: string;
  nameZh: string;
  detectRoots: readonly string[];
}

export interface BaselineSkillAgent {
  toolId: string;
  roots: readonly string[];
  envHome?: string;
  markers: readonly string[];
  maxDepth: number;
}

export interface BaselineUsagePath {
  root: string;
  glob: string;
  format: "json" | "jsonl" | "sqlite";
}

export interface BaselineUsageAdapter {
  source: string;
  paths: readonly BaselineUsagePath[];
  /** true when the adapter ships a per-source mapping (aipy/workbuddy). */
  customMapping: boolean;
  /** true when the adapter carries a SQL query (aipy sqlite). */
  hasSqliteQuery: boolean;
  maxFileSizeBytes: number;
}

export interface BaselineSessionSource {
  source: "claude-code" | "codex" | "grok";
  roots: readonly string[];
  /** Bare resume command template (current string form, pre token-array). */
  resumeCommandTemplate: string;
}

export type BaselinePriceMatcher =
  | { kind: "exactOrSnapshot"; names: readonly string[] }
  | { kind: "includesAll"; parts: readonly string[] };

export interface BaselineModelPrice {
  id: string;
  label: string;
  effectiveDate: string;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
  cacheWriteUsdPerMillion: number | null;
  matcher: BaselinePriceMatcher;
}

export const BASELINE_TOOLS: readonly BaselineTool[] = [
  {
    id: "claude-code",
    nameZh: "Claude Code",
    detectRoots: [".claude", "Library/Application Support/Claude"],
  },
  { id: "codex", nameZh: "Codex", detectRoots: [".codex"] },
  {
    id: "cursor",
    nameZh: "Cursor",
    detectRoots: ["Library/Application Support/Cursor", ".cursor"],
  },
  { id: "kiro", nameZh: "Kiro", detectRoots: [".kiro"] },
  { id: "gemini-cli", nameZh: "Gemini CLI", detectRoots: [".gemini"] },
  {
    id: "opencode",
    nameZh: "OpenCode",
    detectRoots: [".config/opencode", ".local/share/opencode"],
  },
  { id: "openclaw", nameZh: "OpenClaw", detectRoots: [".openclaw"] },
  { id: "every-code", nameZh: "Every Code", detectRoots: [".every-code"] },
  { id: "hermes", nameZh: "Hermes Agent", detectRoots: [".hermes"] },
  {
    id: "github-copilot",
    nameZh: "GitHub Copilot",
    detectRoots: [".config/github-copilot"],
  },
  { id: "kimi-code", nameZh: "Kimi Code", detectRoots: [".kimi"] },
  { id: "omp", nameZh: "oh-my-pi", detectRoots: [".omp", ".oh-my-pi"] },
  { id: "codebuddy", nameZh: "CodeBuddy", detectRoots: [".codebuddy"] },
  { id: "workbuddy", nameZh: "WorkBuddy", detectRoots: [".workbuddy"] },
  { id: "grok", nameZh: "Grok Build", detectRoots: [".grok"] },
  {
    id: "kilo-cli",
    nameZh: "Kilo CLI",
    detectRoots: [".kilo", ".local/share/kilo"],
  },
  {
    id: "kilocode",
    nameZh: "Kilo Code",
    detectRoots: [
      "Library/Application Support/Code/User/globalStorage/kilocode.kilo-code",
    ],
  },
  {
    id: "antigravity",
    nameZh: "Antigravity",
    detectRoots: [
      ".gemini/antigravity",
      "Library/Application Support/Antigravity",
    ],
  },
  { id: "pi", nameZh: "pi", detectRoots: [".pi"] },
  { id: "craft", nameZh: "Craft Agents", detectRoots: [".craft-agent"] },
  {
    id: "roo-code",
    nameZh: "Roo Code",
    detectRoots: [
      "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline",
    ],
  },
  {
    id: "zed",
    nameZh: "Zed Agent",
    detectRoots: ["Library/Application Support/Zed", ".local/share/zed"],
  },
  {
    id: "goose",
    nameZh: "Goose",
    detectRoots: [".local/share/goose", ".goose"],
  },
  { id: "droid", nameZh: "Droid", detectRoots: [".factory"] },
  { id: "mimo", nameZh: "Mimo Code", detectRoots: [".local/share/mimocode"] },
  { id: "zcode", nameZh: "ZCode", detectRoots: [".zcode"] },
  {
    id: "anythingllm",
    nameZh: "AnythingLLM Desktop",
    detectRoots: ["Library/Application Support/anythingllm-desktop"],
  },
];

const NATIVE_USAGE = new Set(["claude-code", "codex", "antigravity"]);
const ADAPTER_USAGE = new Set([
  "cursor",
  "gemini-cli",
  "opencode",
  "github-copilot",
  "kimi-code",
  "workbuddy",
  "grok",
  "roo-code",
]);

export const BASELINE_USAGE_PARSING: Readonly<
  Record<string, BaselineUsageMode>
> = Object.fromEntries(
  BASELINE_TOOLS.map((tool) => [
    tool.id,
    NATIVE_USAGE.has(tool.id)
      ? "native"
      : ADAPTER_USAGE.has(tool.id)
        ? "adapter"
        : "unsupported",
  ]),
) as Readonly<Record<string, BaselineUsageMode>>;

const DEFAULT_MARKERS = ["SKILL.md", "skill.md"] as const;
const DEFAULT_MAX_DEPTH = 3;

export const BASELINE_SKILL_AGENTS: readonly BaselineSkillAgent[] = [
  {
    toolId: "claude-code",
    roots: [".claude/skills"],
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "codex",
    roots: [".codex/skills"],
    envHome: "CODEX_HOME",
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "cursor",
    roots: [".cursor/skills"],
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "gemini-cli",
    roots: [".gemini/skills"],
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "opencode",
    roots: [".config/opencode/skills"],
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "grok",
    roots: [".grok/skills"],
    envHome: "GROK_HOME",
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "hermes",
    roots: [".hermes/skills"],
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "openclaw",
    roots: [".openclaw/workspace/skills"],
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
  {
    toolId: "antigravity",
    roots: [".gemini/antigravity/skills", ".gemini/antigravity-ide/skills"],
    markers: DEFAULT_MARKERS,
    maxDepth: DEFAULT_MAX_DEPTH,
  },
];

const GENERIC_MAX = 8 * 1024 * 1024;
const NATIVE_MAX = 64 * 1024 * 1024;
const AIPY_MAX = 512 * 1024 * 1024;

export const BASELINE_USAGE_ADAPTERS: readonly BaselineUsageAdapter[] = [
  {
    source: "claude-code",
    paths: [{ root: ".claude/projects", glob: "**/*.jsonl", format: "jsonl" }],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX,
  },
  {
    source: "codex",
    paths: [
      { root: ".codex/sessions", glob: "**/rollout-*.jsonl", format: "jsonl" },
      {
        root: ".codex/archived_sessions",
        glob: "**/rollout-*.jsonl",
        format: "jsonl",
      },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX,
  },
  {
    source: "cursor",
    paths: [
      {
        root: "Library/Application Support/Cursor/User/globalStorage",
        glob: "**/*usage*.json",
        format: "json",
      },
      {
        root: "AppData/Roaming/Cursor/User/globalStorage",
        glob: "**/*usage*.json",
        format: "json",
      },
      { root: ".cursor", glob: "**/*usage*.jsonl", format: "jsonl" },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX
  },
  {
    source: "gemini-cli",
    paths: [
      { root: ".gemini/tmp", glob: "**/chats/*.json", format: "json" },
      { root: ".gemini", glob: "**/*usage*.jsonl", format: "jsonl" },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: NATIVE_MAX
  },
  {
    source: "kimi-code",
    paths: [
      { root: ".kimi/sessions", glob: "**/*.jsonl", format: "jsonl" },
      { root: ".kimi/logs", glob: "**/*.jsonl", format: "jsonl" },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX,
  },
  {
    source: "opencode",
    paths: [
      {
        root: ".local/share/opencode/storage/message",
        glob: "**/*.json",
        format: "json",
      },
      { root: ".opencode", glob: "**/*.jsonl", format: "jsonl" },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX
  },
  {
    source: "grok",
    paths: [
      { root: ".grok/sessions", glob: "**/*.jsonl", format: "jsonl" },
      { root: ".grok/logs", glob: "**/*.jsonl", format: "jsonl" },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: NATIVE_MAX
  },
  {
    source: "github-copilot",
    paths: [
      {
        root: ".config/github-copilot",
        glob: "**/*usage*.jsonl",
        format: "jsonl",
      },
      {
        root: "Library/Application Support/github-copilot",
        glob: "**/*usage*.json",
        format: "json",
      },
      {
        root: "AppData/Roaming/github-copilot",
        glob: "**/*usage*.json",
        format: "json",
      },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX,
  },
  {
    source: "cline",
    paths: [
      {
        root: "Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
        glob: "**/*.json",
        format: "json",
      },
      {
        root: ".config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
        glob: "**/*.json",
        format: "json",
      },
      {
        root: "AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/tasks",
        glob: "**/*.json",
        format: "json",
      },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX,
  },
  {
    source: "roo-code",
    paths: [
      {
        root: "Library/Application Support/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
        glob: "**/*.json",
        format: "json",
      },
      {
        root: ".config/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
        glob: "**/*.json",
        format: "json",
      },
      {
        root: "AppData/Roaming/Code/User/globalStorage/rooveterinaryinc.roo-cline/tasks",
        glob: "**/*.json",
        format: "json",
      },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX,
  },
  {
    source: "aipy",
    paths: [
      {
        root: "Library/Application Support/aipy-pro",
        glob: "aipy",
        format: "sqlite",
      },
      { root: "AppData/Roaming/aipy-pro", glob: "aipy", format: "sqlite" },
    ],
    customMapping: true,
    hasSqliteQuery: true,
    maxFileSizeBytes: AIPY_MAX,
  },
  {
    source: "workbuddy",
    paths: [
      { root: ".workbuddy/projects", glob: "**/*.jsonl", format: "jsonl" },
    ],
    customMapping: true,
    hasSqliteQuery: false,
    maxFileSizeBytes: GENERIC_MAX
  },
  {
    source: "openclaw",
    paths: [
      {
        root: ".openclaw/agents",
        glob: "*/sessions/**/*.jsonl*",
        format: "jsonl",
      },
      {
        root: ".openclaw/agents",
        glob: "*/session-sqlite-import-archive/**/*.jsonl*",
        format: "jsonl",
      },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: NATIVE_MAX,
  },
  {
    source: "antigravity",
    paths: [
      {
        root: ".gemini/antigravity",
        glob: "**/.system_generated/logs/transcript.jsonl",
        format: "jsonl",
      },
      {
        root: ".gemini/antigravity-ide",
        glob: "**/.system_generated/logs/transcript.jsonl",
        format: "jsonl",
      },
      {
        root: ".gemini/antigravity-cli",
        glob: "**/.system_generated/logs/transcript.jsonl",
        format: "jsonl",
      },
    ],
    customMapping: false,
    hasSqliteQuery: false,
    maxFileSizeBytes: NATIVE_MAX,
  },
];

export const BASELINE_SESSION_SOURCES: readonly BaselineSessionSource[] = [
  {
    source: "claude-code",
    roots: [".claude/projects"],
    resumeCommandTemplate: "claude --resume",
  },
  {
    source: "codex",
    roots: [".codex/sessions", ".codex/archived_sessions"],
    resumeCommandTemplate: "codex resume",
  },
  {
    source: "grok",
    roots: [".grok/sessions"],
    resumeCommandTemplate: "grok --resume",
  },
];

export const BASELINE_MODEL_PRICES: readonly BaselineModelPrice[] = [
  {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 5,
    outputUsdPerMillion: 30,
    cacheReadUsdPerMillion: 0.5,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5.6-sol"] },
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.25,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5.6-terra"] },
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 6,
    cacheReadUsdPerMillion: 0.1,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5.6-luna"] },
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 6.25,
    outputUsdPerMillion: 37.5,
    cacheReadUsdPerMillion: 0.625,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5.5"] },
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 2.5,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.25,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5.4"] },
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.75,
    outputUsdPerMillion: 14,
    cacheReadUsdPerMillion: 0.175,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5.2"] },
  },
  {
    id: "gpt-5.1-codex",
    label: "GPT-5.1 Codex",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cacheReadUsdPerMillion: 0.125,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5.1-codex"] },
  },
  {
    id: "gpt-5-codex",
    label: "GPT-5 Codex",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 1.25,
    outputUsdPerMillion: 10,
    cacheReadUsdPerMillion: 0.125,
    cacheWriteUsdPerMillion: null,
    matcher: { kind: "exactOrSnapshot", names: ["gpt-5-codex"] },
  },
  {
    id: "claude-opus-4",
    label: "Claude Opus 4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 15,
    outputUsdPerMillion: 75,
    cacheReadUsdPerMillion: 1.5,
    cacheWriteUsdPerMillion: 18.75,
    matcher: { kind: "includesAll", parts: ["claude", "opus", "4"] },
  },
  {
    id: "claude-sonnet-4",
    label: "Claude Sonnet 4",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 3.75,
    matcher: { kind: "includesAll", parts: ["claude", "sonnet", "4"] },
  },
  {
    id: "claude-sonnet-3.7",
    label: "Claude Sonnet 3.7",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 3,
    outputUsdPerMillion: 15,
    cacheReadUsdPerMillion: 0.3,
    cacheWriteUsdPerMillion: 3.75,
    matcher: { kind: "includesAll", parts: ["claude", "3-7", "sonnet"] },
  },
  {
    id: "claude-haiku-3.5",
    label: "Claude Haiku 3.5",
    effectiveDate: "2026-07-27",
    inputUsdPerMillion: 0.8,
    outputUsdPerMillion: 4,
    cacheReadUsdPerMillion: 0.08,
    cacheWriteUsdPerMillion: 1,
    matcher: { kind: "includesAll", parts: ["claude", "3-5", "haiku"] },
  },
];
