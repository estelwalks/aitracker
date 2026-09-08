# Changelog

All notable changes to AITracker will be documented in this file. The project
uses semantic versioning for published releases.

## [Unreleased]

- Prepared the repository for public, reproducible development.
- Integrated the published `@estelwalks/agent-threat-scanner` npm package.
- Moved renderer persistence to SQLite-backed application preferences.
- Removed unreachable server implementation chunks from the public browser
  bundle and made both privacy audits blocking release gates.
- Added privacy, release, and dependency-notice documentation.
- Added Hermes Agent usage collection: the registry now reads its SQLite
  `sessions` table (`state.db` plus `profiles/<name>/state.db`, including the
  Windows `%LOCALAPPDATA%\hermes` layout).
- Added per-tool data-directory overrides on the Sources page: each
  configurable agent can be pointed at its real data directory through the
  native folder picker (macOS/Windows), persisted in the new
  `tool_data_roots` table (migration 0003) and applied to usage scanning,
  installation detection and skill discovery/sync/install (Hermes included).
- The desktop security scanner mirrors the registry skill-agent roots (with a
  parity guard) and honours per-tool overrides through the env/test seam and,
  in packaged clients, through the desktop-state broker bridge into the
  `tool_data_roots` table (GUI-configured directories).

## [1.0.0-beta.1] - 2026-08-31

- First public prerelease of the open-source desktop application.
