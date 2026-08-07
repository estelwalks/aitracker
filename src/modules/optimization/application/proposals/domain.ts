import type { OptimizationFinding } from "../../contracts.ts";
import type {
  ApprovalState,
  ChangeImpact,
  ChangeOperation,
  ChangeProposal,
  ProposalInput,
} from "./contracts.ts";

function opaque(value: string): string {
  let hash = 2166136261;
  for (const char of value)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `opaque-${(hash >>> 0).toString(16)}`;
}

function safeTarget(finding: OptimizationFinding): string {
  return finding.projectId ?? finding.id;
}

function operationFor(finding: OptimizationFinding): ChangeOperation {
  const kind = finding.recommendation?.action ?? "review-project";
  return {
    kind,
    targetRef: opaque(safeTarget(finding)),
    configKey: `optimization.${kind}`,
    before: null,
    after: "review-required",
  };
}

function impactFor(finding: OptimizationFinding): ChangeImpact {
  const impact =
    finding.estimatedImpact ?? finding.recommendation?.estimatedImpact;
  return impact
    ? { ...impact }
    : { kind: "coverage", confidence: "unknown", unit: "events" };
}

export function createChangeProposal(input: ProposalInput): ChangeProposal {
  const createdAt = input.now ?? new Date().toISOString();
  const expiresAt =
    input.expiresAt ??
    new Date(Date.parse(createdAt) + 86_400_000).toISOString();
  const finding = input.finding;
  return {
    id: `proposal:${opaque(`${finding.id}:${createdAt}`)}`,
    schemaVersion: 1,
    state: "draft",
    createdAt,
    expiresAt,
    findingId: opaque(finding.id),
    operations: [operationFor(finding)],
    impact: impactFor(finding),
    evidence: [{ evidenceRef: finding.evidenceRef, observedAt: createdAt }],
    rollback: {
      supported: true,
      status: "pending",
      strategy: "inverse-operation",
    },
  };
}

const transitions: Record<ApprovalState, readonly ApprovalState[]> = {
  draft: ["waiting-approval", "rejected"],
  "waiting-approval": ["approved", "rejected"],
  approved: ["applied", "rolled-back"],
  applied: ["rolled-back"],
  rejected: [],
  "rolled-back": [],
};

export function canTransition(from: ApprovalState, to: ApprovalState): boolean {
  return transitions[from].includes(to);
}

export function transitionProposal(
  proposal: ChangeProposal,
  to: ApprovalState,
  now = new Date(),
): ChangeProposal {
  if (!canTransition(proposal.state, to))
    throw new Error("errors.proposal-invalid-transition");
  if (now.getTime() > Date.parse(proposal.expiresAt) && to !== "rejected")
    throw new Error("errors.proposal-expired");
  return {
    ...proposal,
    state: to,
    ...(to === "rejected"
      ? {
          rejectionReason:
            now.getTime() > Date.parse(proposal.expiresAt)
              ? "expired"
              : "user-rejected",
        }
      : {}),
  };
}
