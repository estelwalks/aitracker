import { readFile } from "node:fs/promises";
import { zstdDecompressSync } from "node:zlib";

/**
 * Decoder for DeepSeek Harness (DSH) session logs.
 *
 * DSH persists each agent session as `~/.dsh/sessions/<workspace>/<session-id>/
 * session.jsonl.zstd` — a CONCATENATED-FRAME Zstandard container: every append
 * batch is one independently decodable, checksummed zstd frame, and the first
 * frame contains exactly the one-line session header record. Plaintext
 * `.jsonl` logs (compression "none") are also valid.
 *
 * This module owns the physical decoding only (frame scanning + per-frame
 * decompression). Event extraction lives in the scanner's `parseDshUsageFile`.
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

/**
 * Decode a complete DSH zstd session log (concatenated frames) to UTF-8 text.
 * A trailing incomplete frame (torn tail) is dropped, matching the writer's
 * committed-prefix semantics; structurally corrupt complete frames throw.
 */
export function decodeZstdSessionLog(buffer: Buffer): string {
  const { frames, tornStart } = scanZstdFrames(buffer);
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
  return parts.join("");
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
