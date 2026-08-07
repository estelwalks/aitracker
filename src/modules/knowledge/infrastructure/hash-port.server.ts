import { createHash } from "node:crypto";
import type { ContentHash, HashPort } from "../contracts.ts";

/** Node adapter; the application only depends on the HashPort. */
export function createSha256HashPort(): HashPort {
  return {
    hash(value: string): ContentHash {
      return `sha256-${createHash("sha256").update(value, "utf8").digest("hex")}` as ContentHash;
    },
  };
}
