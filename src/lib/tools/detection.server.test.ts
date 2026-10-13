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
    "macos",
  );
  assert.equal(facts.find((fact) => fact.id === "codex")?.installed, true);
  assert.equal(facts.find((fact) => fact.id === "cursor")?.installed, true);
  assert.equal(
    facts.find((fact) => fact.id === "claude-code")?.installed,
    false,
  );
});

test("installation facts merge executable and directory evidence", () => {
  const home = "/isolated/home";
  const facts = deriveToolInstallationFacts(
    AI_TOOLS,
    new Set([`${home}/.codex`]),
    home,
    "macos",
    new Map([["claude-code", ["/usr/local/bin/claude"]]]),
  );
  const claude = facts.find((fact) => fact.id === "claude-code");
  assert.equal(claude?.installed, true);
  assert.deepEqual(claude?.detectedPaths, ["/usr/local/bin/claude"]);
  const codex = facts.find((fact) => fact.id === "codex");
  assert.equal(codex?.installed, true);
  assert.deepEqual(codex?.detectedPaths, [`${home}/.codex`]);
});

test("Gemini CLI is not inferred from the shared .gemini config root", () => {
  const home = "/isolated/home";
  const [gemini] = deriveToolInstallationFacts(
    AI_TOOLS.filter((tool) => tool.id === "gemini-cli"),
    new Set([`${home}/.gemini`]),
    home,
    "macos",
  );
  assert.equal(gemini?.installed, false);

  const [withSessions] = deriveToolInstallationFacts(
    AI_TOOLS.filter((tool) => tool.id === "gemini-cli"),
    new Set([`${home}/.gemini`, `${home}/.gemini/tmp`]),
    home,
    "macos",
  );
  assert.equal(withSessions?.installed, true);
  assert.deepEqual(withSessions?.detectedPaths, [`${home}/.gemini/tmp`]);
});

import { describe, test as it } from "node:test";
import { PUBLIC_TOOL_MANIFEST } from "../tool-registry/public-manifest.generated.ts";
import { detectRootsForOs, osFromProcess } from "./detection.server.ts";

describe("P4-T1 platform-aware probing", () => {
  it("macos probes dot-roots plus macos appData roots", () => {
    const roots = detectRootsForOs(AI_TOOLS, "macos");
    const codex = roots.get("codex") ?? [];
    assert.deepEqual([...codex], [".codex"]);
    const claude = roots.get("claude-code") ?? [];
    assert.ok(claude.includes("Library/Application Support/Claude"));
  });

  it("windows probes dot-roots only (no Library/.config/.local/share)", () => {
    const roots = detectRootsForOs(AI_TOOLS, "windows");
    // Dot-roots still probed on windows.
    assert.ok((roots.get("codex") ?? []).includes(".codex"));
    // No macos-only Library roots on windows.
    assert.ok(
      !(roots.get("claude-code") ?? []).includes(
        "Library/Application Support/Claude",
      ),
    );
    // No ~/.config or ~/.local/share probes on windows (D-A expected diff).
    for (const [id, paths] of roots) {
      for (const p of paths) {
        assert.ok(
          !p.startsWith("Library/") &&
            !p.startsWith(".config/") &&
            !p.startsWith(".local/"),
          `${id}: unexpected ${p} on windows`,
        );
      }
    }
  });

  it("linux probes exactly the tools the registry marks supported", () => {
    // The invariant, not a hardcoded list: `detectRootsForOs` must return a
    // probe set for every tool whose linux status is "supported", and nothing
    // for a tool that is "planned" or "unsupported". A hardcoded list was fine
    // while only four tools were supported; with the Linux launch it would have
    // to be rewritten on every tool that gets verified.
    const roots = detectRootsForOs(AI_TOOLS, "linux");
    // Every tool gets an entry; a platform that is not "supported" gets an
    // EMPTY probe list rather than no entry at all. `AI_TOOLS` is a display
    // projection (id/name/detectRoots only), so the per-platform status comes
    // from the registry's public manifest.
    const statuses = new Map(
      PUBLIC_TOOL_MANIFEST.tools.map((tool) => [tool.id, tool.platforms.linux]),
    );
    assert.equal(roots.size, AI_TOOLS.length, "every catalog tool is listed");
    for (const [id, paths] of roots) {
      if (statuses.get(id) === "supported") continue;
      assert.deepEqual(
        [...paths],
        [],
        `${id} is ${String(statuses.get(id))} on linux but has probe roots`,
      );
    }

    // A tool with a HOME dot-directory resolves it; a tool whose only Linux
    // locations are XDG config/data bases has no dot-root to probe and yields
    // an empty list rather than being absent.
    assert.deepEqual([...(roots.get("codex") ?? [])], [".codex"]);
    assert.ok(
      (roots.get("claude-code") ?? []).includes(".claude"),
      "claude-code probes ~/.claude on linux",
    );
    // Tools with no Linux install at all are marked unsupported and therefore
    // probe nothing. Only the ones the public manifest ships a status for can
    // be asserted by name — the manifest is a curated subset of the registry.
    for (const id of [
      "aipy",
      "doubao-work",
      "kimi-work",
      "marvis",
      "trae-work",
    ]) {
      if (!statuses.has(id)) continue;
      assert.equal(statuses.get(id), "unsupported", `${id} status`);
      assert.deepEqual([...(roots.get(id) ?? [])], [], `${id} probes`);
    }
  });

  it("osFromProcess maps node platforms", () => {
    assert.equal(osFromProcess("darwin"), "macos");
    assert.equal(osFromProcess("win32"), "windows");
    assert.equal(osFromProcess("linux"), "linux");
  });
});
