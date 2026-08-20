/** Framework-agnostic persistence contracts. */

export interface Clock {
  now(): Date;
}
