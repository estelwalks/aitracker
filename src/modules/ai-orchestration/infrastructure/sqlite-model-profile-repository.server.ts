/** SQLite model-profile adapter. Secret BLOBs are encrypted by an Electron
 * safeStorage-backed codec before this module writes them; plaintext is never
 * stored in SQLite or exposed by renderer-safe projections. */
import { randomUUID } from "node:crypto";

import {
  DatabaseError,
  type SqliteDatabasePort,
} from "../../../platform/database/contracts.ts";
import { bigintToSafeNumber } from "../../../platform/database/infrastructure/node-sqlite-database.server.ts";
import {
  effectiveProtocol,
  OFFICIAL_ENDPOINT,
  OFFICIAL_MODEL,
  toModelProfileView,
  validateModelProfileInput,
  type ModelProfile,
  type ModelProfileInput,
  type ModelProfileView,
  type ProfileProtocol,
} from "../model-profile.ts";
import {
  ModelProfileError,
  type ModelProfileRepository,
} from "../model-profile.server.ts";

export type SecretEncryptionKind = "dpapi" | "keychain" | "safe-storage";

export interface EncryptedModelSecret {
  readonly ciphertext: Uint8Array;
  readonly encryptionKind: SecretEncryptionKind;
}

/** Must be implemented at the Electron main-process safeStorage boundary. */
export interface ModelSecretCodec {
  readonly encrypt: (plaintext: string) => Promise<EncryptedModelSecret>;
  readonly decrypt: (secret: EncryptedModelSecret) => Promise<string>;
}

