import type { ChangeProposal } from "../../optimization/application/proposals/contracts.ts";
import type { SkillPackage } from "../../skill-catalog/contracts.ts";
import type {
  DistributionRun,
  DistributionRunRef,
  InstallPlan,
  RollbackResult,
  TargetCapability,
  TargetPlatform,
  TargetRef,
} from "../contracts.ts";

/** Backward-compatible module contract export used by the feature barrel. */
export type { SkillDistributionModuleContract as SkillDistributionViewModel } from "../contracts.ts";

/** Declarative capability verdict shown by the confirmation dialog. */
export type CapabilityVerdict =
  "ready" | "read-only" | "planned" | "unsupported";

/** A redacted, renderer-safe line. It intentionally has no path or command field. */
export interface DiffLine {
  readonly kind: "add" | "remove" | "change" | "unchanged";
  readonly label: string;
  readonly before?: string;
  readonly after?: string;
}

export interface TargetSummary {
  /** Opaque target identity; no filesystem location is included. */
  readonly targetRef: TargetRef;
  readonly agentId: string;
  readonly platform: TargetPlatform;
  readonly capability: CapabilityVerdict;
  readonly securityVerdict: SkillPackage["verdict"];
  readonly status: "ready" | "planned" | "unsupported" | "blocked";
}

export type ConfirmationStatus =
  | "preview"
  | "awaiting-confirmation"
  | "approved"
  | "rejected"
  | "succeeded"
  | "failed"
  | "rolled-back";

export interface MigrationConfirmationViewModel {
  readonly kind: "install" | "uninstall" | "change";
  readonly status: ConfirmationStatus;
  readonly planRef?: InstallPlan["planRef"];
  readonly proposalRef?: ChangeProposal["id"];
  readonly runRef?: DistributionRunRef;
  readonly targetSummaries: readonly TargetSummary[];
  readonly diff: readonly DiffLine[];
  readonly approval: "pending" | "approved" | "rejected";
  readonly rollback:
    "available" | "unavailable" | "succeeded" | "failed" | "not-required";
  readonly errorCode?: `errors.${string}`;
}

export type ApprovalAction =
  | { readonly kind: "confirm" }
  | { readonly kind: "reject" }
  | { readonly kind: "rollback" };

export interface ConfirmationInput {
  readonly plan: InstallPlan;
  readonly targets: readonly TargetCapability[];
  readonly package: Pick<
    SkillPackage,
    "verdict" | "installability" | "name" | "version"
  >;
  readonly diff?: readonly DiffLine[];
  readonly proposal?: ChangeProposal;
  readonly run?: DistributionRun;
  readonly rollback?: RollbackResult;
  readonly errorCode?: `errors.${string}`;
}

const REDACTED = "[redacted]";

function redact(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  // Diff text is supplied by server adapters. Never let locations, commands or
  // credentials cross the renderer boundary, even when an adapter misbehaves.
  if (
    /(?:[A-Za-z]:[\\/]|(?:^|\s)\/[^\s]+|(?:bearer|token|secret|password)\s*(?:[:=]|\s)|\b(?:sk-[A-Za-z0-9]|sk_live_[A-Za-z0-9])|\b(?:curl|wget|rm|chmod|powershell|bash|zsh|npm|node|git)\b|(?:api[_-]?key|access[_-]?token)\s*[:=])/i.test(
      value,
    )
  )
    return REDACTED;
  return value.slice(0, 160);
}

function diffLine(line: DiffLine): DiffLine {
  return {
    kind: line.kind,
    label: redact(line.label) ?? REDACTED,
    ...(line.before === undefined ? {} : { before: redact(line.before) }),
    ...(line.after === undefined ? {} : { after: redact(line.after) }),
  };
}

function capability(target: TargetCapability): CapabilityVerdict {
  if (target.support === "planned") return "planned";
  if (target.support === "unsupported" || target.skills === "unsupported")
    return "unsupported";
  if (target.skills === "read") return "read-only";
  return "ready";
}

function status(
  target: TargetCapability,
  security: SkillPackage["verdict"],
): TargetSummary["status"] {
  const verdict = capability(target);
  if (security !== "clean" || verdict === "unsupported") return "blocked";
  if (verdict === "planned") return "planned";
  return "ready";
}

function runStatus(input: ConfirmationInput): ConfirmationStatus {
  if (input.rollback)
    return input.rollback.status === "succeeded" ? "rolled-back" : "failed";
  if (input.run)
    return input.run.status === "succeeded"
      ? "succeeded"
      : input.run.status === "rolled-back"
        ? "rolled-back"
        : "failed";
  if (input.errorCode) return "failed";
  if (input.plan.approval.status === "approved") return "approved";
  if (input.plan.approval.status === "rejected") return "rejected";
  return "preview";
}

/** Builds the only install/migration state that may be sent to a renderer. */
export function createMigrationConfirmationViewModel(
  input: ConfirmationInput,
): MigrationConfirmationViewModel {
  const summaries = input.targets.map((target) => ({
    targetRef: target.targetRef,
    agentId: target.agentId,
    platform: target.platform,
    capability: capability(target),
    securityVerdict: input.package.verdict,
    status: status(target, input.package.verdict),
  }));
  const blocked = summaries.some((target) => target.status !== "ready");
  const rollback = input.rollback
    ? input.rollback.status
    : input.run?.status === "succeeded"
      ? "not-required"
      : input.run?.status === "rolled-back"
        ? "succeeded"
        : "available";
  return {
    kind: "install",
    status:
      blocked && !input.run && !input.rollback ? "preview" : runStatus(input),
    planRef: input.plan.planRef,
    ...(input.proposal ? { proposalRef: input.proposal.id } : {}),
    ...(input.run ? { runRef: input.run.runRef } : {}),
    targetSummaries: summaries,
    diff: (input.diff ?? []).map(diffLine),
    approval: input.plan.approval.status,
    rollback,
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };
}

export const previewMigrationConfirmation =
  createMigrationConfirmationViewModel;
