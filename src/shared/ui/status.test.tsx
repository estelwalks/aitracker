import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { catalogs, getMessage } from "@/lib/i18n/messages";

import {
  STATUS_DEFINITIONS,
  createStatusViewModel,
  isUiDataStatus,
  type UiDataStatus,
} from "./status";
import { StatusBadge, StatusBanner } from "./status.tsx";

const statuses: UiDataStatus[] = [
  "fresh",
  "stale",
  "running",
  "waiting-approval",
  "failed",
  "empty",
  "offline",
  "disabled",
];

test("every data status has a safe, complete definition", () => {
  for (const status of statuses) {
    const model = createStatusViewModel(status);
    assert.equal(model.status, status);
    assert.match(model.messageKey, /^common\.status\./);
    assert.ok(
      ["success", "info", "warning", "danger", "neutral"].includes(
        model.severity,
      ),
    );
    assert.ok(["status", "alert"].includes(model.role));
    assert.ok(["off", "polite", "assertive"].includes(model.ariaLive));
  }
  assert.equal(createStatusViewModel("future-state").status, "empty");
  assert.equal(isUiDataStatus("offline"), true);
  assert.equal(isUiDataStatus("unknown"), false);
});

test("failed and disabled states have intentional accessibility behavior", () => {
  assert.deepEqual(STATUS_DEFINITIONS.failed, {
    messageKey: "common.status.failed",
    severity: "danger",
    role: "alert",
    ariaLive: "assertive",
    loading: false,
    disabled: false,
  });
  assert.equal(STATUS_DEFINITIONS.disabled.ariaLive, "off");
  assert.equal(STATUS_DEFINITIONS.disabled.disabled, true);
  assert.equal(STATUS_DEFINITIONS.running.loading, true);
});

test("all status keys exist in all four locale catalogs", () => {
  for (const catalog of Object.values(catalogs)) {
    for (const status of statuses) {
      const key = STATUS_DEFINITIONS[status].messageKey;
      const value = getMessage(catalog, key);
      assert.notEqual(value, key);
      assert.ok(value.length > 0);
    }
  }
});

test("status components expose role, live region, loading and disabled state", () => {
  const resolve = (
    key: (typeof STATUS_DEFINITIONS)[UiDataStatus]["messageKey"],
  ) => key;
  const running = renderToStaticMarkup(
    <StatusBanner status="running" resolveMessage={resolve} />,
  );
  assert.match(running, /role="status"/);
  assert.match(running, /aria-live="polite"/);
  assert.match(running, /aria-busy="true"/);
  assert.match(running, /data-status="running"/);
  assert.doesNotMatch(running, /path|command|token|password|secret/i);

  const disabled = renderToStaticMarkup(
    <StatusBadge status="disabled" resolveMessage={resolve} />,
  );
  assert.match(disabled, /aria-disabled="true"/);
  assert.match(disabled, /aria-live="off"/);
});
