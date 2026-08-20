import assert from "node:assert/strict";
import test from "node:test";

import { INSIGHT_SURFACE_IDS } from "../page/contracts.ts";
import {
  assertPromptRegistryComplete,
  buildInsightPromptTemplate,
  getInsightPrompt,
  INSIGHT_ALLOWED_LOCALES,
} from "./prompt-registry.ts";

test("registry covers all 14 surfaces with unique, legal versions", () => {
  assert.equal(INSIGHT_SURFACE_IDS.length, 14);
  assert.doesNotThrow(() => assertPromptRegistryComplete());
});

test("every surface id maps to a unique prompt id", () => {
  const ids = new Set(
    INSIGHT_SURFACE_IDS.map((surface) => getInsightPrompt(surface).id),
  );
  assert.equal(ids.size, INSIGHT_SURFACE_IDS.length);
  for (const surface of INSIGHT_SURFACE_IDS) {
    assert.equal(getInsightPrompt(surface).id, `insight.${surface}`);
  }
});

test("widget uses one line; every other surface uses three", () => {
  for (const surface of INSIGHT_SURFACE_IDS) {
    const entry = getInsightPrompt(surface);
    assert.equal(entry.maxLines, surface === "widget" ? 1 : 3);
    assert.equal(entry.maxAnalysisChars, 160);
  }
});

test("security policy insists severity is never softened", () => {
  const policy = getInsightPrompt("security").policy;
  assert.match(policy, /NEVER|never/i);
  assert.match(policy, /severity/i);
});

test("every prompt carries the shared safety system and three locales", () => {
  for (const surface of INSIGHT_SURFACE_IDS) {
    const entry = getInsightPrompt(surface);
    assert.equal(entry.system.length > 0, true);
    assert.deepEqual(entry.allowedLocales, [...INSIGHT_ALLOWED_LOCALES]);
    assert.equal(entry.outputSchemaVersion, 1);
  }
});

test("buildInsightPromptTemplate embeds the surface policy and line budget", () => {
  const template = buildInsightPromptTemplate(getInsightPrompt("widget"));
  assert.match(template, /widget/i);
  assert.match(template, /At most 1 line/);
  assert.match(template, /open_security/);
});
