/**
 * Shared read-model contracts (P1-T1-01).
 *
 * A read model is a compact, page-specific projection of domain data. It must
 * never carry raw events, session details, filesystem paths, commands or
 * server-only types. Every projector should attach a `ReadModelMeta` so the
 * pipeline can be measured (duration, DTO bytes, revision) and privacy-gated.
 */

export type ReadModelStatus = "fresh" | "stale" | "empty" | "failed";

export interface ReadModelMeta {
  /** Stable dotted identifier of the read model (e.g. "dashboard.summary"). */
  readonly name: string;
  /** Revision of the underlying snapshot this projection was built from. */
  readonly revision: string | null;
  /** ISO timestamp when the projection was computed. */
  readonly generatedAt: string | null;
  /** Wall-clock projection time in milliseconds. */
  readonly durationMs: number;
  /** Serialized JSON bytes of the DTO (0 when not serializable). */
  readonly dtoBytes: number;
  readonly status: ReadModelStatus;
}

/** Every page DTO carries its meta block. */
export interface WithReadModelMeta {
  readonly meta: ReadModelMeta;
}

/**
 * Fields that must never appear in a read-model DTO, checked by the DTO gate
 * (`findForbiddenDtoFields` in platform/observability). Keeping the list here
 * documents the page contract; the enforcement lives in the observability
 * measure helper and the verification scripts.
 */
export const READ_MODEL_FORBIDDEN_FIELDS = [
  "command",
  "prompt",
  "transcript",
  "sessionBody",
  "messages",
  "rawContent",
  "content",
  "response",
  "apiKey",
  "accessToken",
  "authorization",
  "password",
  "secret",
  "path",
  "root",
  "home",
] as const;

/** Budgets referenced by read-model tests and the byte gate. */
export const READ_MODEL_BUDGETS = {
  dashboardFirstScreenBytes: 250 * 1024,
  otherRouteFirstScreenBytes: 150 * 1024,
  widgetModelBytes: 50 * 1024,
  widgetStatusBytes: 2 * 1024,
} as const;
