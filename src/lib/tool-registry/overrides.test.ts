import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolDefinition } from "./contracts.ts";
import {
  applyOverride,
  mergeOverrides,
  readToolOverrides,
  writeToolOverrides,
} from "./overrides.server.ts";

function baseDef(id = "codex"): ToolDefinition {
  return {
    id,
    configVersion: 1,
    display: { name: id, nameZh: id },
    detection: { roots: [`.${id}`] },
    capabilities: {
      usage: { mode: "unsupported" },
      skills: { mode: "read-write" },
      agents: { mode: "unsupported" },
      sessions: { mode: "unsupported" },
      market: { mode: "install-target" },
      security: { mode: "unsupported" },
    },
  };
}

test("missing overrides file yields empty overrides (no error)", async () => {
  const result = await readToolOverrides(join(tmpdir(), "does-not-exist.json"));
  assert.deepEqual(result.overrides, {});
  assert.deepEqual(result.diagnostics, []);
});

test("corrupt JSON falls back to empty with a diagnostic", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tt-ov-"));
  const file = join(dir, "tool-overrides.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, "{ not json", "utf8");
  const result = await readToolOverrides(file);
  assert.deepEqual(result.overrides, {});
  assert.equal(result.diagnostics.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("override attempting to change reader/command/pricing is rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tt-ov-"));
  const file = join(dir, "tool-overrides.json");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      overrides: { codex: { reader: "evil", command: ["rm", "-rf", "/"] } },
    }),
    "utf8",
  );
  const result = await readToolOverrides(file);
  // Strict schema rejects the unknown keys -> empty overrides + diagnostic.
  assert.deepEqual(result.overrides, {});
  assert.equal(result.diagnostics.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("mergeOverrides drops disabled tools and merges safe extra roots", () => {
  const defs = [baseDef("codex"), baseDef("cursor")];
  const result = mergeOverrides(defs, {
    codex: { enabled: false },
    cursor: { extraDiscoveryRoots: [".cursor/extra", "../evil", "/abs"] },
  });
  assert.deepEqual(
    result.definitions.map((d) => d.id),
    ["cursor"],
  );
  assert.deepEqual(result.disabledIds, ["codex"]);
  // Safe root merged; unsafe roots dropped + diagnosed.
  const cursor = result.definitions[0];
  assert.deepEqual([...cursor.detection.roots], [".cursor", ".cursor/extra"]);
  assert.ok(result.diagnostics.length >= 2);
});

test("applyOverride merges display name and never touches capabilities", () => {
  const { definition } = applyOverride(baseDef(), {
    display: { nameZh: "新名称" },
  });
  assert.equal(definition.display.nameZh, "新名称");
  // Capabilities unchanged.
  assert.equal(definition.capabilities.usage.mode, "unsupported");
});

test("writeToolOverrides is atomic (temp+rename) and reads back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tt-ov-"));
  const file = join(dir, "tool-overrides.json");
  await writeToolOverrides({ codex: { enabled: false } }, file);
  const written = JSON.parse(await readFile(file, "utf8"));
  assert.equal(written.version, 1);
  assert.equal(written.overrides.codex.enabled, false);
  // No leftover temp file.
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(dir);
  assert.deepEqual(entries, ["tool-overrides.json"]);
  const result = await readToolOverrides(file);
  assert.equal(result.overrides.codex.enabled, false);
  await rm(dir, { recursive: true, force: true });
});
