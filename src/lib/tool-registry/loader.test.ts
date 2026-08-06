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
import {
  buildBasePrefixes,
  compileRawTool,
  projectBase,
  projectBaseWithEnv,
  validateModelObservationProfiles,
} from "./loader.ts";
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

describe("platform-profile-driven projection (F5-T1)", () => {
  test("prefixes derive from platform-profiles (xdgFallback drives XDG bases)", () => {
    const prefixes = buildBasePrefixes(packs.platformProfiles);
    assert.equal(prefixes.get("home"), "");
    assert.equal(prefixes.get("userProfile"), "AppData/");
    assert.equal(prefixes.get("appData"), "Library/Application Support/");
    assert.equal(prefixes.get("appDataRoaming"), "AppData/Roaming/");
    assert.equal(prefixes.get("configHome"), ".config/");
    assert.equal(prefixes.get("dataHome"), ".local/share/");
    // Bases the profile does not declare are absent from the table.
    assert.equal(prefixes.has("env:CODEX_HOME"), false);
    assert.equal(prefixes.size, 6);
  });

  test("projectBaseWithEnv honors XDG_CONFIG_HOME/XDG_DATA_HOME when set", () => {
    assert.deepEqual(
      projectBaseWithEnv("configHome", "opencode", {
        XDG_CONFIG_HOME: "/custom/cfg",
      }),
      { path: "/custom/cfg/opencode", homeRelative: false },
    );
    assert.deepEqual(
      projectBaseWithEnv("dataHome", "zed", {
        XDG_DATA_HOME: "/custom/data",
      }),
      { path: "/custom/data/zed", homeRelative: false },
    );
  });

  test("projectBaseWithEnv falls back to xdgFallback when unset", () => {
    assert.deepEqual(projectBaseWithEnv("configHome", "opencode", {}), {
      path: ".config/opencode",
      homeRelative: true,
    });
    assert.deepEqual(projectBaseWithEnv("dataHome", "zed", {}), {
      path: ".local/share/zed",
      homeRelative: true,
    });
  });

  test("projectBaseWithEnv resolves env:NAME bases when the variable is set", () => {
    assert.deepEqual(
      projectBaseWithEnv("env:PF_HOME", "data", {
        PF_HOME: "/pf-home",
      }),
      { path: "/pf-home/data", homeRelative: false },
    );
    assert.equal(projectBaseWithEnv("env:PF_HOME", "data", {}), null);
  });

  test("non-XDG bases ignore the environment", () => {
    assert.deepEqual(
      projectBaseWithEnv("appData", "V", {
        XDG_CONFIG_HOME: "/custom/cfg",
      }),
      { path: "Library/Application Support/V", homeRelative: true },
    );
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

  test("modelObservation projects into pricing with defaults; legacy fields absent", () => {
    const def = compileRawTool(
      rawTool({
        modelObservation: {
          modelField: "model",
          evidence: { endpointField: "endpoint" },
        },
      }),
      packs,
    );
    assert.equal(def.pricing?.modelField, "model");
    assert.equal(def.pricing?.normalizeProfile, "generic-normalize-v1");
    assert.deepEqual(def.pricing?.evidence, { endpointField: "endpoint" });
    // P1-1: tools no longer hold rates or billing modes.
    assert.equal(def.pricing?.billingMode, undefined);
    assert.deepEqual(def.pricing?.rulePackRefs, undefined);
    assert.equal(def.pricing?.rules, undefined);
  });

  test("modelObservation absent means no pricing projection", () => {
    const def = compileRawTool(rawTool(), packs);
    assert.equal(def.pricing, undefined);
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
            { targets: ["macos"], base: "home", path: ".a" },
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

describe("validateModelObservationProfiles", () => {
  test("known normalize profiles pass (absent defaults to generic-normalize-v1)", () => {
    const raws = [
      rawTool({ modelObservation: { modelField: "model" } }),
      rawTool({
        modelObservation: { normalizeProfile: "generic-normalize-v1" },
      }),
    ];
    assert.deepEqual(validateModelObservationProfiles(raws), []);
  });

  test("unknown normalize profile is reported with the tool id", () => {
    const raws = [
      rawTool({
        modelObservation: { normalizeProfile: "does-not-exist" },
      }),
    ];
    const errors = validateModelObservationProfiles(raws);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].includes("loader-tool"));
    assert.ok(errors[0].includes("does-not-exist"));
  });
});
