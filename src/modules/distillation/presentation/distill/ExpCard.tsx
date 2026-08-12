import { Link } from "@tanstack/react-router";
import {
  Check,
  FileCode2,
  FolderOpen,
  Pencil,
  RefreshCw,
  Rocket,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { StatusBadge, TTButton } from "../../../../components/tt";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { toUiError } from "../../../../lib/errors";
import { useI18n } from "../../../../lib/i18n/context";
import type { MessageKey } from "../../../../lib/i18n/messages";
import { SKILL_AGENTS } from "../../../../lib/local-skills/types";
import type { CandidateOutput } from "../../contracts";
import { saveCandidateAsSkill } from "../../query";

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

function approvalLabel(
  state: CandidateOutput["approvalState"],
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (state === "approved") return t("distill.stateApproved");
  if (state === "cancelled") return t("distill.stateCancelled");
  return t("distill.stateWaiting");
}

function SkillFileBrowser({
  root,
  value,
  editing,
  onChange,
}: {
  root: string;
  value: string;
  editing: boolean;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="grid gap-3 md:grid-cols-[210px_minmax(0,1fr)]">
      <div className="rounded-xl bg-surface-2 p-2">
        <div className="flex items-center gap-1.5 px-1.5 pb-1.5 font-mono text-[10px] text-muted-foreground">
          <FolderOpen className="size-3.5 text-primary" /> {root}/
        </div>
        <button
          type="button"
          aria-pressed="true"
          className="flex w-full items-center gap-1.5 rounded-lg bg-primary/10 px-2 py-1.5 text-left font-mono text-[11px] text-primary ring-1 ring-primary/40"
        >
          <FileCode2 className="size-3" /> SKILL.md
        </button>
        <p className="mt-2 px-1.5 font-mono text-[9.5px] leading-relaxed text-muted-foreground">
          {t("distill.realFileHint")}
        </p>
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl bg-surface-2">
        <div className="flex items-center justify-between gap-2 px-3 py-2 font-mono text-[10px] text-muted-foreground">
          <span className="truncate">{root}/SKILL.md</span>
          <span>
            {t("distill.fileLines", { count: value.split("\n").length })}
          </span>
        </div>
        {editing ? (
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={10}
            className="min-h-64 w-full resize-y bg-transparent px-3 pb-3 font-mono text-[12px] leading-7 outline-none"
          />
        ) : (
          <div className="tt-scroll max-h-[380px] min-h-64 overflow-auto px-3 pb-3">
            <pre className="font-sans text-[12.5px] leading-7 whitespace-pre-wrap break-words text-foreground">
              {value}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Persisted result card with a truthful one-file browser. Candidates currently
 * expose only the generated note, so the tree contains SKILL.md and never
 * fabricates references/scripts to mimic prototype sample output.
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

  useEffect(() => {
    if (!editing) setDraft(candidate.summary);
  }, [candidate.summary, editing]);

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
      <article className="relative overflow-hidden rounded-xl bg-card ring-1 ring-border/60">
        <div className="absolute inset-y-0 left-0 w-[3px] bg-primary" />
        <header className="flex flex-wrap items-center gap-2 px-4 py-3">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
            {candidate.kind.toUpperCase()}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {candidate.title}
          </h3>
          <StatusBadge tone={APPROVAL_TONE[candidate.approvalState]}>
            {approvalLabel(candidate.approvalState, t)}
          </StatusBadge>
        </header>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 font-mono text-[10px] text-muted-foreground">
          <span>{format.formatDateTime(candidate.generatedAt, false)}</span>
          <span>
            {t("common.distillation.expMode")}: {candidate.mode}
          </span>
          <span>
            {t("common.distillation.selected", {
              count: candidate.selectedSessionRefs.length,
            })}
          </span>
          <span>{candidate.candidateId}</span>
        </div>

        {offline && (
          <div className="mx-4 mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            {t("common.distillation.expOfflineNotice")}
          </div>
        )}

        <div className="px-4 pb-3">
          <SkillFileBrowser
            root={suggestSkillName(candidate.title)}
            value={draft}
            editing={editing}
            onChange={setDraft}
          />
          {editing && (
            <p className="mt-1.5 text-[10.5px] text-muted-foreground">
              {t("distill.editHint")}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 px-4 pb-4">
          <TTButton
            variant="ghost"
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? (
              <FileCode2 className="size-3.5" />
            ) : (
              <Pencil className="size-3.5" />
            )}
            {editing ? t("distill.expBrowse") : t("distill.expEdit")}
          </TTButton>
          {pending && (
            <>
              <TTButton variant="primary" disabled={busy} onClick={onApprove}>
                <Check className="size-3.5" />{" "}
                {t("common.distillation.approve")}
              </TTButton>
              <TTButton variant="danger" disabled={busy} onClick={onCancel}>
                <X className="size-3.5" /> {t("common.distillation.cancel")}
              </TTButton>
            </>
          )}
          {!approved && (
            <TTButton variant="ghost" disabled={busy} onClick={onRegenerate}>
              <RefreshCw className="size-3.5" /> {t("distill.expRegenerate")}
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
                <Rocket className="size-3.5" /> {t("distill.expSaveInstall")}
              </TTButton>
              <Link to="/skills" className="ml-auto">
                <TTButton variant="ghost">
                  <Sparkles className="size-3.5" />{" "}
                  {t("common.distillation.saveAndManage")}
                </TTButton>
              </Link>
            </>
          )}
        </footer>
      </article>

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
              disabled={saving || !saveName.trim() || !saveTarget}
              onClick={handleSave}
            >
              <Save className="size-3.5" /> {t("distill.saveConfirm")}
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CandidateCompareDialog({
  candidates,
  onClose,
}: {
  candidates: readonly [CandidateOutput, CandidateOutput];
  onClose: () => void;
}) {
  const { t, format } = useI18n();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t("distill.compare")}</DialogTitle>
          <DialogDescription>{t("distill.compareDesc")}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-3 overflow-y-auto md:grid-cols-2">
          {candidates.map((candidate) => (
            <article
              key={candidate.candidateId}
              className="min-w-0 rounded-xl bg-surface-2 p-3"
            >
              <h3 className="truncate text-[12.5px] font-semibold">
                {candidate.title}
              </h3>
              <p className="mt-0.5 font-mono text-[9.5px] text-muted-foreground">
                {format.formatDateTime(candidate.generatedAt, false)} ·{" "}
                {candidate.mode}
              </p>
              <pre className="tt-scroll mt-3 max-h-[55vh] overflow-auto whitespace-pre-wrap break-words font-sans text-[12px] leading-6">
                {candidate.summary}
              </pre>
            </article>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
