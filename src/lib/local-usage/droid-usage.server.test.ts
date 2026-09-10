import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import {
  isPrivateSessionId,
  sessionIdFromStructuredValue,
} from "./session-id.ts";

/**
 * Droid (Factory CLI) usage support (TokenTracker-sourced): the registry
 * declares a native reader over the `.factory/sessions` tree of the user home
 * (every platform, including win32's %USERPROFILE%), matching every
 * `<id>.settings.json` file at any depth. Each session has a settings file
 * holding its CUMULATIVE session-level tokenUsage plus a sibling `<id>.jsonl`
 * transcript (no token counts, only a fallback `Model:` marker); the settings
 * file is rewritten every turn, so its mtime is the event timestamp. These
 * tests run the real scan pipeline against win32 fixtures pinning that
 * contract.
 */

interface TokenUsageFixture {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  thinkingTokens: number;
}

async function writeSettings(path: string, settings: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(settings), "utf8");
}

function usage(tokens: TokenUsageFixture): { tokenUsage: TokenUsageFixture } {
  return { tokenUsage: tokens };
}

test("droid usage adapter reads cumulative per-session settings.json totals", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-droid-"));
  try {
    const sessions = join(root, ".factory", "sessions");

    // Session "a" lives in two folders under the sessions root (duplicated
    // copy, TokenTracker #204). The nested copy carries the larger cumulative
    // totals, so it must be the single canonical event for the session.
    const aRoot = join(sessions, "a.settings.json");
    const aNested = join(sessions, "archive", "a.settings.json");
    await writeSettings(aRoot, {
      model: "custom:GLM-5.1-[Proxy]-0",
      ...usage({
        inputTokens: 100,
        outputTokens: 20,
        cacheCreationTokens: 3,
        cacheReadTokens: 5,
        thinkingTokens: 0,
      }),
    });
    await writeSettings(aNested, {
      model: "custom:GLM-5.1-[Proxy]-0",
      ...usage({
        inputTokens: 1000,
        outputTokens: 200,
        cacheCreationTokens: 30,
        cacheReadTokens: 40,
        thinkingTokens: 10,
      }),
    });

    // Session "b" has no settings.model; the sibling transcript's `Model:`
    // line supplies the fallback model id.
    const bSettings = join(sessions, "b.settings.json");
    await writeSettings(bSettings, {
      ...usage({
        inputTokens: 300,
        outputTokens: 60,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 5,
      }),
    });
    await writeFile(
      join(sessions, "b.jsonl"),
      [
        '{"type":"session_start","cwd":"C:\\\\repo"}',
        "[00:00:01] Model: Claude Sonnet 4.5",
        '{"type":"message"}',
      ].join("\n"),
      "utf8",
    );

    // Skip rules: zero-sum tokenUsage, missing tokenUsage, malformed JSON.
    await writeSettings(join(sessions, "c.settings.json"), {
      ...usage({
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 0,
      }),
    });
    await writeSettings(join(sessions, "d.settings.json"), {
      model: "some-model",
    });
    await writeFile(join(sessions, "e.settings.json"), "not-json{{{", "utf8");

    const nestedStat = await stat(aNested);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const droid = snapshot.sources.find((source) => source.source === "droid");
    assert.ok(droid, "droid source must be reported");
    assert.equal(droid.available, true);
    assert.equal(droid.detected, true);
    assert.equal(droid.events, 2);
    assert.equal(droid.filesConsidered, 6);
    assert.equal(droid.filesRead, 6);
    assert.equal(droid.filesParsed, 6);
    assert.equal(droid.malformedLines, 1);
    assert.ok(
      droid.diagnostics?.some((item) => item.code === "malformed-json"),
      "the malformed settings file must surface a malformed-json diagnostic",
    );

    const events = snapshot.details.filter((event) => event.source === "droid");
    assert.equal(events.length, 2);

    const sessionA = events.filter(
      (event) => event.sessionId === sessionIdFromStructuredValue("droid", "a"),
    );
    assert.equal(sessionA.length, 1, "duplicate session copies must collapse");
    assert.equal(sessionA[0].model, "glm-5-1-0");
    assert.equal(sessionA[0].inputTokens, 1000);
    assert.equal(sessionA[0].outputTokens, 200);
    assert.equal(sessionA[0].cachedInputTokens, 40);
    assert.equal(sessionA[0].cacheCreationInputTokens, 30);
    assert.equal(sessionA[0].reasoningOutputTokens, 10);
    assert.equal(sessionA[0].totalTokens, 1280);
    assert.equal(
      sessionA[0].timestamp,
      new Date(nestedStat.mtimeMs).toISOString(),
      "the event timestamp must be the canonical settings file mtime",
    );

    const sessionB = events.filter(
      (event) => event.sessionId === sessionIdFromStructuredValue("droid", "b"),
    );
    assert.equal(sessionB.length, 1);
    assert.equal(
      sessionB[0].model,
      "claude-sonnet-4-5",
      "settings.model missing must fall back to the sibling jsonl Model: line",
    );
    assert.equal(sessionB[0].inputTokens, 300);
    assert.equal(sessionB[0].outputTokens, 60);
    assert.equal(sessionB[0].cachedInputTokens, 0);
    assert.equal(sessionB[0].cacheCreationInputTokens, 0);
    assert.equal(sessionB[0].reasoningOutputTokens, 5);
    assert.equal(sessionB[0].totalTokens, 365);

    // Every event carries an opaque structured session id.
    for (const event of events) {
      assert.ok(
        event.sessionId != null && isPrivateSessionId(event.sessionId),
        "droid events must carry an opaque session_ id",
      );
    }
    // Zero-sum / tokenUsage-less / malformed settings never become events.
    for (const stem of ["c", "d", "e"]) {
      assert.equal(
        events.some(
          (event) =>
            event.sessionId === sessionIdFromStructuredValue("droid", stem),
        ),
        false,
        `"${stem}" must be skipped`,
      );
    }

    // An unchanged sessions tree is served from the persistent per-file cache.
    const second = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const secondDroid = second.sources.find(
      (source) => source.source === "droid",
    );
    assert.ok(secondDroid);
    assert.equal(secondDroid.filesParsed, 0);
    assert.equal(secondDroid.filesReused, 6);
    assert.equal(secondDroid.events, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
