import assert from "node:assert/strict";
import test from "node:test";

import { INSIGHT_SURFACE_IDS } from "../page/contracts.ts";
import {
  assertPromptRegistryComplete,
  buildInsightPromptTemplate,
  getInsightPrompt,
  INSIGHT_ALLOWED_LOCALES,
  INSIGHT_OUTPUT_SCHEMA_VERSION,
  INSIGHT_PROMPT_VERSION,
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

test("widget uses one line; every complete page allows up to ten", () => {
  for (const surface of INSIGHT_SURFACE_IDS) {
    const entry = getInsightPrompt(surface);
    assert.equal(entry.maxLines, surface === "widget" ? 1 : 10);
    assert.equal(entry.maxAnalysisChars, 160);
    assert.equal(entry.version, 6);
  }
});

test("all thirteen complete pages have distinct policies", () => {
  const completeSurfaces = INSIGHT_SURFACE_IDS.filter(
    (surface) => surface !== "widget",
  );
  const policies = completeSurfaces.map(
    (surface) => getInsightPrompt(surface).policy,
  );
  assert.equal(completeSurfaces.length, 13);
  assert.equal(new Set(policies).size, completeSurfaces.length);
  for (const policy of policies) {
    assert.match(policy, /distinct dimensions/i);
  }
});

test("security policy insists severity is never softened", () => {
  const policy = getInsightPrompt("security").policy;
  assert.match(policy, /NEVER|never/i);
  assert.match(policy, /severity/i);
});

test("every prompt carries the shared safety system, locales, and v6 schema", () => {
  assert.equal(INSIGHT_PROMPT_VERSION, 6);
  assert.equal(INSIGHT_OUTPUT_SCHEMA_VERSION, 6);
  for (const surface of INSIGHT_SURFACE_IDS) {
    const entry = getInsightPrompt(surface);
    assert.equal(entry.system.length > 0, true);
    assert.deepEqual(entry.allowedLocales, [...INSIGHT_ALLOWED_LOCALES]);
    assert.equal(entry.outputSchemaVersion, 6);
  }
});

test("buildInsightPromptTemplate embeds the surface policy and line budget", () => {
  const widget = buildInsightPromptTemplate(getInsightPrompt("widget"));
  assert.match(widget, /widget/i);
  assert.match(widget, /exactly one line/i);
  assert.match(widget, /open_security/);

  const dashboard = buildInsightPromptTemplate(getInsightPrompt("dashboard"));
  assert.match(dashboard, /at most 10 useful lines/i);
  assert.match(dashboard, /fewer than five is correct/i);
  assert.match(dashboard, /Never pad, repeat, or paraphrase/i);
  assert.match(dashboard, /Do not repeat, paraphrase, summarize/i);
  assert.match(dashboard, /Treat unknown.*as unknown/i);
  assert.match(dashboard, /install or connect missing tools/i);
  assert.match(dashboard, /Analyze every candidate independently/i);
  assert.match(dashboard, /use ONLY that candidate's fact/i);
  assert.match(dashboard, /never borrow a number.*from another candidate/i);
  assert.match(dashboard, /external or assumed benchmarks/i);
  assert.match(dashboard, /Do not speculate/i);
  assert.match(dashboard, /requests for more data, further confirmation/i);
  assert.match(dashboard, /Quality is more important than line count/i);
  assert.match(dashboard, /omit the line.*cannot support/i);
  assert.match(dashboard, /same or synonymous implication/i);
  assert.match(dashboard, /Ground every metric word/i);
  assert.match(dashboard, /never mention events or event volume unless/i);
  assert.match(dashboard, /Never fill a line by describing absent dimensions/i);
  assert.match(dashboard, /only a total-volume dimension is provided/i);
  assert.match(dashboard, /assumptions are unnecessary or forbidden/i);
  assert.match(dashboard, /call a number.*limited, few, small, high, or low/i);
});
