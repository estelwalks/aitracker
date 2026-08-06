/**
 * Schema tests for the v1.5 JSON world (docs §6 contract + audit P1/P2 rules).
 * Each capability gets a positive fixture + an invalid combination counter-case.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { RawToolDefinition } from "./schema.ts";
import { RawToolDefinitionSchema } from "./schema.ts";

function validTool(
  overrides: Partial<RawToolDefinition> = {},
): RawToolDefinition {
  const base: RawToolDefinition = {
    configVersion: 1,
    id: "test-tool",
    display: { name: "Test Tool", nameZh: "测试工具" },
    platforms: { macos: "supported", windows: "supported", linux: "planned" },
    detection: {
      locations: [{ targets: ["macos"], base: "home", path: ".test-tool" }],
    },
    capabilities: {
      usage: {
        mode: "native",
        reader: "generic-jsonl",
        paths: [
          {
            targets: ["macos", "windows10", "windows11"],
            base: "home",
            path: ".test-tool/projects",
            glob: "**/*.jsonl",
            format: "jsonl",
          },
        ],
      },
      skills: "unsupported",
      agents: "unsupported",
      sessions: { mode: "unsupported" },
      market: "unsupported",
      security: "unsupported",
    },
  };
  return { ...base, ...overrides };
}

function parseOk(raw: RawToolDefinition): void {
  const result = RawToolDefinitionSchema.safeParse(raw);
  assert.equal(
    result.success,
    true,
    result.success ? "" : result.error.message,
  );
}

function parseFail(raw: RawToolDefinition, messagePart: string): void {
  const result = RawToolDefinitionSchema.safeParse(raw);
  assert.equal(result.success, false, "expected parse failure");
  if (result.success) return;
  const msg = result.error.issues.map((i) => i.message).join("; ");
  assert.ok(
    msg.includes(messagePart),
    `expected issue "${messagePart}" in messages, got: ${msg}`,
  );
}

describe("RawToolDefinitionSchema - positive fixtures", () => {
  test("valid tool parses", () => {
    parseOk(validTool());
  });

  test("catalogVisible=false allowed for aipy/cline legacy sources", () => {
    parseOk(validTool({ id: "aipy", catalogVisible: false }));
    parseOk(validTool({ id: "cline", catalogVisible: false }));
  });

  test("adapter usage with custom mapping + sqlite query parses", () => {
    parseOk(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          usage: {
            mode: "adapter",
            reader: "generic-sqlite",
            paths: [
              {
                targets: ["macos"],
                base: "appData",
                path: "aipy-pro",
                glob: "aipy",
                format: "sqlite",
              },
            ],
            mapping: {
              timestamp: ["timestamp", "time"],
              model: ["model"],
            },
            query:
              "SELECT e.time AS timestamp FROM task_event e WHERE e.usage IS NOT NULL",
          },
        },
      }),
    );
  });

  test("sessions resume with command token template parses", () => {
    parseOk(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          sessions: {
            mode: "resume",
            reader: "claude-session-v1",
            command: ["claude", "--resume", "{sessionId}"],
          },
        },
      }),
    );
  });

  test("context native with reader parses", () => {
    parseOk(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          context: {
            mode: "native",
            reader: "claude-context-v1",
            dimensions: ["tools", "skills", "commands", "mcp"],
          },
        },
      }),
    );
  });

  test("market install-target with writable skills + roots parses", () => {
    parseOk(
      validTool({
        storage: {
          skills: {
            rootSpecs: [{ base: "home", path: ".test-tool/skills" }],
            markers: ["SKILL.md"],
            maxDepth: 3,
          },
        },
        capabilities: {
          ...validTool().capabilities,
          skills: "read-write",
          market: "install-target",
        },
      }),
    );
  });

  test("windows group status without exact overrides parses", () => {
    parseOk(
      validTool({
        platforms: {
          macos: "supported",
          windows: "supported",
          linux: "planned",
        },
      }),
    );
  });
});

