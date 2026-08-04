import assert from "node:assert/strict";
import test from "node:test";

import { AI_TOOLS } from "./catalog.ts";
import { deriveToolInstallationFacts } from "./detection.server.ts";

test("installation facts use only catalog probe roots", () => {
  const home = "/isolated/home";
  const facts = deriveToolInstallationFacts(
    AI_TOOLS,
    new Set([`${home}/.codex`, `${home}/Library/Application Support/Cursor`]),
    home,
  );
  assert.equal(facts.find((fact) => fact.id === "codex")?.installed, true);
  assert.equal(facts.find((fact) => fact.id === "cursor")?.installed, true);
  assert.equal(
    facts.find((fact) => fact.id === "claude-code")?.installed,
    false,
  );
});
