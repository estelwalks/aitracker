import { err, ok, type Result } from "../../../shared/result.ts";
import type { SkillPackage } from "../../skill-catalog/contracts.ts";
import {
  validateInstallPlan,
  validateUninstallPlan,
  type PlanFailure,
} from "../domain.ts";
import type {
  DistributionErrorCode,
  DistributionRun,
  DistributionRunRef,
  FileSystemPort,
  InstallPlan,
  InstallPlanRef,
  ProposalApproval,
  RollbackResult,
  SkillDistributionModuleContract,
  SkillDistributionOptions,
  TargetCapability,
  TargetDistributionResult,
  TargetRef,
  UninstallPlan,
} from "../contracts.ts";

export interface SkillDistributionApplication {
  readonly contract: SkillDistributionModuleContract;
}

export interface CreatePlanInput {
  readonly package: SkillPackage;
  readonly targetRefs: readonly TargetRef[];
  readonly approval: ProposalApproval;
  readonly createdAt: string;
}

function ref(prefix: string, stamp: string): string {
  const safe = stamp.replace(/[^A-Za-z0-9]/g, "").slice(-24) || "plan";
  return `${prefix}:${safe}`;
}

function resultFailure(
  failure: PlanFailure,
): Result<never, DistributionErrorCode> {
  return err(failure.code);
}

export function createInstallPlan(
  input: CreatePlanInput,
  targets: readonly TargetCapability[],
): Result<InstallPlan, DistributionErrorCode> {
  const plan: InstallPlan = {
    planRef: ref("install-plan", input.createdAt) as InstallPlanRef,
    packageRef: input.package.packageRef,
    packageHash: input.package.hash,
    skillRef: input.package.skillRef,
    targetRefs: [...input.targetRefs],
    approval: input.approval,
    createdAt: input.createdAt,
    status: "ready",
  };
  const failure = validateInstallPlan(plan, input.package, targets);
  return failure ? resultFailure(failure) : ok(plan);
}

export function createUninstallPlan(
  input: {
    readonly skillRef: UninstallPlan["skillRef"];
    readonly targetRefs: readonly TargetRef[];
    readonly approval: ProposalApproval;
    readonly createdAt: string;
  },
  targets: readonly TargetCapability[],
): Result<UninstallPlan, DistributionErrorCode> {
  const plan: UninstallPlan = {
    planRef: ref("install-plan", input.createdAt) as InstallPlanRef,
    skillRef: input.skillRef,
    targetRefs: [...input.targetRefs],
    approval: input.approval,
    createdAt: input.createdAt,
    status: "ready",
  };
  const failure = validateUninstallPlan(plan, targets);
  return failure ? resultFailure(failure) : ok(plan);
}

function errorFrom(
  error: unknown,
  fallback: DistributionErrorCode,
): DistributionErrorCode {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (
      typeof code === "string" &&
      code.startsWith("errors.skillDistribution.")
    )
      return code as DistributionErrorCode;
  }
  return fallback;
}

function runRef(now: string): DistributionRunRef {
  return ref("distribution-run", now) as DistributionRunRef;
}

export async function executeInstallPlan(input: {
  readonly plan: InstallPlan;
  readonly package: SkillPackage;
  readonly fileSystem: FileSystemPort;
  readonly options: SkillDistributionOptions;
}): Promise<Result<DistributionRun, DistributionErrorCode>> {
  const { plan, package: skill, fileSystem, options } = input;
  if (options.dispatcherEnabled !== true)
    return err("errors.skillDistribution.dispatchDisabled");
  if (plan.approval.status !== "approved")
    return err("errors.skillDistribution.notApproved");
  const startedAt = options.clock.now().toISOString();
  const inspected: TargetCapability[] = [];
  for (const targetRef of plan.targetRefs)
    inspected.push(await fileSystem.inspect(targetRef));
  const validation = validateInstallPlan(plan, skill, inspected);
  if (validation) return resultFailure(validation);
  const results: TargetDistributionResult[] = [];
  const backups: Array<{
    targetRef: TargetRef;
    skillRef: SkillPackage["skillRef"];
    backup: Awaited<ReturnType<FileSystemPort["backup"]>>;
  }> = [];
  for (const targetRef of plan.targetRefs) {
    try {
      const staging = await fileSystem.stage({
        targetRef,
        packageRef: skill.packageRef,
        packageHash: skill.hash,
      });
      if (staging.packageHash !== skill.hash)
        throw { code: "errors.skillDistribution.hashMismatch" };
      const backup = await fileSystem.backup({
        targetRef,
        skillRef: skill.skillRef,
      });
      backups.push({ targetRef, skillRef: skill.skillRef, backup });
      await fileSystem.replace({
        staging,
        targetRef,
        skillRef: skill.skillRef,
      });
      results.push({ targetRef, status: "succeeded" });
    } catch (error) {
      results.push({
        targetRef,
        status: "failed",
        errorCode: errorFrom(error, "errors.skillDistribution.replaceFailed"),
      });
      break;
    }
  }
  if (results.some((item) => item.status === "failed")) {
    const rollback = await rollbackBackups(
      runRef(startedAt),
      backups,
      fileSystem,
      options,
    );
    const merged: TargetDistributionResult[] = results.map((item) =>
      item.status === "succeeded"
        ? {
            ...item,
            status:
              rollback.status === "succeeded"
                ? "rolled-back"
                : ("failed" as const),
          }
        : item,
    );
    const run: DistributionRun = {
      runRef: runRef(startedAt),
      planRef: plan.planRef,
      status: rollback.status === "succeeded" ? "rolled-back" : "failed",
      targets: merged,
      startedAt,
      finishedAt: options.clock.now().toISOString(),
    };
    await options.runs?.append(run);
    return ok(run);
  }
  const run: DistributionRun = {
    runRef: runRef(startedAt),
    planRef: plan.planRef,
    status: "succeeded",
    targets: results,
    startedAt,
    finishedAt: options.clock.now().toISOString(),
  };
  await options.runs?.append(run);
  return ok(run);
}