describe("RawToolDefinitionSchema - invalid combinations", () => {
  test("unsupported usage must not declare reader or paths", () => {
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          usage: { mode: "unsupported", reader: "generic-jsonl" },
        },
      }),
      "unsupported",
    );
  });

  test("native usage requires a reader key", () => {
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          usage: {
            mode: "native",
            paths: [
              {
                targets: ["macos"],
                base: "home",
                path: ".test-tool",
                glob: "*",
                format: "jsonl",
              },
            ],
          },
        },
      }),
      "requires a reader key",
    );
  });

  test("sqlite query with write keywords is rejected (D9)", () => {
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          usage: {
            mode: "adapter",
            reader: "generic-sqlite",
            paths: [
              {
                targets: ["macos"],
                base: "home",
                path: ".test-tool",
                glob: "db",
                format: "sqlite",
              },
            ],
            query: "SELECT * FROM t; DROP TABLE t",
          },
        },
      }),
      "read-only SELECT",
    );
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          usage: {
            mode: "adapter",
            reader: "generic-sqlite",
            paths: [
              {
                targets: ["macos"],
                base: "home",
                path: ".test-tool",
                glob: "db",
                format: "sqlite",
              },
            ],
            query: "PRAGMA table_info(t)",
          },
        },
      }),
      "read-only SELECT",
    );
  });

  test("sessions resume requires reader + exactly one {sessionId} token", () => {
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          sessions: { mode: "resume", command: ["claude", "resume"] },
        },
      }),
      "requires a reader key",
    );
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          sessions: {
            mode: "resume",
            reader: "claude-session-v1",
            command: ["claude", "resume", "{sessionId}", "{sessionId}"],
          },
        },
      }),
      "exactly one {sessionId}",
    );
  });

  test("sessions unsupported must not declare reader or command", () => {
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          sessions: { mode: "unsupported", reader: "claude-session-v1" },
        },
      }),
      "must not declare reader or command",
    );
  });

  test("context native requires reader; heuristic requires dimensions", () => {
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          context: { mode: "native" },
        },
      }),
      "requires a reader key",
    );
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          context: { mode: "heuristic" },
        },
      }),
      "requires dimensions",
    );
  });

  test("market install-target requires read-write skills", () => {
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          skills: "read",
          market: "install-target",
        },
      }),
      "requires skills.mode=read-write",
    );
    parseFail(
      validTool({
        capabilities: {
          ...validTool().capabilities,
          skills: "read-write",
          market: "install-target",
        },
      }),
      "requires storage.skills.rootSpecs",
    );
  });

  test("catalogVisible=false is only allowed for aipy/cline", () => {
    parseFail(
      validTool({ catalogVisible: false }),
      "only allowed for legacy sources",
    );
  });

  test("windows group + exact override at tool level is ambiguous", () => {
    parseFail(
      validTool({
        platforms: {
          macos: "supported",
          windows: "supported",
          windows10: "unsupported",
          linux: "planned",
        },
      }),
      "must not coexist",
    );
  });

  test("identical detection declarations at the same level fail", () => {
    parseFail(
      validTool({
        detection: {
          locations: [
            { targets: ["macos"], base: "home", path: ".a" },
            { targets: ["macos"], base: "home", path: ".a" },
          ],
        },
      }),
      "duplicate detection location",
    );
  });

  test("distinct paths covering the same target are allowed", () => {
    parseOk(
      validTool({
        detection: {
          locations: [
            { targets: ["macos"], base: "home", path: ".a" },
            { targets: ["macos"], base: "home", path: ".b" },
          ],
        },
      }),
    );
  });

  test("invalid platforms / targets values are rejected", () => {
    const bad = validTool() as unknown as { platforms: { macos: string } };
    bad.platforms.macos = "shipped";
    const result = RawToolDefinitionSchema.safeParse(bad);
    assert.equal(result.success, false);
  });

  test("invalid path base enum is rejected", () => {
    const raw = validTool();
    raw.detection.locations = [
      { targets: ["macos"], base: "unknown-base" as never, path: ".x" },
    ];
    parseFail(raw, "base");
  });
});

describe("RawToolDefinitionSchema - path safety", () => {
  test("absolute paths, parent traversal and NUL are rejected", () => {
    parseFail(
      validTool({
        detection: {
          locations: [
            { targets: ["macos"], base: "home", path: "/etc/passwd" },
          ],
        },
      }),
      "unsafe",
    );
    parseFail(
      validTool({
        detection: {
          locations: [{ targets: ["macos"], base: "home", path: "../secrets" }],
        },
      }),
      "unsafe",
    );
    parseFail(
      validTool({
        detection: {
          locations: [{ targets: ["macos"], base: "home", path: ".x y" }],
        },
      }),
      "unsafe",
    );
    parseFail(
      validTool({
        storage: {
          skills: { rootSpecs: [{ base: "home", path: "../../etc" }] },
        },
        capabilities: {
          ...validTool().capabilities,
          skills: "read-write",
          market: "install-target",
        },
      }),
      "unsafe",
    );
  });

  test("over-long paths are rejected", () => {
    parseFail(
      validTool({
        detection: {
          locations: [
            { targets: ["macos"], base: "home", path: "a".repeat(600) },
          ],
        },
      }),
      "unsafe",
    );
  });

  test("env base must be a valid uppercase env name", () => {
    const raw = validTool();
    raw.detection.locations = [
      { targets: ["macos"], base: "env:lower-case" as never, path: ".x" },
    ];
    parseFail(raw, "env:");
  });
});

