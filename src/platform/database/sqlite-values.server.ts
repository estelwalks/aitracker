import { DatabaseError } from "./contracts.ts";

export function sqliteInteger(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (
    typeof value === "bigint" &&
    value <= BigInt(Number.MAX_SAFE_INTEGER) &&
    value >= BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  throw new DatabaseError("integer-overflow", "read", { retryable: false });
}

export function sqliteText(value: unknown): string {
  if (typeof value === "string") return value;
  throw new DatabaseError("corrupt", "read", { retryable: false });
}

export function sqliteNullableText(value: unknown): string | undefined {
  return value == null ? undefined : sqliteText(value);
}

export function epoch(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
  return parsed;
}

export function iso(value: unknown): string | undefined {
  if (value == null) return undefined;
  return new Date(sqliteInteger(value)).toISOString();
}

export function stableJson(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new DatabaseError("invalid-argument", "write", { retryable: false });
  }
  return serialized;
}
