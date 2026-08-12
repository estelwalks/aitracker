import { Link } from "@tanstack/react-router";
import { Check, Sparkles, X } from "lucide-react";

import { Panel, StatusBadge, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import type { CandidateOutput } from "../../contracts.ts";

const APPROVAL_TONE: Record<
  CandidateOutput["approvalState"],
  "neutral" | "primary" | "ok" | "warn" | "danger"
> = {
  "waiting-approval": "warn",
  approved: "ok",
  cancelled: "neutral",
};

/**
 * Experiment card for the latest distillation candidate. Shows the real
 * candidate fields plus an explicit offline/fallback marker when the run used
 * the deterministic fallback — the fallback text is never presented as a real
 * model result.
 */
export function ExpCard({
  candidate,
  busy,
  onApprove,
  onCancel,
}: {
  candidate: CandidateOutput;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
}) {
  const { t, format } = useI18n();
  const offline =
    candidate.mode === "offline" || candidate.execution.status === "offline";
  const pending = candidate.approvalState === "waiting-approval";

  return (
    <Panel
      title={candidate.title}
      action={
        <StatusBadge tone={APPROVAL_TONE[candidate.approvalState]}>
          {candidate.approvalState}
        </StatusBadge>
      }
    >
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tt-num">
          {t("common.distillation.expMode")}: {candidate.mode}
        </span>
        <span className="tt-num">
          {t("common.distillation.expTime")}:{" "}
          {format.formatDateTime(candidate.generatedAt, false)}
        </span>
        <span className="tt-num">
          {t("common.distillation.selected")}:{" "}
          {candidate.selectedSessionRefs.length}
        </span>
      </div>

      {offline && (
        <div className="mb-3 rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
          {t("common.distillation.expOfflineNotice")}
        </div>
      )}

      <div className="tt-md rounded-lg bg-surface-2/60 px-3 py-2.5">
        {candidate.summary || t("common.distillation.candidateNote")}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <TTButton
          variant="primary"
          disabled={busy || !pending}
          onClick={onApprove}
        >
          <Check className="size-3.5" />
          {t("common.distillation.approve")}
        </TTButton>
        <TTButton
          variant="danger"
          disabled={busy || !pending}
          onClick={onCancel}
        >
          <X className="size-3.5" />
          {t("common.distillation.cancel")}
        </TTButton>
        {candidate.approvalState === "approved" && (
          <Link to="/skills" className="ml-auto">
            <TTButton variant="ghost">
              <Sparkles className="size-3.5" />
              {t("common.distillation.saveAndManage")}
            </TTButton>
          </Link>
        )}
      </div>
    </Panel>
  );
}
