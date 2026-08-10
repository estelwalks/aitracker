import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("skills route consumes opaque installation refs only", () => {
  const source = readFileSync(
    new URL("../../routes/agents.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /installation\.path|sourcePath\s*:|detectedPaths/,
  );
  assert.match(source, /installationRef/);
  assert.doesNotMatch(source, /source:\s*\{[^}]*label/);
  assert.match(source, /getSkillWorkspace/);
  assert.match(source, /showWorkspace=\{false\}/);
});

test("operations workspace does not render paths, roots, or raw source labels", () => {
  const source = readFileSync(
    new URL("./presentation/SkillsPage.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /installation\.path|sourcePath\s*:|\.roots\b/);
  assert.doesNotMatch(
    source,
    /sourceLabel\(|skills\.detail\.source|updateReason/,
  );
  assert.match(source, /buildSkillWorkspace/);
  assert.match(source, /skill-workspace-card/);
});
