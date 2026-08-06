/**
 * Loader tests: raw v1.5 JSON -> runtime superset ToolDefinition projection,
 * default filling, and rule-pack reference validation.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RawToolDefinition, SharedPolicyPacks } from "./schema.ts";
import { SharedPolicyPackSchema } from "./schema.ts";
import { compileRawTool, projectBase, validateRulePackRefs } from "./loader.ts";
import { validateToolDefinitions } from "./validate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const sharedDir = join(here, "definitions/_shared");

function readPack<T>(name: string): T {
  return JSON.parse(readFileSync(join(sharedDir, name), "utf8")) as T;
}

const packs: SharedPolicyPacks = SharedPolicyPackSchema.parse({
  platformProfiles: readPack("platform-profiles.json"),
  genericReaderDefaults: readPack("generic-reader-defaults.json"),
  scannerPolicy: readPack("scanner-policy.json"),
  skillMarketPolicy: readPack("skill-market-policy.json"),
  usageTaxonomy: readPack("usage-taxonomy.json"),
  // The manifest sits in definitions/ (it lists the definitions dir).
  definitionsManifest: JSON.parse(
    readFileSync(join(here, "definitions/manifest.json"), "utf8"),
  ),
});

function rawTool(
  overrides: Partial<RawToolDefinition> = {},
): RawToolDefinition {
  const base: RawToolDefinition = {
    configVersion: 1,
    id: "loader-tool",
    display: { name: "Loader Tool", nameZh: "装载工具" },
    platforms: { macos: "supported", windows: "supported", linux: "planned" },
    detection: {
      locations: [{ targets: ["macos"], base: "home", path: ".loader-tool" }],
    },
    capabilities: {
      usage: {
        mode: "native",
        reader: "generic-jsonl",
        paths: [
          {
            targets: ["macos", "windows10", "windows11"],
            base: "home",
            path: ".loader-tool/projects",
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

describe("projectBase", () => {
  test("maps bases to flattened HOME-relative prefixes (D4 reverse)", () => {
    assert.equal(projectBase("home", ".claude/projects"), ".claude/projects");
    assert.equal(
      projectBase("appData", "aipy-pro"),
      "Library/Application Support/aipy-pro",
    );
    assert.equal(
      projectBase("appDataRoaming", "aipy-pro"),
      "AppData/Roaming/aipy-pro",
    );
    assert.equal(projectBase("configHome", "opencode"), ".config/opencode");
    assert.equal(projectBase("dataHome", "zed"), ".local/share/zed");
  });

  test("env bases cannot be projected", () => {
    assert.equal(projectBase("env:CODEX_HOME", "x"), null);
  });
});

describe("compileRawTool - projection", () => {
  test("locations project into detection.roots; both forms are kept", () => {
    const def = compileRawTool(rawTool(), packs);
    assert.deepEqual(def.detection.roots, [".loader-tool"]);
    assert.equal(def.detection.locations?.length, 1);
    assert.equal(def.detection.locations?.[0].base, "home");
    assert.deepEqual(
      def.capabilities.usage.paths![0].root,
      ".loader-tool/projects",
    );
    assert.equal(def.capabilities.usage.paths![0].glob, "**/*.jsonl");
  });

  test("usage paths with appData base project to Library/Application Support", () => {
    const def = compileRawTool(
      rawTool({
        capabilities: {
          ...rawTool().capabilities,
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
            query: "SELECT 1 AS timestamp",
          },
        },
      }),
      packs,
    );
    assert.equal(
      def.capabilities.usage.paths![0].root,
      "Library/Application Support/aipy-pro",
    );
  });

  test("rootSpecs project into skills.roots; markers/maxDepth get defaults", () => {
    const def = compileRawTool(
      rawTool({
        storage: {
          skills: {
            rootSpecs: [{ base: "home", path: ".loader-tool/skills" }],
          },
        },
        capabilities: {
          ...rawTool().capabilities,
          skills: "read-write",
          market: "install-target",
        },
      }),
      packs,
    );
    assert.deepEqual(def.storage?.skills?.roots, [".loader-tool/skills"]);
    assert.deepEqual(def.storage?.skills?.markers, ["SKILL.md", "skill.md"]);
    assert.equal(def.storage?.skills?.maxDepth, 3);
  });

  test("custom markers/maxDepth/envHome survive compilation", () => {
    const def = compileRawTool(
      rawTool({
        storage: {
          skills: {
            rootSpecs: [{ base: "home", path: ".codex/skills" }],
            envHome: "CODEX_HOME",
            markers: ["SKILL.md"],
            maxDepth: 4,
          },
        },
        capabilities: {
          ...rawTool().capabilities,
          skills: "read-write",
        },
      }),
      packs,
    );
    assert.deepEqual(def.storage?.skills?.markers, ["SKILL.md"]);
    assert.equal(def.storage?.skills?.maxDepth, 4);
    assert.equal(def.storage?.skills?.envHome, "CODEX_HOME");
  });

  test("usage mapping/size cap get generic defaults when omitted", () => {
    const def = compileRawTool(rawTool(), packs);
    assert.equal(
      def.capabilities.usage.maxFileSizeBytes,
      packs.genericReaderDefaults.defaultMaxFileSizeBytes,
    );
    assert.deepEqual(
      def.capabilities.usage.mapping,
      packs.genericReaderDefaults.defaultMapping,
    );
  });

  test("sessions resume command survives; executable projects shared names", () => {
    const def = compileRawTool(
      rawTool({
        detection: {
          locations: [{ targets: ["macos"], base: "home", path: ".x" }],
          executable: { shared: ["codex"], windows: ["codex.exe"] },
        },
        capabilities: {
          ...rawTool().capabilities,
          sessions: {
            mode: "resume",
            reader: "codex-session-v1",
            command: ["codex", "resume", "{sessionId}"],
          },
        },
      }),
      packs,
    );
    assert.deepEqual(def.capabilities.sessions.command, [
      "codex",
      "resume",
      "{sessionId}",
    ]);
    assert.deepEqual(def.detection.executable, ["codex"]);
    assert.deepEqual(def.detection.executableSpec?.windows, ["codex.exe"]);
  });

  test("pricing policy metadata survives; rules default to absent", () => {
    const def = compileRawTool(
      rawTool({
        pricing: {
          billingMode: "api-metered",
          fallbackProfileRef: "unpriced-v1",
          rulePackRefs: ["openai"],
        },
      }),
      packs,
    );
    assert.equal(def.pricing?.billingMode, "api-metered");
    assert.deepEqual(def.pricing?.rulePackRefs, ["openai"]);
    assert.equal(def.pricing?.rules, undefined);
  });
});

