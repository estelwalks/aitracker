/** Browser-safe WSL topology contract (P3-T3-04). */

export interface WslDistroHomeInput {
  readonly distribution: string;
  /** Linux home path (e.g. "/home/user"); never empty. */
  readonly home: string;
}

export interface WslTopologyInput {
  readonly distros: readonly WslDistroHomeInput[];
  /** ISO timestamp of the last successful enumeration. */
  readonly enumeratedAt: string | null;
  readonly failed: boolean;
}
