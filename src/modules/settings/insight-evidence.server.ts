/**
 * Page-insight evidence adapter for the `settings` surface.
 *
 * Evidence sources (read-only, renderer-safe, never a secret):
 *  - model profile repository: profile count + whether any profile has a key
 *  - unified task runtime: count of enabled task preferences
 *
 * Fact keys are the canonical `insights.page.settings.*` vocabulary declared by
 * `PAGE_RULE_IDS` (M1).
 */
import {
  assertEntityId,
  availabilityEvidence,
  emptyBundle,
  metricEvidence,
  metricValue,
} from "../../app/insights/evidence-util.server.ts";
import type {
  InsightCandidate,
  InsightEvidenceBundle,
  InsightScope,
  PageInsightAdapter,
} from "../insights/page/contracts.ts";

function composeSettingsCandidates(
  bundle: InsightEvidenceBundle,
): readonly InsightCandidate[] {
  const profiles = metricValue(bundle, "settings.profiles");
  const profileReady = bundle.evidence.find(
    (item) => item.id === "settings.profileReady" && item.value === true,
  );
  const tasksEnabled = metricValue(bundle, "settings.tasksEnabled");

  if (profiles != null && profiles === 0) {
    return [
      {
        id: "settings.model-unconfigured",
        severity: "attention",
        factKey: "insights.page.settings.settings-model-unconfigured",
        factParams: {},
        evidenceRefs: ["settings.profiles"],
        allowedActionIds: ["open_settings"],
        actionId: "open_settings",
      },
    ];
  }

  if (profileReady == null && profiles != null && profiles > 0) {
    return [
      {
        id: "settings.model-unconfigured",
        severity: "attention",
        factKey: "insights.page.settings.settings-model-unconfigured",
        factParams: {},
        evidenceRefs: ["settings.profileReady"],
        allowedActionIds: ["open_settings"],
        actionId: "open_settings",
      },
    ];
  }

  if (profiles != null && profiles > 0) {
    return [
      {
        id: "settings.scan-plan",
        severity: "info",
        factKey: "insights.page.settings.settings-scan-plan",
        factParams: { count: tasksEnabled ?? 0 },
        evidenceRefs: ["settings.tasksEnabled"],
        allowedActionIds: ["open_settings"],
        actionId: "open_settings",
      },
      {
        id: "settings.local",
        severity: "info",
        factKey: "insights.page.settings.settings-local",
        factParams: {},
        evidenceRefs: ["settings.profiles"],
        allowedActionIds: ["open_settings"],
        actionId: "open_settings",
      },
    ];
  }

  return [];
}

export const settingsInsightAdapter: PageInsightAdapter = {
  surfaceId: "settings",
  adapterVersion: 2,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();

    const profiles = await root.modelProfiles.listViews().catch(() => []);
    const profileReady = profiles.some((profile) => profile.apiKeyMasked);

    const preferences = await root.taskApi.listPreferences().catch(() => null);
    const tasksEnabled = preferences?.ok
      ? preferences.value.filter((preference) => preference.enabled).length
      : null;

    const evidence = [
      metricEvidence(
        "settings.profiles",
        profiles.length,
        observedAt,
        "unknown",
        "count",
      ),
      availabilityEvidence("settings.profileReady", profileReady, observedAt),
      // A failing task read degrades to an honest 0 (never a fabricated count).
      metricEvidence(
        "settings.tasksEnabled",
        tasksEnabled ?? 0,
        observedAt,
        "unknown",
        "count",
      ),
    ];

    return {
      surfaceId: "settings" as const,
      scope,
      observedAt,
      evidence,
      ...(tasksEnabled == null ? { partial: true } : {}),
    };
  },
  composeCandidates: composeSettingsCandidates,
};
