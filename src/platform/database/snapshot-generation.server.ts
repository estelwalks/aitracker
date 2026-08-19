import { createHmac, randomUUID } from "node:crypto";

import type { SqliteDatabasePort, SqliteRow } from "./contracts.ts";
import type {
  SnapshotEnvelope,
  SnapshotHydrateResult,
} from "../snapshot-runtime/contracts.ts";

export type PersistedSnapshotDomain =
  "usage" | "sessions" | "skills" | "installations" | "wsl" | "exchange";

export function hashSensitiveRef(
  key: string | Uint8Array,
  domain: string,
  value: string,
): string {
  return createHmac("sha256", key)
    .update(`trusttools:${domain}:v1\0`, "utf8")
    .update(value, "utf8")
    .digest("base64url");
}

export function safeProjectLabel(value: string): string {
  const normalized = value.trim().replaceAll("\\", "/").replace(/\/+$/u, "");
  const label = normalized.slice(normalized.lastIndexOf("/") + 1);
  return label && !/^[A-Za-z]:$/u.test(label) ? label.slice(0, 128) : "unknown";
}

export function isoToMs(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function msToIso(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "bigint") return null;
  return new Date(Number(value)).toISOString();
}

function optionalInteger(value: number | undefined): number | null {
  return value == null ? null : Math.max(0, Math.trunc(value));
}

function completedStatus(status: SnapshotEnvelope<unknown>["status"]): string {
  return status === "refreshing" ? "fresh" : status;
}

export function currentSnapshotRow(
  database: SqliteDatabasePort,
  domain: PersistedSnapshotDomain,
): SqliteRow | undefined {
  return database
    .prepare(
      `SELECT g.* FROM snapshot_heads h
       JOIN snapshot_generations g ON g.snapshot_id = h.snapshot_id
       WHERE h.domain = ?`,
    )
    .get(domain);
}

export function envelopeFromRow<T>(
  row: SqliteRow,
  data: T,
): SnapshotEnvelope<T> {
  const warnings = row.warning_codes;
  return {
    schemaVersion: Number(row.schema_version),
    revision: String(row.revision),
    generatedAt: msToIso(row.generated_at_ms),
    sourceFingerprint:
      typeof row.source_fingerprint === "string"
        ? row.source_fingerprint
        : null,
    status: String(row.status) as SnapshotEnvelope<T>["status"],
    data,
    diagnostics: {
      lastAttemptAt: msToIso(row.last_attempt_at_ms),
      lastSuccessAt: msToIso(row.last_success_at_ms),
      ...(row.duration_ms == null
        ? {}
        : { durationMs: Number(row.duration_ms) }),
      ...(row.scanned_items == null
        ? {}
        : { scannedItems: Number(row.scanned_items) }),
      ...(row.reused_items == null
        ? {}
        : { reusedItems: Number(row.reused_items) }),
      warningCodes: Array.isArray(warnings) ? (warnings as string[]) : [],
    },
  };
}

export function loadGeneration<T>(options: {
  database: SqliteDatabasePort;
  domain: PersistedSnapshotDomain;
  readData: (snapshotId: string, row: SqliteRow) => T;
}): SnapshotHydrateResult<T> {
  const row = currentSnapshotRow(options.database, options.domain);
  if (!row) {
    return {
      source: "default",
      schemaVersion: 1,
      envelope: {
        schemaVersion: 1,
        revision: "empty",
        generatedAt: null,
        sourceFingerprint: null,
        status: "empty",
        data: null,
        diagnostics: {
          lastAttemptAt: null,
          lastSuccessAt: null,
          warningCodes: [],
        },
      },
    };
  }
  const snapshotId = String(row.snapshot_id);
  const warningCodes = options.database
    .prepare(
      "SELECT warning_code FROM snapshot_warnings WHERE snapshot_id = ? ORDER BY sequence",
    )
    .all(snapshotId)
    .map((warning) => String(warning.warning_code));
  const data = options.readData(snapshotId, {
    ...row,
    warning_codes: warningCodes,
  });
  return {
    source: "stored",
    schemaVersion: Number(row.schema_version),
    envelope: envelopeFromRow({ ...row, warning_codes: warningCodes }, data),
  };
}

export function commitGeneration<T>(options: {
  database: SqliteDatabasePort;
  domain: PersistedSnapshotDomain;
  envelope: SnapshotEnvelope<T>;
  writeData: (snapshotId: string, data: T) => void;
  now?: () => number;
  retain?: number;
  createId?: () => string;
}): void {
  if (options.envelope.data == null)
    throw new TypeError("snapshot data required");
  const now = options.now?.() ?? Date.now();
  const snapshotId = options.createId?.() ?? randomUUID();
  const transaction = options.database.transaction();
  transaction.begin();
  try {
    options.database
      .prepare(
        `INSERT INTO snapshot_generations (
          snapshot_id, domain, schema_version, revision, generated_at_ms,
          source_fingerprint, status, last_attempt_at_ms, last_success_at_ms,
          duration_ms, scanned_items, reused_items, created_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshotId,
        options.domain,
        options.envelope.schemaVersion,
        options.envelope.revision,
        isoToMs(options.envelope.generatedAt),
        options.envelope.sourceFingerprint,
        completedStatus(options.envelope.status),
        isoToMs(options.envelope.diagnostics.lastAttemptAt),
        isoToMs(options.envelope.diagnostics.lastSuccessAt),
        optionalInteger(options.envelope.diagnostics.durationMs),
        optionalInteger(options.envelope.diagnostics.scannedItems),
        optionalInteger(options.envelope.diagnostics.reusedItems),
        now,
      );
    options.envelope.diagnostics.warningCodes.forEach((code, sequence) => {
      options.database
        .prepare(
          "INSERT INTO snapshot_warnings(snapshot_id, sequence, warning_code) VALUES (?, ?, ?)",
        )
        .run(snapshotId, sequence, code);
    });
    options.writeData(snapshotId, options.envelope.data);
    options.database
      .prepare(
        `INSERT INTO snapshot_heads(domain, snapshot_id, updated_at_ms) VALUES (?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET snapshot_id=excluded.snapshot_id, updated_at_ms=excluded.updated_at_ms`,
      )
      .run(options.domain, snapshotId, now);
    const retain = Math.max(1, options.retain ?? 2);
    options.database
      .prepare(
        `DELETE FROM snapshot_generations
         WHERE domain = ? AND snapshot_id NOT IN (
           SELECT snapshot_id FROM snapshot_generations WHERE domain = ? ORDER BY created_at_ms DESC LIMIT ?
         ) AND snapshot_id <> (SELECT snapshot_id FROM snapshot_heads WHERE domain = ?)`,
      )
      .run(options.domain, options.domain, retain, options.domain);
    transaction.commit();
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}

export function clearGenerations(
  database: SqliteDatabasePort,
  domain: PersistedSnapshotDomain,
): void {
  const transaction = database.transaction();
  transaction.begin();
  try {
    database.prepare("DELETE FROM snapshot_heads WHERE domain = ?").run(domain);
    database
      .prepare("DELETE FROM snapshot_generations WHERE domain = ?")
      .run(domain);
    transaction.commit();
  } catch (error) {
    transaction.rollback();
    throw error;
  }
}
