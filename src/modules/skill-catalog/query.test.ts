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
});

test("skills lazy chunk renders the workspace hidden (P6-T6-04 split)", () => {
  const lazySource = readFileSync(
    new URL("../../routes/agents.lazy.tsx", import.meta.url),
    "utf8",
  );
  assert.match(lazySource, /showWorkspace=\{false\}/);
  assert.match(lazySource, /SkillsPage/);
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
  assert.match(source, /<SkillCard/);
});
