import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createFileSecretCodec } from "./file-secret-codec.server.ts";

const ERROR_CODE = "errors.modelProfile.safeStorageUnavailable";

function fixture(t: { after(fn: () => void): void }): string {
  const directory = mkdtempSync(join(tmpdir(), "tt-secret-codec-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test("encrypt/decrypt roundtrips an API key", async (t) => {
  const dataRoot = fixture(t);
  const codec = createFileSecretCodec({ dataRoot });
  const secret = await codec.encrypt("sk-ant-test-0123456789");
  assert.equal(secret.encryptionKind, "keychain");
  assert.ok(secret.ciphertext.byteLength > 16);
  assert.notEqual(
    Buffer.from(secret.ciphertext).toString("utf8"),
    "sk-ant-test-0123456789",
    "plaintext must never be stored as-is",
  );
  assert.equal(await codec.decrypt(secret), "sk-ant-test-0123456789");
});

test("key file is created under <dataRoot>/secure with 0600 mode", async (t) => {
  const dataRoot = fixture(t);
  const codec = createFileSecretCodec({ dataRoot });
  await codec.encrypt("sk-test-abcdefgh");
  const keyPath = join(dataRoot, "secure", "secrets.key");
  const { statSync } = await import("node:fs");
  const info = statSync(keyPath);
  assert.ok(info.isFile());
  assert.equal(info.size, 32);
  // 0o600 regardless of umask.
  assert.equal(info.mode & 0o777, 0o600);
});

test("secrets survive across codec instances sharing the same data root", async (t) => {
  const dataRoot = fixture(t);
  const first = createFileSecretCodec({ dataRoot });
  const secret = await first.encrypt("sk-persist-0123456789");

  const second = createFileSecretCodec({ dataRoot });
  assert.equal(await second.decrypt(secret), "sk-persist-0123456789");
  assert.equal(
    await second.encrypt("sk-another").then((s) => second.decrypt(s)),
    "sk-another",
  );
});

test("tampered ciphertext fails with the mapped error code", async (t) => {
  const dataRoot = fixture(t);
  const codec = createFileSecretCodec({ dataRoot });
  const secret = await codec.encrypt("sk-tamper-0123456789");

  const blob = Buffer.from(secret.ciphertext);
  blob[blob.length - 1] ^= 0xff;
  const tampered = { ...secret, ciphertext: new Uint8Array(blob) };

  await assert.rejects(
    codec.decrypt(tampered),
    (error: unknown) =>
      error instanceof Error &&
      (error as { code?: string }).code === ERROR_CODE,
  );
});

test("a second instance cannot decrypt with a different data root", async (t) => {
  const dataRootA = fixture(t);
  const dataRootB = fixture(t);
  const a = createFileSecretCodec({ dataRoot: dataRootA });
  const b = createFileSecretCodec({ dataRoot: dataRootB });
  const secret = await a.encrypt("sk-cross-root-0123456789");
  await assert.rejects(b.decrypt(secret));
});
