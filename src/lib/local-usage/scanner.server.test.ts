import assert from "node:assert/strict";
import {
  appendFile,
  mkdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { scanLocalUsage } from "./scanner.server.ts";
import type { LocalUsageEvent } from "./types.ts";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function sourceSummary(
  snapshot: Awaited<ReturnType<typeof scanLocalUsage>>,
  source: "claude-code" | "codex",
) {
  const summary = snapshot.sources.find(
    (candidate) => candidate.source === source,
  );
  assert.ok(summary);
  return summary;
}

test("persistent cache reuses, reparses, prunes, and rebuilds files safely", async () => {
  const root = join(tmpdir(), `tt-scanner-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const cacheDirectory = join(root, "cache");
  const claudeFile = join(
    homeDirectory,
    ".claude",
    "projects",
    "demo",
    "session.jsonl",
  );
  const codexFile = join(
    homeDirectory,
    ".codex",
    "sessions",
    "rollout-demo.jsonl",
  );
  const cacheFile = join(cacheDirectory, "local-usage-index-v10.json");
  const legacyCacheFile = join(cacheDirectory, "local-usage-index-v2.json");

  await mkdir(join(homeDirectory, ".claude", "projects", "demo"), {
    recursive: true,
  });
  await mkdir(join(homeDirectory, ".codex", "sessions"), { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(
    legacyCacheFile,
    JSON.stringify({
      version: 2,
      files: [
        {
          source: "codex",
          path: codexFile,
          mtimeMs: 0,
          size: 0,
          malformedLines: 0,
          events: [],
        },
      ],
    }),
  );
  await writeFile(
    claudeFile,
    `${JSON.stringify({
      timestamp: "2026-07-27T10:00:00.000Z",
      cwd: "/demo/claude",
      sessionId: "claude-session-private-source",
      content: "DO_NOT_CACHE_CLAUDE_CONTENT",
      message: {
        id: "claude-message-1",
        model: "claude-test",
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    })}\n`,
  );
  await writeFile(
    codexFile,
    [
      JSON.stringify({
        timestamp: "2026-07-27T09:59:00.000Z",
        type: "session_meta",
        payload: { type: "session_meta", id: "codex-session-private-source" },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:00.000Z",
        type: "turn_context",
        payload: {
          type: "turn_context",
          model: "codex-test",
          cwd: "/demo/codex",
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:01:00.000Z",
        prompt: "DO_NOT_CACHE_CODEX_PROMPT",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 20,
              cached_input_tokens: 5,
              output_tokens: 8,
              reasoning_output_tokens: 3,
            },
          },
        },
      }),
    ].join("\n") + "\n",
  );

  try {
    const cold = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(cold, "claude-code").filesParsed, 1);
    assert.equal(sourceSummary(cold, "codex").filesParsed, 1);
    assert.equal(
      cold.details.find((event) => event.source === "claude-code")?.sessionId
        ?.length,
      28,
    );
    assert.equal(
      cold.details.find((event) => event.source === "codex")?.sessionId?.length,
      28,
    );
    assert.ok(cold.details.every((event) => event.project !== "/demo/claude"));
    assert.ok(cold.details.every((event) => event.project !== "/demo/codex"));

    const cachePayload = await readFile(cacheFile, "utf8");
    assert.doesNotMatch(
      cachePayload,
      /DO_NOT_CACHE|content|prompt|raw|claude-session-private-source|codex-session-private-source/i,
    );
    await assert.rejects(readFile(legacyCacheFile, "utf8"));

    const warm = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(warm, "claude-code").filesReused, 1);
    assert.equal(sourceSummary(warm, "codex").filesReused, 1);
    assert.deepEqual(warm.totals, cold.totals);

    await appendFile(
      codexFile,
      `${JSON.stringify({
        timestamp: "2026-07-27T10:02:00.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 12,
              cached_input_tokens: 2,
              output_tokens: 4,
              reasoning_output_tokens: 1,
            },
          },
        },
      })}\n`,
    );
    const changed = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(changed, "claude-code").filesReused, 1);
    assert.equal(sourceSummary(changed, "codex").filesParsed, 1);
    assert.equal(changed.events, cold.events + 1);

    await unlink(claudeFile);
    await scanLocalUsage({ homeDirectory, cacheDirectory, now: NOW });
    const prunedIndex = JSON.parse(await readFile(cacheFile, "utf8")) as {
      files: unknown[];
    };
    assert.equal(prunedIndex.files.length, 1);

    await writeFile(cacheFile, "{not-json");
    const rebuilt = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(rebuilt, "codex").filesParsed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cache embeds registryFingerprint and invalidates on mismatch", async () => {
  const root = join(tmpdir(), `tt-fp-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const cacheDirectory = join(root, "cache");
  const cacheFile = join(cacheDirectory, "local-usage-index-v10.json");
  const sessionDir = join(homeDirectory, ".codex", "sessions");
  await mkdir(sessionDir, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  await writeFile(
    join(sessionDir, "rollout-fp.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-07-27T10:00:00.000Z",
        type: "session_meta",
        payload: { type: "session_meta", id: "fp-session" },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:01.000Z",
        type: "turn_context",
        payload: { type: "turn_context", model: "gpt-5-codex", cwd: "/demo" },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:02.000Z",
        type: "token_count",
        payload: {
          type: "token_count",
          timestamp: "2026-07-27T10:00:02.000Z",
          info: {
            total_token_usage: {
              input_tokens: 100,
              output_tokens: 50,
              cached_input_tokens: 0,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 150,
            },
            last_token_usage: {
              input_tokens: 100,
              output_tokens: 50,
              cached_input_tokens: 0,
              cache_creation_input_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 150,
            },
          },
        },
      }),
    ].join("\n") + "\n",
  );

  try {
    const first = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(first, "codex").filesParsed, 1);

    const index = JSON.parse(await readFile(cacheFile, "utf8")) as {
      version: number;
      registryFingerprint: string;
      files: unknown[];
    };
    assert.equal(index.version, 12);
    assert.ok(
      typeof index.registryFingerprint === "string" &&
        index.registryFingerprint.length > 0,
    );

    // Re-scan: cache hits (file reused, not reparsed).
    const second = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(second, "codex").filesReused, 1);

    // Corrupt the fingerprint -> cache must be invalidated and rebuilt.
    await writeFile(
      cacheFile,
      JSON.stringify({ ...index, registryFingerprint: "stale-fingerprint" }),
    );
    const third = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(third, "codex").filesParsed, 1);
    assert.equal(sourceSummary(third, "codex").filesReused, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WorkBuddy reads historical rawUsage with correct cache and reasoning token math", async () => {
  const root = join(tmpdir(), `tt-workbuddy-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const sessionDirectory = join(
    homeDirectory,
    ".workbuddy",
    "projects",
    "demo",
  );
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    join(sessionDirectory, "session.jsonl"),
    [
      JSON.stringify({
        id: "workbuddy-response-1",
        timestamp: new Date("2026-05-01T10:00:00.000Z").getTime(),
        type: "function_call",
        sessionId: "private-workbuddy-session",
        cwd: join(homeDirectory, "private-project"),
        providerData: {
          requestModelName: "Auto",
          rawUsage: {
            prompt_tokens: 1_000,
            completion_tokens: 200,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 100,
            completion_tokens_details: { reasoning_tokens: 50 },
          },
        },
      }),
      JSON.stringify({
        id: "workbuddy-response-1",
        timestamp: new Date("2026-05-01T10:00:00.000Z").getTime(),
        providerData: {
          rawUsage: { prompt_tokens: 1_000, completion_tokens: 200 },
        },
      }),
    ].join("\n") + "\n",
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      cacheDirectory: join(root, "cache"),
      now: NOW,
    });
    const events = snapshot.details.filter(
      (event) => event.source === "workbuddy",
    );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.inputTokens, 600);
    assert.equal(events[0]?.cachedInputTokens, 300);
    assert.equal(events[0]?.cacheCreationInputTokens, 100);
    assert.equal(events[0]?.outputTokens, 150);
    assert.equal(events[0]?.reasoningOutputTokens, 50);
    assert.equal(events[0]?.totalTokens, 1_200);
    assert.equal(events[0]?.project, "~/private-project");
    assert.notEqual(events[0]?.sessionId, "private-workbuddy-session");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers Codex sessions from an explicitly configured home", async () => {
  const root = join(tmpdir(), `tt-codex-home-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const codexHomeDirectory = join(root, "custom-codex-home");
  const sessionDirectory = join(
    codexHomeDirectory,
    "sessions",
    "2026",
    "07",
    "28",
  );
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    join(sessionDirectory, "rollout-windows.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-07-28T10:00:00.000Z",
        type: "turn_context",
        payload: {
          type: "turn_context",
          model: "windows-codex",
          cwd: homeDirectory,
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-28T10:00:01.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 30,
              cached_input_tokens: 10,
              output_tokens: 5,
            },
          },
        },
      }),
    ].join("\n") + "\n",
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      codexHomeDirectory,
      cacheDirectory: join(root, "cache"),
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    const summary = snapshot.sources.find(
      (source) => source.source === "codex",
    );
    const event = snapshot.details.find(
      (candidate) => candidate.source === "codex",
    );
    assert.equal(summary?.available, true);
    assert.ok(summary?.paths?.includes(join(codexHomeDirectory, "sessions")));
    assert.equal(event?.model, "windows-codex");
    assert.equal(event?.totalTokens, 35);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("discovers Windows-style alternate homes and nested cumulative Codex events", async () => {
  const root = join(
    tmpdir(),
    `tt-codex-alternate-${process.pid}-${Date.now()}`,
  );
  const homeDirectory = join(root, "electron-home");
  const windowsUserHome = join(root, "windows-user");
  const sessionDirectory = join(
    windowsUserHome,
    ".codex",
    "sessions",
    "2026",
    "07",
    "28",
  );
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    join(sessionDirectory, "session.jsonl"),
    [
      JSON.stringify({
        timestamp: "2026-07-28T10:00:00.000Z",
        type: "turn_context",
        payload: {
          type: "turn_context",
          model: "windows-new-codex",
          cwd: windowsUserHome,
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-28T10:00:01.000Z",
        type: "event_msg",
        payload: {
          msg: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 40,
                output_tokens: 10,
              },
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-28T10:00:02.000Z",
        type: "event_msg",
        payload: {
          msg: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 130,
                cached_input_tokens: 50,
                output_tokens: 15,
              },
            },
          },
        },
      }),
    ].join("\n") + "\n",
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      additionalHomeDirectories: [windowsUserHome],
      cacheDirectory: join(root, "cache"),
      now: new Date("2026-07-28T12:00:00.000Z"),
    });
    const event = snapshot.details.find(
      (candidate) => candidate.source === "codex",
    );
    assert.equal(event?.model, "windows-new-codex");
    assert.equal(event?.inputTokens, 20);
    assert.equal(event?.cachedInputTokens, 10);
    assert.equal(event?.outputTokens, 5);
    assert.equal(event?.totalTokens, 35);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("generic adapters prefer structured sessions and distinguish file fallbacks", async () => {
  const root = join(
    tmpdir(),
    `tt-generic-session-${process.pid}-${Date.now()}`,
  );
  const homeDirectory = join(root, "home");
  const sessionDirectory = join(homeDirectory, ".kimi", "sessions");
  const structuredSecret = "structured-session-must-not-leak";
  const bodySecret = "PROMPT_BODY_MUST_NOT_LEAK";
  await mkdir(sessionDirectory, { recursive: true });

  const usageRecord = (sessionId?: string) => ({
    timestamp: "2026-07-27T10:00:00.000Z",
    session_id: sessionId,
    prompt: bodySecret,
    model: "kimi-test",
    usage: { input_tokens: 5, output_tokens: 2 },
  });

  await writeFile(
    join(sessionDirectory, "same-a.jsonl"),
    `${JSON.stringify(usageRecord(structuredSecret))}\n`,
  );
  await writeFile(
    join(sessionDirectory, "same-b.jsonl"),
    `${JSON.stringify(usageRecord(structuredSecret))}\n`,
  );
  await writeFile(
    join(sessionDirectory, "fallback-a.jsonl"),
    `${JSON.stringify(usageRecord())}\n`,
  );
  await writeFile(
    join(sessionDirectory, "fallback-b.jsonl"),
    `${JSON.stringify(usageRecord())}\n`,
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      now: NOW,
      disablePersistentCache: true,
    });
    const events = snapshot.details.filter(
      (event) => event.source === "kimi-code",
    );
    assert.equal(events.length, 4);
    assert.ok(
      events.every((event) =>
        /^session_[a-f0-9]{20}$/.test(event.sessionId ?? ""),
      ),
    );

    const counts = new Map<string, number>();
    for (const event of events) {
      counts.set(
        event.sessionId ?? "",
        (counts.get(event.sessionId ?? "") ?? 0) + 1,
      );
    }
    assert.deepEqual(
      [...counts.values()].sort((left, right) => right - left),
      [2, 1, 1],
    );
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /structured-session-must-not-leak|PROMPT_BODY/,
    );
    assert.doesNotMatch(
      JSON.stringify(snapshot),
      /same-a\.jsonl|fallback-a\.jsonl/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex rollout context is attributed, bucketed, and never caches raw commands or outputs", async () => {
  const root = join(tmpdir(), `tt-codex-context-${process.pid}-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const cacheDirectory = join(root, "cache");
  const sessionDirectory = join(homeDirectory, ".codex", "sessions");
  const rolloutFile = join(sessionDirectory, "rollout-context.jsonl");
  const cacheFile = join(cacheDirectory, "local-usage-index-v10.json");
  const commandSecret = "DO_NOT_CACHE_COMMAND_SECRET";
  const outputSecret = "DO_NOT_CACHE_OUTPUT_SECRET";
  await mkdir(sessionDirectory, { recursive: true });
  await writeFile(
    rolloutFile,
    [
      JSON.stringify({
        timestamp: "2026-07-27T10:00:00.000Z",
        type: "session_meta",
        payload: { type: "session_meta", id: "private-context-session" },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:01.000Z",
        type: "turn_context",
        payload: {
          type: "turn_context",
          model: "codex-test",
          cwd: "/demo/context",
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:02.000Z",
        type: "response_item",
        payload: {
          type: "response_item",
          item: {
            type: "function_call",
            name: "functions.exec_command",
            arguments: JSON.stringify({
              cmd: `npm run /private/skills/release-check/SKILL.md --token=${commandSecret}`,
            }),
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:03.000Z",
        type: "function_call_output",
        payload: {
          type: "function_call_output",
          output: `${outputSecret}\nsecond line`,
          status: "completed",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:03.500Z",
        type: "response_item",
        payload: {
          type: "response_item",
          item: {
            type: "function_call",
            name: "functions.exec_command",
            arguments: JSON.stringify({
              cmd: "python /private/skills/release-check/scripts/validate.py artifact",
            }),
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:04.000Z",
        type: "tool_search_call",
        payload: { type: "tool_search_call", skill_name: "release-check" },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:05.000Z",
        type: "event_msg",
        payload: {
          type: "mcp_tool_call_end",
          invocation: {
            server: "github",
            tool: "get_issue",
            arguments: { issue: "must-not-be-cached" },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:06.000Z",
        payload: { type: "patch_apply_end" },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:07.000Z",
        payload: { type: "web_search_end" },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:08.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 20,
              output_tokens: 10,
              reasoning_output_tokens: 3,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-27T10:00:09.000Z",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 5,
              output_tokens: 2,
              reasoning_output_tokens: 1,
            },
          },
        },
      }),
    ].join("\n") + "\n",
  );

  try {
    const snapshot = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    const [attributed, textResponse] = snapshot.details
      .filter((candidate) => candidate.source === "codex")
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
    assert.deepEqual(
      attributed?.context?.tools?.map((tool) => tool.name).sort(),
      [
        "apply_patch",
        "exec_command",
        "mcp_github_get_issue",
        "tool_search",
        "web_search",
      ],
    );
    assert.deepEqual(attributed?.context?.skills, [
      { name: "release-check", calls: 3 },
    ]);
    assert.deepEqual(attributed?.context?.commands, [
      {
        kind: "exec_command",
        executable: "npm",
        safeSignature: "npm run",
        duration: "unknown",
        outputSize: "under-1k",
        exitStatus: "success",
        calls: 1,
      },
      {
        kind: "exec_command",
        executable: "python",
        safeSignature: "python artifact",
        duration: "unknown",
        outputSize: "unknown",
        exitStatus: "unknown",
        calls: 1,
      },
    ]);
    assert.equal(attributed?.context?.toolOutputs?.lines, 2);
    assert.equal(textResponse?.context?.textResponse, true);
    const cached = await readFile(cacheFile, "utf8");
    assert.doesNotMatch(cached, /DO_NOT_CACHE|private\/skills|token=/i);

    const invalidCache = JSON.parse(cached) as {
      files: Array<{ events: LocalUsageEvent[] }>;
    };
    invalidCache.files[0]!.events[0]!.context = {
      commands: [
        {
          kind: "exec_command",
          executable: "npm",
          safeSignature: "npm run",
          duration: "not-a-bucket" as never,
          outputSize: "unknown",
          exitStatus: "unknown",
          calls: 1,
        },
      ],
    };
    await writeFile(cacheFile, JSON.stringify(invalidCache));
    const rebuilt = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: NOW,
    });
    assert.equal(sourceSummary(rebuilt, "codex").filesParsed, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("TC-REG-005: external adapter/override files are never read", async () => {
  const root = join(tmpdir(), `tt-reg005-${Date.now()}`);
  const homeDirectory = join(root, "home");
  const cacheDirectory = join(root, "cache");
  await mkdir(homeDirectory, { recursive: true });
  await mkdir(cacheDirectory, { recursive: true });
  try {
    // Plant the deleted runtime extension files in the user home; a scanner
    // that still reads them would fabricate a `custom:` source.
    const ttDir = join(homeDirectory, ".trusttools");
    await mkdir(ttDir, { recursive: true });
    await writeFile(
      join(ttDir, "usage-adapters.json"),
      JSON.stringify({
        adapters: [
          {
            id: "custom:evil",
            paths: [{ root: ".evil", glob: "**/*.jsonl", format: "jsonl" }],
          },
        ],
      }),
    );
    await writeFile(
      join(ttDir, "tool-overrides.json"),
      JSON.stringify({ "claude-code": { paths: [".evil"] } }),
    );

    const snapshot = await scanLocalUsage({
      homeDirectory,
      cacheDirectory,
      now: new Date(2026, 6, 30, 12, 0, 0),
    });
    const sources = snapshot.sources ?? snapshot.bySource ?? {};
    const sourceIds = Object.keys(sources);
    assert.ok(
      !sourceIds.some((id) => id.startsWith("custom:")),
      `custom: sources must not appear, got: ${sourceIds.join(", ")}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
