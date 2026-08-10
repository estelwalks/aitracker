import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scanRepository } from "./check-open-source-hygiene.mjs";

test("hygiene scanner detects secrets, private paths and TokenTracker references", () => {
  const root = mkdtempSync(join(tmpdir(), "trusttools-hygiene-"));
  writeFileSync(
    join(root, "unsafe.ts"),
    'const token = "sk-12345678901234567890";\n// /Users/alice/project\n// TokenTracker\n',
  );
  const findings = scanRepository(root);
  assert.deepEqual(
    new Set(findings.map((finding) => finding.rule)),
    new Set([
      "credential-value",
      "local-absolute-path",
      "tokentracker-residue",
    ]),
  );
});

test("docs, fixtures and tests are excluded to avoid example false positives", () => {
  const root = mkdtempSync(join(tmpdir(), "trusttools-hygiene-"));
  mkdirSync(join(root, "docs"));
  mkdirSync(join(root, "fixtures"));
  mkdirSync(join(root, ".output"));
  writeFileSync(join(root, "docs", "example.md"), "TokenTracker /Users/alice");
  writeFileSync(join(root, "fixtures", "sample.ts"), "sk-12345678901234567890");
  writeFileSync(join(root, "sample.test.ts"), "TokenTracker /Users/alice");
  writeFileSync(
    join(root, ".output", "manifest.json"),
    '"/Users/alice/.cache" sk-12345678901234567890',
  );
  assert.deepEqual(scanRepository(root), []);
});
