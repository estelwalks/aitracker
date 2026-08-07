import type { Clock } from "../../platform/persistence/contracts.ts";
import type {
  PackageHash,
  PackageRef,
  SkillRef,
} from "../skill-catalog/contracts.ts";

export const skillDistributionModuleId = "skill-distribution" as const;
export type SkillDistributionModuleId = typeof skillDistributionModuleId;
export type TargetRef = `target:${string}`;
export type InstallPlanRef = `install-plan:${string}`;
export type DistributionRunRef = `distribution-run:${string}`;
export type StagingRef = `staging:${string}`;
export type BackupRef = `backup:${string}`;
export type ChangeProposalRef = `change-proposal:${string}`;

export type DistributionErrorCode =
  | "errors.skillDistribution.invalidPlan"
  | "errors.skillDistribution.notApproved"
  | "errors.skillDistribution.packageBlocked"
  | "errors.skillDistribution.hashMismatch"
  | "errors.skillDistribution.targetUnsupported"
  | "errors.skillDistribution.targetConflict"
  | "errors.skillDistribution.stageFailed"
  | "errors.skillDistribution.replaceFailed"
  | "errors.skillDistribution.rollbackFailed"
  | "errors.skillDistribution.dispatchDisabled";

export type TargetPlatform = "macos" | "windows10" | "windows11" | "linux";
export type TargetSupport = "supported" | "planned" | "unsupported";
export interface TargetCapability {
  readonly targetRef: TargetRef;
  readonly agentId: string;
  readonly platform: TargetPlatform;
  readonly support: TargetSupport;
  readonly skills: "read-write" | "read" | "unsupported";
  readonly installedSkills: readonly InstalledSkill[];
}
export interface InstalledSkill {
  readonly skillRef: SkillRef;
  readonly packageHash?: PackageHash;
}

export interface ProposalApproval {
  readonly proposalRef: ChangeProposalRef;
  readonly status: "pending" | "approved" | "rejected";
  readonly approvedAt?: string;
}

export interface InstallPlan {
  readonly planRef: InstallPlanRef;
  readonly packageRef: PackageRef;
  readonly packageHash: PackageHash;
  readonly skillRef: SkillRef;
  readonly targetRefs: readonly TargetRef[];
  readonly approval: ProposalApproval;
  readonly createdAt: string;
  readonly status: "ready" | "blocked" | "completed" | "rolled-back";
}

export interface UninstallPlan {
  readonly planRef: InstallPlanRef;
  readonly skillRef: SkillRef;
  readonly targetRefs: readonly TargetRef[];
  readonly approval: ProposalApproval;
  readonly createdAt: string;
  readonly status: "ready" | "blocked" | "completed" | "rolled-back";
}

export interface StagingReceipt {
  readonly stagingRef: StagingRef;
  readonly targetRef: TargetRef;
  readonly packageRef: PackageRef;
  readonly packageHash: PackageHash;
}
export interface BackupReceipt {
  readonly backupRef: BackupRef;
  readonly targetRef: TargetRef;
  readonly skillRef: SkillRef;
  readonly existed: boolean;
}
export interface TargetDistributionResult {
  readonly targetRef: TargetRef;
  readonly status: "succeeded" | "failed" | "rolled-back" | "skipped";
  readonly errorCode?: DistributionErrorCode;
}
export interface DistributionRun {
  readonly runRef: DistributionRunRef;
  readonly planRef: InstallPlanRef;
  readonly status: "succeeded" | "failed" | "rolled-back";
  readonly targets: readonly TargetDistributionResult[];
  readonly startedAt: string;
  readonly finishedAt: string;
}
export interface RollbackResult {
  readonly runRef: DistributionRunRef;
  readonly status: "succeeded" | "failed";
  readonly targets: readonly TargetDistributionResult[];
}

export interface FileSystemPort {
  inspect(targetRef: TargetRef): Promise<TargetCapability>;
  stage(input: {
    targetRef: TargetRef;
    packageRef: PackageRef;
    packageHash: PackageHash;
  }): Promise<StagingReceipt>;
  backup(input: {
    targetRef: TargetRef;
    skillRef: SkillRef;
  }): Promise<BackupReceipt>;
  replace(input: {
    staging: StagingReceipt;
    targetRef: TargetRef;
    skillRef: SkillRef;
  }): Promise<void>;
  restore(input: {
    backup: BackupReceipt;
    targetRef: TargetRef;
    skillRef: SkillRef;
  }): Promise<void>;
  remove(input: {
    targetRef: TargetRef;
    skillRef: SkillRef;
  }): Promise<BackupReceipt>;
}

export interface DistributionRunStore {
  append(run: DistributionRun): Promise<void>;
}
export interface SkillDistributionOptions {
  readonly clock: Clock;
  readonly runs?: DistributionRunStore;
  /** Explicit opt-in: desktop composition root enables this after confirmation. */
  readonly dispatcherEnabled?: boolean;
}
export interface SkillDistributionModuleContract {
  readonly module: SkillDistributionModuleId;
  readonly schemaVersion: 1;
}
