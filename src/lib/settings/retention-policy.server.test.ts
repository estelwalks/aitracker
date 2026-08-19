import assert from "node:assert/strict";
import test from "node:test";

import { retentionDaysFromPreference } from "./retention-policy.server.ts";

test("retention preference uses the SQLite value", () => {
  assert.equal(
    retentionDaysFromPreference(JSON.stringify({ retentionDays: 45 })),
    45,
  );
});

test("missing preference uses the new-install default", () => {
  assert.equal(retentionDaysFromPreference(undefined), 90);
});
