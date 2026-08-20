import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Zap } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { StatusBadge, TTButton } from "../../../components/tt";
import { toUiError } from "../../../lib/errors";
import { useI18n } from "../../../lib/i18n/context";
import type { MessageKey } from "../../../lib/i18n/messages";
import {
  deleteModelProfile,
  listModelProfiles,
  listRemoteModels,
  OFFICIAL_ENDPOINT,
  OFFICIAL_MODEL,
  OFFICIAL_MODEL_DISPLAY_NAME,
  protocolMeta,
  setActiveModelProfile,
  testModelProfile,
  upsertModelProfile,
  type ModelProfileInput,
  type ModelProfileView,
  type ProfileMode,
} from "../../ai-orchestration/index.ts";

interface FormState {
  readonly id: string | null;
  readonly name: string;
  readonly mode: ProfileMode;
  readonly protocol: "openai" | "anthropic";
  readonly apiKey: string;
  readonly storedApiKey: boolean;
  readonly endpoint: string;
  readonly model: string;
  readonly models: string[];
  readonly listing: boolean;
  readonly listMsg: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  mode: "custom",
  protocol: "openai",
  apiKey: "",
  storedApiKey: false,
  endpoint: "",
  model: "",
  models: [],
  listing: false,
  listMsg: "",
};

const OFFICIAL_ENTRY_ID = "__official_model__";

function toInput(form: FormState): ModelProfileInput {
  return {
    ...(form.id ? { id: form.id } : {}),
    ...(form.mode === "custom" && form.name.trim()
      ? { name: form.name.trim() }
      : {}),
    mode: form.mode,
    ...(form.mode === "custom" ? { protocol: form.protocol } : {}),
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    ...(form.mode === "custom" && form.endpoint.trim()
      ? { endpoint: form.endpoint.trim() }
      : {}),
    ...(form.mode === "custom" && form.model.trim()
      ? { model: form.model.trim() }
      : {}),
  };
}

function fromProfile(profile: ModelProfileView): FormState {
  return {
    id: profile.id,
    name: profile.name,
    mode: "custom",
    protocol: profile.protocol,
    apiKey: "",
    storedApiKey: profile.apiKeyMasked,
    endpoint: profile.endpoint ?? "",
    model: profile.model ?? "",
    models: [],
    listing: false,
    listMsg: "",
  };
}

function fromOfficialProfile(profile: ModelProfileView): FormState {
  return {
    id: profile.id === OFFICIAL_ENTRY_ID ? null : profile.id,
    name: profile.name,
    mode: "official",
    protocol: "openai",
    apiKey: "",
    storedApiKey: profile.apiKeyMasked,
    endpoint: OFFICIAL_ENDPOINT,
    model: OFFICIAL_MODEL,
    models: [],
    listing: false,
    listMsg: "",
  };
}

function officialEntry(name: string): ModelProfileView {
  return {
    id: OFFICIAL_ENTRY_ID,
    name,
    mode: "official",
    protocol: "openai",
    apiKeyMasked: false,
    endpoint: OFFICIAL_ENDPOINT,
    model: OFFICIAL_MODEL,
    auth: "bearer",
    createdAt: "",
    updatedAt: "",
  };
}