async function rollbackBackups(
  run: DistributionRunRef,
  backups: ReadonlyArray<{
    targetRef: TargetRef;
    skillRef: SkillPackage["skillRef"];
    backup: Awaited<ReturnType<FileSystemPort["backup"]>>;
  }>,
  fileSystem: FileSystemPort,
  options: SkillDistributionOptions,
): Promise<RollbackResult> {
  const targets: TargetDistributionResult[] = [];
  let failed = false;
  for (const item of [...backups].reverse()) {
    try {
      await fileSystem.restore({
        targetRef: item.targetRef,
        skillRef: item.skillRef,
        backup: item.backup,
      });
      targets.push({ targetRef: item.targetRef, status: "rolled-back" });
    } catch {
      failed = true;
      targets.push({
        targetRef: item.targetRef,
        status: "failed",
        errorCode: "errors.skillDistribution.rollbackFailed",
      });
    }
  }
  return { runRef: run, status: failed ? "failed" : "succeeded", targets };
}

export async function executeUninstallPlan(input: {
  readonly plan: UninstallPlan;
  readonly fileSystem: FileSystemPort;
  readonly options: SkillDistributionOptions;
}): Promise<Result<DistributionRun, DistributionErrorCode>> {
  const { plan, fileSystem, options } = input;
  if (options.dispatcherEnabled !== true)
    return err("errors.skillDistribution.dispatchDisabled");
  if (plan.approval.status !== "approved")
    return err("errors.skillDistribution.notApproved");
  const inspected = await Promise.all(
    plan.targetRefs.map((targetRef) => fileSystem.inspect(targetRef)),
  );
  const validation = validateUninstallPlan(plan, inspected);
  if (validation) return resultFailure(validation);
  const startedAt = options.clock.now().toISOString();
  const results: TargetDistributionResult[] = [];
  const backups: Array<{
    targetRef: TargetRef;
    skillRef: UninstallPlan["skillRef"];
    backup: Awaited<ReturnType<FileSystemPort["remove"]>>;
  }> = [];
  for (const targetRef of plan.targetRefs) {
    try {
      const backup = await fileSystem.remove({
        targetRef,
        skillRef: plan.skillRef,
      });
      backups.push({ targetRef, skillRef: plan.skillRef, backup });
      results.push({ targetRef, status: "succeeded" });
    } catch {
      results.push({
        targetRef,
        status: "failed",
        errorCode: "errors.skillDistribution.replaceFailed",
      });
      break;
    }
  }
  if (results.some((item) => item.status === "failed")) {
    const rollback = await rollbackBackups(
      runRef(startedAt),
      backups,
      fileSystem,
      options,
    );
    const run: DistributionRun = {
      runRef: runRef(startedAt),
      planRef: plan.planRef,
      status: rollback.status === "succeeded" ? "rolled-back" : "failed",
      targets: results,
      startedAt,
      finishedAt: options.clock.now().toISOString(),
    };
    await options.runs?.append(run);
    return ok(run);
  }
  const run: DistributionRun = {
    runRef: runRef(startedAt),
    planRef: plan.planRef,
    status: "succeeded",
    targets: results,
    startedAt,
    finishedAt: options.clock.now().toISOString(),
  };
  await options.runs?.append(run);
  return ok(run);
}
