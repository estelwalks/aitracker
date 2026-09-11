import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { zstdDecompressSync } from "node:zlib";

/**
 * Naming model and decoder for DeepSeek Harness (DSH) session logs.
 *
 * DSH persists each agent session as `~/.dsh/sessions/<workspace>/<session-id>/
 * session.jsonl.zstd` — a CONCATENATED-FRAME Zstandard container: every append
 * batch is one independently decodable, checksummed zstd frame, and the first
 * frame contains exactly the one-line session header record. Plaintext
 * `.jsonl` logs (compression "none") are also valid.
 *
 * The basename is not fixed. DSH addresses each Session FORMAT GENERATION with
 * its own file: generation 0 keeps `session.jsonl`, every later generation
 * carries a `.vN` component (`session.v3.jsonl`), and the persistence layer
 * appends `.zstd` when compressed. An upgrade that advances the stored format
 * therefore starts writing a NEW name, and a migrated session keeps the older
 * generation's file beside the new one. Discovery must match the generation
 * component instead of one literal name — see `parseDshLogFilename` and
 * `selectDshSessionLogs`, whose rules mirror the harness's own
 * `CANONICAL_LOG_FILENAME` / "highest canonical generation wins".
 *
 * This module owns the naming model and the physical decoding (frame scanning
 * + per-frame decompression). Event extraction lives in the scanners'
 * `applyDshUsageLine` / `applyDshRecord` and never depends on the generation.
 *
 * Frame layout follows the Zstandard format spec (RFC 8878 §3.1): magic
 * 0xFD2FB528, one descriptor byte, optional window descriptor / dictionary id
 * / content size, then 3-byte block headers until the last block, then an
 * optional 4-byte checksum.
 */

const ZSTD_MAGIC = 0xfd2fb528;
/** Zstandard magic as the first four bytes of a file. */
export const ZSTD_MAGIC_BYTES = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
/**
 * P2-17: a decompressed DSH session log above this cap is rejected. The
 * compressed file is bounded by the adapter's maxFileSizeBytes, but
 * decompression can expand far beyond that, so the plaintext is capped
 * independently to keep collection memory bounded.
 */
const MAX_DECOMPRESSED_SESSION_BYTES = 256 * 1024 * 1024;

export interface ZstdFrameRange {
  start: number;
  end: number;
}

export interface ZstdFrameScan {
  /** Every structurally complete frame in the buffer. */
  frames: ZstdFrameRange[];
  /**
   * Byte offset where a trailing incomplete frame starts (writer may be
   * mid-append). Undefined when the buffer ends on a frame boundary.
   */
  tornStart?: number;
}

/**
 * Locate complete zstd frames without decompressing their blocks. Invalid
 * complete structure rejects; EOF inside the final frame reports its start
 * for torn-tail handling (the DSH writer appends frame-by-frame, so a
 * crash/close mid-batch leaves exactly one partial frame at the end).
 */
export function scanZstdFrames(buffer: Buffer): ZstdFrameScan {
  const frames: ZstdFrameRange[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) {
      return { frames, tornStart: start };
    }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error(
        `corrupt zstd session log: invalid frame magic at byte ${offset}`,
      );
    }
    offset += 4;
    if (offset === buffer.length) {
      return { frames, tornStart: start };
    }
    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 24) !== 0) {
      throw new Error(
        `corrupt zstd session log: reserved frame-header bit at byte ${offset - 1}`,
      );
    }
    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 32) !== 0;
    const checksum = (descriptor & 4) !== 0;
    const dictionaryFlag = descriptor & 3;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes =
      contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes =
      (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) {
      return { frames, tornStart: start };
    }
    offset += remainingHeaderBytes;
    for (;;) {
      if (buffer.length - offset < 3) {
        return { frames, tornStart: start };
      }
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 3;
      const blockSize = blockHeader >>> 3;
      if (blockType === 3) {
        throw new Error(
          `corrupt zstd session log: reserved block type at byte ${offset - 3}`,
        );
      }
      const payloadBytes = blockType === 1 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) {
        return { frames, tornStart: start };
      }
      offset += payloadBytes;
      if (lastBlock) break;
    }
    if (checksum) {
      if (buffer.length - offset < 4) {
        return { frames, tornStart: start };
      }
      offset += 4;
    }
    frames.push({ start, end: offset });
  }
  return { frames };
}

export interface ZstdDecodedSessionLog {
  /** Plaintext of every complete frame. */
  readonly text: string;
  /** Byte offset of the end of the last complete frame (torn tail excluded). */
  readonly completeEnd: number;
}

/**
 * Decode a complete DSH zstd session log (concatenated frames) to UTF-8 text
 * plus the byte extent of the decoded frames. A trailing incomplete frame
 * (torn tail) is dropped, matching the writer's committed-prefix semantics;
 * structurally corrupt complete frames throw. The bounds let callers resume
 * from `completeEnd` on a later append without re-decoding the prefix.
 */
export function decodeZstdSessionLogWithBounds(
  buffer: Buffer,
): ZstdDecodedSessionLog {
  const { frames } = scanZstdFrames(buffer);
  if (frames.length === 0) {
    throw new Error("zstd session log is empty or header-less");
  }
  const parts: string[] = [];
  let totalBytes = 0;
  for (const frame of frames) {
    let plaintext: Buffer;
    try {
      plaintext = zstdDecompressSync(buffer.subarray(frame.start, frame.end));
    } catch (error) {
      throw new Error(
        `corrupt zstd session log: frame at byte ${frame.start} failed validation`,
        { cause: error },
      );
    }
    // P2-17: bail early once the accumulated plaintext exceeds the cap so a
    // pathological log never stays resident in memory at full size.
    totalBytes += plaintext.length;
    if (totalBytes > MAX_DECOMPRESSED_SESSION_BYTES) {
      throw new Error(
        `zstd session log exceeds the ${MAX_DECOMPRESSED_SESSION_BYTES}-byte decompressed size limit`,
      );
    }
    parts.push(plaintext.toString("utf8"));
  }
  return {
    text: parts.join(""),
    completeEnd: frames[frames.length - 1]!.end,
  };
}

