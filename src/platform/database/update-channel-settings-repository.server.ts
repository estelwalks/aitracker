import type { SqliteDatabasePort } from "./contracts.ts";
import { sqliteInteger, sqliteText } from "./sqlite-values.server.ts";

/**
 * Update-channel proxy settings (Settings → 更新代理).
 *
 * Deliberate carve-out from the privacy guard, in the same spirit as migration
 * 0003: `app_preferences` and `runtime_flags` reject URL-shaped values
 * (§9-4 / §14.4) so the application never *collects* an address on its own. A
 * proxy endpoint is the opposite — the user typed it in Settings, and only the
 * Electron main process reads it back to configure the update session. The
 * repository therefore does NOT run `assertAppPreferenceValueSafe`; it
 * validates the one shape this table exists to hold: a bare proxy endpoint
 * (lowercase http/https/socks4/socks5 scheme + non-empty host[:port]) with no
 * credentials, path, query or fragment.
 *
 * Read-side discipline: this is configuration, not collected evidence. It must
 * never be projected into browser summaries, snapshots, exports or insights.
 */

/** Single-row table: the update channel has exactly one proxy setting. */
export const UPDATE_PROXY_SETTING_ID = "update-proxy";

const ALLOWED_SCHEME_PREFIXES = [
  "http://",
  "https://",
  "socks4://",
  "socks5://",
] as const;

/** Kept in sync with the `update_channel_settings.proxy_url` CHECK. */
const MAX_PROXY_URL_LENGTH = 255;
const MIN_PROXY_URL_LENGTH = 8;

/** Host-authority characters that turn an endpoint into a full URL. */
const FORBIDDEN_AUTHORITY = /[\s@/?#\\]/u;

export interface UpdateChannelSettingsRecord {
  readonly proxyUrl: string | null;
  readonly proxyEnabled: boolean;
  readonly updatedAtMs: number;
}

export interface UpdateChannelSettingsInput {
  /** Normalized endpoint, or `null` when the update channel follows the system proxy. */
  readonly proxyUrl: string | null;
  readonly proxyEnabled: boolean;
}

/**
 * Validates one update-proxy setting pair before it reaches SQLite. The scheme
 * must already be lowercase: the persisted form is the canonical one produced
 * by the Electron normalizer, and the table CHECK is case-sensitive too.
 */
export function assertUpdateChannelSettings(
  input: UpdateChannelSettingsInput,
): void {
  if (typeof input.proxyEnabled !== "boolean") {
    throw new TypeError("proxyEnabled must be a boolean");
  }
  if (input.proxyUrl === null) {
    if (input.proxyEnabled) {
      throw new TypeError("Enabling the update proxy requires a proxy address");
    }
    return;
  }
  const proxyUrl = input.proxyUrl;
  if (typeof proxyUrl !== "string" || proxyUrl.trim() !== proxyUrl) {
    throw new TypeError("proxyUrl must be a trimmed string");
  }
  if (
    proxyUrl.length < MIN_PROXY_URL_LENGTH ||
    proxyUrl.length > MAX_PROXY_URL_LENGTH
  ) {
    throw new TypeError("proxyUrl length is out of range");
  }
  const prefix = ALLOWED_SCHEME_PREFIXES.find((scheme) =>
    proxyUrl.startsWith(scheme),
  );
  if (prefix === undefined) {
    throw new TypeError(
      "proxyUrl must use a lowercase http, https, socks4 or socks5 scheme",
    );
  }
  const authority = proxyUrl.slice(prefix.length);
  if (authority.length === 0 || FORBIDDEN_AUTHORITY.test(authority)) {
    throw new TypeError(
      "proxyUrl must be a bare host:port endpoint without credentials, path, query or fragment",
    );
  }
}

export interface UpdateChannelSettingsRepository {
  read(): Promise<UpdateChannelSettingsRecord | undefined>;
  write(
    settings: UpdateChannelSettingsInput,
    updatedAtMs?: number,
  ): Promise<void>;
  clear(): Promise<void>;
}

export function createSqliteUpdateChannelSettingsRepository(
  database: SqliteDatabasePort,
): UpdateChannelSettingsRepository {
  const selectSql =
    "SELECT proxy_url, proxy_enabled, updated_at_ms FROM update_channel_settings WHERE setting_id = ?";
  const upsertSql = `INSERT INTO update_channel_settings (setting_id, proxy_url, proxy_enabled, updated_at_ms)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (setting_id) DO UPDATE SET
      proxy_url = excluded.proxy_url,
      proxy_enabled = excluded.proxy_enabled,
      updated_at_ms = excluded.updated_at_ms`;

  return {
    async read() {
      const row = database.prepare(selectSql).get(UPDATE_PROXY_SETTING_ID);
      if (!row) return undefined;
      const proxyUrl = row.proxy_url;
      return {
        proxyUrl: proxyUrl === null ? null : sqliteText(proxyUrl),
        proxyEnabled: sqliteInteger(row.proxy_enabled) === 1,
        updatedAtMs: sqliteInteger(row.updated_at_ms),
      };
    },
    async write(settings, updatedAtMs = Date.now()) {
      assertUpdateChannelSettings(settings);
      if (!Number.isSafeInteger(updatedAtMs) || updatedAtMs < 0) {
        throw new TypeError("updatedAtMs must be a non-negative integer");
      }
      database
        .prepare(upsertSql)
        .run(
          UPDATE_PROXY_SETTING_ID,
          settings.proxyUrl,
          settings.proxyEnabled ? 1 : 0,
          BigInt(updatedAtMs),
        );
    },
    async clear() {
      database
        .prepare("DELETE FROM update_channel_settings WHERE setting_id = ?")
        .run(UPDATE_PROXY_SETTING_ID);
    },
  };
}
