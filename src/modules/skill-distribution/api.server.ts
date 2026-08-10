import { err, ok, type Result } from "../../shared/result.ts";
import {
  applyApproved,
  reject,
  rollbackApplied,
} from "../optimization/index.ts";
import type {
  ChangeDispatchResult,
  ChangeProposal,
  ProposalApplicationOptions,
  ProposalErrorCode,
} from "../optimization/index.ts";
import type { SkillPackage } from "../skill-catalog/index.ts";
import { executeInstallPlan } from "./application/index.ts";
import type {
  DistributionErrorCode,
  DistributionRun,
  FileSystemPort,
  InstallPlan,
  RollbackResult,
  SkillDistributionOptions,
} from "./contracts.ts";
import type { ApprovalAction } from "./presentation/index.ts";

export type SkillDistributionApiResponse = {
  readonly module: "skill-distribution";
  readonly schemaVersion: 1;
};

export type ApprovalActionError = DistributionErrorCode | ProposalErrorCode;

export interface ApprovalActionHandlers {
  readonly fileSystem?: FileSystemPort;
  readonly distributionOptions?: SkillDistributionOptions;
  readonly proposalOptions?: ProposalApplicationOptions;
  /** Rollback is injected because receipts stay server-side and are never renderer data. */
  readonly rollbackDistribution?: (
    run: DistributionRun,
  ) => Promise<Result<RollbackResult, DistributionErrorCode>>;
  readonly dispatchChange?: (
    proposal: ChangeProposal,
  ) => Promise<ChangeDispatchResult>;
  readonly rollbackChange?: (
    proposal: ChangeProposal,
    dispatch: ChangeDispatchResult,
  ) => Promise<void>;
}

/**
 * Dispatches a confirmation action through application services. A preview has
 * no action here; writes are impossible until the explicit confirm branch.
 */
export async function dispatchApprovalAction(input: {
  readonly action: ApprovalAction | ApprovalAction["kind"];
  readonly plan: InstallPlan;
  readonly package?: SkillPackage;
  readonly proposal?: ChangeProposal;
  readonly run?: DistributionRun;
  readonly dispatch?: ChangeDispatchResult;
  readonly handlers: ApprovalActionHandlers;
}): Promise<
  Result<DistributionRun | RollbackResult | ChangeProposal, ApprovalActionError>
> {
  const action =
    typeof input.action === "string" ? input.action : input.action.kind;
  const { handlers } = input;
  if (action === "confirm") {
    if (!input.package || !handlers.fileSystem)
      return err("errors.skillDistribution.dispatchDisabled");
    if (input.plan.approval.status !== "approved")
      return err("errors.skillDistribution.notApproved");
    return executeInstallPlan({
      plan: input.plan,
      package: input.package,
      fileSystem: handlers.fileSystem,
      options: handlers.distributionOptions ?? {
        clock: { now: () => new Date() },
      },
    });
  }
  if (action === "reject") {
    if (!input.proposal) return err("errors.proposal-invalid-transition");
    return reject(input.proposal, handlers.proposalOptions);
  }
  if (!input.run || !handlers.rollbackDistribution)
    return err("errors.rollback-unavailable");
  return handlers.rollbackDistribution(input.run);
}

/** Applies a ChangeProposal only through the proposal application API. */
export async function dispatchApprovedChange(input: {
  readonly proposal: ChangeProposal;
  readonly handlers: ApprovalActionHandlers;
}): Promise<Result<ChangeProposal, ProposalErrorCode>> {
  const dispatcher = input.handlers.dispatchChange;
  if (!dispatcher) return err("errors.change-dispatch-unavailable");
  return applyApproved(input.proposal, {
    ...input.handlers.proposalOptions,
    dispatcher: {
      dispatch: dispatcher,
      ...(input.handlers.rollbackChange
        ? { rollback: input.handlers.rollbackChange }
        : {}),
    },
  });
}

export async function rollbackApprovedChange(input: {
  readonly proposal: ChangeProposal;
  readonly dispatch: ChangeDispatchResult;
  readonly handlers: ApprovalActionHandlers;
}): Promise<Result<ChangeProposal, ProposalErrorCode>> {
  if (!input.handlers.rollbackChange) return err("errors.rollback-unavailable");
  return rollbackApplied(input.proposal, input.dispatch, {
    ...input.handlers.proposalOptions,
    dispatcher: {
      dispatch: input.handlers.dispatchChange ?? (async () => input.dispatch),
      rollback: input.handlers.rollbackChange,
    },
  });
}
