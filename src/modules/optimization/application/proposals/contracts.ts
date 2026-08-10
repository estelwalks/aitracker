import type { OptimizationFinding } from "../../contracts.ts";

export type ApprovalState =
  | "draft"
  | "waiting-approval"
  | "approved"
  | "rejected"
  | "applied"
  | "rolled-back";

export type ChangeOperationKind =
  "review-pricing" | "review-cache" | "deduplicate-config" | "review-project";

/** A safe, declarative operation. It contains no path, command, prompt or secret. */
export interface ChangeOperation {
  readonly kind: ChangeOperationKind;
  readonly targetRef: string;
  readonly configKey: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface ChangeImpact {
  readonly kind: "cost" | "savings" | "coverage" | "efficiency";
  readonly confidence: "exact" | "estimated" | "unknown";
  readonly amountUsd?: number;
  readonly unit?: "usd" | "ratio" | "events" | "projects";
}

export interface ChangeRollback {
  readonly supported: boolean;
  readonly status: "pending" | "succeeded" | "failed" | "not-required";
  readonly strategy: "inverse-operation" | "unavailable";
  readonly errorCode?: "errors.rollback-unavailable" | "errors.rollback-failed";
}

export interface ProposalEvidence {
  readonly evidenceRef: string;
  readonly observedAt: string;
}

export interface ChangeProposal {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly state: ApprovalState;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly findingId: string;
  readonly operations: readonly ChangeOperation[];
  readonly impact: ChangeImpact;
  readonly evidence: readonly ProposalEvidence[];
  readonly rollback: ChangeRollback;
  readonly rejectionReason?: "user-rejected" | "expired";
  readonly appliedChangeRef?: string;
}

export interface ProposalAuditEvent {
  readonly type: "optimization.proposal.audit";
  readonly schemaVersion: 1;
  readonly proposalId: string;
  readonly state: ApprovalState;
  readonly action:
    | "created"
    | "requested"
    | "approved"
    | "rejected"
    | "applied"
    | "rolled-back"
    | "dispatch-failed";
  readonly occurredAt: string;
  readonly summary: Readonly<Record<string, string | number | boolean | null>>;
}

export interface ChangeDispatchResult {
  readonly changeRef: string;
  readonly rollbackToken?: string;
}

export interface ChangeDispatcher {
  readonly dispatch: (
    proposal: ChangeProposal,
  ) => Promise<ChangeDispatchResult>;
  readonly rollback?: (
    proposal: ChangeProposal,
    dispatch: ChangeDispatchResult,
  ) => Promise<void>;
}

export interface ProposalApplicationOptions {
  readonly now?: () => Date;
  readonly ttlMs?: number;
  readonly dispatcher?: ChangeDispatcher;
  readonly audit?: (event: ProposalAuditEvent) => void;
}

export type ProposalErrorCode =
  | "errors.proposal-invalid-transition"
  | "errors.proposal-expired"
  | "errors.proposal-duplicate"
  | "errors.change-dispatch-unavailable"
  | "errors.change-dispatch-failed"
  | "errors.rollback-unavailable"
  | "errors.rollback-failed";

export interface ProposalInput {
  readonly finding: OptimizationFinding;
  readonly now?: string;
  readonly expiresAt?: string;
}
