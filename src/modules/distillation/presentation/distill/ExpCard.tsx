import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
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
import { useEffect, useMemo, useState } from "react";
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
import { isMemoryKind, kindMeta } from "./out-types.ts";

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

/** Deduplicated source names of the candidate's selected sessions. */
function sourceNames(candidate: CandidateOutput): string {
  return [...new Set(candidate.selectedSessionRefs.map((ref) => ref.source))]
    .join(" / ")
    .trim();
}

/** 原型 Act 胶囊按钮（rounded-full bg-surface-2）。 */
function Act({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: typeof Pencil;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-[11.5px] transition-opacity hover:opacity-80 disabled:opacity-40"
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
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
 * Persisted result card aligned with the prototype ExpCard (lines 1808-1958):
 * kind-color blur circle, saved chip, Act pill actions and a kind-colored save
 * button. Memory assets render in the memory-card style and lead to the memory
 * library; capability assets keep the skill file browser + install dialog.
 *
 * Real progress: candidates only exist after the synchronous server run, so no
 * card ever shows a running state; the in-flight "蒸馏中…" placeholder is
 * rendered by the page instead of faking a percentage here.
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
  const memoryAsset = isMemoryKind(candidate.kind);
  const badge = kindMeta(candidate.kind);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(candidate.summary);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState(() =>
    suggestSkillName(candidate.title),
  );
  const [saveTargets, setSaveTargets] = useState<string[]>(() => [
    ...SKILL_AGENTS,
  ]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(candidate.summary);
  }, [candidate.summary, editing]);

  const sources = useMemo(() => sourceNames(candidate), [candidate]);

  async function handleSave() {
    if (!saveName.trim() || saveTargets.length === 0) return;
    setSaving(true);
    const savedAgents: string[] = [];
    const failed: string[] = [];
    for (const agent of saveTargets) {
      try {
        const result = await saveCandidateAsSkill({
          data: {
            candidateId: candidate.candidateId,
            skillName: saveName.trim(),
            targetAgent: agent,
            content: draft,
          },
        });
        if (result.ok) {
          savedAgents.push(agent);
        } else {
          failed.push(agent);
        }
      } catch {
        failed.push(agent);
      }
    }
    setSaving(false);
    if (savedAgents.length > 0) {
      toast.success(
        savedAgents.length === 1
          ? t("distill.savedToast", { agent: savedAgents[0] })
          : t("distill.savedToastMulti", { count: savedAgents.length }),
      );
    }
    if (failed.length > 0) {
      toast.error(t("distill.savePartialFail", { agents: failed.join(", ") }));
    }
    if (failed.length === 0) setSaveOpen(false);
  }

  return (
    <>
      <article
        className="relative overflow-hidden rounded-xl bg-card"
        style={{ boxShadow: `inset 3px 0 0 ${badge.color}` }}
      >
        {/* 原型右上角模糊色圈（原型 1828-1831） */}
        <div
          className="pointer-events-none absolute -top-16 right-0 size-40 rounded-full opacity-[0.14] blur-3xl"
          style={{ background: badge.color }}
        />
        <header className="relative flex flex-wrap items-center gap-2 px-4 py-3">
          <span
            className="rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold"
            style={{
              background: `color-mix(in oklab, ${badge.color} 16%, transparent)`,
              color: badge.color,
            }}
          >
            {t(badge.labelKey)}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold">
            {candidate.title}
          </h3>
          <StatusBadge tone={APPROVAL_TONE[candidate.approvalState]}>
            {approvalLabel(candidate.approvalState, t)}
          </StatusBadge>
        </header>
        <div className="relative flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 font-mono text-[10px] text-muted-foreground">
          <span>{format.formatDateTime(candidate.generatedAt, false)}</span>
          <span>
            {t("common.distillation.expMode")}: {candidate.mode}
          </span>
          {sources && (
            <span>
              {t("distill.materialMeta", {
                count: candidate.selectedSessionRefs.length,
                sources,
              })}
            </span>
          )}
          <span>{candidate.candidateId}</span>
          {approved && (
            <span
              className="rounded-full px-2 py-0.5 font-semibold"
              style={{
                background:
                  "color-mix(in oklab, var(--chart-1) 16%, transparent)",
                color: "var(--chart-1)",
              }}
            >
              {memoryAsset
                ? t("distill.expSavedMemory")
                : t("distill.expSavedSkill")}
            </span>
          )}
        </div>

        {offline && (
          <div className="relative mx-4 mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] text-warn">
            {t("common.distillation.expOfflineNotice")}
          </div>
        )}

        {memoryAsset ? (
          <div className="relative px-4 pb-3">
            <div
              className="rounded-xl bg-surface-2 p-3"
              style={{ boxShadow: `inset 3px 0 0 ${badge.color}` }}
            >
              <div className="flex items-center gap-2">
                <Sparkles
                  className="size-3.5 shrink-0"
                  style={{ color: badge.color }}
                />
                <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {candidate.title}
                </p>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {t(badge.labelKey)}
                </span>
              </div>
              {editing ? (
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={8}
                  className="mt-2 min-h-[120px] w-full resize-y bg-transparent text-[12.5px] leading-7 outline-none"
                />
              ) : (
                <p className="tt-scroll mt-2 max-h-[380px] overflow-auto text-[12.5px] leading-7 text-foreground/85">
                  {draft}
                </p>
              )}
            </div>
            {editing && (
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">
                {t("distill.editHint")}
              </p>
            )}
          </div>
        ) : (
          <div className="relative px-4 pb-3">
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
        )}

        <footer className="relative flex flex-wrap items-center gap-2 px-4 pb-4">
          <Act
            icon={editing ? FileCode2 : Pencil}
            label={editing ? t("distill.expBrowse") : t("distill.expEdit")}
            onClick={() => setEditing((value) => !value)}
          />
          {pending && (
            <>
              <Act
                icon={Check}
                label={t("common.distillation.approve")}
                onClick={onApprove}
                disabled={busy}
              />
              <Act
                icon={X}
                label={t("common.distillation.cancel")}
                onClick={onCancel}
                disabled={busy}
              />
            </>
          )}
          {!approved && (
            <Act
              icon={RefreshCw}
              label={t("distill.expRegenerate")}
              onClick={onRegenerate}
              disabled={busy}
            />
          )}
          {approved && memoryAsset && (
            <Link to="/memory" className="ml-auto">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: badge.color }}
              >
                <ArrowRight className="size-3.5" /> {t("distill.memoryGo")}
              </span>
            </Link>
          )}
          {approved && !memoryAsset && (
            <>
              <button
                type="button"
                onClick={() => {
                  setSaveName(suggestSkillName(candidate.title));
                  setSaveTargets([...SKILL_AGENTS]);
                  setSaveOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: badge.color }}
              >
                <Rocket className="size-3.5" /> {t("distill.expSaveInstall")}
              </button>
              <Link to="/skills" className="ml-auto">
                <Act
                  icon={Sparkles}
                  label={t("common.distillation.saveAndManage")}
                />
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
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <label className="block text-[11px] text-muted-foreground">
                  {t("distill.saveTargets")}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setSaveTargets((current) =>
                      current.length === SKILL_AGENTS.length
                        ? []
                        : [...SKILL_AGENTS],
                    )
                  }
                  className="rounded-full bg-accent/50 px-2.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent"
                >
                  {saveTargets.length === SKILL_AGENTS.length
                    ? t("distill.saveClearAll")
                    : t("distill.saveSelectAll")}
                </button>
              </div>
              <p className="mb-2 text-[11px] text-muted-foreground">
                {t("distill.saveTargetHint")}
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {SKILL_AGENTS.map((agent) => {
                  const on = saveTargets.includes(agent);
                  return (
                    <button
                      key={agent}
                      type="button"
                      onClick={() =>
                        setSaveTargets((current) =>
                          on
                            ? current.filter((item) => item !== agent)
                            : [...current, agent],
                        )
                      }
                      aria-pressed={on}
                      className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] transition-colors ${
                        on
                          ? "bg-primary/15 text-foreground"
                          : "bg-accent/25 text-foreground hover:bg-accent/50"
                      }`}
                    >
                      <span
                        className={`grid size-4 shrink-0 place-items-center rounded-md ${
                          on
                            ? "bg-primary text-primary-foreground"
                            : "bg-accent"
                        }`}
                      >
                        {on && <Check className="size-3" />}
                      </span>
                      <span className="truncate">{agent}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter>
            <span className="mr-auto self-center font-mono text-[10.5px] text-muted-foreground">
              {t("distill.saveTargetsSelected", {
                count: saveTargets.length,
                total: SKILL_AGENTS.length,
              })}
            </span>
            <TTButton
              variant="ghost"
              disabled={saving}
              onClick={() => setSaveOpen(false)}
            >
              {t("common.close")}
            </TTButton>
            <TTButton
              variant="primary"
              disabled={saving || !saveName.trim() || saveTargets.length === 0}
              onClick={handleSave}
            >
              <Save className="size-3.5" /> {t("distill.saveInstall")}
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