export function ModelProfilesSection() {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState<ModelProfileView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
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

  const official = useMemo(
    () =>
      profiles.find((profile) => profile.mode === "official") ??
      officialEntry(t("settings.modelProfiles.modeOfficial")),
    [profiles, t],
  );
  const displayProfiles = useMemo(
    () => [
      official,
      ...profiles.filter((profile) => profile.mode === "custom"),
    ],
    [official, profiles],
  );
  const updateForm = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const openNew = () => {
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const editProfile = (profile: ModelProfileView) => {
    if (profile.mode !== "custom") return;
    setForm(fromProfile(profile));
    setDialogOpen(true);
  };

  const openOfficial = (profile: ModelProfileView) => {
    setForm(fromOfficialProfile(profile));
    setDialogOpen(true);
  };

  const activateProfile = async (profile: ModelProfileView) => {
    if (profile.mode === "official" && !profile.apiKeyMasked) {
      openOfficial(profile);
      return;
    }
    try {
      if (profile.id === activeId) return;
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

  const formValid =
    form.mode === "official"
      ? form.apiKey.trim().length >= 8 || form.storedApiKey
      : form.name.trim().length > 0 &&
        form.model.trim().length > 0 &&
        (form.apiKey.trim().length === 0 || form.apiKey.trim().length >= 8) &&
        (form.id !== null || form.apiKey.trim().length >= 8);

  const loadModels = async () => {
    if (form.mode !== "custom") return;
    if (form.listing || (form.apiKey.trim() === "" && form.id === null)) return;
    setForm((current) => ({ ...current, listing: true, listMsg: "" }));
    try {
      const result = await listRemoteModels({
        data: {
          id: form.id ?? undefined,
          mode: "custom",
          protocol: form.protocol,
          ...(form.endpoint.trim() ? { endpoint: form.endpoint.trim() } : {}),
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        },
      });
      const models = [...(result.models ?? [])];
      setForm((current) => ({
        ...current,
        models,
        listing: false,
        listMsg: result.ok
          ? result.source === "remote"
            ? t("settings.modelProfiles.listModelsDone", {
                count: models.length,
              })
            : t("settings.modelProfiles.listModelsFallback")
          : "",
        model: current.model.trim() || models[0] || current.model,
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
    if (!formValid) return;
    setSaving(true);
    try {
      const saved = await upsertModelProfile({ data: toInput(form) });
      setDialogOpen(false);
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

  const doDelete = async () => {
    if (!deleteTarget || deleteTarget.mode === "official") return;
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
      await load();
    } catch (error) {
      const ui = toUiError(error);
      toast.error(ui ? t(ui.code, ui.params) : t("common.failed"));
    } finally {
      setSaving(false);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <section className="rounded-sm border border-border bg-surface-2">
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="min-w-0">
            <span className="tt-label block truncate">
              {t("settings.modelProfiles.count", {
                count:
                  profiles.length +
                  (profiles.some((profile) => profile.mode === "official")
                    ? 0
                    : 1),
              })}
            </span>
          </div>
          <TTButton size="sm" variant="ghost" onClick={openNew}>
            {t("settings.modelProfiles.add")}
          </TTButton>
        </div>

        {loading ? (
          <div className="px-3 py-8 text-center text-[12px] text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {displayProfiles.map((profile) => {
              const active =
                profile.id === activeId &&
                (profile.mode !== "official" || profile.apiKeyMasked);
              const isOfficial = profile.mode === "official";
              const endpoint = isOfficial
                ? OFFICIAL_ENDPOINT
                : (profile.endpoint ?? protocolMeta[profile.protocol].endpoint);
              const model = isOfficial
                ? OFFICIAL_MODEL_DISPLAY_NAME
                : (profile.model ?? "—");
              return (
                <li
                  key={profile.id}
                  className={`flex items-start gap-3 px-3 py-2.5 text-[12px] transition-colors ${active ? "bg-accent/50" : "hover:bg-accent/30"}`}
                >
                  <div className="min-w-0 flex-1 text-left">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium">
                        {isOfficial
                          ? t("settings.modelProfiles.modeOfficial")
                          : profile.name}
                      </span>
                      {active && (
                        <StatusBadge tone="primary">
                          {t("settings.modelProfiles.active")}
                        </StatusBadge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
                      {endpoint} · {model}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <TTButton
                      size="sm"
                      variant={active ? "primary" : "ghost"}
                      disabled={active}
                      onClick={() => void activateProfile(profile)}
                    >
                      {active
                        ? t("settings.modelProfiles.active")
                        : t("settings.modelProfiles.enable")}
                    </TTButton>
                    <TTButton
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        isOfficial
                          ? openOfficial(profile)
                          : editProfile(profile)
                      }
                    >
                      {t("settings.modelProfiles.edit")}
                    </TTButton>
                    <TTButton
                      size="sm"
                      variant="ghost"
                      disabled={isOfficial}
                      title={
                        isOfficial
                          ? t("settings.modelProfiles.officialDeleteDisabled")
                          : t("settings.modelProfiles.delete")
                      }
                      onClick={() => {
                        if (!isOfficial) {
                          setDeleteTarget(profile);
                        }
                      }}
                    >
                      {t("settings.modelProfiles.delete")}
                    </TTButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && !saving && !testing) {
            setDialogOpen(false);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.mode === "official"
                ? t("settings.modelProfiles.officialFormTitle")
                : form.id
                  ? t("settings.modelProfiles.formTitleEdit", {
                      name: form.name || "—",
                    })
                  : t("settings.modelProfiles.formTitleNew")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {form.mode === "official" ? (
              <>
                <div>
                  <div className="tt-label mb-1">
                    {t("settings.modelProfiles.apiKeyLabel")}{" "}
                    <span className="text-danger">*</span>
                  </div>
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={(event) =>
                      updateForm({ apiKey: event.target.value })
                    }
                    placeholder={t("settings.modelProfiles.apiKeyPlaceholder")}
                    autoComplete="new-password"
                    className="security-config-input"
                  />
                  {form.storedApiKey && (
                    <p className="mt-1 text-[10.5px] text-muted-foreground">
                      {t("settings.modelProfiles.apiKeyConfigured")}
                    </p>
                  )}
                </div>
                <dl className="space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0">
                      {t("settings.modelProfiles.apiFormatLabel")}
                    </dt>
                    <dd className="text-foreground">
                      {t("settings.modelProfiles.protocolOpenai")}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0">
                      {t("settings.modelProfiles.endpointLabel")}
                    </dt>
                    <dd className="text-foreground">{OFFICIAL_ENDPOINT}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0">
                      {t("settings.modelProfiles.modelLabel")}
                    </dt>
                    <dd className="text-foreground">
                      {OFFICIAL_MODEL_DISPLAY_NAME}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <>
                <div>
                  <div className="tt-label mb-1">
                    {t("settings.modelProfiles.nameLabel")}{" "}
                    <span className="text-danger">*</span>
                  </div>
                  <input
                    value={form.name}
                    onChange={(event) =>
                      updateForm({ name: event.target.value })
                    }
                    placeholder={t("settings.modelProfiles.namePlaceholder")}
                    maxLength={64}
                    className="security-config-input"
                  />
                </div>

                <div>
                  <div className="tt-label mb-1.5">
                    {t("settings.modelProfiles.apiFormatLabel")}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["openai", "anthropic"] as const).map((protocol) => (
                      <button
                        key={protocol}
                        type="button"
                        onClick={() =>
                          updateForm({
                            protocol,
                            models: [],
                          })
                        }
                        className={`rounded-sm border px-2.5 py-2 text-left transition-colors ${form.protocol === protocol ? "border-primary bg-primary/10" : "border-border hover:border-border-strong"}`}
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

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <div className="tt-label mb-1">
                      {t("settings.modelProfiles.apiKeyLabel")}
                    </div>
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={(event) =>
                        updateForm({ apiKey: event.target.value })
                      }
                      placeholder={t(
                        "settings.modelProfiles.apiKeyPlaceholder",
                      )}
                      autoComplete="new-password"
                      className="security-config-input"
                    />
                    {form.storedApiKey && (
                      <p className="mt-1 text-[10.5px] text-muted-foreground">
                        {t("settings.modelProfiles.apiKeyConfigured")}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="tt-label mb-1">
                      {t("settings.modelProfiles.endpointLabel")}
                    </div>
                    <input
                      value={form.endpoint}
                      onChange={(event) =>
                        updateForm({ endpoint: event.target.value })
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
                      disabled={
                        form.listing ||
                        (form.apiKey.trim() === "" && form.id === null)
                      }
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
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select
                        value={
                          form.models.includes(form.model) ? form.model : ""
                        }
                        onChange={(event) =>
                          updateForm({ model: event.target.value })
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
                          updateForm({ model: event.target.value })
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
                        updateForm({ model: event.target.value })
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
                </dl>
              </>
            )}
          </div>

          <DialogFooter className="mt-2 flex-wrap gap-2">
            <TTButton
              variant="ghost"
              size="sm"
              onClick={() => setDialogOpen(false)}
              disabled={saving || testing}
            >
              {t("common.cancel")}
            </TTButton>
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
              disabled={!formValid || saving}
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {t("common.save")}
            </TTButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
