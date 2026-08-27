import { Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AITrackerButton } from "../../../components/aitracker.tsx";
import { toUiError } from "../../../lib/errors.ts";
import { useI18n } from "../../../lib/i18n/context.tsx";
import { resumeSession } from "../query.ts";
import type { SessionSummary } from "../contracts.ts";

/**
 * Browser-side trigger for the constrained server recovery port. It sends only
 * the public source/session id pair and intentionally never obtains a command,
 * path, working directory, process output, or conversation body.
 */
export function ResumeSessionButton({
  session,
  size = "sm",
}: {
  session: Pick<SessionSummary, "source" | "sessionId" | "resumeAvailable">;
  size?: "sm" | "md";
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function startResume() {
    if (busy || !session.resumeAvailable) return;
    setBusy(true);
    try {
      const result = await resumeSession({
        data: { source: session.source, sessionId: session.sessionId },
      });
      if (result.accepted) toast.success(t("sessions.action.resumeAccepted"));
      else toast.error(t("common.error"));
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AITrackerButton
      size={size}
      variant={session.resumeAvailable ? "primary" : "ghost"}
      disabled={busy || !session.resumeAvailable}
      title={
        session.resumeAvailable
          ? undefined
          : t("sessions.action.resumeUnavailable")
      }
      onClick={startResume}
    >
      <Play className="size-3.5" />
      {busy ? t("sessions.action.resuming") : t("sessions.action.resume")}
    </AITrackerButton>
  );
}
