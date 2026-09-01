import { createHash } from "node:crypto";
import { lstat, opendir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ScanSkillReport } from "@l3m0nc9/agent-threat-scanner";

import { scanLocalSkills } from "../../../lib/local-skills/scanner.server.ts";
import type {
  LocalSkill,
  SkillSnapshot,
} from "../../../lib/local-skills/types.ts";
import type { SecurityInputFile } from "../../../lib/security/scanner.ts";
import {
  assessmentHistorySummary,
  createAssetAssessment,
} from "../application/index.ts";
import { assessmentFromSkillScannerReport } from "./scanner.ts";
import { runQuickNodeSecurityEngine } from "./node-security-engine.server.ts";
import type {
  AssetAssessment,
  AssetHashRef,
  AssetRef,
  BackgroundSkillSecurityScanPort,
  BackgroundSkillSecurityScanResult,
  SecurityAssessmentHistoryStore,
} from "../contracts.ts";

const MAX_FILES_PER_SKILL = 128;
const MAX_FILE_BYTES = 1_000_000;
const MAX_DIRECTORY_DEPTH = 4;

const SCANNABLE_FILE_NAMES = new Set(["SKILL.md", "AGENTS.md", "package.json"]);
const SCANNABLE_FILE_EXTENSIONS = new Set([
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".cjs",
  ".mjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".sh",
  ".bash",
  ".zsh",
]);

/** Server-only discovery dependency. Paths are intentionally confined here. */
export interface LocalSkillDiscoveryPort {
  discover(): Promise<SkillSnapshot>;
}

export interface CreateLocalSkillSecurityMonitorOptions {
  readonly history: SecurityAssessmentHistoryStore;
  readonly discovery?: LocalSkillDiscoveryPort;
  readonly scanner?: (
    files: readonly SecurityInputFile[],
  ) => ScanSkillReport | Promise<ScanSkillReport>;
  readonly now?: () => Date;
}

interface ReadSkillFilesResult {
  readonly files: readonly SecurityInputFile[];
  /** False means a candidate was unreadable, oversized, or a symlink. */
  readonly complete: boolean;
}

function extension(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index).toLowerCase();
}

function shouldScanFile(name: string): boolean {
  return (
    SCANNABLE_FILE_NAMES.has(name) ||
    SCANNABLE_FILE_EXTENSIONS.has(extension(name))
  );
}

function opaqueAssetRef(skill: LocalSkill, installationPath: string): AssetRef {
  const digest = createHash("sha256")
    .update(skill.id)
    .update("\u0000")
    .update(installationPath)
    .digest("hex");
  return `asset:local-skill-${digest}`;
}

function opaqueHash(files: readonly SecurityInputFile[]): AssetHashRef {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.name);
    hash.update("\u0000");
    hash.update(file.content);
    hash.update("\u0000");
  }
  return `asset-hash:sha256-${hash.digest("hex")}`;
}

/**
 * Reads a bounded set of text/configuration files from a discovered directory.
 * Symlinks are deliberately not followed, so a discovered Skill cannot expand
 * this background scanner's read scope beyond its own installation.
 */
async function readDiscoveredSkillFiles(
  root: string,
): Promise<ReadSkillFilesResult> {
  const files: SecurityInputFile[] = [];
  let complete = true;

  async function visit(directory: string, depth: number): Promise<void> {
    if (files.length >= MAX_FILES_PER_SKILL) {
      complete = false;
      return;
    }
    let entries: { name: string; path: string }[];
    try {
      const handle = await opendir(directory);
      entries = [];
      for await (const entry of handle)
        entries.push({ name: entry.name, path: join(directory, entry.name) });
    } catch {
      complete = false;
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (files.length >= MAX_FILES_PER_SKILL) {
        complete = false;
        return;
      }
      let details;
      try {
        details = await lstat(entry.path);
      } catch {
        complete = false;
        continue;
      }
      if (details.isSymbolicLink()) {
        complete = false;
        continue;
      }
      if (details.isDirectory()) {
        if (depth >= MAX_DIRECTORY_DEPTH) {
          complete = false;
          continue;
        }
        await visit(entry.path, depth + 1);
        continue;
      }
      if (!details.isFile() || !shouldScanFile(entry.name)) continue;
      if (details.size > MAX_FILE_BYTES) {
        complete = false;
        continue;
      }
      try {
        const content = await readFile(entry.path, "utf8");
        // File labels stay process-local; the report and persisted DTO discard
        // them before crossing the security-assessment boundary.
        files.push({ name: `file-${files.length + 1}`, content });
      } catch {
        complete = false;
      }
    }
  }

  try {
    const details = await lstat(root);
    if (details.isSymbolicLink() || !details.isDirectory())
      return { files, complete: false };
  } catch {
    return { files, complete: false };
  }
  await visit(root, 0);
  return { files, complete };
}

