import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { constants, zstdCompressSync } from "node:zlib";
import { APP_DATA_DIR } from "../app-config";

import { scanLocalUsage } from "./scanner.server.ts";
import { isPrivateSessionId } from "./session-id.ts";

const NOW = new Date("2026-08-20T12:00:00.000Z");

function zstdFrame(text: string): Buffer {
  return zstdCompressSync(Buffer.from(text, "utf8"), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  });
}

function sessionLog(headerLine: string, eventLines: string[]): Buffer {
  return Buffer.concat([
    zstdFrame(`${headerLine}\n`),
    zstdFrame(`${eventLines.join("\n")}\n`),
  ]);
}

interface DshFixture {
  root: string;
  homeDirectory: string;
  cacheDirectory: string;
}

async function fixture(): Promise<DshFixture> {
  const root = join(
    tmpdir(),
    `aitracker-dsh-scan-${process.pid}-${Date.now()}`,
  );
  const homeDirectory = join(root, "home");
  const cacheDirectory = join(root, "cache");
  await mkdir(cacheDirectory, { recursive: true });
  return { root, homeDirectory, cacheDirectory };
}

const HEADER = (cwd: string) =>
  JSON.stringify({
    type: "session",
    version: 0,
    id: "session-11111111-1111-1111-1111-111111111111",
    createdAt: 1786933183733,
    cwd,
    delegationDepth: 0,
    agentPreset: "cordis",
  });

const TIME = 1787000000000;

