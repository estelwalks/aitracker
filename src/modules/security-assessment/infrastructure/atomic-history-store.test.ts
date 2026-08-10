import assert from "node:assert/strict";
import test from "node:test";

import type { AtomicJsonStore } from "../../../platform/persistence/contracts.ts";
import { createAssetAssessment } from "../application/index.ts";
import {
  createAtomicSecurityAssessmentHistoryStore,
  type SecurityAssessmentHistoryDocument,
} from "./atomic-history-store.ts";

function memoryStore(): AtomicJsonStore<SecurityAssessmentHistoryDocument> {
  let value: SecurityAssessmentHistoryDocument = { entries: [] };
  return {
    read: async () => ({ value, source: "stored", schemaVersion: 1 }),
    write: async (next) => {
      value = next;
    },
  };
}

test("atomic assessment history replaces an asset's last result and persists only safe assessment fields", async () => {
  const history = createAtomicSecurityAssessmentHistoryStore(memoryStore());
  const first = createAssetAssessment({
    assetRef: "asset:local-skill-a",
    assetHashRef: "asset-hash:sha256-first",
    assetKind: "skill",
    verdict: "clean",
    findingCount: 0,
    ruleVersion: "builtin-v4",
    assessedAt: "2026-08-10T01:00:00.000Z",
  });
  const second = createAssetAssessment({
    assetRef: "asset:local-skill-a",
    assetHashRef: "asset-hash:sha256-second",
    assetKind: "skill",
    verdict: "suspicious",
    findingCount: 1,
    findingSeverities: ["medium"],
    ruleVersion: "builtin-v4",
    assessedAt: "2026-08-10T02:00:00.000Z",
  });

  await history.save(first);
  await history.save(second);

  const values = await history.list();
  assert.equal(values.length, 1);
  assert.equal(values[0]?.verdict, "suspicious");
  assert.equal(values[0]?.assetHashRef, "asset-hash:sha256-second");
  assert.equal(
    (await history.latest("asset:local-skill-a"))?.assessmentRef,
    first.assessmentRef,
  );
});
