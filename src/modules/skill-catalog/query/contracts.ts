import type {
  BatchUninstallResult as LegacyBatchUninstallResult,
  LocalSkill as LegacyLocalSkill,
  SkillAgent as LegacySkillAgent,
  SkillSnapshot as LegacySkillSnapshot,
  SkillSyncResult as LegacySkillSyncResult,
} from "../../../lib/local-skills/types.ts";

/** Public scanner DTOs. They intentionally omit every filesystem location. */
export type SkillInstallation = Omit<
  LegacyLocalSkill["installations"][number],
  "path" | "source"
> & {
  readonly installationRef: string;
  readonly source: { readonly kind: "frontmatter" | "market" } | null;
};

export type LocalSkill = Omit<LegacyLocalSkill, "installations"> & {
  readonly installations: readonly SkillInstallation[];
};

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
