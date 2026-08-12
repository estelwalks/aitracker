import { Link } from "@tanstack/react-router";
import {
  Check,
  FileCode2,
  Pencil,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Panel, StatusBadge, TTButton } from "../../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { useI18n } from "../../../../lib/i18n/context";
import { toUiError } from "../../../../lib/errors";
import type { MessageKey } from "../../../../lib/i18n/messages";
import { SKILL_AGENTS } from "../../../../lib/local-skills/types";
import { saveCandidateAsSkill } from "../../query";
import type { CandidateOutput } from "../../contracts";

const APPROVAL_TONE: Record<
  CandidateOutput["approvalState"],
  "neutral" | "primary" | "ok" | "warn" | "danger"
> = {
  "waiting-approval": "warn",
  approved: "ok",
  cancelled: "neutral",
};

function suggestSkillName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "distilled-skill";
}

/**
 * Experiment card for a distillation candidate, aligned with the prototype:
 * SKILL.md directory browse, edit, regenerate and — for approved candidates —
 * "save & install" which writes the note as a local Skill.
 */
export function ExpCard({
  candidate,
  busy,
  onApprove,
  onCancel,
  onRegenerate,
}: {
  candidate: CandidateOutput;
  busy: boolean;
  onApprove: () => void;
  onCancel: () => void;
  onRegenerate: () => void;
}) {
  const { t, format } = useI18n();
  const offline =
    candidate.mode === "offline" || candidate.execution.status === "offline";
  const pending = candidate.approvalState === "waiting-approval";
  const approved = candidate.approvalState === "approved";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(candidate.summary);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(() =>
    suggestSkillName(candidate.title),
  );
  const [saveTarget, setSaveTarget] = useState(SKILL_AGENTS[0] ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const result = await saveCandidateAsSkill({
        data: {
          candidateId: candidate.candidateId,
          skillName: saveName.trim(),
          targetAgent: saveTarget,
          content: draft,
        },
      });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      toast.success(
        t("distill.savedToast", { agent: result.agent ?? saveTarget }),
      );
      setSaveOpen(false);
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Panel
        title={
          <span className="flex items-center gap-2">
            <FileCode2 className="size-3.5 text-primary" />
            {candidate.title}
          </span>
        }
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

        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.08em] text-muted-foreground">
            SKILL.md
          </span>
          <TTButton
            size="sm"
            variant="ghost"
            onClick={() => setEditing((current) => !current)}
          >
            {editing ? (
              <>
                <FileCode2 className="size-3.5" />
                {t("distill.expBrowse")}
              </>
            ) : (
              <>
                <Pencil className="size-3.5" />
                {t("distill.expEdit")}
              </>
            )}
          </TTButton>
        </div>

        {editing ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={6}
            className="w-full resize-y rounded-lg bg-surface-2/60 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-primary/30"
          />
        ) : (
          <div className="tt-md rounded-lg bg-surface-2/60 px-3 py-2.5 font-mono text-[12px] leading-relaxed">
            {candidate.summary || t("common.distillation.candidateNote")}
          </div>
        )}
        {editing && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {t("distill.editHint")}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {pending && (
            <>
              <TTButton variant="primary" disabled={busy} onClick={onApprove}>
                <Check className="size-3.5" />
                {t("common.distillation.approve")}
              </TTButton>
              <TTButton variant="danger" disabled={busy} onClick={onCancel}>
                <X className="size-3.5" />
                {t("common.distillation.cancel")}
              </TTButton>
            </>
          )}
          {!approved && (
            <TTButton variant="ghost" disabled={busy} onClick={onRegenerate}>
              <RefreshCw className="size-3.5" />
              {t("distill.expRegenerate")}
            </TTButton>
          )}
          {approved && (
            <>
              <TTButton
                variant="primary"
                disabled={busy}
                onClick={() => {
                  setSaveName(suggestSkillName(candidate.title));
                  setSaveOpen(true);
                }}
              >
                <Save className="size-3.5" />
                {t("distill.expSaveInstall")}
              </TTButton>
              <Link to="/skills" className="ml-auto">
                <TTButton variant="ghost">
                  <Sparkles className="size-3.5" />
                  {t("common.distillation.saveAndManage")}
                </TTButton>
              </Link>
            </>
          )}
        </div>
      </Panel>

      <Dialog
        open={saveOpen}
        onOpenChange={(open) => !open && setSaveOpen(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("distill.saveTitle")}</DialogTitle>
            <DialogDescription>{t("distill.saveDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-[11px] text-muted-foreground">
                {t("distill.saveName")}
              </label>
              <input
                value={saveName}
                onChange={(event) => setSaveName(event.target.value)}
                className="h-9 w-full rounded-lg bg-surface-2/70 px-3 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] text-muted-foreground">
                {t("distill.saveTarget")}
              </label>
              <select
                value={saveTarget}
                onChange={(event) => setSaveTarget(event.target.value)}
                className="h-9 w-full rounded-lg bg-surface-2/70 px-2.5 text-[13px] outline-none focus:ring-2 focus:ring-primary/30"
              >
                {SKILL_AGENTS.map((agent) => (
                  <option key={agent} value={agent}>
                    {agent}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <TTButton
              variant="ghost"
              disabled={saving}
              onClick={() => setSaveOpen(false)}
            >
              {t("common.close")}
            </TTButton>
            <TTButton
              variant="primary"
              disabled={saving || !saveName.trim()}
              onClick={handleSave}
            >
              <Save className="size-3.5" />
              {t("distill.saveConfirm")}
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