function unknownAssessment(input: {
  readonly assetRef: AssetRef;
  readonly assetHashRef: AssetHashRef;
  readonly assessedAt: string;
}): AssetAssessment {
  return createAssetAssessment({
    assetRef: input.assetRef,
    assetHashRef: input.assetHashRef,
    assetKind: "skill",
    verdict: "unknown",
    findingCount: 0,
    ruleVersion: "unknown",
    ruleProvenance: "unknown",
    assessedAt: input.assessedAt,
  });
}

/**
 * Controlled background adapter for locally discovered Skill installations.
 * It is intentionally server-only: discovery paths and file bodies exist only
 * while the static scan executes, and durable/public values contain opaque
 * asset and content-hash references plus verdict/count metadata only.
 */
export function createLocalSkillSecurityMonitor(
  options: CreateLocalSkillSecurityMonitorOptions,
): BackgroundSkillSecurityScanPort {
  const discovery = options.discovery ?? { discover: () => scanLocalSkills() };
  const scanner =
    options.scanner ??
    ((files) =>
      runQuickNodeSecurityEngine(
        files.map((file, index) => ({
          path: file.name || `file-${index + 1}`,
          content: file.content,
        })),
        "zh-CN",
      ));
  const now = options.now ?? (() => new Date());

  return {
    async scanDiscoveredSkills(): Promise<BackgroundSkillSecurityScanResult> {
      const snapshot = await discovery.discover();
      const assessedAt = now().toISOString();
      const assessments: AssetAssessment[] = [];
      let discoveredAssetCount = 0;
      let failedAssetCount = 0;

      for (const skill of snapshot.skills) {
        for (const installation of skill.installations) {
          discoveredAssetCount += 1;
          const assetRef = opaqueAssetRef(skill, installation.path);
          let files: ReadSkillFilesResult;
          try {
            files = await readDiscoveredSkillFiles(installation.path);
          } catch {
            files = { files: [], complete: false };
          }
          const assetHashRef = opaqueHash(files.files);
          // Unchanged since the last scan: reuse the stored assessment for this
          // run's summary without re-running the model scanner or re-writing
          // history — avoids wasting tokens/time on identical content.
          const previous = await options.history.latest(assetRef);
          if (
            files.complete &&
            files.files.length > 0 &&
            previous?.assetHashRef === assetHashRef
          ) {
            assessments.push(previous);
            continue;
          }
          let assessment: AssetAssessment;
          if (!files.complete || files.files.length === 0) {
            failedAssetCount += 1;
            assessment = unknownAssessment({
              assetRef,
              assetHashRef,
              assessedAt,
            });
          } else {
            try {
              assessment = assessmentFromSkillScannerReport({
                assetRef,
                assetKind: "skill",
                report: await scanner(files.files),
                assessedAt,
              });
            } catch {
              failedAssetCount += 1;
              assessment = unknownAssessment({
                assetRef,
                assetHashRef,
                assessedAt,
              });
            }
          }
          // Always attach the opaque content hash; scanner reports themselves
          // intentionally do not expose or persist their input file list.
          assessment = {
            ...assessment,
            assetHashRef,
            ...(assessment.assessedAt === assessedAt ? {} : { assessedAt }),
          };
          await options.history.save(assessment);
          assessments.push(assessment);
        }
      }

      return {
        assessedAt,
        discoveredAssetCount,
        assessedAssetCount: assessments.length,
        failedAssetCount,
        assessments: assessments.map(assessmentHistorySummary),
      };
    },
  };
}

/** Exposed only for server-adapter tests; callers must never transport this result. */
export const __testOnly = {
  readDiscoveredSkillFiles,
  opaqueAssetRef,
  opaqueHash,
};
