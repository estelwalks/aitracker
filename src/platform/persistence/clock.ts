import type { Clock } from "./contracts.ts";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
