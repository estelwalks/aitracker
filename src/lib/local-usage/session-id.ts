import { createHash } from "node:crypto";

import type { LocalUsageSource } from "./types.ts";
import { SESSION_HMAC_DOMAIN } from "../app-config";

const SESSION_ID_PATTERN = /^session_[a-f0-9]{20}$/;

function identifierValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return String(value);
  }
  return undefined;
}

function opaqueIdentifier(
  source: LocalUsageSource,
  kind: string,
  value: string,
): string {
  const digest = createHash("sha256")
    .update(SESSION_HMAC_DOMAIN)
    .update("\0")
    .update(source)
    .update("\0")
    .update(kind)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, 20);
  return `session_${digest}`;
}

export function sessionIdFromStructuredValue(
  source: LocalUsageSource,
  value: unknown,
): string | undefined {
  const identifier = identifierValue(value);
  return identifier == null
    ? undefined
    : opaqueIdentifier(source, "structured", identifier);
}

export function sessionIdFromRelativeFile(
  source: LocalUsageSource,
  relativeFileIdentity: string,
): string {
  return opaqueIdentifier(
    source,
    "file",
    relativeFileIdentity.replaceAll("\\", "/"),
  );
}

export function isPrivateSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}