test("DSH native reader extracts provider usage from zstd session logs", async () => {
  const f = await fixture();
  const project = join(f.homeDirectory, "project-a");
  const sessionDir = join(
    f.homeDirectory,
    ".dsh",
    "sessions",
    "project-a",
    "session-11111111-1111-1111-1111-111111111111",
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session.jsonl.zstd"),
    sessionLog(HEADER(project), [
      JSON.stringify({
        type: "request/header",
        seq: 1,
        time: TIME,
        data: {
          header: {
            config: {
              provider: "deepseek-official",
              model: "deepseek-v4-flash",
            },
            system: "TOP_SECRET_SYSTEM_PROMPT",
          },
        },
      }),
      JSON.stringify({
        type: "request/context",
        seq: 2,
        time: TIME,
        data: {
          provider: "deepseek-official",
          model: "deepseek-v4-flash",
          contextWindow: 1000000,
        },
      }),
      JSON.stringify({
        type: "assistant/message",
        seq: 3,
        time: TIME + 1000,
        data: {
          turn: 1,
          step: 1,
          message: {
            role: "assistant",
            content: [{ type: "text", text: "TOP_SECRET_MESSAGE" }],
          },
          usage: {
            inputTokens: 100,
            outputTokens: 20,
            cacheReadTokens: 50,
            reasoningTokens: 5,
          },
        },
      }),
      // No usage sample -> not an event.
      JSON.stringify({
        type: "assistant/message",
        seq: 4,
        time: TIME + 2000,
        data: { turn: 1, step: 2, message: { role: "assistant", content: [] } },
      }),
      // Streaming usage chunks are superseded by the final message sample.
      JSON.stringify({
        type: "assistant/chunk",
        seq: 5,
        time: TIME + 3000,
        data: {
          turn: 1,
          step: 2,
          chunk: {
            type: "usage",
            usage: { inputTokens: 999, outputTokens: 999 },
          },
        },
      }),
      JSON.stringify({
        type: "tool/call",
        seq: 6,
        time: TIME + 4000,
        data: { turn: 1, step: 2, name: "read", arguments: "TOOL_ARGUMENTS" },
      }),
      JSON.stringify({
        type: "request/header",
        seq: 7,
        time: TIME + 5000,
        data: {
          header: {
            config: { provider: "deepseek-official", model: "deepseek-v4-pro" },
          },
        },
      }),
      JSON.stringify({
        type: "assistant/message",
        seq: 8,
        time: TIME + 6000,
        data: {
          turn: 1,
          step: 3,
          message: { role: "assistant", content: [] },
          usage: { inputTokens: 40, outputTokens: 3, cacheReadTokens: 0 },
        },
      }),
      "this is not json",
    ]),
  );

  try {
    const first = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const summary = first.sources.find((s) => s.source === "dsh");
    assert.ok(summary);
    assert.equal(summary.detected, true);
    assert.equal(summary.filesConsidered, 1);
    assert.equal(summary.filesParsed, 1);
    assert.equal(summary.malformedLines, 1);
    assert.equal(summary.events, 2);

    const dshEvents = first.details.filter((e) => e.source === "dsh");
    assert.equal(dshEvents.length, 2);
    // `details` are newest-first; look events up by their distinguishing value.
    const byInput = new Map(dshEvents.map((e) => [e.inputTokens, e]));

    const firstEvent = byInput.get(100);
    assert.ok(firstEvent);
    assert.equal(firstEvent.cachedInputTokens, 50);
    assert.equal(firstEvent.cacheCreationInputTokens, 0);
    assert.equal(firstEvent.outputTokens, 20);
    assert.equal(firstEvent.reasoningOutputTokens, 5);
    assert.equal(firstEvent.totalTokens, 175);
    assert.equal(firstEvent.model, "deepseek-v4-flash");
    assert.equal(firstEvent.project, "~/project-a");
    assert.ok(isPrivateSessionId(firstEvent.sessionId));
    assert.equal(firstEvent.timestamp, new Date(TIME + 1000).toISOString());

    const secondEvent = byInput.get(40);
    assert.ok(secondEvent);
    assert.equal(secondEvent.outputTokens, 3);
    assert.equal(secondEvent.model, "deepseek-v4-pro");

    const dshTotals = first.bySource.find((b) => b.key === "dsh");
    assert.ok(dshTotals);
    assert.equal(dshTotals.inputTokens, 140);
    assert.equal(dshTotals.cachedInputTokens, 50);
    assert.equal(dshTotals.outputTokens, 23);
    assert.equal(dshTotals.reasoningOutputTokens, 5);
    assert.equal(dshTotals.events, 2);

    // The index is now an in-process, rebuildable cache: no app-owned JSON
    // sidecar is created, so raw message/system content cannot be persisted.
    await assert.rejects(
      access(join(f.cacheDirectory, "local-usage-index-v10.json")),
    );

    // Incremental rescan reuses the cached parse.
    const second = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const secondSummary = second.sources.find((s) => s.source === "dsh");
    assert.ok(secondSummary);
    assert.equal(secondSummary.filesParsed, 0);
    assert.equal(secondSummary.filesReused, 1);
    assert.equal(secondSummary.events, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("DSH reader accepts plaintext .jsonl logs (compression none)", async () => {
  const f = await fixture();
  const project = join(f.homeDirectory, "project-b");
  const sessionDir = join(
    f.homeDirectory,
    ".dsh",
    "sessions",
    "project-b",
    "session-22222222-2222-2222-2222-222222222222",
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session.jsonl"),
    [
      HEADER(project),
      JSON.stringify({
        type: "assistant/message",
        seq: 1,
        time: TIME,
        data: {
          turn: 1,
          step: 1,
          message: { role: "assistant", content: [] },
          usage: { inputTokens: 7, outputTokens: 2 },
        },
      }),
    ].join("\n"),
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const events = snapshot.details.filter((e) => e.source === "dsh");
    assert.equal(events.length, 1);
    assert.equal(events[0].inputTokens, 7);
    assert.equal(events[0].outputTokens, 2);
    assert.equal(events[0].project, "~/project-b");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("DSH reader reports a diagnostic for undecodable logs without failing the scan", async () => {
  const f = await fixture();
  const sessionDir = join(
    f.homeDirectory,
    ".dsh",
    "sessions",
    "project-c",
    "session-33333333-3333-3333-3333-333333333333",
  );
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, "session.jsonl.zstd"),
    Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x01, 0x02, 0x03]),
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const summary = snapshot.sources.find((s) => s.source === "dsh");
    assert.ok(summary);
    assert.equal(summary.filesParsed, 1);
    assert.equal(summary.events, 0);
    assert.ok(
      summary.diagnostics?.some((d) => d.code === "malformed-json"),
      "expected a malformed-json diagnostic for the corrupt log",
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("dsh appears among KNOWN_LOCAL_USAGE_SOURCES and stays scannable via registry", async () => {
  const { KNOWN_LOCAL_USAGE_SOURCES } = await import("./types.ts");
  assert.ok(
    (KNOWN_LOCAL_USAGE_SOURCES as readonly string[]).includes("dsh"),
    "dsh missing from KNOWN_LOCAL_USAGE_SOURCES",
  );
  const { getDefaultRegistry } = await import("../tool-registry/registry.ts");
  const registry = getDefaultRegistry();
  const dsh = registry.byId.get("dsh");
  assert.ok(dsh);
  assert.equal(dsh.capabilities.usage.mode, "native");
  assert.equal(dsh.capabilities.usage.reader, "dsh-session-v1");
  assert.equal(APP_DATA_DIR, ".aitracker"); // sanity: app data root untouched
});
