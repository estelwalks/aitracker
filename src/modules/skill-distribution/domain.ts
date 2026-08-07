import type { SkillPackage } from "../skill-catalog/contracts.ts";
import type {
  DistributionErrorCode,
  InstallPlan,
  ProposalApproval,
  TargetCapability,
  UninstallPlan,
} from "./contracts.ts";

export interface PlanFailure {
  readonly code: DistributionErrorCode;
  readonly targetRef?: TargetCapability["targetRef"];
}

function validApproval(approval: ProposalApproval): boolean {
  return (
    approval.status === "approved" &&
    approval.proposalRef.startsWith("change-proposal:")
  );
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function validateInstallPlan(
  value: InstallPlan,
  skill: SkillPackage,
  targets: readonly TargetCapability[],
): PlanFailure | undefined {
  if (skill.installability !== "installable" || skill.verdict !== "clean")
    return { code: "errors.skillDistribution.packageBlocked" };
  if (skill.packageRef !== value.packageRef || skill.hash !== value.packageHash)
    return { code: "errors.skillDistribution.hashMismatch" };
  if (!validApproval(value.approval))
    return { code: "errors.skillDistribution.notApproved" };
  if (
    value.targetRefs.length === 0 ||
    unique(value.targetRefs).length !== value.targetRefs.length
  )
    return { code: "errors.skillDistribution.invalidPlan" };
  for (const ref of value.targetRefs) {
    const target = targets.find((item) => item.targetRef === ref);
    if (
      !target ||
      target.support !== "supported" ||
      target.skills !== "read-write"
    )
      return {
        code: "errors.skillDistribution.targetUnsupported",
        targetRef: ref,
      };
    const conflict = target.installedSkills.find(
      (item) =>
        item.skillRef === value.skillRef &&
        item.packageHash !== value.packageHash,
    );
    if (conflict)
      return {
        code: "errors.skillDistribution.targetConflict",
        targetRef: ref,
      };
  }
  return undefined;
}

export function validateUninstallPlan(
  value: UninstallPlan,
  targets: readonly TargetCapability[],
): PlanFailure | undefined {
  if (!validApproval(value.approval) || value.targetRefs.length === 0)
    return { code: "errors.skillDistribution.notApproved" };
  if (unique(value.targetRefs).length !== value.targetRefs.length)
    return { code: "errors.skillDistribution.invalidPlan" };
  for (const ref of value.targetRefs) {
    const target = targets.find((item) => item.targetRef === ref);
    if (
      !target ||
      target.support !== "supported" ||
      target.skills !== "read-write"
    )
      return {
        code: "errors.skillDistribution.targetUnsupported",
        targetRef: ref,
      };
  }
  return undefined;
}
