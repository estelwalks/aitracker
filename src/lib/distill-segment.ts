/**
 * Session-segment URL codec (Story B-100).
 *
 * The session detail page passes its user-selected transcript window to the
 * distillation workbench through the `?segment=` search param, encoded as
 * `source|sessionId|startIndex|endIndex` (each part percent-encoded, indices
 * decimal). Only opaque public ids survive decoding: source/sessionId must
 * match the shared `[A-Za-z0-9._:-]` charset and the window must be a
 * non-negative, non-inverted inclusive range. The segment is a reference,
 * not content — the referenced text is loaded into memory by the server only
 * when the user actually starts a distillation.
 */

export interface SegmentRefCodec {
  readonly source: string;
  readonly sessionId: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/** Encode a segment ref into a URL-search-safe string. */
export function encodeSegmentRef(ref: SegmentRefCodec): string {
  return [
    encodeURIComponent(ref.source),
    encodeURIComponent(ref.sessionId),
    String(ref.startIndex),
    String(ref.endIndex),
  ].join("|");
}

/**
 * Decode a `?segment=` search value back into a segment ref. Returns null for
 * any malformed value (wrong arity, un-decodable part, non-opaque ids,
 * inverted/negative window) so the caller can silently ignore junk input.
 */
export function decodeSegmentRef(raw: unknown): SegmentRefCodec | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split("|");
  if (parts.length !== 4) return null;

  const [sourceRaw, sessionIdRaw, startRaw, endRaw] = parts;
  if (
    sourceRaw == null ||
    sessionIdRaw == null ||
    startRaw == null ||
    endRaw == null
  ) {
    return null;
  }
  const source = safeDecode(sourceRaw);
  const sessionId = safeDecode(sessionIdRaw);
  const start = Number(startRaw);
  const end = Number(endRaw);
  if (
    source == null ||
    sessionId == null ||
    !OPAQUE_ID.test(source) ||
    !OPAQUE_ID.test(sessionId) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < 0 ||
    start > end
  ) {
    return null;
  }
  return { source, sessionId, startIndex: start, endIndex: end };
}
