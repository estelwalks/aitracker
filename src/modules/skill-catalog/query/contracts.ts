import type {
  BatchUninstallResult as LegacyBatchUninstallResult,
  LocalSkill as LegacyLocalSkill,
  SkillAgent as LegacySkillAgent,
  SkillForm,
  SkillSnapshot as LegacySkillSnapshot,
  SkillSyncResult as LegacySkillSyncResult,
} from "../../../lib/local-skills/types.ts";

/** Public scanner DTOs. They intentionally omit every filesystem location. */
export type SkillInstallation = Omit<
  LegacyLocalSkill["installations"][number],
  "path" | "source"
> & {
  readonly installationRef: string;
  readonly source: {
    readonly kind: "frontmatter" | "market";
    readonly label: string;
  } | null;
  /** Safe basename for display; never an absolute or relative path. */
  readonly directoryName?: string;
  readonly isDistilled?: boolean;
};

export type LocalSkill = Omit<LegacyLocalSkill, "installations"> & {
  readonly installations: readonly SkillInstallation[];
};

/** One readable file inside a skill directory (directory-relative path). */
export interface SkillFileEntry {
  readonly path: string;
  readonly content: string;
}

/** Detail-view file tree resolved server-side by skill name. */
export interface SkillFileList {
  readonly name: string;
  readonly root: string;
  readonly files: readonly SkillFileEntry[];
}

export type SkillAgent = LegacySkillAgent;

export type SkillSnapshot = Omit<
  LegacySkillSnapshot,
  "roots" | "agents" | "skills"
> & {
  readonly roots: Record<SkillAgent, { readonly count: number }>;
  readonly agents: Record<SkillAgent, { readonly installed: boolean }>;
  readonly skills: readonly LocalSkill[];
};

export type BatchUninstallResult = Omit<
  LegacyBatchUninstallResult,
  "succeeded" | "failed"
> & {
  readonly succeeded: readonly string[];
  readonly failed: readonly (Omit<
    LegacyBatchUninstallResult["failed"][number],
    "path"
  > & {
    readonly installationRef: string;
  })[];
};

export type SkillSyncResult = Omit<
  LegacySkillSyncResult,
  "succeeded" | "failed"
> & {
  readonly succeeded: readonly { agent: string; installationRef: string }[];
  readonly failed: readonly (Omit<
    LegacySkillSyncResult["failed"][number],
    "agent"
  > & {
    readonly agent: string;
  })[];
};

/**
 * T7-08: the persisted skill-snapshot DTO (P3-T3-02). Paths and detected
 * roots are stripped at collection time; pages read this shape instead of
 * scanning. Defined here so the public query facade and the server-side
 * snapshot infrastructure share one contract without a public->server edge.
 */
export interface SkillSnapshotInstallation {
  readonly agent: string;
  readonly installedAt: string;
  readonly modifiedAt: string;
  readonly version: string | null;
  readonly source: {
    readonly kind: "frontmatter" | "market";
    readonly label: string;
  } | null;
  /** Safe basename for display; never an absolute or relative path. */
  readonly directoryName?: string;
  readonly isDistilled?: boolean;
  readonly updateStatus: "current" | "available" | "unknown";
  readonly updateReason: string;
}

export interface SkillSnapshotSkill {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** Shape; old snapshots may be missing (undefined) and projection layers normalized to null. */
  readonly form?: SkillForm | null;
  readonly lastUsedAt: string | null;
  readonly sizeBytes: number;
  readonly tokenEstimate: number;
  readonly installations: readonly SkillSnapshotInstallation[];
}

export interface SkillSnapshotData {
  readonly generatedAt: string;
  readonly fingerprint: string;
  readonly roots: Record<string, { readonly count: number }>;
  readonly agents: Record<string, { readonly installed: boolean }>;
  readonly skills: readonly SkillSnapshotSkill[];
  readonly blacklist: readonly string[];
}
