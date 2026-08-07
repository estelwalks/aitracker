import assert from "node:assert/strict";
import test from "node:test";
import { evaluateInstallability, parseSkillPackageMetadata } from "./index.ts";
import { packageHash } from "../domain.ts";

const hash = "sha256-" + "b".repeat(64);
const input = { name: "a", version: "1", source: "local", hash };

test("parser returns stable Result errors without throwing", () => {
  const invalid = parseSkillPackageMetadata({ ...input, hash: "bad" });
  assert.equal(invalid.ok, false);
  if (!invalid.ok)
    assert.equal(invalid.error.code, "errors.skillCatalog.invalidHash");
  const nonObject = parseSkillPackageMetadata(null);
  assert.equal(nonObject.ok, false);
});

test("installability requires assessment and matching package hash", () => {
  const parsed = parseSkillPackageMetadata(input);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const missing = evaluateInstallability(parsed.value);
  assert.equal(missing.ok, false);
  if (!missing.ok)
    assert.equal(missing.error.code, "errors.skillCatalog.assessmentRequired");
  const mismatch = evaluateInstallability(
    parsed.value,
    undefined,
    packageHash("sha256-" + "c".repeat(64)),
  );
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok)
    assert.equal(mismatch.error.code, "errors.skillCatalog.hashMismatch");
});
