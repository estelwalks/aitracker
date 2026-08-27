import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { constants, zstdCompressSync } from "node:zlib";

import {
  decodeZstdSessionLog,
  readDshSessionLog,
  scanZstdFrames,
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
