import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DatabaseError } from "../../../platform/database/contracts.ts";
import { DatabaseHost } from "../../../platform/database/database-host.server.ts";
import { runMigrations } from "../../../platform/database/migration-runner.server.ts";
import {
  createSqliteModelProfileRepository,
  createSqliteModelSecretRepository,
  type ModelSecretCodec,
} from "./sqlite-model-profile-repository.server.ts";

function fixture(t: { after(fn: () => void): void }): DatabaseHost {
  const directory = mkdtempSync(join(tmpdir(), "tt-model-repo-"));
  const host = DatabaseHost.open({
    path: join(directory, "platform.db"),
    versionsProvider: {
      getVersions: () => ({ nodeVersion: "24.19.0", sqliteVersion: "99.0.0" }),
    },
  });
  runMigrations({ database: host, appVersion: "test" });
  t.after(() => host.close());
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return host;
}

const codec: ModelSecretCodec = {
  async encrypt(plaintext) {
    const payload = new TextEncoder().encode(plaintext);
    const ciphertext = new Uint8Array(Math.max(16, payload.length));
    ciphertext.fill(0xa5);
    for (let index = 0; index < payload.length; index += 1) {
      ciphertext[index] = payload[index]! ^ 0xa5;
    }
    return { ciphertext, encryptionKind: "safe-storage" };
  },
  async decrypt(secret) {
    const bytes = new Uint8Array(secret.ciphertext.length);
    for (let index = 0; index < secret.ciphertext.length; index += 1) {
      bytes[index] = secret.ciphertext[index]! ^ 0xa5;
    }
    return new TextDecoder().decode(bytes).replace(/\0+$/u, "");
  },
};

test("model profile persists only encrypted BLOB and exposes a masked view", async (t) => {
  const host = fixture(t);
  const repository = createSqliteModelProfileRepository({
    database: host,
    secretCodec: codec,
    now: () => 100,
  });
  const view = await repository.upsert({
    name: "Local model",
    mode: "custom",
    protocol: "openai",
    endpoint: "https://example.invalid/v1",
    model: "test-model",
    apiKey: "secret-key-value",
  });
  assert.equal(view.apiKeyMasked, true);
  assert.equal("apiKey" in view, false);
  const row = host
    .prepare(
      `SELECT typeof(ciphertext) AS storage_type,
    instr(CAST(ciphertext AS TEXT), ?) AS plaintext_position FROM secure_secrets`,
    )
    .get("secret-key-value");
  assert.equal(row?.storage_type, "blob");
  assert.equal(row?.plaintext_position, 0n);
  assert.equal(
    (await repository.getProfileForExecution(view.id))?.apiKey,
    "secret-key-value",
  );
});

test("secret repository rejects non-encrypted/short payloads", (t) => {
  const secrets = createSqliteModelSecretRepository(fixture(t));
  assert.throws(
    () =>
      secrets.putEncrypted({
        id: "s",
        ciphertext: new Uint8Array([1, 2]),
        encryptionKind: "safe-storage",
        createdAtMs: 0,
        updatedAtMs: 0,
      }),
    (error: unknown) =>
      error instanceof DatabaseError && error.code === "invalid-argument",
  );
});

test("safeStorage failure never falls back to plaintext persistence", async (t) => {
  const host = fixture(t);
  const repository = createSqliteModelProfileRepository({
    database: host,
    secretCodec: {
      encrypt: async () => {
        throw new Error("safeStorage unavailable");
      },
      decrypt: codec.decrypt,
    },
  });
  await assert.rejects(() =>
    repository.upsert({
      name: "No encryption",
      mode: "custom",
      protocol: "openai",
      model: "test-model",
      apiKey: "must-not-persist",
    }),
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM model_profiles").get()?.n,
    0n,
  );
  assert.equal(
    host.prepare("SELECT COUNT(*) AS n FROM secure_secrets").get()?.n,
    0n,
  );
});
