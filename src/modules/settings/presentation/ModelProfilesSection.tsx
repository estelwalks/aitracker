import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Trash2, Zap } from "lucide-react";
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
import { StatusBadge, TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import { toUiError } from "../../../lib/errors";
import type { MessageKey } from "../../../lib/i18n/messages";
import {
  deleteModelProfile,
  listModelProfiles,
  listRemoteModels,
  setActiveModelProfile,
  testModelProfile,
  upsertModelProfile,
  OFFICIAL_ENDPOINT,
  OFFICIAL_MODEL,
  defaultAuth,
  protocolMeta,
  type ModelProfileInput,
  type ModelProfileView,
  type ProfileAuth,
} from "../../ai-orchestration/index.ts";

interface FormState {
  readonly id: string | null;
  readonly name: string;
  readonly mode: "official" | "custom";
  readonly protocol: "openai" | "anthropic";
  readonly auth: ProfileAuth;
  readonly apiKey: string;
  readonly endpoint: string;
  readonly model: string;
  readonly models: string[];
  readonly listing: boolean;
  readonly listMsg: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  mode: "official",
  protocol: "openai",
  auth: "x-api-key",
  apiKey: "",
  endpoint: "",
  model: "",
  models: [],
  listing: false,
  listMsg: "",
};

function toInput(form: FormState): ModelProfileInput {
  return {
    ...(form.id ? { id: form.id } : {}),
    ...(form.name.trim() ? { name: form.name.trim() } : {}),
    mode: form.mode,
    ...(form.mode === "custom" ? { protocol: form.protocol } : {}),
    ...(form.mode === "custom" ? { auth: form.auth } : {}),
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
        auth: profile.auth,
        apiKey: "",
        endpoint: profile.endpoint ?? "",
        model: profile.model ?? "",
        models: [],
        listing: false,
        listMsg: "",
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

  const keyOk =
    form.apiKey.trim().length === 0 || form.apiKey.trim().length >= 8;
  const formValid =
    keyOk &&
    (form.mode === "custom"
      ? form.name.trim().length > 0 && form.model.trim().length > 0
      : true) &&
    (form.id != null || form.apiKey.trim().length >= 8);

  const activeView =
    profiles.find((profile) => profile.id === activeId) ?? null;

  const describeProfile = (view: ModelProfileView | null): string => {
    if (!view) return "—";
    if (view.mode === "official") {
      return `${t("settings.modelProfiles.officialDefault")} · ${OFFICIAL_MODEL}`;
    }
    const protocolLabel =
      view.protocol === "anthropic"
        ? t("settings.modelProfiles.protocolAnthropic")
        : t("settings.modelProfiles.protocolOpenai");
    return `${protocolLabel} · ${view.model ?? "—"}`;
  };

  const canList = form.apiKey.trim() !== "" || form.id != null;

  const loadModels = async () => {
    if (!canList || form.listing) return;
    setForm((current) => ({ ...current, listing: true, listMsg: "" }));
    try {
      const result = await listRemoteModels({
        data: {
          id: form.id ?? undefined,
          mode: form.mode,
          protocol: form.protocol,
          auth: form.auth,
          ...(form.endpoint.trim() ? { endpoint: form.endpoint.trim() } : {}),
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        },
      });
      const nextModels = [...(result.models ?? [])];
      setForm((current) => ({
        ...current,
        models: nextModels,
        listing: false,
        listMsg: result.ok
          ? result.source === "remote"
            ? t("settings.modelProfiles.listModelsDone", {
                count: nextModels.length,
              })
            : t("settings.modelProfiles.listModelsFallback")
          : "",
        model: current.model.trim()
          ? current.model
          : (nextModels[0] ?? current.model),
      }));
      if (!result.ok && result.errorCode) {
        toast.error(t(result.errorCode as MessageKey));
      }
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
      setForm((current) => ({ ...current, listing: false }));
    }
  };

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
    <>
      <div className="grid gap-3 xl:grid-cols-[240px_minmax(0,1fr)]">
        {/* 左：Profile 列表 */}
        <div className="flex flex-col rounded-sm border border-border bg-surface-2">
          <div className="border-b border-border px-3 py-2">
            <span className="tt-label">
              {t("settings.modelProfiles.count", { count: profiles.length })}
            </span>
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
                      <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
                        {profile.mode === "official"
                          ? `DeepSeek · ${OFFICIAL_MODEL}`
                          : `${t(
                              profile.protocol === "anthropic"
                                ? "settings.modelProfiles.protocolAnthropic"
                                : "settings.modelProfiles.protocolOpenai",
                            )} · ${profile.model ?? "—"}`}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground/70">
                        {profile.apiKeyMasked
                          ? "••••••••"
                          : t("settings.modelProfiles.missingKey")}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={t("settings.modelProfiles.delete")}
                      onClick={() => setDeleteTarget(profile)}
                      className="mt-0.5 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-auto border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
            {t("settings.modelProfiles.currentActive")}：
            <span className="tt-num text-foreground">
              {describeProfile(activeView)}
            </span>
          </div>
        </div>

        {/* 右：新增 / 编辑表单 */}
        <div className="flex flex-col rounded-sm border border-border bg-surface-2">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="tt-label min-w-0 truncate">
              {form.id
                ? t("settings.modelProfiles.formTitleEdit", {
                    name: form.name || "—",
                  })
                : t("settings.modelProfiles.formTitleNew")}
            </span>
          </div>

          <div className="@container space-y-3 p-3">
            {/* 模式选择 */}
            <div className="grid gap-2 @md:grid-cols-2">
              {(
                [
                  {
                    v: "official",
                    label: t("settings.modelProfiles.modeOfficialCard"),
                    desc: t("settings.modelProfiles.officialDesc", {
                      endpoint: OFFICIAL_ENDPOINT,
                      model: OFFICIAL_MODEL,
                    }),
                  },
                  {
                    v: "custom",
                    label: t("settings.modelProfiles.modeCustomCard"),
                    desc: t("settings.modelProfiles.modeCustomCardDesc"),
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.v}
                  className={`flex cursor-pointer items-start gap-2.5 rounded-sm border px-3 py-2.5 transition-colors ${
                    form.mode === option.v
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border-strong"
                  }`}
                >
                  <input
                    type="radio"
                    name="ai-mode"
                    checked={form.mode === option.v}
                    onChange={() =>
                      setForm((current) => ({
                        ...current,
                        mode: option.v,
                        protocol:
                          option.v === "official" ? "openai" : current.protocol,
                      }))
                    }
                    className="mt-0.5 accent-[var(--color-primary)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px]">{option.label}</span>
                    <span className="tt-num block text-[11px] text-muted-foreground">
                      {option.desc}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            {form.mode === "official" && (
              <div>
                <div className="tt-label mb-1">
                  {t("settings.modelProfiles.apiKeyLabel")}{" "}
                  <span className="text-danger">*</span>
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
                  {form.id
                    ? t("settings.modelProfiles.apiKeyConfigured")
                    : t("settings.modelProfiles.apiKeyHint")}
                </p>
              </div>
            )}

            {form.mode === "custom" && (
              <div className="space-y-3 rounded-sm border border-border bg-surface-2 p-3">
                <div>
                  <div className="tt-label mb-1">
                    {t("settings.modelProfiles.nameLabel")}{" "}
                    <span className="text-danger">*</span>
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

                <div>
                  <div className="tt-label mb-1.5">
                    {t("settings.modelProfiles.protocolLabel")}
                  </div>
                  <div className="grid gap-2 @md:grid-cols-2">
                    {(["openai", "anthropic"] as const).map((protocol) => (
                      <button
                        key={protocol}
                        type="button"
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            protocol,
                            auth: defaultAuth(protocol),
                            models: [],
                          }))
                        }
                        className={`rounded-sm border px-2.5 py-2 text-left transition-colors ${
                          form.protocol === protocol
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-border-strong"
                        }`}
                      >
                        <span className="block text-[12px] text-foreground">
                          {t(
                            protocol === "openai"
                              ? "settings.modelProfiles.protocolOpenai"
                              : "settings.modelProfiles.protocolAnthropic",
                          )}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {t(
                            protocol === "openai"
                              ? "settings.modelProfiles.protocolOpenaiHint"
                              : "settings.modelProfiles.protocolAnthropicHint",
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {form.protocol === "anthropic" && (
                  <div>
                    <div className="tt-label mb-1.5">
                      {t("settings.modelProfiles.authLabel")}
                    </div>
                    <div className="grid gap-2 @md:grid-cols-2">
                      {(["x-api-key", "bearer"] as const).map((auth) => (
                        <button
                          key={auth}
                          type="button"
                          onClick={() =>
                            setForm((current) => ({ ...current, auth }))
                          }
                          className={`rounded-sm border px-2.5 py-2 text-left transition-colors ${
                            form.auth === auth
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-border-strong"
                          }`}
                        >
                          <span className="block text-[12px] text-foreground">
                            {t(
                              auth === "x-api-key"
                                ? "settings.modelProfiles.authXApiKey"
                                : "settings.modelProfiles.authBearer",
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {t(
                              auth === "x-api-key"
                                ? "settings.modelProfiles.authXApiKeyHint"
                                : "settings.modelProfiles.authBearerHint",
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid gap-3 @md:grid-cols-2">
                  <div className="min-w-0">
                    <div className="tt-label mb-1">
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
                      placeholder={t(
                        "settings.modelProfiles.apiKeyPlaceholder",
                      )}
                      autoComplete="new-password"
                      className="security-config-input"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="tt-label mb-1">
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
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="tt-label">
                      {t("settings.modelProfiles.modelLabel")}
                    </span>
                    <button
                      type="button"
                      disabled={!canList || form.listing}
                      onClick={() => void loadModels()}
                      className="tt-num flex shrink-0 items-center gap-1 rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {form.listing ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <RefreshCw className="size-3" />
                      )}
                      {form.listing
                        ? t("settings.modelProfiles.listingModels")
                        : t("settings.modelProfiles.listModels")}
                    </button>
                  </div>
                  {form.models.length > 0 ? (
                    <div className="grid gap-2 @md:grid-cols-2">
                      <select
                        value={
                          form.models.includes(form.model) ? form.model : ""
                        }
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
                        }
                        className="security-config-input"
                      >
                        <option value="">
                          {t("settings.modelProfiles.selectModel")}
                        </option>
                        {form.models.map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                      <input
                        value={form.model}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            model: event.target.value,
                          }))
                        }
                        placeholder={t("settings.modelProfiles.manualModel")}
                        maxLength={120}
                        className="security-config-input"
                      />
                    </div>
                  ) : (
                    <input
                      value={form.model}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          model: event.target.value,
                        }))
                      }
                      placeholder={t("settings.modelProfiles.modelFetchHint", {
                        model: OFFICIAL_MODEL,
                      })}
                      maxLength={120}
                      className="security-config-input"
                    />
                  )}
                  {form.listMsg && (
                    <div className="tt-num mt-1 text-[11px] text-muted-foreground">
                      {form.listMsg}
                    </div>
                  )}
                </div>

                <dl className="tt-num space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0">
                      {t("settings.modelProfiles.requestPath")}
                    </dt>
                    <dd className="truncate text-foreground">
                      {protocolMeta[form.protocol].path}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0">
                      {t("settings.modelProfiles.authMethod")}
                    </dt>
                    <dd className="truncate text-foreground">
                      {form.protocol === "openai"
                        ? "Authorization: Bearer <API Key>"
                        : form.auth === "bearer"
                          ? "Authorization: Bearer <API Key> · anthropic-version: 2023-06-01"
                          : protocolMeta[form.protocol].auth}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>

          <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border px-3 py-2">
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
    </>
  );
}
