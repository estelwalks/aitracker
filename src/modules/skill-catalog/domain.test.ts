import assert from "node:assert/strict";
import test from "node:test";
import {
  applySecurityAssessment,
  dedupePackages,
  filterSkillPackages,
  normalizeSkillPackage,
  toSkillPackageDto,
} from "./index.ts";
import type { AssetAssessment } from "../security-assessment/contracts.ts";

const hash = "sha256-" + "a".repeat(64);
const metadata = {
  name: "review-skill",
  version: "1.0.0",
  source: {
    kind: "market",
    ref: "skill-source:marketplace",
    label: "Community",
  },
  hash,
  capabilities: ["review", "review", "prompt", "/tmp/private"],
  refs: ["ref:docs", "command=rm"],
};

test("normalizes local/market/enterprise metadata into safe package facts", () => {
  const value = normalizeSkillPackage(metadata, "2026-01-01T00:00:00.000Z");
  assert.equal(value.verdict, "unknown");
  assert.equal(value.installability, "blocked");
  assert.deepEqual(value.capabilities, ["review"]);
  assert.deepEqual(value.refs, ["ref:docs"]);
  assert.equal(value.source.ref, "skill-source:marketplace");
  assert.deepEqual(toSkillPackageDto(value), {
    name: "review-skill",
    version: "1.0.0",
    source: {
      kind: "market",
      ref: "skill-source:marketplace",
      label: "Community",
    },
    hash,
    verdict: "unknown",
    installability: "blocked",
    capabilities: ["review"],
    refs: ["ref:docs"],
  });
});

test("only a matching clean security assessment becomes installable", () => {
  const value = normalizeSkillPackage(metadata);
  const assessment: AssetAssessment = {
    assessmentRef:
      "assessment:review-skill-1.0.0-aaaaaaaaaaaa" as `assessment:${string}`,
    assetRef:
      `asset:${value.packageRef.slice("package:".length)}` as `asset:${string}`,
    assetHashRef: `asset-hash:${hash}` as `asset-hash:${string}`,
    assetKind: "skill" as const,
    verdict: "clean" as const,
    findings: [],
    ruleVersion: { version: "v1", provenance: "builtin" as const },
    assessedAt: "2026-01-01T00:00:00.000Z",
    evidenceCount: 0,
  };
  const clean = applySecurityAssessment(value, assessment);
  assert.equal(clean.verdict, "clean");
  assert.equal(clean.installability, "installable");
  for (const verdict of ["suspicious", "dangerous", "unknown"] as const) {
    const blocked = applySecurityAssessment(value, { ...assessment, verdict });
    assert.equal(blocked.verdict, verdict);
    assert.equal(blocked.installability, "blocked");
  }
});

test("assessment hash/ref mismatch is fail-closed", () => {
  const value = normalizeSkillPackage(metadata);
  const blocked = applySecurityAssessment(value, {
    assessmentRef: "assessment:x" as `assessment:${string}`,
    assetRef: "asset:other" as `asset:${string}`,
    assetKind: "skill",
    verdict: "clean",
    findings: [],
    ruleVersion: { version: "v1", provenance: "builtin" },
    assessedAt: new Date(0).toISOString(),
    evidenceCount: 0,
  });
  assert.equal(blocked.installability, "blocked");
  assert.equal(blocked.verdict, "unknown");
});

test("deduplicates same name/version/hash and supports search/filter", () => {
  const first = normalizeSkillPackage(metadata, "2026-01-01T00:00:00.000Z");
  const second = normalizeSkillPackage(
    { ...metadata, source: "enterprise" },
    "2026-01-02T00:00:00.000Z",
  );
  const deduped = dedupePackages([first, second]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].source.kind, "enterprise");
  assert.equal(
    filterSkillPackages(deduped.map(toSkillPackageDto), { text: "review" })
      .length,
    1,
  );
  assert.equal(
    filterSkillPackages(deduped.map(toSkillPackageDto), {
      installability: "installable",
    }).length,
    0,
  );
});
