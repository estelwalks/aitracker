import type { MonitoringStatus } from "../contracts.ts";

/** The persisted contract is already renderer-safe, so no richer UI model is
 * required at this module boundary. */
export type MonitoringViewModel = MonitoringStatus;
