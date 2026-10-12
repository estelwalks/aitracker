/**
 * Migration 0005: update-channel proxy settings (Settings → 更新代理).
 *
 * The update channel is the one place AITracker talks to the network on its own
 * behalf, and users behind a local proxy (Clash, Surge, a corporate gateway)
 * need to name it. Before this migration the address was written into
 * `app_preferences`, whose forbidden-zone CHECK (§9-4 / §14.4) rejects every
 * value that looks like a drive-letter path — which `http://` matches,
 * because `p:/` is exactly the `*[A-Za-z]:/*` shape. The runtime guard
 * (`assertAppPreferenceValueSafe`) rejects it as a URL for the same reason:
 * both zones exist so the application never *collects* an address by itself.
 *
 * A proxy endpoint the user typed into Settings is the opposite case, exactly
 * like the user-picked data directories of migration 0003. It is persisted
 * here, in a table whose CHECK accepts one bare proxy endpoint and nothing
 * else: an allowed lowercase scheme, a non-empty host[:port], and no
 * credentials, path, query, fragment, whitespace or backslash. Read-side
 * discipline: this is configuration, not collected evidence — it must never be
 * projected into browser summaries, snapshots, exports or insights.
 */
export const UPDATE_CHANNEL_SETTINGS_SQL = `-- AITracker local storage database — update-channel proxy settings.
CREATE TABLE update_channel_settings (
  setting_id TEXT PRIMARY KEY CHECK (setting_id = 'update-proxy'),
  proxy_url TEXT CHECK (
    proxy_url IS NULL OR (
      length(proxy_url) BETWEEN 8 AND 255
      AND instr(proxy_url, char(0)) = 0
      AND instr(proxy_url, char(92)) = 0
      AND instr(proxy_url, ' ') = 0
      AND (
        proxy_url GLOB 'http://*'
        OR proxy_url GLOB 'https://*'
        OR proxy_url GLOB 'socks4://*'
        OR proxy_url GLOB 'socks5://*'
      )
      -- Everything after the scheme authority must stay a bare host[:port]:
      -- credentials, a path, a query string or a fragment would make this a
      -- full URL rather than the endpoint the update session dials.
      AND instr(proxy_url, '@') = 0
      AND instr(proxy_url, '?') = 0
      AND instr(proxy_url, '#') = 0
      AND instr(substr(proxy_url, instr(proxy_url, '://') + 3), '/') = 0
    )
  ),
  proxy_enabled INTEGER NOT NULL DEFAULT 0 CHECK (proxy_enabled IN (0, 1)),
  updated_at_ms INTEGER NOT NULL CHECK (updated_at_ms >= 0),
  -- Enabling the update channel without an address would silently fall back to
  -- the system proxy, so the row can never claim that state.
  CHECK (proxy_enabled = 0 OR proxy_url IS NOT NULL)
) STRICT;
`;
