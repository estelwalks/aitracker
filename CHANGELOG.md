# Changelog

All notable changes to AITracker will be documented in this file. The project
uses semantic versioning for published releases.

## [Unreleased]

## [1.0.2] - 2026-09-10

- In-app updates are now a complete workflow instead of a manual check: the
  desktop client checks GitHub every six hours while it runs, downloads a
  verified installer silently in the background, and offers restart-to-install
  through a global "update ready" dialog. Downloads survive slow connections
  (separate connect and stream-idle timeouts), resume from a package already on
  disk instead of transferring the same release twice, and report throttled
  progress with a percentage in Settings and in the manual update dialog.
  A deferral is remembered per version, and the Windows hand-off runs the
  installer with `/S --updated --force-run` so it closes the running app and
  relaunches the new build.
- Added an update proxy setting (off by default, configured like model
  profiles) that routes update traffic through a dedicated Electron session
  for networks that cannot reach GitHub directly.
- The tag-triggered release workflow now publishes a Windows arm64 NSIS
  installer alongside the existing macOS arm64/x64 and Windows x64 ones
  (`AITracker-Setup-<version>-arm64.exe`). The Windows arm64 build is
  cross-built on the x64 runner: NSIS embeds the native win32-arm64 Electron
  payload while the installer stub itself stays x86 and runs under Windows'
  x86 emulation, so no ARM64 runner is required.
- `win32-arm64` joined the release contract: `release-metadata.json`, the
  `release-metadata.schema.json` artifact map, and the `npx` installer
  launcher now resolve Windows on ARM to its own installer instead of falling
  back to the x64 one.
- Every release now also carries versionless copies of its four installers
  (`AITracker-arm64.dmg`, `AITracker-x64.dmg`, `AITracker-Setup-x64.exe`,
  `AITracker-Setup-arm64.exe`). Because GitHub resolves
  `/releases/latest/download/<name>` against the newest release, the README
  download links are pinned to those names and no longer need editing on every
  release. The versioned installers, `release-metadata.json` and
  `checksums.txt` are unchanged.
- GitHub release notes are now extracted from this changelog, so the published
  notes for a tag are that version's `CHANGELOG.md` section rather than a
  hard-coded template.
- The macOS app icon is now a dedicated white rounded tile for the Dock,
  Finder and the mounted installer volume, while the menu-bar template icon,
  the Windows icon set and the web favicons keep their transparent artwork
  (`icon.icns` became `mac-app.icns`).
- Scanned every Skills directory concurrently with a bounded worker pool
  instead of walking them serially, so the skill catalog refresh no longer
  scales with the number of installed agents.

## [1.0.1] - 2026-09-08

- Added pi and oh-my-pi (omp) session and usage readers over their `~/.pi`
  and `~/.omp` session logs (project-grouped jsonl envelopes): pi/omp
  sessions now appear in session management, usage analytics and the agent
  overview instead of "暂无日志" ([#33](https://github.com/estelwalks/aitracker/issues/33)).
- Incremental DSH session scanning with persisted per-file caches and DSH
  transcript resume.
- New agents converge across Sources, Agent overview and the skill catalog
  within minutes: parsed usage/session evidence queues an installation probe,
  and a freshly installed skill-capable agent queues a skills rescan instead
  of waiting out the scheduled cadences.
- Shortened the skill snapshot refresh cadence to 30 minutes and the
  installation probe to 60 minutes (both user-configurable down to 15).
- Added per-tool data-directory overrides on the Sources page: each
  configurable agent can be pointed at its real data directory through the
  native folder picker (macOS/Windows), persisted in the new
  `tool_data_roots` table (migration 0003) and applied to usage scanning,
  installation detection and skill discovery/sync/install (Hermes included)
  ([#31](https://github.com/estelwalks/aitracker/issues/31)).
- Added Hermes Agent usage collection: the registry now reads its SQLite
  `sessions` table (`state.db` plus `profiles/<name>/state.db`, including the
  Windows `%LOCALAPPDATA%\hermes` layout).
- The desktop security scanner mirrors the registry skill-agent roots (with a
  parity guard) and honours per-tool overrides through the env/test seam and,
  in packaged clients, through the desktop-state broker bridge into the
  `tool_data_roots` table (GUI-configured directories).
- Prepared the repository for public, reproducible development; integrated
  the published `@estelwalks/agent-threat-scanner` npm package; moved
  renderer persistence to SQLite-backed application preferences; removed
  unreachable server implementation chunks from the public browser bundle and
  made both privacy audits blocking release gates; added privacy, release and
  dependency-notice documentation.

## [1.0.0-beta.1] - 2026-08-31

- First public prerelease of the open-source desktop application.
