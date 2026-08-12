import { useEffect, useState } from "react";
import { KeyRound, LockKeyhole, X } from "lucide-react";

import { useI18n } from "../../../../lib/i18n/context";
import type { SecurityModelConfigUpdate } from "../../query/desktop-client";
import type { SecurityModelConfigView } from "../security-view";

interface FormState {
  provider: "openai" | "anthropic";
  endpoint: string;
  apiKey: string;
  liteModel: string;
  proModel: string;
  timeoutMs: string;
  contextWindowTokens: string;
  maxAgentTurns: string;
}

function initialForm(config: SecurityModelConfigView | null): FormState {
  return {
    provider: config?.provider ?? "openai",
    endpoint: config?.endpoint ?? "",
    apiKey: "",
    liteModel: config?.liteModel ?? "",
    proModel: config?.proModel ?? "",
    timeoutMs: String(config?.timeoutMs ?? 120_000),
    contextWindowTokens:
      config?.contextWindowTokens == null
        ? ""
        : String(config.contextWindowTokens),
    maxAgentTurns: String(config?.maxAgentTurns ?? 12),
  };
}

export function ModelConfigDialog({
  open,
  config,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  config: SecurityModelConfigView | null;
  saving: boolean;
  onClose: () => void;
  onSave: (config: SecurityModelConfigUpdate) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(() => initialForm(config));

  useEffect(() => {
    if (open) setForm(initialForm(config));
  }, [config, open]);

  if (!open) return null;

  const valid =
    form.endpoint.trim().length > 0 &&
    form.liteModel.trim().length > 0 &&
    form.proModel.trim().length > 0 &&
    (config?.apiKeyConfigured === true || form.apiKey.trim().length > 0) &&
    config?.encryptionAvailable === true;

  const submit = () => {
    if (!valid) return;
    const update: SecurityModelConfigUpdate = {
      provider: form.provider,
      endpoint: form.endpoint.trim(),
      liteModel: form.liteModel.trim(),
      proModel: form.proModel.trim(),
      timeoutMs: Number(form.timeoutMs) || 120_000,
      maxAgentTurns: Number(form.maxAgentTurns) || 12,
      ...(form.contextWindowTokens.trim()
        ? { contextWindowTokens: Number(form.contextWindowTokens) }
        : {}),
      ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    };
    onSave(update);
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="security-model-title"
    >
      <section className="tt-scroll max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-card p-6 shadow-[var(--elev-2)]">
        <header className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <KeyRound className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="security-model-title" className="text-[15px] font-semibold">
              {t("security.center.model.title")}
            </h2>
            <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
              {t("security.center.model.desc")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid size-8 place-items-center rounded-full bg-surface-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        {config && (
          <div
            className={`mt-4 flex items-start gap-2 rounded-xl px-3.5 py-3 text-[12px] ${
              config.encryptionAvailable
                ? "bg-ok/10 text-ok"
                : "bg-danger/10 text-danger"
            }`}
          >
            <LockKeyhole className="mt-0.5 size-4 shrink-0" />
            {config.encryptionAvailable
              ? t("security.center.model.encryptionAvailable")
              : t("security.center.model.encryptionUnavailable")}
          </div>
        )}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <ConfigField label={t("security.center.model.provider")}>
            <select
              value={form.provider}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  provider: event.target.value as FormState["provider"],
                }))
              }
              className="security-config-input"
            >
              <option value="openai">
                {t("security.center.model.openai")}
              </option>
              <option value="anthropic">
                {t("security.center.model.anthropic")}
              </option>
            </select>
          </ConfigField>
          <ConfigField label={t("security.center.model.endpoint")}>
            <input
              value={form.endpoint}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  endpoint: event.target.value,
                }))
              }
              className="security-config-input"
              type="url"
              autoComplete="url"
            />
          </ConfigField>
          <ConfigField
            label={t("security.center.model.apiKey")}
            hint={
              config?.apiKeyConfigured
                ? t("security.center.model.apiKeyConfigured")
                : t("security.center.model.apiKeyMissing")
            }
          >
            <input
              value={form.apiKey}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              className="security-config-input"
              type="password"
              autoComplete="new-password"
              disabled={config?.encryptionAvailable === false}
            />
          </ConfigField>
          <ConfigField label={t("security.center.model.liteModel")}>
            <input
              value={form.liteModel}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  liteModel: event.target.value,
                }))
              }
              className="security-config-input"
            />
          </ConfigField>
          <ConfigField label={t("security.center.model.proModel")}>
            <input
              value={form.proModel}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  proModel: event.target.value,
                }))
              }
              className="security-config-input"
            />
          </ConfigField>
          <ConfigField label={t("security.center.model.timeoutMs")}>
            <input
              value={form.timeoutMs}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  timeoutMs: event.target.value,
                }))
              }
              className="security-config-input"
              type="number"
              min={100}
              max={120000}
            />
          </ConfigField>
          <ConfigField label={t("security.center.model.contextWindowTokens")}>
            <input
              value={form.contextWindowTokens}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  contextWindowTokens: event.target.value,
                }))
              }
              className="security-config-input"
              type="number"
              min={1}
              max={10000000}
            />
          </ConfigField>
          <ConfigField label={t("security.center.model.maxAgentTurns")}>
            <input
              value={form.maxAgentTurns}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  maxAgentTurns: event.target.value,
                }))
              }
              className="security-config-input"
              type="number"
              min={1}
              max={100}
            />
          </ConfigField>
        </div>

        <footer className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-surface-2 px-4 py-2 text-[12px] hover:bg-accent"
          >
            {t("security.center.model.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid || saving}
            className="rounded-full bg-primary px-4 py-2 text-[12px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving
              ? t("security.center.model.saving")
              : t("security.center.model.save")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ConfigField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[10px] text-muted-foreground">
          {hint}
        </span>
      )}
    </label>
  );
}
