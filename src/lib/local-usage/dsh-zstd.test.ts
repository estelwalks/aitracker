import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { constants, zstdCompressSync } from "node:zlib";

import {
  decodeZstdSessionLog,
  parseDshLogFilename,
  readDshSessionLog,
  scanZstdFrames,
  selectDshSessionLogs,
} from "./dsh-zstd.ts";

function zstdFrame(text: string, checksum = true): Buffer {
  return zstdCompressSync(
    Buffer.from(text, "utf8"),
    checksum ? { params: { [constants.ZSTD_c_checksumFlag]: 1 } } : undefined,
  );
}

test("scanZstdFrames locates every frame in a concatenated container", () => {
  const header = zstdFrame('{"type":"session","id":"s1"}\n');
  const batch1 = zstdFrame(
    '{"type":"turn/start","seq":1}\n{"type":"assistant/message","seq":2}\n',
  );
  const batch2 = zstdFrame('{"type":"assistant/message","seq":3}\n');
  const log = Buffer.concat([header, batch1, batch2]);

  const { frames } = scanZstdFrames(log);
  assert.equal(frames.length, 3);
  assert.deepEqual(
    frames.map((f) => log.subarray(f.start, f.end).toString("hex")),
    [header.toString("hex"), batch1.toString("hex"), batch2.toString("hex")],
  );
});

test("decodeZstdSessionLog concatenates the plaintext of all frames", () => {
  const header = zstdFrame('{"type":"session","id":"s1"}\n');
  const batch = zstdFrame(
    '{"type":"turn/start","seq":1}\n{"type":"assistant/message","seq":2}\n',
  );
  const decoded = decodeZstdSessionLog(Buffer.concat([header, batch]));
  assert.equal(
    decoded,
    '{"type":"session","id":"s1"}\n{"type":"turn/start","seq":1}\n{"type":"assistant/message","seq":2}\n',
  );
});

test("decodeZstdSessionLog handles non-checksummed frames too", () => {
  const header = zstdFrame('{"type":"session","id":"s1"}\n', false);
  const batch = zstdFrame('{"type":"turn/start","seq":1}\n', false);
  assert.equal(
    decodeZstdSessionLog(Buffer.concat([header, batch])),
    '{"type":"session","id":"s1"}\n{"type":"turn/start","seq":1}\n',
  );
});

test("decodeZstdSessionLog tolerates a torn final frame (writer mid-append)", () => {
  const header = zstdFrame('{"type":"session","id":"s1"}\n');
  const batch = zstdFrame('{"type":"turn/start","seq":1}\n');
  const torn = zstdFrame('{"type":"assistant/message","seq":2}\n').subarray(
    0,
    12,
  );
  const decoded = decodeZstdSessionLog(Buffer.concat([header, batch, torn]));
  assert.equal(
    decoded,
    '{"type":"session","id":"s1"}\n{"type":"turn/start","seq":1}\n',
  );
});

test("decodeZstdSessionLog rejects corrupt magic mid-file", () => {
  const header = zstdFrame('{"type":"session","id":"s1"}\n');
  const garbage = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
  assert.throws(
    () => decodeZstdSessionLog(Buffer.concat([header, garbage])),
    /invalid frame magic/,
  );
});

test("decodeZstdSessionLog rejects empty or header-less input", () => {
  assert.throws(
    () => decodeZstdSessionLog(Buffer.alloc(0)),
    /empty or header-less/,
  );
  // A single 4-byte magic with nothing after it is a torn first frame.
  assert.throws(
    () => decodeZstdSessionLog(Buffer.from([0x28, 0xb5, 0x2f, 0xfd])),
    /empty or header-less/,
  );
});

