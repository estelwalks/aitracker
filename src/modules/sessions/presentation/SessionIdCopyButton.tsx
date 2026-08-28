import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { AITrackerButton } from "../../../components/aitracker.tsx";
import { useI18n } from "../../../lib/i18n/context.tsx";

/** Copies a safe public session id for tools that require manual recovery. */
export function SessionIdCopyButton({
  sessionId,
  size = "sm",
}: {
  sessionId: string;
  size?: "sm" | "md";
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      if (resetTimer.current !== undefined)
        window.clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copySessionId() {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopied(true);
      if (resetTimer.current !== undefined)
        window.clearTimeout(resetTimer.current);
      resetTimer.current = window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      toast.error(t("common.error"));
    }
  }

  return (
    <AITrackerButton
      size={size}
      variant="ghost"
      onClick={() => void copySessionId()}
      title={t(copied ? "sessions.row.copiedHash" : "sessions.row.copyHash")}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t("sessions.row.copiedHash") : t("sessions.row.copyHash")}
    </AITrackerButton>
  );
}
