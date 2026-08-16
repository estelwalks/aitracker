import { useEffect, useState } from "react";
import { Cpu, Loader2, LockKeyhole, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../components/ui/alert-dialog";
import { Segmented, StatusBadge, TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n/messages";
import {
  deleteModelProfile,
  listModelProfiles,
  setActiveModelProfile,
  testModelProfile,
  upsertModelProfile,
  OFFICIAL_ENDPOINT,
  OFFICIAL_MODEL,
  protocolMeta,
  type ModelProfileInput,
  type ModelProfileView,
} from "../../ai-orchestration/index.ts";
import { SectionHeading } from "./fields";

interface FormState {
  readonly id: string | null;
  readonly name: string;
  readonly mode: "official" | "custom";
  readonly protocol: "openai" | "anthropic";
  readonly apiKey: string;
  readonly endpoint: string;
  readonly model: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  mode: "official",
  protocol: "openai",
  apiKey: "",
  endpoint: "",
  model: "",
};

function toInput(form: FormState): ModelProfileInput {
  return {
    ...(form.id ? { id: form.id } : {}),
    ...(form.name.trim() ? { name: form.name.trim() } : {}),
    mode: form.mode,
    ...(form.mode === "custom" ? { protocol: form.protocol } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    ...(form.endpoint.trim() ? { endpoint: form.endpoint.trim() } : {}),
    ...(form.model.trim() ? { model: form.model.trim() } : {}),
  };
}

function fromProfile(profile: ModelProfileView | null): FormState {
  return profile
    ? {
        id: profile.id,
        name: profile.name,
        mode: profile.mode,
        protocol: profile.protocol,
        apiKey: "",
        endpoint: profile.endpoint ?? "",
        model: profile.model ?? "",
      }
    : EMPTY_FORM;
}

/**
 * S-500 「通用 AI 模型 Profile」设置区块：多 Profile 列表（激活 / 删除）、
 * 新增 / 编辑表单与「测试连接」。所有读写走 server fns；API Key 只存在
 * 服务端（0600 文件），这里的表单值仅用于提交与测试，绝不写 localStorage。
 */
export function ModelProfilesSection() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ModelProfileView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ModelProfileView | null>(
    null,
  );

  const load = async () => {
    try {
      const result = await listModelProfiles();
      setProfiles([...result.profiles]);
      setActiveId(result.activeProfileId);
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editingKeyMasked = profiles.some(
    (profile) => profile.id === form.id && profile.apiKeyMasked,
  );
  const keyOk =
    form.apiKey.trim().length === 0 || form.apiKey.trim().length >= 8;
  const formValid =
    keyOk &&
    (form.mode === "custom"
      ? form.name.trim().length > 0 && form.model.trim().length > 0
      : true) &&
    (form.id != null || form.apiKey.trim().length >= 8);

  const startNew = () => {
    setForm(EMPTY_FORM);
  };

  const editProfile = (profile: ModelProfileView) => {
    setForm(fromProfile(profile));
  };

  const chooseProfile = async (profile: ModelProfileView) => {
    if (profile.id === activeId) return;
    try {
      const result = await setActiveModelProfile({ data: { id: profile.id } });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      setActiveId(profile.id);
      toast.success(
        t("settings.modelProfiles.activatedToast", { name: profile.name }),
      );
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const result = await deleteModelProfile({
        data: { id: deleteTarget.id },
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
        t("settings.modelProfiles.deletedToast", { name: deleteTarget.name }),
      );
      if (form.id === deleteTarget.id) setForm(EMPTY_FORM);
      await load();
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  const doTest = async () => {
    setTesting(true);
    try {
      const result = await testModelProfile({ data: toInput(form) });
      if (!result.ok) {
        toast.error(
          result.errorCode
            ? t(result.errorCode as MessageKey)
            : t("common.failed"),
        );
        return;
      }
      toast.success(
        t("settings.modelProfiles.testSuccess", {
          latency: result.latencyMs ?? 0,
        }),
      );
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setTesting(false);
    }
  };

  const doSave = async () => {
    setSaving(true);
    try {
      const saved = await upsertModelProfile({ data: toInput(form) });
      setForm(fromProfile(saved));
      toast.success(
        t("settings.modelProfiles.savedToast", { name: saved.name }),
      );
      await load();
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SectionHeading icon={<Cpu className="size-3.5" />}>
        {t("settings.modelProfiles.title")}
      </SectionHeading>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {t("settings.modelProfiles.desc")}
      </p>
      <div className="mb-3 flex items-start gap-2 rounded-xl bg-ok/5 px-3.5 py-2.5 text-[11.5px] text-muted-foreground ring-1 ring-border/60">
        <LockKeyhole className="mt-0.5 size-4 shrink-0" />
        {t("settings.modelProfiles.storageNote")}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,230px)_minmax(0,1fr)]">
        {/* 左：Profile 列表 */}
        <div className="flex flex-col rounded-xl border border-border bg-surface-2">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="tt-label">
              {t("settings.modelProfiles.count", { count: profiles.length })}
            </span>
            <TTButton
              size="sm"
              variant="ghost"
              onClick={startNew}
              disabled={loading}
            >
              <Plus className="size-3.5" />
              {t("settings.modelProfiles.add")}
            </TTButton>
          </div>
          {loading ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              {t("common.loading")}
            </div>
          ) : profiles.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12px] text-muted-foreground">
              <div>{t("settings.modelProfiles.empty")}</div>
              <div className="mt-1 text-[11px] text-muted-foreground/70">
                {t("settings.modelProfiles.emptyHint")}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {profiles.map((profile) => {
                const active = profile.id === activeId;
                return (
                  <li
                    key={profile.id}
                    className={`group flex items-start gap-2 px-3 py-2 text-[12px] transition-colors ${
                      active ? "bg-accent/50" : "hover:bg-accent/30"
                    }`}
                  >
                    <button
                      type="button"
                      title={t("settings.modelProfiles.activateTitle")}
                      aria-pressed={active}
                      onClick={() => void chooseProfile(profile)}
                      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm border transition-colors ${
                        active ? "border-primary" : "border-border-strong"
                      }`}
                    >
                      {active && (
                        <span className="size-2 rounded-sm bg-primary" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => editProfile(profile)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate font-medium">
                          {profile.name}
                        </span>
                        {active && (
                          <StatusBadge tone="primary">
                            {t("settings.modelProfiles.active")}
                          </StatusBadge>
                        )}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge
                          tone={
                            profile.mode === "official" ? "primary" : "neutral"
                          }
                        >
                          {profile.mode === "official"
                            ? t("settings.modelProfiles.modeOfficial")
                            : t("settings.modelProfiles.modeCustom")}
                        </StatusBadge>
                        <span className="tt-num truncate text-[10.5px] text-muted-foreground">
                          {profile.protocol === "anthropic"
                            ? t("settings.modelProfiles.protocolAnthropic")
                            : t("settings.modelProfiles.protocolOpenai")}
                          {" · "}
                          {profile.model ?? "—"}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      title={t("settings.modelProfiles.delete")}
                      onClick={() => setDeleteTarget(profile)}
                      className="mt-0.5 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 右：新增 / 编辑表单 */}
        <div className="rounded-xl border border-border bg-surface-2 p-3.5">
          <div className="mb-3">
            <div className="text-[13px] font-semibold tracking-tight">
              {form.id
                ? t("settings.modelProfiles.formTitleEdit", {
                    name: form.name || "—",
                  })
                : t("settings.modelProfiles.formTitleNew")}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="tt-label mb-1.5">
                {t("settings.modelProfiles.modeLabel")}
              </div>
              <Segmented
                value={form.mode}
                onChange={(mode) =>
                  setForm((current) => ({
                    ...current,
                    mode,
                    protocol: mode === "official" ? "openai" : current.protocol,
                  }))
                }
                options={[
                  {
                    value: "official",
                    label: t("settings.modelProfiles.modeOfficial"),
                  },
                  {
                    value: "custom",
                    label: t("settings.modelProfiles.modeCustom"),
                  },
                ]}
              />
            </div>

            {form.mode === "official" && (
              <div className="rounded-lg bg-surface-1 px-3 py-2 font-mono text-[11px] text-muted-foreground ring-1 ring-border/60">
                {t("settings.modelProfiles.officialDesc", {
                  endpoint: OFFICIAL_ENDPOINT,
                  model: OFFICIAL_MODEL,
                })}
              </div>
            )}

            <div>
              <div className="tt-label mb-1.5">
                {t("settings.modelProfiles.nameLabel")}
              </div>
              <input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                placeholder={t("settings.modelProfiles.namePlaceholder")}
                maxLength={64}
                className="security-config-input"
              />
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {t("settings.modelProfiles.nameHint")}
              </p>
            </div>

            {form.mode === "custom" && (
              <>
                <div>
                  <div className="tt-label mb-1.5">
                    {t("settings.modelProfiles.protocolLabel")}
                  </div>
                  <Segmented
                    value={form.protocol}
                    onChange={(protocol) =>
                      setForm((current) => ({ ...current, protocol }))
                    }
                    options={[
                      {
                        value: "openai",
                        label: t("settings.modelProfiles.protocolOpenai"),
                      },
                      {
                        value: "anthropic",
                        label: t("settings.modelProfiles.protocolAnthropic"),
                      },
                    ]}
                  />
                </div>
                <div>
                  <div className="tt-label mb-1.5">
                    {t("settings.modelProfiles.endpointLabel")}
                  </div>
                  <input
                    value={form.endpoint}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        endpoint: event.target.value,
                      }))
                    }
                    placeholder={protocolMeta[form.protocol].endpoint}
                    type="url"
                    autoComplete="url"
                    className="security-config-input"
                  />
                </div>
                <div>
                  <div className="tt-label mb-1.5">
                    {t("settings.modelProfiles.modelLabel")}
                  </div>
                  <input
                    value={form.model}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder={t("settings.modelProfiles.modelPlaceholder")}
                    maxLength={120}
                    className="security-config-input"
                  />
                </div>
              </>
            )}

            <div>
              <div className="tt-label mb-1.5">
                {t("settings.modelProfiles.apiKeyLabel")}
              </div>
              <input
                type="password"
                value={form.apiKey}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    apiKey: event.target.value,
                  }))
                }
                placeholder={t("settings.modelProfiles.apiKeyPlaceholder")}
                autoComplete="new-password"
                className="security-config-input"
              />
              <p className="mt-1 text-[10.5px] text-muted-foreground">
                {editingKeyMasked
                  ? t("settings.modelProfiles.apiKeyConfigured")
                  : t("settings.modelProfiles.apiKeyHint")}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
            {form.id && (
              <TTButton
                size="sm"
                variant="ghost"
                onClick={startNew}
                disabled={saving || testing}
              >
                {t("settings.modelProfiles.cancelEdit")}
              </TTButton>
            )}
            <TTButton
              size="sm"
              onClick={() => void doTest()}
              disabled={!formValid || testing || saving}
            >
              {testing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Zap className="size-3.5" />
              )}
              {testing
                ? t("settings.modelProfiles.testing")
                : t("settings.modelProfiles.test")}
            </TTButton>
            <TTButton
              size="sm"
              variant="primary"
              onClick={() => void doSave()}
              disabled={!formValid || saving || testing}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {form.id
                ? t("settings.modelProfiles.saveEdit")
                : t("settings.modelProfiles.saveNew")}
            </TTButton>
          </div>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {t("settings.modelProfiles.reportsUseEnv")}
      </p>

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.modelProfiles.deleteDialogTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? t("settings.modelProfiles.deleteDialogDesc", {
                    name: deleteTarget.name,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void doDelete();
              }}
              disabled={saving}
              className="bg-danger text-danger-foreground hover:bg-danger/90"
            >
              {t("settings.modelProfiles.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