// ---------------------------------------------------------------------------
// Shared policy packs (TC-POL-001, P3 version): pack JSON content must match
// the frozen constants they replace, item by item.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sharedDir = join(here, "definitions/_shared");

function readPack(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(sharedDir, name), "utf8"));
}

describe("shared policy packs (TC-POL-001)", () => {
  test("generic-reader-defaults matches COMMON_MAPPING + file-size cap", () => {
    const pack = readPack("generic-reader-defaults.json") as {
      defaultMapping: Record<string, string[]>;
      defaultMaxFileSizeBytes: number;
    };
    const COMMON_MAPPING_FIELDS = [
      "records",
      "timestamp",
      "sessionId",
      "model",
      "project",
      "inputTokens",
      "cachedInputTokens",
      "cacheCreationInputTokens",
      "outputTokens",
      "reasoningOutputTokens",
      "totalTokens",
    ];
    assert.deepEqual(
      Object.keys(pack.defaultMapping).sort(),
      [...COMMON_MAPPING_FIELDS].sort(),
    );
    assert.equal(pack.defaultMaxFileSizeBytes, 8 * 1024 * 1024);
    // Spot-check a few candidates copied from adapters/catalog.ts.
    assert.deepEqual(pack.defaultMapping.records, [
      "events",
      "messages",
      "turns",
      "history",
      "items",
      "data.events",
      "data.messages",
    ]);
    assert.deepEqual(pack.defaultMapping.model, [
      "model",
      "model_id",
      "modelId",
      "metadata.model",
      "usage.model",
    ]);
  });

  test("skill-market-policy matches SKILL_AGENT_ORDER + defaults", () => {
    const pack = readPack("skill-market-policy.json") as {
      skillAgentOrder: string[];
      defaultMarkers: string[];
      defaultMaxDepth: number;
    };
    assert.deepEqual(pack.skillAgentOrder, [
      "claude-code",
      "codex",
      "cursor",
      "gemini-cli",
      "opencode",
      "grok",
      "hermes",
      "openclaw",
      "antigravity",
    ]);
    assert.deepEqual(pack.defaultMarkers, ["SKILL.md", "skill.md"]);
    assert.equal(pack.defaultMaxDepth, 3);
  });

  test("scanner-policy matches scanner.server.ts budgets", () => {
    const pack = readPack("scanner-policy.json") as Record<string, unknown>;
    assert.equal(pack.lookbackDays, 10 * 365);
    assert.equal(pack.maxFilesPerSource, 1_200);
    assert.equal(pack.maxDiscoveredEntriesPerSource, 30_000);
    assert.equal(pack.maxJsonlLineLength, 16 * 1024 * 1024);
    assert.equal(pack.futureTimestampToleranceMs, 24 * 60 * 60 * 1000);
    assert.equal(pack.cacheFileName, "local-usage-index-v10.json");
  });

  test("usage-taxonomy matches DEBUG_COMMAND_HINTS", () => {
    const pack = readPack("usage-taxonomy.json") as {
      debugCommandHints: string[];
    };
    assert.deepEqual(pack.debugCommandHints, [
      "diff",
      "grep",
      "log",
      "status",
      "test",
      "lint",
    ]);
  });

  test("platform-profiles defines windows group and base platforms", () => {
    const pack = readPack("platform-profiles.json") as {
      groups: { windows: string[] };
      basePlatforms: Record<string, string[]>;
      defaultStatus: { macos: string; windows: string; linux: string };
    };
    assert.deepEqual(pack.groups.windows, ["windows10", "windows11"]);
    assert.deepEqual(pack.basePlatforms.appData, ["macos"]);
    assert.deepEqual(pack.basePlatforms.appDataRoaming, [
      "windows10",
      "windows11",
    ]);
    assert.deepEqual(pack.basePlatforms.configHome, ["macos", "linux"]);
    assert.equal(pack.defaultStatus.linux, "planned");
    assert.equal(pack.defaultStatus.macos, "supported");
  });

  test("manifest lists all 29 tools in frozen UI order", () => {
    // The manifest sits in definitions/ (it lists the definitions dir), not _shared/.
    const pack = JSON.parse(
      readFileSync(join(here, "definitions/manifest.json"), "utf8"),
    ) as {
      tools: { id: string; path: string }[];
    };
    assert.equal(pack.tools.length, 29);
    assert.equal(pack.tools[0].id, "claude-code");
    assert.equal(pack.tools[27].id, "aipy");
    assert.equal(pack.tools[28].id, "cline");
    const ids = new Set(pack.tools.map((t) => t.id));
    assert.equal(ids.size, 29, "ids must be unique");
    for (const t of pack.tools) {
      assert.equal(
        t.path,
        `${t.id}.tool.json`,
        `path must match id for ${t.id}`,
      );
    }
  });
});