describe("compileRawTool - compiled definitions pass validation", () => {
  test("compiled skill/market fixture is valid", () => {
    const def = compileRawTool(
      rawTool({
        storage: {
          skills: {
            rootSpecs: [{ base: "home", path: ".loader-tool/skills" }],
          },
        },
        capabilities: {
          ...rawTool().capabilities,
          skills: "read-write",
          market: "install-target",
        },
      }),
      packs,
    );
    assert.deepEqual(validateToolDefinitions([def]), []);
  });

  test("duplicate detection targets surface a validation diagnostic", () => {
    const def = compileRawTool(
      rawTool({
        detection: {
          locations: [
            { targets: ["macos"], base: "home", path: ".a" },
            { targets: ["macos"], base: "home", path: ".b" },
          ],
        },
      }),
      packs,
    );
    const diags = validateToolDefinitions([def]);
    assert.ok(
      diags.some((d) => d.code === "duplicate-platform-location"),
      `expected duplicate-platform-location, got: ${JSON.stringify(diags)}`,
    );
  });
});

describe("validateRulePackRefs", () => {
  test("known pack ids pass", () => {
    const raws = [
      rawTool({
        pricing: {
          billingMode: "api-metered",
          fallbackProfileRef: "unpriced-v1",
          rulePackRefs: ["openai", "tool-routing"],
        },
      }),
    ];
    assert.deepEqual(validateRulePackRefs(raws), []);
  });

  test("unknown pack id is reported with the tool id", () => {
    const raws = [
      rawTool({
        pricing: {
          billingMode: "api-metered",
          fallbackProfileRef: "unpriced-v1",
          rulePackRefs: ["does-not-exist"],
        },
      }),
    ];
    const errors = validateRulePackRefs(raws);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("loader-tool"));
    assert.ok(errors[0].includes("does-not-exist"));
  });
});
