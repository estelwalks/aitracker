/**
 * Settings section for the 「今日洞察双模式」: mode (local rules / manual
 * enhance / auto enhance), enhance profile, auto-enhance consent, and daily
 * call limit. Persists through `setInsightPreferences`; the profile dropdown
 * reuses the shared `listModelProfiles` server fn (no parallel model data).
 */
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Segmented, TTButton } from "../../../../components/tt";
import { useI18n } from "../../../../lib/i18n/context";
import {
  listModelProfiles,
  type ModelProfileView,
} from "../../../ai-orchestration";
import { setInsightPreferences } from "../server-fns";
import { getInsightPreferences } from "../server-fns";
import { INSIGHT_AUTO_CONSENT_VERSION } from "../contracts";

type InsightMode = "rules" | "enhanced-manual" | "enhanced-auto";

/** Bump when the consent wording changes (fed back to the server as a string). */
export function InsightSettingsSection() {
  const { t } = useI18n();
  const [mode, setMode] = useState<InsightMode>("rules");
  const [profileId, setProfileId] = useState("");
  const [consent, setConsent] = useState(false);
  const [dailyLimit, setDailyLimit] = useState("");
  const [profiles, setProfiles] = useState<ModelProfileView[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      listModelProfiles(),
      getInsightPreferences({ data: {} }),
    ]).then(([profilesResult, preferenceResult]) => {
      if (cancelled) return;
      if (profilesResult.status === "fulfilled") {
        setProfiles([...profilesResult.value.profiles]);
      }
      if (preferenceResult.status === "fulfilled") {
        const preference = preferenceResult.value;
        setMode(preference.mode);
        setProfileId(preference.profileId ?? "");
        setConsent(preference.consentVersion === INSIGHT_AUTO_CONSENT_VERSION);
        setDailyLimit(
          preference.dailyCallLimit == null
            ? ""
            : String(preference.dailyCallLimit),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async () => {
    if (mode === "enhanced-auto" && !consent) {
      toast.error(t("settings.insight.section.consentRequired"));
      return;
    }
    setSaving(true);
    try {
      const parsedLimit =
        dailyLimit.trim() === "" ? null : Number(dailyLimit.trim());
      await setInsightPreferences({
        data: {
          mode,
          ...(mode !== "rules" && profileId ? { profileId } : {}),
          ...(mode === "enhanced-auto"
            ? { consentVersion: INSIGHT_AUTO_CONSENT_VERSION }
            : {}),
          ...(parsedLimit != null &&
          Number.isFinite(parsedLimit) &&
          parsedLimit >= 0
            ? { dailyCallLimit: Math.floor(parsedLimit) }
            : {}),
        },
      });
      toast.success(t("settings.insight.section.saved"));
    } catch {
      toast.error(t("settings.insight.section.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const modeHint =
    mode === "rules"
      ? t("settings.insight.section.modeRulesDesc")
      : mode === "enhanced-manual"
        ? t("settings.insight.section.modeManualDesc")
        : t("settings.insight.section.modeAutoDesc");

  return (
    <div className="mt-4 space-y-1 border-t border-border pt-3">
      <div className="tt-label">{t("settings.insight.section.title")}</div>
      <p className="text-[11px] text-muted-foreground">
        {t("settings.insight.section.desc")}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
        <div className="text-[13px]">{t("settings.insight.section.mode")}</div>
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            {
              value: "rules",
              label: t("settings.insight.section.modeRules"),
            },
            {
              value: "enhanced-manual",
              label: t("settings.insight.section.modeManual"),
            },
            {
              value: "enhanced-auto",
              label: t("settings.insight.section.modeAuto"),
            },
          ]}
        />
      </div>
      <p className="text-[11px] text-muted-foreground">{modeHint}</p>

      {mode !== "rules" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
          <div>
            <div className="text-[13px]">
              {t("settings.insight.section.profile")}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {t("settings.insight.section.profileHint")}
            </div>
          </div>
          {profiles.length === 0 ? (
            <span className="max-w-[260px] text-[11px] text-muted-foreground">
              {t("settings.insight.section.profileEmpty")}
            </span>
          ) : (
            <select
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
              className="security-config-input w-48"
            >
              <option value="">—</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {mode === "enhanced-auto" && (
        <div className="border-b border-border py-3">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 accent-[var(--color-primary)]"
            />
            <span className="min-w-0">
              <span className="text-[13px]">
                {t("settings.insight.section.consent")}
              </span>
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                {t("settings.insight.section.consentDesc")}
              </span>
            </span>
          </label>
          {!consent && (
            <p className="mt-1.5 text-[11px] text-warn">
              {t("settings.insight.section.consentRequired")}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3">
        <div>
          <div className="text-[13px]">
            {t("settings.insight.section.dailyLimit")}
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {t("settings.insight.section.dailyLimitHint")}
          </div>
        </div>
        <input
          type="number"
          min={0}
          value={dailyLimit}
          onChange={(event) => setDailyLimit(event.target.value)}
          placeholder="30"
          className="tt-num h-8 w-24 rounded-sm border border-border bg-surface-2 px-2 text-right text-[13px]"
        />
      </div>

      <div className="flex justify-end pt-2">
        <TTButton
          size="sm"
          variant="primary"
          onClick={() => void save()}
          disabled={saving || (mode === "enhanced-auto" && !consent)}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {t("settings.insight.section.save")}
        </TTButton>
      </div>
    </div>
  );
}
