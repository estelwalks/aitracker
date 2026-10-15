# Changelog

All notable changes to AITracker will be documented in this file. The project
uses semantic versioning for published releases.

## [Unreleased]

<!--
Unreleased work is summarised here. The release branch turns this whole
section into `## [X.Y.Z] - YYYY-MM-DD` when the version is actually
published, in the same commit that bumps the package versions and receives
the tag, so a numbered section means "this version shipped" and is never
opened early. Individual fixes do not have to touch this file.
-->

### Highlights

> Published as this release's GitHub notes; keep these short and user-facing.
> `### 更新摘要` below carries the same list in Chinese and is published as
> `## 本次更新` right after the English one, so the release page is bilingual.

- In-app updates work on Linux again: 1.0.6 could see a newer release but failed to verify the Linux package, so every check ended in "Could not fetch version info" and no Linux install could update itself
- If you are on Linux with 1.0.6, install 1.0.7 once by hand — the broken build cannot receive its own fix; from 1.0.7 everything is automatic again
- An AppImage install now updates silently in place, and the restart prompt says so; a deb/rpm install is instead told exactly which command finishes the install
- The prompt no longer describes a silent install on a deb/rpm install, and no longer reports a failed install when nothing was ever started
- Linux downloads land in AITracker's own data folder instead of `/tmp`, so a large AppImage is not held in RAM and stays runnable on systems that mount `/tmp` no-exec

### 更新摘要

> 与上面的 `### Highlights` 一一对应，发布时作为 `## 本次更新` 出现在英文摘要之后。

- Linux 应用内更新恢复正常：1.0.6 能看到新版本，却在校验 Linux 安装包时失败，于是每次检查都以「无法获取版本信息」结束，Linux 用户无法自动更新
- 如果你在 Linux 上用的是 1.0.6，请手动安装一次 1.0.7——出问题的版本收不到自己的修复；从 1.0.7 起一切恢复自动
- AppImage 安装现在是真正的静默就地替换，重启提示也如实说明；deb/rpm 安装则直接告诉您完成安装需要执行哪条命令
- 提示不再对 deb/rpm 安装宣称「静默安装」，也不会在什么都没启动时报告「安装失败」
- Linux 的下载改放在 AITracker 自己的数据目录，不再占用 `/tmp`：大文件不会驻留内存，在把 `/tmp` 挂成 noexec 的系统上也能正常运行

### Details

- Linux clients read the release's **companion** `release-metadata-linux.json`
  first and fall back to the main `release-metadata.json`, in that order. The
  companion document records `linux-x64` with its `sha256`, which is what 1.0.6
  never looked at: it validated the main document (four macOS/Windows keys, and
  correctly so) and then failed to find a Linux artifact in it, ending every
  check as an integrity failure. macOS and Windows clients still read the main
  document only, so their update path is untouched.
- The document order also keeps the planned merge working: once Linux is merged
  into the main document, a 1.0.7-and-later client finds `linux-x64` through the
  fallback instead of being stranded. The merge itself is deliberately **not**
  part of this release — a client shipped before 1.0.6 rejects any fifth key
  outright, so merging early would stop those installs from ever updating again.
