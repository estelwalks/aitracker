import { err, ok, type Result } from "../../../../shared/result.ts";
import { createChangeProposal, transitionProposal } from "./domain.ts";
import type {
  ApprovalState,
  ChangeDispatchResult,
  ChangeDispatcher,
  ChangeProposal,
  ProposalApplicationOptions,
  ProposalAuditEvent,
  ProposalErrorCode,
  ProposalInput,
} from "./contracts.ts";

export type * from "./contracts.ts";
export {
  createChangeProposal,
  canTransition,
  transitionProposal,
} from "./domain.ts";

function audit(
  options: ProposalApplicationOptions,
  event: ProposalAuditEvent,
): void {
  options.audit?.(event);
}

function event(
  proposal: ChangeProposal,
  action: ProposalAuditEvent["action"],
  now: string,
): ProposalAuditEvent {
  return {
    type: "optimization.proposal.audit",
    schemaVersion: 1,
    proposalId: proposal.id,
    state: proposal.state,
    action,
    occurredAt: now,
    summary: {
      findingId: proposal.findingId,
      operationCount: proposal.operations.length,
    },
  };
}

export function requestApproval(
  proposal: ChangeProposal,
  options: ProposalApplicationOptions = {},
): Result<ChangeProposal, ProposalErrorCode> {
  try {
    const now = (options.now ?? (() => new Date()))();
    const next = transitionProposal(proposal, "waiting-approval", now);
    audit(options, event(next, "requested", now.toISOString()));
    return ok(next);
  } catch (error) {
    return err(
      error instanceof Error && error.message === "errors.proposal-expired"
        ? "errors.proposal-expired"
        : "errors.proposal-invalid-transition",
    );
  }
}

export function approve(
  proposal: ChangeProposal,
  options: ProposalApplicationOptions = {},
): Result<ChangeProposal, ProposalErrorCode> {
  try {
    const now = (options.now ?? (() => new Date()))();
    const next = transitionProposal(proposal, "approved", now);
    audit(options, event(next, "approved", now.toISOString()));
    return ok(next);
  } catch (error) {
    return err(
      error instanceof Error && error.message === "errors.proposal-expired"
        ? "errors.proposal-expired"
        : "errors.proposal-duplicate",
    );
  }
}

export function reject(
  proposal: ChangeProposal,
  options: ProposalApplicationOptions = {},
): Result<ChangeProposal, ProposalErrorCode> {
  try {
    const now = (options.now ?? (() => new Date()))();
    const next = transitionProposal(proposal, "rejected", now);
    audit(options, event(next, "rejected", now.toISOString()));
    return ok(next);
  } catch {
    return err("errors.proposal-duplicate");
  }
}

export async function applyApproved(
  proposal: ChangeProposal,
  options: ProposalApplicationOptions = {},
): Promise<Result<ChangeProposal, ProposalErrorCode>> {
  if (proposal.state !== "approved")
    return err("errors.proposal-invalid-transition");
  const dispatcher: ChangeDispatcher | undefined = options.dispatcher;
  if (!dispatcher) return err("errors.change-dispatch-unavailable");
  const now = (options.now ?? (() => new Date()))();
  let dispatch: ChangeDispatchResult;
  try {
    dispatch = await dispatcher.dispatch(proposal);
  } catch {
    // A dispatcher may have partially applied a change before reporting an
    // error. Give the injected port an opportunity to compensate, but never
    // invent a rollback success when that port is unavailable.
    const failed = {
      ...proposal,
      state: "rolled-back" as const,
      rollback: {
        ...proposal.rollback,
        status: "failed" as const,
        errorCode: dispatcher.rollback
          ? ("errors.rollback-failed" as const)
          : ("errors.rollback-unavailable" as const),
      },
    };
    if (dispatcher.rollback) {
      try {
        await dispatcher.rollback(proposal, { changeRef: "dispatch-failed" });
      } catch {
        audit(options, event(failed, "dispatch-failed", now.toISOString()));
        return err("errors.rollback-failed");
      }
    }
    audit(options, event(failed, "dispatch-failed", now.toISOString()));
    return err("errors.change-dispatch-failed");
  }
  const applied = {
    ...proposal,
    state: "applied" as const,
    appliedChangeRef: dispatch.changeRef,
    rollback: { ...proposal.rollback, status: "not-required" as const },
  };
  audit(options, event(applied, "applied", now.toISOString()));
  return ok(applied);
}

export async function rollbackApplied(
  proposal: ChangeProposal,
  dispatch: ChangeDispatchResult,
  options: ProposalApplicationOptions = {},
): Promise<Result<ChangeProposal, ProposalErrorCode>> {
  if (proposal.state !== "applied")
    return err("errors.proposal-invalid-transition");
  if (!options.dispatcher?.rollback) return err("errors.rollback-unavailable");
  const now = (options.now ?? (() => new Date()))();
  try {
    await options.dispatcher.rollback(proposal, dispatch);
  } catch {
    const failed = {
      ...proposal,
      state: "rolled-back" as const,
      rollback: {
        ...proposal.rollback,
        status: "failed" as const,
        errorCode: "errors.rollback-failed" as const,
      },
    };
    audit(options, event(failed, "rolled-back", now.toISOString()));
    return err("errors.rollback-failed");
  }
  const rolledBack = {
    ...proposal,
    state: "rolled-back" as const,
    rollback: { ...proposal.rollback, status: "succeeded" as const },
  };
  audit(options, event(rolledBack, "rolled-back", now.toISOString()));
  return ok(rolledBack);
}
