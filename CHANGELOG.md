# Changelog

All notable changes to AITracker will be documented in this file. The project
uses semantic versioning for published releases.

## [Unreleased]

### Fixes

- Fixed usage collection for sqlite-backed tools whose database passes the
  adapter's `maxFileSizeBytes` cap (issue #42). ZCode keeps every session's
  message/part plaintext in `~/.zcode/cli/db/db.sqlite`, so a real install
  passes 512 MB within weeks of heavy use; the whole file was skipped before
  its read-only query ever ran, and the card reported "no logs" forever. The
  byte cap is a budget for formats that are read in one piece (json/jsonl) and
  no longer applies to `format: "sqlite"`, whose size says nothing about scan
  memory. The same gate was removed from Zed's native `threads.db` reader; the
  other seven sqlite adapters (AiPy, AnythingLLM, Goose, Hermes, Kiro, MiMo,
  Qoder CN) share the generic reader and are fixed with it.
- Bounded that read instead by row count: sqlite rows are now streamed through
  `iterate()` instead of collected with `.all()`, so a large table no longer
  materializes a second in-memory copy, and a shared `maxSqliteRows` budget
  (500,000 events per source, declared in `_shared/scanner-policy.json`) caps
  what a single database can contribute. Exceeding it emits a counted
  diagnostic instead of failing silently.
- Every sqlite usage query now ends with `ORDER BY <timestamp> DESC`, so the
  row budget keeps the most recent events and drops the oldest instead of an
  arbitrary prefix. A new contract test prepares each query against a fixture
  schema and fails if the ordering is missing or no longer leads with `DESC`.
- The scan window now reaches sqlite instead of being applied afterwards. The
  adapter query used to be a fixed string, so a scan read every historical row
  and discarded the pre-cutoff ones in TypeScript: a multi-gigabyte database
  cost the same whether the window was ten years or thirty days, and the row
  budget filled with rows the window would have thrown away. Each sqlite
  adapter now declares a `windowFilter` predicate, which the compiler applies
  by wrapping its query in a subquery - filtering the adapter's own output
  columns keeps the comparison in the units it already normalized to, so a
  table storing text timestamps cannot coerce a millisecond parameter. The
  TypeScript range check remains the authority for adapters without one. On a
  634 MB / 5M-row fixture a 365-day scan drops from 27.0 s to 13.4 s and stops
  truncating; at 90 and 30 days it drops to 0.9 s and 0.4 s.
- A row-budget stop is reported as `query-truncated` rather than
  `file-too-large`. The file is fine in that case - the query simply returned
  more rows than one scan will carry - and reusing the size code sent anyone
  debugging it back to the byte cap that no longer applies to sqlite reads.
- The tool registry rejects a definition whose usage path format and reader
  disagree. A `format: "sqlite"` path on a non-sqlite reader silently lost
  both sqlite protections and reproduced the "no logs" failure #42 describes,
  and validation previously accepted it without a diagnostic.

### Review follow-ups

- The new `query-truncated` code is registered in the persisted-index
  validator. It was missing from that hand-written list, so the warning
  survived the first scan and vanished on the next restart, turning a visible
  truncation back into a silent one. The list is now typed against the
  diagnostic union so an unclassified code fails the build, and a test reads
  the union out of the source to cover the runtime half.
- Zed's `threads.db` window compares an ISO-8601 TEXT column, so the numeric
  cutoff was coerced to text and every date satisfied the comparison - the
  window filtered nothing while appearing to. It now binds the same instant as
  an ISO string as well, and orders `updated_at DESC, rowid DESC` so a capped
  walk keeps the newest threads instead of the oldest.
- The row budget is per source, not per file. Hermes keeps one `state.db` per
  profile, and handing each file its own budget multiplied the documented
  "500,000 rows per source" by the number of profiles, escaping the memory
  bound the budget exists to enforce. One budget is now created per adapter
  scan and shared by every file, with a single truncation diagnostic.
- A cached sqlite parse records the lookback it was windowed to and is reused
  only when that window covers the request; scanning 365 days and then 3650
  would otherwise serve the narrower cache and silently under-report. The
  window identity also survives index hydration, so entries are still reused
  across restarts instead of re-parsing everything.

## [1.0.4] - 2026-09-10

### Highlights

> Published as this release's GitHub notes; keep these short and user-facing.

- The compatibility layer added in 1.0.3 is gone: installers are published under their versionless names only, so a release no longer attaches a duplicate copy of every installer
- `release-metadata.json` lists all four platforms again, including the Windows ARM64 installer
- Updates keep working: 1.0.3 resolves the new document, and later versions resolve it the same way

### Details

- Removed the compatibility layer that kept 1.0.0 and 1.0.1 updating
  themselves. It was added in 1.0.3, whose release is the last one those
  clients can reach, so it has served its purpose: releases no longer carry a
  versioned copy of every installer, `release-metadata.json` names the
  versionless files at `releases/latest/download/<name>` URLs, and the Windows
  ARM64 installer is listed again (`win32-arm64` was withheld only because a
  pre-1.0.2 client rejects a platform key it does not know).
- An update is resolved from the record alone: the name is matched against the
  selected release's own assets and the bytes are verified against `sha256`, so
  the tag-addressed URL and the duplicate assets were never load-bearing for
  1.0.3 and later.
- `checksums.txt` names the same files as before, now simply the artifact names.
  The CLI and the Cask generator accept both namings, so a release published
  before this change (up to 1.0.3) can still be resolved and re-rendered.

## [1.0.3] - 2026-09-10

### Highlights

> Published as this release's GitHub notes; keep these short and user-facing.