- A release that publishes no metadata document for this platform now reports a
  distinct state (`errorCode: "metadata"`, "no update info for your platform —
  download it from the release page") instead of the same "Could not fetch
  version info" that also covered a document that failed validation.
- The Linux restart prompt is chosen by install form, read from the main process
  (`$APPIMAGE` set → AppImage; a package under `/opt` or `/usr/lib` → deb/rpm; a
  checkout or unpacked directory → unpacked). The AppImage copy promises the
  in-place swap it can perform; the other two say that the folder will open and
  that the command shown finishes the install, because installing a distro
  package needs root and the app never escalates.
- Clicking "Restart & update" now reports what actually happened instead of
  always claiming an install had started: a manual hand-off shows the real
  command (`chmod +x <file> && <file>` for an AppImage, `sudo apt install <file>`
  for a deb, `sudo rpm -U <file>` for an rpm) and no longer arms the 90-second
  watchdog that used to report a failure for an install nobody started.
- On Linux the downloaded installer and its hand-off script live in
  `userData/updates` rather than the system temp directory: `/tmp` is often a
  `tmpfs` (a 150 MB AppImage parked in RAM) and is sometimes mounted `noexec`,
  which would make the hand-off script unrunnable and the displayed manual
  command useless.

## [1.0.6] - 2026-10-15

### Highlights

> Published as this release's GitHub notes; keep these short and user-facing.
> `### 更新摘要` below carries the same list in Chinese and is published as
> `## 本次更新` right after the English one, so the release page is bilingual.

- Linux joins macOS and Windows as a supported platform: every release ships an AppImage, a `.deb` and an `.rpm`, and in-app updates work there
- Reports can now describe what the AI actually did instead of only counting usage: a new switch (off by default) reads the covered sessions locally and sends only a redacted digest to your own configured model
- Fixed daily/weekly/monthly reports gained a work profile: behaviour mix, per-agent tool activity and session topics
- Twenty more agents are tracked on Linux, and the five with no Linux build read as unsupported instead of "not installed"
- An `http://` update proxy address saves again: every address but `socks5://` used to be rejected as an invalid format

### 更新摘要

> 与上面的 `### Highlights` 一一对应，发布时作为 `## 本次更新` 出现在英文摘要之后。

- Linux 与 macOS/Windows 并列成为正式支持的平台：每个版本都提供 AppImage、`.deb` 和 `.rpm`，应用内更新在 Linux 上同样可用
- 报告可以说明 AI 实际做了什么，而不只是统计用量：新增开关（默认关闭）在本机读取所覆盖的会话，只把脱敏摘要交给您自己配置的模型
- 固定的日报/周报/月报新增工作画像：行为构成、各 Agent 的工具活动与会话主题
- Linux 上新增追踪 20 个 Agent 工具，5 个没有 Linux 版本的工具从「未安装」改判为「不支持」
- `http://` 更新代理地址可以保存了：以前除 `socks5://` 之外的地址一律报格式无效

### Details

- Linux is a supported desktop platform. Every release now also ships
  `AITracker-Linux-x64.AppImage`, `AITracker-Linux-x64.deb` and
  `AITracker-Linux-x64.rpm`; the download links, the
  `npx @estelwalks/aitracker` launcher and the in-app updater all resolve them,
  and `npm run dist:linux:x64` builds them (on Linux — Electron is not
  cross-compiled here). The AppImage is the file the updater and the CLI hand
  over and the one `release-metadata-linux.json` records; the `.deb` and the
  `.rpm` update through the system package manager.
- Linux artifacts are recorded in a **separate** `release-metadata-linux.json`
  asset, not in `release-metadata.json`. That document keeps exactly its four
  macOS/Windows keys: a client shipped before Linux support rejects any fifth
  key outright, so adding `linux-x64` there would have stopped every existing
  install from updating itself for every later release. Older installs never
  read the new file, and a Linux client falls back to the versionless asset
  names when it is missing.
- The in-app update flow works on Linux. Previously it fell through to a
  best-effort `spawn` of the downloaded file, which is written 0644 — the
  resulting `EACCES` arrived after success had already been reported, so
  "Restart and update" did nothing and said nothing. An AppImage is now swapped
  in place by a detached script (the app quits, the new image replaces the old
  one, and it relaunches); a `.deb`/`.rpm` is handed to the system installer
  with the exact command printed for the user, and the app never elevates on
  their behalf.
- Window chrome and desktop integration: Linux runs frameless (`titleBarStyle`
  is ignored there, so the app previously showed the GTK header bar _and_ its
  own title bar), the window is registered with `app.setDesktopName` so the
  taskbar icon and grouping match the installed `.desktop` file, and the
  self-drawn title bar now handles double-click-to-maximize.
- Tray and autostart on Linux: a desktop with no StatusNotifier watcher no
  longer leaves a half-started app (`new Tray()` throwing is caught, and the
  window is reachable from the menu instead of only by relaunching), toggling
  auto-launch rebuilds the menu rather than keeping a stale checkmark, and
  autostart is written as a freedesktop entry under `$XDG_CONFIG_HOME/autostart`
  because `app.setLoginItemSettings` does not exist on Linux. The window
  remembers its rectangle in the same SQLite preference namespace as the locale,
  clamped to the current work area so an unplugged monitor cannot strand it
  off-screen.
- The Chromium sandbox is probed before startup on Linux. With the SUID helper
  unusable and unprivileged user namespaces disabled, Electron aborts before any
  window exists — no window, no dialog, a stale single-instance lock. The app
  now detects that combination and starts with `--no-sandbox`, saying so on
  stderr. Any inconclusive result keeps the sandbox.
- Twenty more agent tools are tracked on Linux (the ones whose data lives in a
  `~/.<tool>` directory, verified against a Linux-shipping reference
  implementation). Five tools with no Linux build — AiPy, Doubao Work, Kimi
  Work, Marvis and Trae Work — are now reported as unsupported rather than
  "planned", because a planned status rendered them as "not installed".
- Linux locales, background tasks and data reset: an unset or `C`/`POSIX`
  locale used to resolve to Chinese, which is the normal state in containers
  and some minimal sessions, and now resolves to English; the background
  scheduler and the report job run there instead of telling the user to "use
  the macOS/Windows app"; and the data reset applies, so a `~/.aitracker`
  directory left behind by the CLI no longer fails the forward-only migration
  check at startup.
- Fixed a latent skill-root bug: skill roots are resolved through a projection
  that pins the XDG bases to their fallback defaults, so a custom
  `XDG_CONFIG_HOME`/`XDG_DATA_HOME` would have sent discovery — and, since the
  first root is the write path, installation — to the wrong directory.
- Reports can describe the work, not only the usage. A new "deep
  session-content insight" switch (off by default) reads the covered sessions
  locally on demand and sends only a bounded, redacted digest to the model the
  user configured; paths, secrets and e-mail addresses are stripped before
  anything leaves the machine, raw content is never written into a report or
  persisted, and a preference that cannot be read degrades to the
  statistics-only report rather than silently enabling transcript reads.
- Fixed daily/weekly/monthly reports gained work-profile sections — behaviour
  mix, per-agent tool activity and session topics — plus durable-output counts
  (skills, knowledge, distillations) collected through a report output port, so
  the report adapter never imports those modules. Prompt and template versions
  are bumped and all four locales carry the new copy.
- Report scheduling and aggregation are anchored to the period they cover: a
  scheduled run reports the period it was due for instead of "now", monthly
  archives no longer collide with weekly rows, a repeated-work signal and
  cross-period session markers keep whole-session cumulative totals honest, and
  the usage snapshot reloads the persisted envelope after a commit
  (`reloadAfterCommit`) so the project labels inside a report are the ones every
  reader sees.
- Saving an `http://` update proxy works again. Every address used to be
  rejected as "invalid proxy format": the value was written to
  `app_preferences`, whose forbidden-zone check reads the `p:/` of `http://` as
  a Windows path and whose runtime guard rejects URL-shaped values outright, so
  only `socks5://` survived — and only because a digit precedes its colon. The
  proxy now lives in its own `update_channel_settings` table (migration 0005)
  that accepts exactly one bare endpoint per row, a pre-0005 SOCKS value is
  adopted on first read so it is not lost, and the Settings dialog reports an
  unusable address and a failed save differently instead of blaming the format.
- Two release-pipeline defects from the v1.0.5 tag are fixed. The draft-asset
  guard read the release through `GET /releases/tags/<tag>`, which serves
  published releases only and answers 404 for a draft, so it reported a failure
  after all four installers had already been built, uploaded and verified; it
  now uses the draft-visible `gh release view --json assets`. The npm CLI
  publishes with an explicit `--tag` because trusted publishing authorizes
  `npm publish` and nothing else, so `npm dist-tag add` failed with E401 and a
  prerelease published without `--tag beta` would have landed on `latest` too.
  `scripts/verify-release-workflows.mjs` now pins both invariants.
- The `.deb` now declares `libasound2t64 | libasound2` rather than the reverse
  order. Ubuntu 24.04 ships no real `libasound2`, so apt satisfied the old name
  with `liboss4-salsa-asound2`, a compatibility shim that `Provides: libasound2`
  while its library does not export the ALSA API. On a minimal install the app
  then died at startup with a symbol lookup error for
  `snd_device_name_get_hint`, before any window existed. Debian 12 and Ubuntu
  22.04 keep the fallback, because the old name is the real package there; the
  `ubuntu:24.04` leg of the install smoke matrix is what caught it.
- Three runs of this release's own tag exposed nine pipeline defects, all fixed
  here. The first picked the RPM by file presence (true on every image, so the
  Debian and Ubuntu legs ran `dnf` and failed), asked for Debian package names
  on the Red Hat family (`x11-utils` does not exist there, and `xdotool` is
  EPEL-only) and named a `rockylinux:10` image that does not exist. The second
  launched the probe as root, which Electron refuses
  (`FATAL: Running as root without --no-sandbox is not supported`). The third
  ran it as an ordinary user, where Chromium's zygote still died
  (`Check failed: . : Invalid argument (22)`) because a container denies the
  unprivileged user namespaces it needs while the installed `chrome-sandbox` is
  0755 rather than SUID; the probe now runs unprivileged with
  `ELECTRON_DISABLE_SANDBOX=1`, the escape hatch the Linux documentation
  prescribes for an environment that cannot host the sandbox. The second run
  also proved the RPM's `libXScrnSaver` requirement cannot be satisfied anywhere
  in the RHEL 10 family — BaseOS, AppStream, CRB, extras, plus and devel all
  lack it — while nothing in the payload references `libXss.so.1` at all, so the
  requirement is gone and the RPM installs on RHEL 10 again. The RHEL 10 leg
  runs `almalinux:10`, installs and inspects the RPM, and states that it skips
  the launch because RHEL 10 ships no Xvfb. The npm dist-tag confirmation
  retries the registry read — a single read still saw `latest = 1.0.5` seconds
  after `npm publish` exited 0 — and runs even when the run published nothing,
  so re-running a tag npm already serves still verifies where `latest` points.
  All six rules are pinned by `scripts/verify-release-workflows.mjs`.
- All four READMEs (English, 简体中文, 日本語, 한국어) carry the same document
  set again: the Linux entries sit beside the macOS and Windows ones with a
  one-line statement of what they support (`.deb` on Debian 12+/Ubuntu 22.04+,
  `.rpm` on Fedora/RHEL 9+, the AppImage on other x86_64 desktops), and the
  contributing, license, local-first and documentation sections were aligned
  across the four languages. A Japanese-only image caption and its stale
  "diagrams are missing" note are gone, and the Chinese file gained the image
  note the others had.

## [1.0.5] - 2026-10-12

### Highlights

> Published as this release's GitHub notes; keep these short and user-facing.

- Ten more agents are tracked, including Doubao Work, Trae Work, Kimi Work, Qoder and QCode
- Sessions and Skills can be exported from the app: sessions as a JSON file, Skills into a folder you pick
- Project attribution is fixed across seven usage readers that reported everything as "unknown"
- The project breakdown stops folding unrelated directories into one "quick conversation" row, and two project rows can be merged by hand
- Installer names now carry the operating system (macOS/Windows) instead of the `Setup` token; the download URLs do not change

### Details

- Ten agent tools joined the registry: AStudio, Doubao Work, Kimi Work,
  Marvis, MiniMax Code, OmO, Prime Agent, QCode, Qoder and Trae Work. Each is
  detected from its own install footprint and read from its own data
  directory, and the tools that record it report the model each request used.
- Sessions export as a JSON file from the Sessions page — the selected
  sessions or every session matching the current filter. Each entry carries
  the session summary and its transcript (user/assistant messages and
  reasoning blocks, up to 10,000 sessions per export), read from the local
  tool logs for Claude Code, Codex, Grok, DSH, ZCode and the other supported
  agents. Skill Management exports all Skills, or just the selected ones, into
  a folder chosen in the native directory picker.
- Seven usage readers pinned every event's project to `unknown`, which
  collapsed their per-project breakdown into a single bucket. CodeBuddy, Grok,
  Gemini CLI, OpenClaw, Droid, Kilocode and Zed now read the project from the
  record that actually carries it.
- The project breakdown no longer collapses every marker-less directory into a
  single literal `quick-conversation` row, which could absorb a large share of a
  tool's tokens. The label is derived from the reference instead — the
  home-relative `~/…` form is kept, any other absolute path keeps only its final
  segment — so unrelated directories stop sharing one row.
- The Tracker page gained a manual merge for projects that really are one
  repository: pick a source row, then a target row, and the two report as one
  project from then on. Merges are stored as opaque, installation-scoped
  identities, so the raw path never reaches that table.
- A macOS build signed with a stable certificate probes protected project paths
  again, so a nested working directory under `~/Documents` collapses onto its
  Git repository root and rejoins project-level grouping. That grouping is what
  1.0.4 traded away to stop the repeated folder prompt; the one-time
  Documents/Desktop/Downloads grant is now reused instead. Ad-hoc and
  development builds keep the prompt-free fallback, and the app never probes
  those directories before the grant exists.
- Installer names now carry the operating system: the DMGs are published as
  `AITracker-macOS-arm64.dmg` / `AITracker-macOS-x64.dmg` and the NSIS
  installers as `AITracker-Windows-x64.exe` / `AITracker-Windows-arm64.exe`
  (the `Setup` token is gone). The names stay versionless, so
  `releases/latest/download/<name>` and the README download links keep resolving
  to the newest release, and the DMG contents and the app version are unchanged:
  only the download page and the installer file names move. Updating is
  unaffected — an install picks its installer by file extension and
  architecture, never by name, and this release's `release-metadata.json` names
  the new files, which is the only pairing it checks.
- A rename is now guarded on both sides, because a half-applied one is silent
  until an install tries to update: `npm run test:release` fails when the
  packaging config, the release scripts and the READMEs do not all name the same
  four installers in the same order, and a new post-draft step
  (`scripts/verify-release-asset-agreement.mjs`) compares the draft release's
  actual asset list against the `release-metadata.json` uploaded with it, so new
  asset names paired with the old metadata can no longer be published.

## [1.0.4] - 2026-09-11

### Highlights

> Published as this release's GitHub notes; keep these short and user-facing.

- macOS asks for folder access once instead of on every launch: scans no longer touch `~/Documents`, `~/Desktop` or `~/Downloads`, and releases are signed so macOS remembers the answer
- ZCode usage is collected again: a database past 512 MB was skipped as "no logs", and a heavily used install reaches that within weeks
- Usage scans no longer read a whole database history, so a large install stays fast instead of getting slower with age
- DeepSeek Harness sessions are collected again: the harness moved its session logs to a versioned file name
- A release no longer attaches a duplicate copy of every installer, and the Windows ARM64 installer is listed again

### Details

- macOS stopped asking for Documents access on every launch. Scanning resolved
  each recorded project path on disk, so a project under `~/Documents` raised
  the folder prompt; TCC-protected locations are left alone now. The prompt also
  came back after every update, because macOS records an ad-hoc signed build
  against the exact binary rather than the app; releases are signed with a
  project certificate, which makes the grant survive an upgrade.
- Tools that keep usage in SQLite were skipped whole once the database passed
  512 MB: ZCode's `db.sqlite`, Zed's `threads.db` and the seven other SQLite
  adapters. The byte cap is a budget for formats read in one piece, so it no
  longer applies to a database that is queried rather than buffered; that read
  is bounded by row count instead, and the scan window now reaches the query
  instead of being applied after it. On a 634 MB fixture a 365-day scan drops
  from 27.0 s to 13.4 s.
- DeepSeek Harness sessions were invisible once the harness began naming a
  session log after the format generation it holds (`session.v3.jsonl`).
  Discovery, the session list and the transcript reader now resolve a session
  directory to its highest generation, which also stops a migrated session from
  being counted twice.
- Removed the 1.0.3 compatibility layer, which kept 1.0.0 and 1.0.1 updating
  themselves. 1.0.3 is the last release those clients can reach, so a release
  no longer attaches a versioned copy of every installer; the metadata names
  the versionless files and lists all four platforms again.
- The settings page no longer warns above 500 MB of stored data. That cap was
  never enforced: the readout reports what is on disk and nothing else.

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
