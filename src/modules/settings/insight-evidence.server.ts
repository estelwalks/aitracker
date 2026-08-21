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
  const readyProfiles = metricValue(bundle, "settings.readyProfiles");
  const tasksEnabled = metricValue(bundle, "settings.tasksEnabled");
  const tasksTotal = metricValue(bundle, "settings.tasksTotal");
  const tasksDisabled = metricValue(bundle, "settings.tasksDisabled");
  const candidates: InsightCandidate[] = [];
  if (profiles != null && readyProfiles != null) {
    candidates.push({
      id: "settings.models",
      severity: readyProfiles === 0 ? "attention" : "info",
      factKey: "insights.page.settings.settings-guide-model",
      factParams: { profiles, ready: readyProfiles },
      evidenceRefs: ["settings.profiles", "settings.readyProfiles"],
      allowedActionIds: ["open_settings"],
      actionId: "open_settings",
    });
    candidates.push({
      id: "settings.credentials",
      severity:
        readyProfiles === profiles && profiles > 0 ? "info" : "attention",
      factKey: "insights.page.settings.settings-guide-privacy",
      factParams: { ready: readyProfiles },
      evidenceRefs: ["settings.readyProfiles"],
      allowedActionIds: ["open_settings"],
      actionId: "open_settings",
    });
  }
  for (const [id, value, key, ref, param] of [
    [
      "tasks",
      tasksTotal,
      "settings-guide-enhancement",
      "settings.tasksTotal",
      "total",
    ],
    [
      "enabled",
      tasksEnabled,
      "settings-guide-schedules",
      "settings.tasksEnabled",
      "enabled",
    ],
    [
      "disabled",
      tasksDisabled,
      "settings-guide-retention",
      "settings.tasksDisabled",
      "disabled",
    ],
  ] as const) {
    if (value == null) continue;
    candidates.push({
      id: `settings.${id}`,
      severity: "info",
      factKey: `insights.page.settings.${key}`,
      factParams: { [param]: value },
      evidenceRefs: [ref],
      allowedActionIds: ["open_settings"],
      actionId: "open_settings",
    });
  }
  return candidates;
}

export const settingsInsightAdapter: PageInsightAdapter = {
  surfaceId: "settings",
  adapterVersion: 3,
  async loadEvidence(scope: InsightScope) {
    assertEntityId(scope.entityId);
    const nowMs = Date.now();
    const observedAt = new Date(nowMs).toISOString();

    const { getCompositionRoot } =
      await import("../../app/composition.server.ts");
    const root = await getCompositionRoot();

    const profiles = await root.modelProfiles.listViews().catch(() => null);
    const readyProfiles =
      profiles?.filter((profile) => profile.apiKeyMasked).length ?? null;

    const preferences = await root.taskApi.listPreferences().catch(() => null);
    const taskValues = preferences?.ok ? preferences.value : null;
    const tasksEnabled =
      taskValues?.filter((preference) => preference.enabled).length ?? null;

    const evidence = [];
    if (profiles != null && readyProfiles != null) {
      evidence.push(
        metricEvidence(
          "settings.profiles",
          profiles.length,
          observedAt,
          "unknown",
          "count",
        ),
        metricEvidence(
          "settings.readyProfiles",
          readyProfiles,
          observedAt,
          "unknown",
          "count",
        ),
        availabilityEvidence(
          "settings.profileReady",
          readyProfiles > 0,
          observedAt,
        ),
      );
    }
    if (taskValues != null && tasksEnabled != null) {
      evidence.push(
        metricEvidence(
          "settings.tasksTotal",
          taskValues.length,
          observedAt,
          "unknown",
          "count",
        ),
        metricEvidence(
          "settings.tasksEnabled",
          tasksEnabled,
          observedAt,
          "unknown",
          "count",
        ),
        metricEvidence(
          "settings.tasksDisabled",
          taskValues.length - tasksEnabled,
          observedAt,
          "unknown",
          "count",
        ),
      );
    }

    return {
      surfaceId: "settings" as const,
      scope,
      observedAt,
      evidence,
      ...(tasksEnabled == null || profiles == null ? { partial: true } : {}),
    };
  },
  composeCandidates: composeSettingsCandidates,
};
