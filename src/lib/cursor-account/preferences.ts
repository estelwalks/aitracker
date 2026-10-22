/**
 * Opt-in switch for the Cursor account collector.
 *
 * Cursor exposes per-request token usage only through its own account API, so
 * enabling this feature is the user's consent to one outbound request to
 * cursor.com made with the session Cursor already keeps on this machine. It is
 * deliberately off until the user turns it on in Settings.
 */
export const CURSOR_ACCOUNT_USAGE_PREFERENCE_KEY =
  "aitracker.cursorAccountUsage.enabled";

export function parseCursorAccountUsageEnabled(value: unknown): boolean {
  return value === true;
}