export interface StoredEncryptedModelSecret extends EncryptedModelSecret {
  readonly id: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface SqliteModelSecretRepository {
  getEncrypted(id: string): StoredEncryptedModelSecret | undefined;
  /** Only an already-encrypted BLOB is accepted by the persistence boundary. */
  putEncrypted(secret: StoredEncryptedModelSecret): void;
  removeIfUnreferenced(id: string): void;
}

function safeNumber(value: unknown): number {
  if (typeof value === "bigint") return bigintToSafeNumber(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  throw new DatabaseError("integer-overflow", "read", { retryable: false });
}

function assertEpoch(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
}

function withTransaction<T>(database: SqliteDatabasePort, work: () => T): T {
  const transaction = database.transaction();
  transaction.begin();
  try {
    const value = work();
    transaction.commit();
    return value;
  } catch (error) {
    try {
      transaction.rollback();
    } catch {
      /* keep original failure */
    }
    throw error;
  }
}

export function createSqliteModelSecretRepository(
  database: SqliteDatabasePort,
): SqliteModelSecretRepository {
  return {
    getEncrypted(id) {
      const row = database
        .prepare(
          `SELECT secret_id, ciphertext, encryption_kind, created_at_ms, updated_at_ms
        FROM secure_secrets WHERE secret_id = ?`,
        )
        .get(id);
      if (!row) return undefined;
      if (
        typeof row.secret_id !== "string" ||
        !(row.ciphertext instanceof Uint8Array) ||
        (row.encryption_kind !== "dpapi" &&
          row.encryption_kind !== "keychain" &&
          row.encryption_kind !== "safe-storage")
      ) {
        throw new DatabaseError("corrupt", "read", { retryable: false });
      }
      return {
        id: row.secret_id,
        ciphertext: new Uint8Array(row.ciphertext),
        encryptionKind: row.encryption_kind,
        createdAtMs: safeNumber(row.created_at_ms),
        updatedAtMs: safeNumber(row.updated_at_ms),
      };
    },
    putEncrypted(secret) {
      assertEpoch(secret.createdAtMs);
      assertEpoch(secret.updatedAtMs);
      if (
        !(secret.ciphertext instanceof Uint8Array) ||
        secret.ciphertext.byteLength < 16
      ) {
        throw new DatabaseError("invalid-argument", "write", {
          retryable: false,
        });
      }
      database
        .prepare(
          `INSERT INTO secure_secrets
        (secret_id, purpose, ciphertext, encryption_kind, created_at_ms, updated_at_ms)
        VALUES (?, 'model-api-key', ?, ?, ?, ?)
        ON CONFLICT (secret_id) DO UPDATE SET
          ciphertext = excluded.ciphertext,
          encryption_kind = excluded.encryption_kind,
          updated_at_ms = excluded.updated_at_ms`,
        )
        .run(
          secret.id,
          secret.ciphertext,
          secret.encryptionKind,
          BigInt(secret.createdAtMs),
          BigInt(secret.updatedAtMs),
        );
    },
    removeIfUnreferenced(id) {
      database
        .prepare(
          `DELETE FROM secure_secrets WHERE secret_id = ?
        AND NOT EXISTS (SELECT 1 FROM model_profiles WHERE secret_id = ?)`,
        )
        .run(id, id);
    },
  };
}

interface ProfileRow {
  readonly profile_id: string;
  readonly name: string;
  readonly mode: "official" | "custom";
  readonly protocol: ProfileProtocol;
  readonly endpoint: string | null;
  readonly model: string | null;
  readonly secret_id: string | null;
  readonly is_active: number | bigint;
  readonly created_at_ms: number | bigint;
  readonly updated_at_ms: number | bigint;
}

function readProfileRow(row: Readonly<Record<string, unknown>>): ProfileRow {
  if (
    typeof row.profile_id !== "string" ||
    typeof row.name !== "string" ||
    (row.mode !== "official" && row.mode !== "custom") ||
    (row.protocol !== "openai" && row.protocol !== "anthropic") ||
    (row.endpoint !== null && typeof row.endpoint !== "string") ||
    (row.model !== null && typeof row.model !== "string") ||
    (row.secret_id !== null && typeof row.secret_id !== "string")
  )
    throw new DatabaseError("corrupt", "read", { retryable: false });
  return row as unknown as ProfileRow;
}

function profileWithoutSecret(row: ProfileRow): ModelProfile {
  return {
    id: row.profile_id,
    name: row.name,
    mode: row.mode,
    protocol: row.protocol,
    ...(row.endpoint ? { endpoint: row.endpoint } : {}),
    ...(row.model ? { model: row.model } : {}),
    createdAt: new Date(safeNumber(row.created_at_ms)).toISOString(),
    updatedAt: new Date(safeNumber(row.updated_at_ms)).toISOString(),
  };
}

function toSafeView(row: ProfileRow): ModelProfileView {
  const profile = profileWithoutSecret(row);
  return {
    ...toModelProfileView(profile),
    apiKeyMasked: row.secret_id !== null,
  };
}

const PROFILE_COLUMNS = `profile_id, name, mode, protocol, endpoint, model, secret_id,
  is_active, created_at_ms, updated_at_ms`;

export interface LegacyModelProfiles {
  readonly profiles: readonly ModelProfile[];
  readonly activeProfileId: string | null;
}

export interface SqliteModelProfileRepository extends ModelProfileRepository {
  /** Import is idempotent. Existing encrypted secrets are never overwritten by legacy plaintext. */
  importLegacy(
    source: LegacyModelProfiles,
  ): Promise<{ profilesImported: number; secretsSkipped: number }>;
}

export interface SqliteModelProfileRepositoryOptions {
  readonly database: SqliteDatabasePort;
  readonly secretCodec: ModelSecretCodec;
  readonly now?: () => number;
  readonly testProfile?: ModelProfileRepository["test"];
  readonly listModels?: ModelProfileRepository["listModels"];
}

export function createSqliteModelProfileRepository(
  options: SqliteModelProfileRepositoryOptions,
): SqliteModelProfileRepository {
  const database = options.database;
  const secrets = createSqliteModelSecretRepository(database);
  const now = options.now ?? Date.now;

  function listRows(): ProfileRow[] {
    return database
      .prepare(
        `SELECT ${PROFILE_COLUMNS} FROM model_profiles ORDER BY created_at_ms, profile_id`,
      )
      .all()
      .map(readProfileRow);
  }

  function getRow(id: string): ProfileRow | undefined {
    const row = database
      .prepare(
        `SELECT ${PROFILE_COLUMNS} FROM model_profiles WHERE profile_id = ?`,
      )
      .get(id);
    return row ? readProfileRow(row) : undefined;
  }

  return {
    async listViews() {
      return listRows().map(toSafeView);
    },
    async getActiveView() {
      const rows = listRows();
      const row =
        rows.find((candidate) => safeNumber(candidate.is_active) === 1) ??
        rows[0];
      return row ? toSafeView(row) : null;
    },
    async getProfileForExecution(id) {
      const row = getRow(id);
      if (!row) return undefined;
      const profile = profileWithoutSecret(row);
      if (!row.secret_id) return profile;
      const encrypted = secrets.getEncrypted(row.secret_id);
      if (!encrypted) return profile;
      const apiKey = await options.secretCodec.decrypt(encrypted);
      return { ...profile, ...(apiKey ? { apiKey } : {}) };
    },
    async upsert(input) {
      const isUpdate = input.id !== undefined;
      const validation = validateModelProfileInput(input, isUpdate);
      if (!validation.ok) throw new ModelProfileError(validation.errorCode);
      const existing = input.id ? getRow(input.id) : undefined;
      if (isUpdate && !existing)
        throw new ModelProfileError("errors.modelProfile.notFound");
      const profileId = existing?.profile_id ?? `m-${randomUUID()}`;
      const timestamp = now();
      assertEpoch(timestamp);
      const createdAtMs = existing
        ? safeNumber(existing.created_at_ms)
        : timestamp;
      const name = (
        input.name?.trim() ||
        (input.mode === "official"
          ? OFFICIAL_MODEL
          : input.model?.trim() || "untitled")
      ).slice(0, 64);
      const protocol = effectiveProtocol(input.mode, input.protocol);
      let encrypted: EncryptedModelSecret | undefined;
      if (input.apiKey?.trim())
        encrypted = await options.secretCodec.encrypt(input.apiKey.trim());
      const secretId = encrypted
        ? `${profileId}:api-key`
        : (existing?.secret_id ?? null);

      withTransaction(database, () => {
        if (encrypted) {
          secrets.putEncrypted({
            id: secretId!,
            ...encrypted,
            createdAtMs,
            updatedAtMs: timestamp,
          });
        }
        database
          .prepare(
            "UPDATE model_profiles SET is_active = 0 WHERE is_active = 1",
          )
          .run();
        database
          .prepare(
            `INSERT INTO model_profiles
          (profile_id, name, mode, protocol, endpoint, model, secret_id, is_active, created_at_ms, updated_at_ms)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
          ON CONFLICT (profile_id) DO UPDATE SET name=excluded.name, mode=excluded.mode,
            protocol=excluded.protocol, endpoint=excluded.endpoint, model=excluded.model,
            secret_id=excluded.secret_id, is_active=1, updated_at_ms=excluded.updated_at_ms`,
          )
          .run(
            profileId,
            name,
            input.mode,
            protocol,
            input.mode === "official"
              ? OFFICIAL_ENDPOINT
              : input.endpoint?.trim() || null,
            input.mode === "official"
              ? OFFICIAL_MODEL
              : input.model?.trim() || null,
            secretId,
            BigInt(createdAtMs),
            BigInt(timestamp),
          );
      });
      return toSafeView(getRow(profileId)!);
    },
    async remove(id) {
      const existing = getRow(id);
      if (!existing)
        return { ok: false, errorCode: "errors.modelProfile.notFound" };
      withTransaction(database, () => {
        database
          .prepare("DELETE FROM model_profiles WHERE profile_id = ?")
          .run(id);
        const next = database
          .prepare(
            "SELECT profile_id FROM model_profiles ORDER BY created_at_ms, profile_id LIMIT 1",
          )
          .get();
        if (next && typeof next.profile_id === "string") {
          database
            .prepare(
              "UPDATE model_profiles SET is_active = 1 WHERE profile_id = ?",
            )
            .run(next.profile_id);
        }
        if (existing.secret_id)
          secrets.removeIfUnreferenced(existing.secret_id);
      });
      return { ok: true };
    },
    async setActive(id) {
      if (!getRow(id))
        return { ok: false, errorCode: "errors.modelProfile.notFound" };
      withTransaction(database, () => {
        database
          .prepare(
            "UPDATE model_profiles SET is_active = 0 WHERE is_active = 1",
          )
          .run();
        database
          .prepare(
            "UPDATE model_profiles SET is_active = 1 WHERE profile_id = ?",
          )
          .run(id);
      });
      return { ok: true };
    },
    async test(input) {
      if (!options.testProfile)
        return { ok: false, errorCode: "errors.modelProfile.testFailed" };
      return options.testProfile(input);
    },
    async listModels(input) {
      if (!options.listModels)
        return { ok: false, errorCode: "errors.modelProfile.listFailed" };
      return options.listModels(input);
    },
    async importLegacy(source) {
      const prepared: Array<{
        profile: ModelProfile;
        encrypted?: EncryptedModelSecret;
      }> = [];
      let secretsSkipped = 0;
      for (const profile of source.profiles) {
        const existing = getRow(profile.id);
        if (profile.apiKey && !existing?.secret_id) {
          try {
            prepared.push({
              profile,
              encrypted: await options.secretCodec.encrypt(profile.apiKey),
            });
          } catch {
            prepared.push({ profile });
            secretsSkipped += 1;
          }
        } else {
          prepared.push({ profile });
        }
      }
      let profilesImported = 0;
      withTransaction(database, () => {
        database
          .prepare(
            "UPDATE model_profiles SET is_active = 0 WHERE is_active = 1",
          )
          .run();
        for (const item of prepared) {
          const created = Date.parse(item.profile.createdAt);
          const updated = Date.parse(item.profile.updatedAt);
          if (
            !Number.isSafeInteger(created) ||
            created < 0 ||
            !Number.isSafeInteger(updated) ||
            updated < 0
          )
            continue;
          const existing = getRow(item.profile.id);
          const secretId = item.encrypted
            ? `${item.profile.id}:api-key`
            : (existing?.secret_id ?? null);
          if (item.encrypted)
            secrets.putEncrypted({
              id: secretId!,
              ...item.encrypted,
              createdAtMs: created,
              updatedAtMs: updated,
            });
          const result = database
            .prepare(
              `INSERT INTO model_profiles
            (profile_id, name, mode, protocol, endpoint, model, secret_id, is_active, created_at_ms, updated_at_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
            ON CONFLICT (profile_id) DO UPDATE SET name=excluded.name, mode=excluded.mode,
              protocol=excluded.protocol, endpoint=excluded.endpoint, model=excluded.model,
              secret_id=COALESCE(model_profiles.secret_id, excluded.secret_id), updated_at_ms=excluded.updated_at_ms
            WHERE excluded.updated_at_ms > model_profiles.updated_at_ms`,
            )
            .run(
              item.profile.id,
              item.profile.name,
              item.profile.mode,
              item.profile.protocol,
              item.profile.endpoint ?? null,
              item.profile.model ?? null,
              secretId,
              BigInt(created),
              BigInt(updated),
            );
          profilesImported += Number(result.changes);
        }
        const activeId =
          source.activeProfileId && getRow(source.activeProfileId)
            ? source.activeProfileId
            : (listRows()[0]?.profile_id ?? null);
        if (activeId)
          database
            .prepare(
              "UPDATE model_profiles SET is_active = 1 WHERE profile_id = ?",
            )
            .run(activeId);
      });
      return { profilesImported, secretsSkipped };
    },
  };
}

/** SQLite-first read fallback. Mutations always target SQLite. */
export function createModelProfileReadFallback(
  sqlite: SqliteModelProfileRepository,
  legacy: ModelProfileRepository,
): ModelProfileRepository {
  return {
    async listViews() {
      const rows = await sqlite.listViews();
      return rows.length ? rows : legacy.listViews();
    },
    async getActiveView() {
      return (await sqlite.getActiveView()) ?? legacy.getActiveView();
    },
    async getProfileForExecution(id) {
      return (
        (await sqlite.getProfileForExecution(id)) ??
        legacy.getProfileForExecution(id)
      );
    },
    upsert: sqlite.upsert,
    remove: sqlite.remove,
    setActive: sqlite.setActive,
    test: sqlite.test,
    listModels: sqlite.listModels,
  };
}
