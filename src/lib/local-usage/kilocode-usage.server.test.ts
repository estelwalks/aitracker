import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import {
  isPrivateSessionId,
  sessionIdFromStructuredValue,
} from "./session-id.ts";

/**
 * Kilo Code usage support (TokenTracker-sourced): the registry declares a
 * native reader over every VS Code-family install's
 * `User/globalStorage/kilocode.kilo-code/tasks` tree (Code, Code - Insiders,
 * Cursor, CodeBuddy, Windsurf, VSCodium, Trae, Trae CN), matching each task's
 * `ui_messages.json` (a single whole-file JSON array, rewritten on every
 * turn). Token counts and the inference provider live inside the JSON-string
 * `text` of `say == "api_req_started" | "api_req_deleted"` messages, so this
 * reader must be native. These tests run the real scan pipeline against a
 * win32 fixture pinning the TokenTracker semantics: per-request field
 * decomposition (input/cached/cacheCreation/output), deleted rows counting
 * like started ones, zero-sum request-START placeholders never surfacing, and
 * the per-file cache contract.
 */

interface UiMessageFixture {
  say?: string;
  ts?: number;
  text?: unknown;
}

function uiMessage(fixture: UiMessageFixture): unknown {
  const message: Record<string, unknown> = {
    type: "say",
    ...(fixture.say == null ? {} : { say: fixture.say }),
    ...(fixture.ts == null ? {} : { ts: fixture.ts }),
    ...(fixture.text == null ? {} : { text: fixture.text }),
  };
  return message;
}

/** JSON-stringify a Kilo Code token payload (the `text` of a say message). */
function payloadText(payload: Record<string, unknown>): string {
  return JSON.stringify(payload);
}

async function writeUiMessages(
  path: string,
  messages: readonly unknown[],
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(messages), "utf8");
}

