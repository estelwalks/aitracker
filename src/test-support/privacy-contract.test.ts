import assert from "node:assert/strict";
import test from "node:test";

import { AppError, toUiError } from "../lib/errors.ts";
import { PUBLIC_TOOL_MANIFEST } from "../lib/tool-registry/public-manifest.generated.ts";
import {
  marketListFixture,
  securityReportFixture,
  sessionSummaryFixture,
  skillSnapshotFixture,
  usageSnapshotFixture,
} from "./output-baseline.ts";
import {
  findDtoDisclosureViolations,
  isP0StableErrorCode,
  P0_STABLE_ERROR_CODES,
} from "./privacy-contract.ts";

test("P0-05: public and synthetic DTOs contain no sensitive disclosures", () => {
  const dtoSamples = [
    PUBLIC_TOOL_MANIFEST,
    usageSnapshotFixture,
    skillSnapshotFixture,
    sessionSummaryFixture,
    securityReportFixture,
    marketListFixture,
  ];

  assert.deepEqual(findDtoDisclosureViolations(dtoSamples), []);
});

test("P0-05: disclosure contract catches each protected data class", () => {
  const violations = findDtoDisclosureViolations({
    diskLocation: "/Users/example/private/session.jsonl",
    windowsLocation: "C:\\Users\\example\\secret.txt",
    apiKey: "sk-1234567890abcdef",
    prompt: "unredacted conversation body",
    nested: { resumeCommand: ["codex", "resume", "abc"] },
  });

  assert.deepEqual(violations.map((violation) => violation.kind).sort(), [
    "absolute-path",
    "absolute-path",
    "credential",
    "raw-field",
    "raw-field",
    "raw-field",
  ]);
});

test("P0-05: UI errors use the stable translated-code contract", () => {
  for (const code of P0_STABLE_ERROR_CODES) {
    assert.equal(isP0StableErrorCode(code), true);
    const uiError = toUiError(new AppError(code));
    assert.deepEqual(uiError, { code, params: undefined });
  }

  assert.equal(isP0StableErrorCode("errors.market.archive.invalidPath"), false);
  assert.equal(isP0StableErrorCode("untranslated error text"), false);
});
