/**
 * Framework-neutral outcome types for application and domain code.
 *
 * Error codes deliberately use the translated `errors.*` namespace instead
 * of exception text. Transport adapters may map these values to their UI
 * error representation without exposing implementation details.
 */
export type ErrorCode = `errors.${string}`;

export type ErrorParams = Readonly<Record<string, string | number | boolean>>;

export interface AppError<TCode extends ErrorCode = ErrorCode> {
  readonly code: TCode;
  readonly params?: ErrorParams;
}

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<TCode extends ErrorCode = ErrorCode> {
  readonly ok: false;
  readonly error: AppError<TCode>;
}

export type Result<T, TCode extends ErrorCode = ErrorCode> = Ok<T> | Err<TCode>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<TCode extends ErrorCode>(
  code: TCode,
  params?: ErrorParams,
): Err<TCode> {
  return {
    ok: false,
    error: params === undefined ? { code } : { code, params },
  };
}

export function isOk<T, TCode extends ErrorCode>(
  result: Result<T, TCode>,
): result is Ok<T> {
  return result.ok;
}

export function isErr<T, TCode extends ErrorCode>(
  result: Result<T, TCode>,
): result is Err<TCode> {
  return !result.ok;
}

/** Maps a successful value and leaves a stable failure untouched. */
export function mapResult<T, U, TCode extends ErrorCode>(
  result: Result<T, TCode>,
  mapper: (value: T) => U,
): Result<U, TCode> {
  return isOk(result) ? ok(mapper(result.value)) : result;
}
