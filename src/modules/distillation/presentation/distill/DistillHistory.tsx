import { EmptyState, TTButton } from "../../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { useI18n } from "../../../../lib/i18n/context";
import type { CandidateOutput } from "../../contracts";
import { kindMeta } from "./out-types.ts";

function stateLabel(
  state: CandidateOutput["approvalState"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (state === "approved") return t("distill.stateApproved");
  if (state === "cancelled") return t("distill.stateCancelled");
  return t("distill.stateWaiting");
}

/**
 * Distill-history dialog (E-600): a projection of the real persisted
 * candidate list — kind, title, generated time and approval state — with a
 * "view" action that jumps to the matching result card. No fabricated runs.
 */
export function DistillHistoryDialog({
  candidates,
  onClose,
  onView,
}: {
  candidates: readonly CandidateOutput[];
  onClose: () => void;
  onView: (candidateId: string) => void;
}) {
  const { t, format } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("distill.historyTitle")}</DialogTitle>
          <DialogDescription>{t("distill.historyDesc")}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <EmptyState
              title={t("distill.historyEmpty")}
              desc={t("distill.historyEmptyDesc")}
            />
          ) : (
            <ul className="divide-y divide-border/40 overflow-hidden rounded-xl bg-surface-2/60">
              {candidates.map((candidate) => {
                const badge = kindMeta(candidate.kind);
                return (
                  <li
                    key={candidate.candidateId}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 font-mono text-[9.5px] font-semibold"
                          style={{
                            background: `color-mix(in oklab, ${badge.color} 16%, transparent)`,
                            color: badge.color,
                          }}
                        >
                          {t(badge.labelKey)}
                        </span>
                        <span className="truncate text-[12.5px] font-medium">
                          {candidate.title}
                        </span>
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-muted-foreground">
                        {format.formatDateTime(candidate.generatedAt, false)} ·{" "}
                        {stateLabel(candidate.approvalState, t)}
                      </span>
                    </span>
                    <TTButton
                      variant="ghost"
                      size="sm"
                      onClick={() => onView(candidate.candidateId)}
                    >
                      {t("distill.historyView")}
                    </TTButton>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
