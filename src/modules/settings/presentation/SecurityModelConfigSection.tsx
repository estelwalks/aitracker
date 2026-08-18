import { useEffect, useState, type ReactNode } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";
import { toast } from "sonner";

import { TTButton } from "../../../components/tt";
import { useI18n } from "../../../lib/i18n/context";
import type {
  SecurityClient,
  SecurityModelConfigUpdate,
  SecurityModelConfigView,
} from "../../security-assessment/index";
import {
  Field,
  SectionHeading,
  SecurityLoadError,
  SecurityUnavailable,
} from "./fields";
import type { SecurityConnectionStatus } from "./use-security-client";

interface ModelFormState {
  provider: "openai" | "anthropic";
  endpoint: string;
  apiKey: string;
  liteModel: string;
  proModel: string;
  timeoutMs: string;
}

function initialForm(config: SecurityModelConfigView | null): ModelFormState {
  return {
    provider: config?.provider ?? "openai",
    endpoint: config?.endpoint ?? "",
    apiKey: "",
    liteModel: config?.liteModel ?? "",
    proModel: config?.proModel ?? "",
    timeoutMs: String(config?.timeoutMs ?? 120_000),
  };
}

function ConfigField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
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

/**
 * 安全检测模型配置表单。绑定真实 SecurityClient.getModelConfig()/
 * setModelConfig()。API Key 永不从主进程返回，`apiKeyConfigured` 仅为布尔值；
 * 用户留空时省略 `apiKey` 以保留已保存的密钥。
 */
export function SecurityModelConfigSection({
  client,
  status,
  onRetry,
}: {
  client: SecurityClient | null;
  status: SecurityConnectionStatus;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [config, setConfig] = useState<SecurityModelConfigView | null>(null);
  const [form, setForm] = useState<ModelFormState>(() => initialForm(null));
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (client == null) return;
    let cancelled = false;
    setLoadError(false);
    setConfig(null);
    client
      .getModelConfig()
      .then((next) => {
        if (cancelled) return;
        setConfig(next);
        setForm(initialForm(next));
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(true);
        toast.error(t("settings.security.model.loadFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadTick, t]);

  const retryLoad = () => setReloadTick((value) => value + 1);

  let content: ReactNode;
  if (status === "unavailable") {
    content = <SecurityUnavailable onRetry={onRetry} />;
  } else if (loadError) {
    content = (
      <SecurityLoadError
        message={t("settings.security.model.loadFailed")}
        onRetry={retryLoad}
      />
    );
  } else if (config == null) {
    content = (
      <Field label={t("settings.security.model.title")}>
        <span className="text-[13px] text-muted-foreground">
          {t("common.loading")}
        </span>
      </Field>
    );
  } else {
    const valid =
      config.encryptionAvailable === true &&
      form.endpoint.trim().length > 0 &&
      form.liteModel.trim().length > 0 &&
      form.proModel.trim().length > 0 &&
      (config.apiKeyConfigured === true || form.apiKey.trim().length > 0);

    const submit = async () => {
      if (!valid || client == null) return;
      const update: SecurityModelConfigUpdate = {
        provider: form.provider,
        endpoint: form.endpoint.trim(),
        liteModel: form.liteModel.trim(),
        proModel: form.proModel.trim(),
        timeoutMs: Number(form.timeoutMs) || 120_000,
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
      };
      setSaving(true);
      try {
        const saved = await client.setModelConfig(update);
        setConfig(saved);
        setForm((current) => ({ ...current, apiKey: "" }));
        toast.success(t("settings.security.model.saved"));
      } catch {
        toast.error(t("settings.security.model.saveFailed"));
      } finally {
        setSaving(false);
      }
    };

    content = (
      <div>
        <div
          className={`mb-3 flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-[11.5px] ${
            config.encryptionAvailable
              ? "bg-ok/10 text-ok"
              : "bg-danger/10 text-danger"
          }`}
        >
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          {config.encryptionAvailable
            ? t("settings.security.model.encryptionAvailable")
            : t("settings.security.model.encryptionUnavailable")}
        </div>

        <div className="rounded-sm border border-border bg-surface-2 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ConfigField label={t("settings.security.model.provider")}>
              <select
                value={form.provider}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    provider: event.target.value as ModelFormState["provider"],
                  }))
                }
                className="security-config-input"
              >
                <option value="openai">
                  {t("settings.security.model.openai")}
                </option>
                <option value="anthropic">
                  {t("settings.security.model.anthropic")}
                </option>
              </select>
            </ConfigField>
            <ConfigField label={t("settings.security.model.endpoint")}>
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
              label={t("settings.security.model.apiKey")}
              hint={
                config.apiKeyConfigured
                  ? t("settings.security.model.apiKeyConfigured")
                  : t("settings.security.model.apiKeyMissing")
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
                disabled={config.encryptionAvailable === false}
              />
            </ConfigField>
            <ConfigField label={t("settings.security.model.liteModel")}>
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
            <ConfigField label={t("settings.security.model.proModel")}>
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
            <ConfigField label={t("settings.security.model.timeoutMs")}>
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
          </div>
          <div className="mt-4 flex justify-end">
            <TTButton
              variant="primary"
              size="sm"
              disabled={!valid || saving}
              onClick={() => void submit()}
            >
              {saving
                ? t("settings.security.model.saving")
                : t("settings.security.model.save")}
            </TTButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading icon={<KeyRound className="size-3.5" />}>
        {t("settings.security.model.title")}
      </SectionHeading>
      <p className="mb-3 text-[11px] text-muted-foreground">
        {t("settings.security.model.desc")}
      </p>
      {content}
    </div>
  );
}