- In-app updates are now a complete workflow: check every six hours, download a verified installer silently in the background, restart to install, with progress and a per-version "later" that is remembered
- macOS updates no longer need a manual drag into Applications: restarting mounts, replaces and relaunches the app on its own (macOS asks for a one-time confirmation on first launch)
- Added an update proxy setting (off by default) for networks that cannot reach GitHub directly
- Added a Windows ARM64 installer
- Installs from 1.0.0 and 1.0.1 can update themselves again: each release carries both a versionless installer (what the README links) and a versioned copy that older clients require
- The macOS app icon is now a white rounded tile
- Skill directories are scanned concurrently, so a large catalog refreshes faster

### Details

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
- macOS installs an update without the manual drag-and-drop step: "restart to
  install" now quits the app, mounts the downloaded image at a mount point it
  owns, replaces the app bundle and starts the new version again on its own.
  The update is validated before anything moves (bundle structure, runnable
  executable, no downgrade), the old bundle is kept aside until the new one
  starts, and any failure falls back to the previous behaviour of opening the
  image for a manual install. macOS still asks for the normal one-time
  confirmation when the downloaded app first opens, because the packages remain
  unsigned and the quarantine flag is never removed.
- Added an update proxy setting (off by default, configured like model
  profiles) that routes update traffic through a dedicated Electron session
  for networks that cannot reach GitHub directly.
- The tag-triggered release workflow now publishes a Windows arm64 NSIS
  installer alongside the existing macOS arm64/x64 and Windows x64 ones
  (`AITracker-Setup-arm64.exe`). The Windows arm64 build is cross-built on the
  x64 runner: NSIS embeds the native win32-arm64 Electron payload while the
  installer stub itself stays x86 and runs under Windows' x86 emulation, so no
  ARM64 runner is required.
- `win32-arm64` joined the release contract: `release-metadata.json`, the
  `release-metadata.schema.json` artifact map, the desktop updater and the
  `npx` installer launcher now resolve Windows on ARM to its own installer
  instead of falling back to the x64 one. The desktop updater only knew the
  three platforms published before 1.0.2 and rejected any other artifact key,
  which would have failed every update to this release with "invalid release
  metadata"; it now expects exactly the four platforms the pipeline publishes.
- Installer names no longer carry the version (`AITracker-arm64.dmg`,
  `AITracker-x64.dmg`, `AITracker-Setup-x64.exe`). GitHub resolves
  `/releases/latest/download/<name>` against the newest release, so the README
  download links and `npx --yes @estelwalks/aitracker@latest` keep pointing at
  the current build without a documentation edit per release.
- Every release publishes each installer twice: under that versionless name and
  under a versioned copy (`AITracker-1.0.3-x64.dmg`). `release-metadata.json`
  names the versioned copies at `releases/download/v<version>/<name>` URLs
  specifically so installs from 1.0.0 and 1.0.1 - which compare the URL to that
  exact string and require the matching asset - can update themselves instead of
  needing a manual download. `checksums.txt` lists the versionless names, which
  are the files the README hands out; both namings carry identical bytes.
- `release-metadata.json` lists three platforms again (macOS arm64/x64, Windows
  x64). Windows arm64 is still built and attached to the release, but a client
  released before 1.0.2 rejects the whole document when it carries a platform
  key it does not know, so listing it would stop those installs from updating.
  Windows on ARM users download the installer from the release page.
- The updater and the `npx` launcher take the metadata URL from the selected
  release's own asset list, and `scripts/verify-release-artifact-names.mjs`
  fails CI if a version placeholder or a renamed template ever returns to
  `electron-builder.yml`.
- GitHub release notes are now extracted from this changelog, so the published
  notes for a tag are that version's `CHANGELOG.md` section rather than a
  hard-coded template.
- The documented install commands no longer pin a version: the READMEs and the
  release notes use `npx --yes @estelwalks/aitracker@latest`, which resolves
  through the npm `latest` dist-tag and therefore needs no edit per release.
  Beta builds stay on `@beta`, and pinning a version is documented for
  reproducing an exact build. `verify-readme-release-links` now fails CI when a
  documented command pins a CLI version again.
- The macOS app icon is now a dedicated white rounded tile for the Dock,
  Finder and the mounted installer volume, while the menu-bar template icon,
  the Windows icon set and the web favicons keep their transparent artwork
  (`icon.icns` became `mac-app.icns`).
- Scanned every Skills directory concurrently with a bounded worker pool
  instead of walking them serially, so the skill catalog refresh no longer
  scales with the number of installed agents.

## [1.0.2] - 2026-09-10

Never published: the tag `v1.0.2` was consumed by an immutable release, and
GitHub refuses to reuse an immutable tag name. Its content ships as
[1.0.3] below. Because the release contract requires the tag to equal
`v<package.json version>`, the only way forward was the next version.

## Compatibility window closed at 1.0.3

1.0.3 is the last release that keeps clients from 1.0.0 and 1.0.1 able to
update themselves, and the plan is that every existing install reaches it.
From **1.0.4 onward the release contract targets 1.0.3 and later only**, so
future releases may drop the compatibility layer described under [1.0.3]:
the versioned installer copies, the tag-addressed artifact URLs, and the
three-platform limit on `release-metadata.json`.

What is dropped is the _compatibility_ obligation, not updateability: a
client on 1.0.3 and later still needs every release to keep

- `release-metadata.json` attached under exactly that name;
- the `darwin-arm64`, `darwin-x64` and `win32-x64` artifact records;
- each record's `name`, `url`, `sha256` and `size`, with the bytes matching.

Those three rules are what every future update is resolved through; the
compatibility layer exists only for the older clients.

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