test("readDshSessionLog decodes zstd files and passes plaintext through", async () => {
  const root = await mkdtemp(join(tmpdir(), "aitracker-dsh-zstd-"));
  try {
    const zstdPath = join(root, "session.jsonl.zstd");
    await writeFile(
      zstdPath,
      Buffer.concat([
        zstdFrame('{"type":"session","id":"s1"}\n'),
        zstdFrame('{"type":"turn/start","seq":1}\n'),
      ]),
    );
    assert.equal(
      await readDshSessionLog(zstdPath),
      '{"type":"session","id":"s1"}\n{"type":"turn/start","seq":1}\n',
    );

    const plainPath = join(root, "session.jsonl");
    await writeFile(plainPath, '{"type":"session","id":"s2"}\n');
    assert.equal(
      await readDshSessionLog(plainPath),
      '{"type":"session","id":"s2"}\n',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("parseDshLogFilename reads every canonical generation name", () => {
  assert.deepEqual(parseDshLogFilename("session.jsonl"), {
    generation: 0,
    compressed: false,
  });
  assert.deepEqual(parseDshLogFilename("session.jsonl.zstd"), {
    generation: 0,
    compressed: true,
  });
  assert.deepEqual(parseDshLogFilename("session.v3.jsonl.zstd"), {
    generation: 3,
    compressed: true,
  });
  assert.deepEqual(parseDshLogFilename("session.v12.jsonl"), {
    generation: 12,
    compressed: false,
  });
});

test("parseDshLogFilename rejects names the harness does not canonically address", () => {
  for (const name of [
    // Writer temps: a migration keeps its half-written file under `.tmp`.
    "session.migration.a1b2c3.jsonl.zstd.tmp",
    "session.v3.jsonl.zstd.9f8e7d.tmp",
    // Neighbours in a session directory that are not session logs.
    "session.lock",
    "session.backup.jsonl.zstd",
    "session.v3.jsonl.zstd.bak",
    // Non-canonical generation spellings (mirrors CANONICAL_LOG_FILENAME).
    "session.v0.jsonl",
    "session.v03.jsonl.zstd",
    "session.V3.jsonl.zstd",
  ]) {
    assert.equal(parseDshLogFilename(name), undefined, name);
  }
});

test("selectDshSessionLogs keeps the highest generation of each session directory", () => {
  // The shape a real migration leaves behind: a 324-byte generation-0 stub
  // beside the generation-3 log holding the actual conversation.
  const files = [
    { path: "/home/.dsh/sessions/proj/sess-a/session.jsonl.zstd" },
    { path: "/home/.dsh/sessions/proj/sess-a/session.v3.jsonl.zstd" },
    { path: "/home/.dsh/sessions/proj/sess-b/session.v3.jsonl.zstd" },
    { path: "/home/.dsh/sessions/proj/sess-c/session.jsonl" },
  ];
  assert.deepEqual(selectDshSessionLogs(files), [
    { path: "/home/.dsh/sessions/proj/sess-a/session.v3.jsonl.zstd" },
    { path: "/home/.dsh/sessions/proj/sess-b/session.v3.jsonl.zstd" },
    { path: "/home/.dsh/sessions/proj/sess-c/session.jsonl" },
  ]);
});

test("selectDshSessionLogs prefers the newest generation regardless of order", () => {
  // Directory walk order is not guaranteed: the older file may be seen last.
  const files = [
    { path: "/root/w/s/session.v3.jsonl.zstd" },
    { path: "/root/w/s/session.jsonl.zstd" },
  ];
  assert.deepEqual(selectDshSessionLogs(files), [
    { path: "/root/w/s/session.v3.jsonl.zstd" },
  ]);
});

test("selectDshSessionLogs prefers zstd within one generation", () => {
  const files = [
    { path: "/root/w/s/session.jsonl" },
    { path: "/root/w/s/session.jsonl.zstd" },
  ];
  assert.deepEqual(selectDshSessionLogs(files), [
    { path: "/root/w/s/session.jsonl.zstd" },
  ]);
});

test("selectDshSessionLogs drops non-canonical names and preserves input order", () => {
  const files = [
    { path: "/root/w/s/session.lock" },
    { path: "/root/w/s/session.v3.jsonl.zstd.a1.tmp" },
    { path: "/root/w/t/session.v2.jsonl.zstd" },
    { path: "/root/w/u/session.v3.jsonl.zstd" },
  ];
  assert.deepEqual(selectDshSessionLogs(files), [
    { path: "/root/w/t/session.v2.jsonl.zstd" },
    { path: "/root/w/u/session.v3.jsonl.zstd" },
  ]);
  assert.deepEqual(selectDshSessionLogs([]), []);
});
