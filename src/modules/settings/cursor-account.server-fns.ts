import { createServerFn } from "@tanstack/react-start";

import {
  CURSOR_ACCOUNT_USAGE_PREFERENCE_KEY,
  parseCursorAccountUsageEnabled,
} from "../../lib/cursor-account/preferences.ts";
import {
  readCursorAccountStatus,
  type CursorAccountSyncResult,
} from "../../lib/cursor-account/sync.server.ts";
import { runCursorAccountSync } from "../../lib/cursor-account/service.server.ts";

/**
 * Renderer-safe state of the opt-in Cursor account collector. No path, token,
 * cookie, or raw export row crosses this boundary.
 */
export interface CursorAccountUsageView {
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly signedIn: boolean;
  readonly syncedAt: string | null;
  readonly cachedRecords: number;
}

async function composition() {
  const { getCompositionRoot } =
    await import("../../app/composition.server.ts");
  return getCompositionRoot();
}

type Composition = Awaited<ReturnType<typeof composition>>;

function readEnabled(root: Composition): boolean {
  return parseCursorAccountUsageEnabled(
    root.database.features.appPreferences.get(
      CURSOR_ACCOUNT_USAGE_PREFERENCE_KEY,
    )?.value,
  );
}

async function view(
  root: Composition,
  enabled = readEnabled(root),
): Promise<CursorAccountUsageView> {
  const status = await readCursorAccountStatus({
    homeDirectory: root.dataRoot,
  });
  return {
    enabled,
    installed: status.installed,
    signedIn: status.signedIn,
    syncedAt: status.syncedAt,
    cachedRecords: status.cachedRecords,
  };
}

function validateToggle(value: unknown): { enabled: boolean } {
  if (
    value == null ||
    typeof value !== "object" ||
    typeof (value as { enabled?: unknown }).enabled !== "boolean"
  ) {
    throw new TypeError("cursor account usage requires a boolean enabled flag");
  }
  return { enabled: (value as { enabled: boolean }).enabled };
}

export const getCursorAccountUsageStatus = createServerFn({
  method: "GET",
}).handler(async (): Promise<CursorAccountUsageView> => {
  const root = await composition();
  return view(root);
});

export const setCursorAccountUsageEnabled = createServerFn({ method: "POST" })
  .validator(validateToggle)
  .handler(async ({ data }): Promise<CursorAccountUsageView> => {
    const root = await composition();
    root.database.features.appPreferences.set({
      key: CURSOR_ACCOUNT_USAGE_PREFERENCE_KEY,
      value: data.enabled,
      updatedAtMs: Date.now(),
    });
    return view(root, data.enabled);
  });

export interface CursorAccountSyncResponse {
  readonly result: CursorAccountSyncResult;
  readonly status: CursorAccountUsageView;
}

/**
 * Manual sync. The outbound request only happens when the user already opted
 * in; turning the feature off and pressing sync is a no-op that reports the
 * disabled state.
 */
export const syncCursorAccountUsageNow = createServerFn({
  method: "POST",
}).handler(async (): Promise<CursorAccountSyncResponse> => {
  const root = await composition();
  const enabled = readEnabled(root);
  const result = await runCursorAccountSync({
    homeDirectory: root.dataRoot,
    enabled,
  });
  if (result.status === "synced") {
    await root.usageSnapshot.requestRefresh({ reason: "event" });
  }
  return { result, status: await view(root, enabled) };
});
