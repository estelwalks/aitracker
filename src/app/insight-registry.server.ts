/**
 * Page-insight application wiring (M3).
 *
 * Assembles the 14 surface adapters, the SQLite insight store, and — unless
 * the `insight.killSwitch` runtime flag is set — the AI enhancer (M2), into the
 * `PageInsightsApplication` produced by M1's `createPageInsightsApplication`.
 *
 * This module is the single place that knows how the pieces fit together. It
 * is `*.server.ts` and is only ever dynamically imported by the composition
 * root, so neither it nor the adapters form a static cycle with the root.
 *
 * Kill-switch contract: when `runtimeFlags.get("insight.killswitch")` is true
 * the enhancer is NEVER constructed and the model Profile is NEVER read —
 * rule-generated candidates remain, enhancement is disabled.
 */
import type { AIExecutorPort } from "../modules/ai-orchestration/ai-executor.ts";
import type { ModelProfileRepository } from "../modules/ai-orchestration/model-profile.server.ts";
import type { PageInsightAdapter } from "../modules/insights/page/contracts.ts";
import type { PageInsightsApplication } from "../modules/insights/page/application.ts";
import type { SqliteInsightRepository } from "../modules/insights/infrastructure/sqlite-insight-repository.server.ts";
import type { RuntimeFlagRepository } from "../platform/database/runtime-flag-repository.server.ts";
import {
  dashboardInsightAdapter,
  widgetInsightAdapter,
} from "../modules/dashboard/insight-evidence.server.ts";
import {
  agentsInsightAdapter,
  trackerInsightAdapter,
} from "../modules/usage/insight-evidence.server.ts";
import { distillInsightAdapter } from "../modules/distillation/insight-evidence.server.ts";
import { reportsInsightAdapter } from "../modules/reports/insight-evidence.server.ts";
import { memoryInsightAdapter } from "../modules/knowledge/insight-evidence.server.ts";
import { securityInsightAdapter } from "../modules/security-assessment/insight-evidence.server.ts";
import { skillsInsightAdapter } from "../modules/skill-catalog/insight-evidence.server.ts";
import {
  chatsInsightAdapter,
  chatDetailInsightAdapter,
} from "../modules/sessions/insight-evidence.server.ts";
import { sourcesInsightAdapter } from "../modules/sources/insight-evidence.server.ts";
import { marketInsightAdapter } from "../lib/local-market/insight-evidence.server.ts";
import { settingsInsightAdapter } from "../modules/settings/insight-evidence.server.ts";

/** All 14 surface adapters in a stable, surface-id-unique order. */
export function createInsightAdapterRegistry(): readonly PageInsightAdapter[] {
  return [
    dashboardInsightAdapter,
    widgetInsightAdapter,
    agentsInsightAdapter,
    trackerInsightAdapter,
    distillInsightAdapter,
    reportsInsightAdapter,
    memoryInsightAdapter,
    securityInsightAdapter,
    skillsInsightAdapter,
    chatsInsightAdapter,
    chatDetailInsightAdapter,
    sourcesInsightAdapter,
    marketInsightAdapter,
    settingsInsightAdapter,
  ];
}

/** The composition-root pieces the page-insights application depends on. */
export interface PageInsightsDependencies {
  readonly aiExecutor: AIExecutorPort;
  readonly modelProfiles: ModelProfileRepository;
  readonly store: SqliteInsightRepository;
  readonly runtimeFlags: RuntimeFlagRepository;
}

/**
 * Constructs a `PageInsightsApplication` from the given runtime dependencies.
 * Exported for the composition root so it can assemble `insights` while it is
 * still building (the public cached accessor below would otherwise re-enter
 * `getCompositionRoot` and deadlock).
 */
export async function createPageInsightsApplicationForRoot(
  deps: PageInsightsDependencies,
): Promise<PageInsightsApplication> {
  const { createPageInsightsApplication } =
    await import("../modules/insights/page/application.ts");
  const adapters = createInsightAdapterRegistry();

  // Kill switch: enhancement (and the model Profile read it entails) is
  // disabled entirely; only rule-generated candidates remain.
  // NOTE: the flag key is lowercase because `RuntimeFlagRepository` validates
  // keys against `SAFE_KEY = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/` (the task
  // spec's camelCase "insight.killSwitch" is rejected by that guard).
  const killSwitch = await deps.runtimeFlags
    .get<boolean>("insight.killswitch")
    .catch(() => undefined);

  let enhancer:
    | import("../modules/insights/enhancer/index.ts").InsightEnhancerPort
    | undefined;
  if (killSwitch?.value === true) {
    enhancer = undefined;
  } else {
    const { createInsightEnhancer } =
      await import("../modules/insights/enhancer/index.ts");
    enhancer = createInsightEnhancer({
      ai: deps.aiExecutor,
      repository: deps.store,
      resolveActiveProfile: async () => {
        const active = await deps.modelProfiles.getActiveView();
        return active
          ? { id: active.id, label: active.name ?? active.id }
          : null;
      },
      resolveProfile: async (profileId) => {
        const views = await deps.modelProfiles.listViews();
        const selected = views.find((view) => view.id === profileId);
        return selected
          ? { id: selected.id, label: selected.name ?? selected.id }
          : null;
      },
      now: () => Date.now(),
    });
  }

  return createPageInsightsApplication({
    adapters,
    ...(enhancer ? { enhancer } : {}),
    store: deps.store,
    now: () => Date.now(),
  });
}

let cachedApplication: PageInsightsApplication | undefined;
let cachedRoot: unknown;

/**
 * Returns the singleton page-insights application, keyed to the current
 * composition root. When the composition root is rebuilt (tests, HMR) the
 * cached application is rebuilt against the new root automatically.
 */
export async function getPageInsightsApplication(): Promise<PageInsightsApplication> {
  const { getCompositionRoot } = await import("./composition.server.ts");
  const root = await getCompositionRoot();
  if (cachedApplication && cachedRoot === root) return cachedApplication;
  const application = await createPageInsightsApplicationForRoot({
    aiExecutor: root.aiExecutor,
    modelProfiles: root.modelProfiles,
    store: root.database.features.insights,
    runtimeFlags: root.database.features.runtimeFlags,
  });
  cachedApplication = application;
  cachedRoot = root;
  return application;
}

/** Test-only seam: drop the cached application so the next call rebuilds. */
export function resetPageInsightsApplicationForTests(): void {
  cachedApplication = undefined;
  cachedRoot = undefined;
}