/**
 * Decode a complete DSH zstd session log (concatenated frames) to UTF-8 text.
 * A trailing incomplete frame (torn tail) is dropped, matching the writer's
 * committed-prefix semantics; structurally corrupt complete frames throw.
 */
export function decodeZstdSessionLog(buffer: Buffer): string {
  return decodeZstdSessionLogWithBounds(buffer).text;
}

/**
 * Read one DSH session log file. Autodetects the container: zstd magic means
 * concatenated frames (`.jsonl.zstd`), anything else is treated as plaintext
 * JSONL (compression "none"). Throws a descriptive error on undecodable input.
 */
export async function readDshSessionLog(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  if (
    buffer.length >= ZSTD_MAGIC_BYTES.length &&
    buffer.subarray(0, ZSTD_MAGIC_BYTES.length).equals(ZSTD_MAGIC_BYTES)
  ) {
    return decodeZstdSessionLog(buffer);
  }
  return buffer.toString("utf8");
}

// ---------------------------------------------------------------------------
// Session log naming and generation selection.
//
// The harness names a session log after the Session FORMAT GENERATION it is
// stored in, and keeps every generation it has written (a migration does not
// delete its source). Discovery therefore has two jobs: recognize every
// canonical generation name, and read only the live one.
// ---------------------------------------------------------------------------

/**
 * Canonical DSH session-log basename: `session.jsonl[.zstd]` (generation 0) or
 * `session.v<N>.jsonl[.zstd]` for generation N ≥ 1. Mirrors the harness's own
 * `CANONICAL_LOG_FILENAME`, which accepts no compression-suffixed, uppercase,
 * leading-zero, or `.v0` spelling.
 */
export const DSH_LOG_FILENAME =
  /^session(?:\.v([1-9][0-9]*))?\.jsonl(\.zstd)?$/u;

export interface DshLogGeneration {
  /** Session format generation the basename names; 0 for `session.jsonl`. */
  readonly generation: number;
  /** Whether the container is zstd-compressed (`.jsonl.zstd`). */
  readonly compressed: boolean;
}

/**
 * Highest Session format generation whose record vocabulary the DSH readers
 * have been verified against: generation 0 (harnesses before the format
 * catalog existed), 2 (0.1.3-alpha.2), and 3 (0.1.5-alpha.1 through
 * 0.1.5-rc.2). Generation 1 was never written by a released harness; it exists
 * only as a migration waypoint.
 *
 * A later generation is still discovered and read like any other, so one that
 * keeps the records these readers consume needs no change here. When it does
 * not, the usage scan reports a field mismatch instead of quietly reporting an
 * empty source for a harness that is collecting fine.
 */
export const DSH_MAX_VERIFIED_GENERATION = 3;

/**
 * Read the format generation one basename names. Returns undefined when the
 * name is not a canonical session log, which is how a discoverer rejects
 * temporary, backup, or foreign files that happen to share the prefix.
 */
export function parseDshLogFilename(
  filename: string,
): DshLogGeneration | undefined {
  const match = DSH_LOG_FILENAME.exec(filename);
  if (match == null) return undefined;
  const generation = match[1] === undefined ? 0 : Number(match[1]);
  if (!Number.isSafeInteger(generation)) return undefined;
  return { generation, compressed: match[2] !== undefined };
}

/**
 * Keep only the live log of each session directory.
 *
 * A session directory holds one session, and one session may hold several
 * generations. The newest generation is a COMPLETE re-encoding of that session
 * — the same events under new sequence numbers, not an extension of the older
 * file — so summing generations would count every migrated session twice (in
 * one real install a 324-byte header-only generation-0 stub sat beside the
 * 392 KB generation-3 log of the same conversation).
 *
 * Highest generation wins, and within one generation the zstd container wins,
 * matching the harness, which resolves a session directory to its numerically
 * highest canonical generation. Non-canonical names are dropped rather than
 * read: they are not session logs, and DSH's own reader rejects them.
 *
 * Input order is preserved so callers that rank candidates (by mtime, then
 * truncate to a file budget) keep their existing semantics.
 */
export function selectDshSessionLogs<T extends { readonly path: string }>(
  files: readonly T[],
): T[] {
  const winnerByDirectory = new Map<
    string,
    {
      readonly file: T;
      readonly generation: number;
      readonly compressed: boolean;
    }
  >();
  for (const file of files) {
    const parsed = parseDshLogFilename(basename(file.path));
    if (parsed == null) continue;
    const directory = dirname(file.path);
    const winner = winnerByDirectory.get(directory);
    if (
      winner == null ||
      parsed.generation > winner.generation ||
      (parsed.generation === winner.generation &&
        parsed.compressed &&
        !winner.compressed)
    ) {
      winnerByDirectory.set(directory, {
        file,
        generation: parsed.generation,
        compressed: parsed.compressed,
      });
    }
  }
  if (winnerByDirectory.size === 0) return [];
  const winners = new Set(
    [...winnerByDirectory.values()].map((entry) => entry.file),
  );
  return files.filter((file) => winners.has(file));
}
