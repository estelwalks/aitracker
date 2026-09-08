import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import { isPrivateSessionId } from "./session-id.ts";

const NOW = new Date("2026-09-10T12:00:00.000Z");

interface PiFixture {
  root: string;
  homeDirectory: string;
  cacheDirectory: string;
}

async function fixture(): Promise<PiFixture> {
  const root = join(tmpdir(), `aitracker-pi-scan-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const cacheDirectory = join(root, "cache");
  await mkdir(cacheDirectory, { recursive: true });
  return { root, homeDirectory, cacheDirectory };
}

const SESSION_ID = "a1b2c3d4-1111-2222-3333-444455556666";
const TIME = 1787000000000;

function v4Header(cwd: string): string {
  return JSON.stringify({
    v: 4,
    kind: "header",
    id: SESSION_ID,
    storageVersion: 1,
    createdAt: TIME,
    cwd,
  });
}

function v3Header(cwd: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id: SESSION_ID,
    timestamp: new Date(TIME).toISOString(),
    cwd,
  });
}

function assistantMessage(
  seq: string,
  model: string,
  usage: Record<string, number>,
): string {
  return JSON.stringify({
    type: "message",
    id: `msg-${seq}`,
    message: {
      role: "assistant",
      model,
      provider: "deepseek",
      timestamp: TIME + 1000,
      content: [{ type: "text", text: "TOP_SECRET" }],
      usage,
    },
  });
}

async function sessionFile(
  homeDirectory: string,
  project: string,
  header: string,
  lines: string[],
): Promise<string> {
  const dir = join(
    homeDirectory,
    ".pi",
    "agent",
    "sessions",
    `--${project.replaceAll("/", "-")}--`,
  );
  await mkdir(dir, { recursive: true });
  const file = join(
    dir,
    `${new Date(TIME).toISOString().replace(/[:.]/g, "-")}_${encodeURIComponent(SESSION_ID)}.jsonl`,
  );
  await writeFile(file, [header, ...lines].join("\n"));
  return file;
}

test("pi native usage reader extracts assistant usage envelopes from v4 logs", async () => {
  const f = await fixture();
  const project = join(f.homeDirectory, "project-a");
  try {
    await sessionFile(f.homeDirectory, "project-a", v4Header(project), [
      JSON.stringify({
        type: "message",
        id: "u-1",
        message: { role: "user", content: "hi" },
      }),
      assistantMessage("1", "deepseek-v4-flash", {
        input: 100,
        output: 20,
        cacheRead: 50,
        reasoningTokens: 5,
      }),
      assistantMessage("2", "deepseek-v4-pro", { input: 40, output: 3 }),
      // Torn tail from an in-flight writer must not count as malformed.
      '{"type":"message","id":"wip","message":{"role":"assistant","usage":',
    ]);

    const snapshot = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const summary = snapshot.sources.find((s) => s.source === "pi");
    assert.ok(summary);
    assert.equal(summary.detected, true);
    assert.equal(summary.filesParsed, 1);
    assert.equal(summary.malformedLines, 0);
    assert.equal(summary.events, 2);

    const events = snapshot.details.filter((e) => e.source === "pi");
    assert.equal(events.length, 2);
    const byInput = new Map(events.map((e) => [e.inputTokens, e]));
    const first = byInput.get(100);
    assert.ok(first);
    assert.equal(first.cachedInputTokens, 50);
    assert.equal(first.cacheCreationInputTokens, 0);
    assert.equal(first.outputTokens, 20);
    assert.equal(first.reasoningOutputTokens, 5);
    assert.equal(first.totalTokens, 175);
    assert.equal(first.model, "deepseek-v4-flash");
    assert.equal(first.project, "~/project-a");
    assert.ok(isPrivateSessionId(first.sessionId));
    assert.equal(first.timestamp, new Date(TIME + 1000).toISOString());
    assert.equal(byInput.get(40)?.model, "deepseek-v4-pro");
    assert.equal(byInput.get(40)?.totalTokens, 43);

    // Incremental rescan reuses the cached parse.
    const second = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const secondSummary = second.sources.find((s) => s.source === "pi");
    assert.equal(secondSummary?.filesParsed, 0);
    assert.equal(secondSummary?.filesReused, 1);
    assert.equal(secondSummary?.events, 2);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("pi native usage reader accepts legacy v3 headers", async () => {
  const f = await fixture();
  const project = join(f.homeDirectory, "project-v3");
  try {
    await sessionFile(f.homeDirectory, "project-v3", v3Header(project), [
      assistantMessage("1", "claude-3-7-sonnet", { input: 7, output: 2 }),
    ]);
    const snapshot = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const events = snapshot.details.filter((e) => e.source === "pi");
    assert.equal(events.length, 1);
    assert.equal(events[0].inputTokens, 7);
    assert.equal(events[0].outputTokens, 2);
    assert.equal(events[0].model, "claude-3-7-sonnet");
    assert.equal(events[0].project, "~/project-v3");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("omp (oh-my-pi) uses the same usage envelope under ~/.omp", async () => {
  const f = await fixture();
  const project = join(f.homeDirectory, "project-omp");
  try {
    const dir = join(
      f.homeDirectory,
      ".omp",
      "agent",
      "sessions",
      `--project-omp--`,
    );
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(
        dir,
        `${new Date(TIME).toISOString().replace(/[:.]/g, "-")}_${encodeURIComponent(SESSION_ID)}.jsonl`,
      ),
      [
        v4Header(project),
        assistantMessage("1", "deepseek-v4-flash", {
          input: 100,
          output: 20,
          cacheRead: 50,
        }),
      ].join("\n"),
    );

    const snapshot = await scanLocalUsage({
      homeDirectory: f.homeDirectory,
      cacheDirectory: f.cacheDirectory,
      now: NOW,
    });
    const summary = snapshot.sources.find((s) => s.source === "omp");
    assert.ok(summary);
    assert.equal(summary.filesParsed, 1);
    assert.equal(summary.events, 1);
    const events = snapshot.details.filter((e) => e.source === "omp");
    assert.equal(events.length, 1);
    assert.equal(events[0].inputTokens, 100);
    assert.equal(events[0].outputTokens, 20);
    assert.equal(events[0].totalTokens, 170);
    assert.equal(events[0].project, "~/project-omp");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