test("kilocode usage adapter reads per-message ui_messages.json token payloads", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-kilocode-"));
  try {
    // win32 fixture: %APPDATA% is the appDataRoaming base, which compiles to
    // the HOME-relative "AppData/Roaming/..." root.
    const taskFile = join(
      root,
      "AppData",
      "Roaming",
      "Code",
      "User",
      "globalStorage",
      "kilocode.kilo-code",
      "tasks",
      "task-1",
      "ui_messages.json",
    );
    const now = Date.now();
    // Message timestamps pinned to fixed offsets from "now" so they always
    // land inside the scan's lookback window.
    const ts1 = now - 3 * 60 * 60 * 1000;
    const ts2 = now - 2 * 60 * 60 * 1000;
    const ts3 = now - 60 * 60 * 1000;
    const tsZero = now - 30 * 60 * 1000;

    await writeUiMessages(taskFile, [
      // Request 1 (api_req_started): full four-field decomposition, provider
      // "Moonshot AI" -> model "provider:moonshot-ai" (whitespace -> "-").
      uiMessage({
        say: "api_req_started",
        ts: ts1,
        text: payloadText({
          apiProtocol: "anthropic",
          tokensIn: 28673,
          tokensOut: 31,
          cacheReads: 5120,
          cacheWrites: 0,
          cost: 0,
          inferenceProvider: "Moonshot AI",
        }),
      }),
      // Request 2 (api_req_started): simple provider slug, non-zero
      // cacheCreation.
      uiMessage({
        say: "api_req_started",
        ts: ts2,
        text: payloadText({
          apiProtocol: "openai",
          tokensIn: 1000,
          tokensOut: 400,
          cacheReads: 200,
          cacheWrites: 50,
          cost: 0,
          inferenceProvider: "Stealth",
        }),
      }),
      // Request 3 (api_req_deleted): a user-removed turn still billed by the
      // provider — counts exactly like started. Numeric-string token fields
      // are coerced (TokenTracker's toNonNegativeInt); no provider -> unknown.
      uiMessage({
        say: "api_req_deleted",
        ts: ts3,
        text: payloadText({
          apiProtocol: "openai",
          tokensIn: "60",
          tokensOut: 5,
          cacheReads: "7",
          cacheWrites: 8,
          cost: 0,
          inferenceProvider: "",
        }),
      }),
      // Zero-sum api_req_started: the request-START placeholder (written with
      // zero tokens and back-filled in place at the same ts) must never
      // surface as an event.
      uiMessage({
        say: "api_req_started",
        ts: tsZero,
        text: payloadText({
          apiProtocol: "anthropic",
          tokensIn: 0,
          tokensOut: 0,
          cacheReads: 0,
          cacheWrites: 0,
          cost: 0,
          inferenceProvider: "Moonshot AI",
        }),
      }),
      // Not one of the two billing says — structurally skipped, never
      // malformed.
      uiMessage({
        say: "command",
        ts: now - 20 * 60 * 1000,
        text: payloadText({
          tokensIn: 10,
          tokensOut: 10,
          cacheReads: 0,
          cacheWrites: 0,
          inferenceProvider: "Moonshot AI",
        }),
      }),
      // text not starting with "{" (plain string / non-string) — skipped.
      uiMessage({
        say: "api_req_started",
        ts: now - 10 * 60 * 1000,
        text: "not json",
      }),
      // text starting with "{" but not parseable JSON — skipped.
      uiMessage({
        say: "api_req_started",
        ts: now - 9 * 60 * 1000,
        text: "{oops",
      }),
      // Valid text payload JSON but ts missing/invalid — skipped.
      uiMessage({
        text: payloadText({
          tokensIn: 5,
          tokensOut: 5,
          cacheReads: 0,
          cacheWrites: 0,
          inferenceProvider: "Stealth",
        }),
      }),
      uiMessage({
        say: "api_req_started",
        ts: -1,
        text: payloadText({
          tokensIn: 5,
          tokensOut: 5,
          cacheReads: 0,
          cacheWrites: 0,
          inferenceProvider: "Stealth",
        }),
      }),
      // Non-object array element — skipped.
      "just a string",
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const kilocode = snapshot.sources.find(
      (source) => source.source === "kilocode",
    );
    assert.ok(kilocode, "kilocode source must be reported");
    assert.equal(kilocode.available, true);
    assert.equal(kilocode.detected, true);
    assert.equal(kilocode.events, 3);
    assert.equal(kilocode.filesConsidered, 1);
    assert.equal(kilocode.filesRead, 1);
    assert.equal(kilocode.filesParsed, 1);
    assert.equal(kilocode.filesReused, 0);
    assert.equal(kilocode.malformedLines, 0);

    const events = snapshot.details.filter(
      (event) => event.source === "kilocode",
    );
    assert.equal(events.length, 3);

    // Every event is derived from the taskUuid directory stem and carries an
    // opaque structured session id; project stays "unknown".
    const expectedSessionId = sessionIdFromStructuredValue(
      "kilocode",
      "task-1",
    );
    for (const event of events) {
      assert.ok(
        event.sessionId != null && isPrivateSessionId(event.sessionId),
        "kilocode events must carry an opaque session_ id",
      );
      assert.equal(event.sessionId, expectedSessionId);
      assert.equal(event.project, "unknown");
      assert.equal(event.reasoningOutputTokens, 0);
    }

    // Request 1: tokensIn 28673 / cacheReads 5120 / cacheWrites 0 /
    // tokensOut 31 -> total 33824.
    const rt1 = events.find((event) => event.totalTokens === 33824);
    assert.ok(rt1, "request 1 event present");
    assert.equal(rt1.model, "provider:moonshot-ai");
    assert.equal(rt1.inputTokens, 28673);
    assert.equal(rt1.cachedInputTokens, 5120);
    assert.equal(rt1.cacheCreationInputTokens, 0);
    assert.equal(rt1.outputTokens, 31);
    assert.equal(rt1.timestamp, new Date(ts1).toISOString());

    // Request 2: 1000 / 200 / 50 / 400 -> total 1650.
    const rt2 = events.find((event) => event.totalTokens === 1650);
    assert.ok(rt2, "request 2 event present");
    assert.equal(rt2.model, "provider:stealth");
    assert.equal(rt2.inputTokens, 1000);
    assert.equal(rt2.cachedInputTokens, 200);
    assert.equal(rt2.cacheCreationInputTokens, 50);
    assert.equal(rt2.outputTokens, 400);
    assert.equal(rt2.timestamp, new Date(ts2).toISOString());

    // Request 3 (api_req_deleted): numeric strings coerced (60/7), no
    // inferenceProvider -> "provider:unknown"; total 80.
    const rt3 = events.find((event) => event.totalTokens === 80);
    assert.ok(rt3, "request 3 (deleted) event present");
    assert.equal(rt3.model, "provider:unknown");
    assert.equal(rt3.inputTokens, 60);
    assert.equal(rt3.cachedInputTokens, 7);
    assert.equal(rt3.cacheCreationInputTokens, 8);
    assert.equal(rt3.outputTokens, 5);
    assert.equal(rt3.timestamp, new Date(ts3).toISOString());

    // No event may carry the zero-sum placeholder's timestamp or a zero total
    // (the request-START row and every skipped row produce nothing).
    assert.equal(
      events.some(
        (event) => event.timestamp === new Date(tsZero).toISOString(),
      ),
      false,
      "zero-sum placeholder must not produce an event",
    );
    assert.equal(
      events.some((event) => event.totalTokens === 0),
      false,
      "no zero-token event may surface",
    );

    // An unchanged tasks tree is served from the persistent per-file cache.
    const second = await scanLocalUsage({
      homeDirectory: root,
      cacheDirectory: join(root, ".cache"),
      lookbackDays: 3650,
      platform: "win32",
    });
    const secondKilocode = second.sources.find(
      (source) => source.source === "kilocode",
    );
    assert.ok(secondKilocode);
    assert.equal(secondKilocode.filesParsed, 0);
    assert.equal(secondKilocode.filesReused, 1);
    assert.equal(secondKilocode.events, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
