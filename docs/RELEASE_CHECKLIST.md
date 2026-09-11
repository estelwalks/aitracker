# Release checklist

This checklist is intentionally local/manual. It documents the release
evidence without adding another CI workflow or slowing ordinary pull requests.

## Changelog convention

- Work in progress always goes under `## [Unreleased]`. A numbered section
  (`## [X.Y.Z] - YYYY-MM-DD`) means that version is released.
- Both the numbered section and the version bump belong to the **release
  branch**, not to the feature branch that produced the change and not to the
  pull request. A feature branch adds its entry under `[Unreleased]` and stops
  there; retitling the section, bumping `package.json`,
  `package-lock.json` and `packages/cli/package.json`, and tagging are one
  atomic act on that branch, which is why `main` can legitimately declare a
  version whose section does not exist yet.
- Preparing a release moves the whole `[Unreleased]` body into the new numbered
  heading and recreates `[Unreleased]` empty; nothing is left behind under the
  old heading.
- A numbered section for a version with no tag is a bug, not staging: it reads
  as shipped while the newest published version is older. Do not open one to
  "reserve" a version.
- `scripts/changelog-release-notes.test.mjs` enforces the shape without naming
  a version, so it does not need editing per release: `[Unreleased]` carries no
  date, every other heading is dated and extractable, and any version listed is
  not newer than the one being prepared. The release job then extracts the
  tag's section, so a tag whose section is missing or blank fails instead of
  publishing empty notes.

## Before tagging

- Confirm `package.json`, `package-lock.json`, and `packages/cli/package.json`
  use the same semantic version. `src/lib/app-config.ts` reads the version from
  the root `package.json`, so there is no separate constant to edit.
- Update `CHANGELOG.md` with user-facing changes and known limitations, and put
  the short summary users should read in a `### Highlights` sub-section at the
  top of the entry; everything below it (`### Details`) stays in the changelog.
  The release workflow publishes the Highlights list as the GitHub release
  notes, falling back to the whole section when a version has none, and fails
  the tag when the section or an empty Highlights heading would ship blank
  notes — preview it locally with
  `npm run release:notes -- --version <version> --output -`.
- Keep the release page short: it is an update summary plus a pointer to the
  README for install commands, not a second copy of the documentation. The
  workflow appends only a short `## Download` section, so anything longer
  differs per release and belongs in the changelog.
- Check the `publish-npm` workflow finished for the tag. It publishes
  `packages/cli` to npm and moves the `latest`/`beta` dist-tag, which is what
  `npx --yes @estelwalks/aitracker@latest` documents; it needs the repository
  secret `NPM_TOKEN` (an npm automation token with publish access for the
  `@estelwalks` scope) and reports a missing secret as a clear failure. Rerun it
  by hand with `gh workflow run publish-npm.yml -f version=<version>`; the job
  is idempotent and skips a version npm already serves.
- Run `npm ci` from a clean checkout.
- Run the release contract gate against the exact tag:
  `npm run verify:release-contract -- --tag v<version> --channel <stable|beta>`.
- Confirm the installer names are still versionless and that the READMEs match:
  `npm run verify:release-artifact-names` pins `electron-builder.yml` and the
  release scripts to `AITracker-arm64.dmg`, `AITracker-x64.dmg`,
  `AITracker-Setup-x64.exe`, `AITracker-Setup-arm64.exe`;
  `npm run verify:readme-release-links` then confirms the install links in
  `README.md`, `docs/README_CN.md`, `docs/README_JA.md` and `docs/README_KO.md`
  use `/releases/latest/download/<name>` for exactly those four. A `${version}`
  in an artifact name would silently break every one of those URLs, so the
  guard fails on it. The `npx` examples in the READMEs still carry the current
  version.

## Automated evidence

```bash
npm run typecheck
npm run lint
npm run test:all
npm run build:desktop
npm run verify:sqlite-only
npm run verify:bundle-no-sqlite
npm run verify:bundle-budget
npm run test:release
npx prettier --check README.md CHANGELOG.md docs/RELEASE_CHECKLIST.md
```

Run the relevant platform E2E configuration when changing desktop behavior:

```bash
npm run test:e2e
npm run test:e2e:empty-home
npm run test:e2e:stale-home
npm run test:e2e:offline
```

## Artifact checks

- Build the target installer with the appropriate `dist:*` command. Experimental
  beta releases may remain unsigned; stable releases must be signed and
  notarized/smoke-tested for the target platform.
- For Phase 1, confirm the target set is macOS x64/arm64 and Windows
  x64/arm64; Linux is out of scope. Keep the beta channel separate from stable.
- The tag-triggered [unsigned release workflow](../.github/workflows/release.yml)
  runs the version and README-link gates first, builds the four installers on
  platform runners, verifies their electron-builder names, and generates
  `release/release-metadata.json` plus `release/checksums.txt`.
- The workflow creates a draft release and uploads assets without the clobber
  option. If the tag, link or build gate fails, the draft-release job is not
  run and no release is published. An existing release name is refused rather
  than overwritten.
- Installer names carry no version, which is what makes
  `/releases/latest/download/<name>` — the URL the READMEs, the desktop updater
  and the CLI resolve — keep working release after release. The compatibility
  window that required a second, versioned copy of every installer closed at
  1.0.3 (see the changelog): a release now attaches exactly four installers.
  The app version is unaffected: it lives in `package.json` → `app.asar`'s
  Info.plist, and `release-metadata.json` records `appVersion`/`gitTag`.
- `release-metadata.json` lists exactly four platforms (macOS arm64/x64,
  Windows x64/arm64) and each record must keep its `name`, `url`, `sha256` and
  `size`, with the bytes matching. Adding a platform key strands every install
  older than the release that introduces it, because those clients reject a
  document carrying a key they do not know.
- Because installers repeat across releases, each release keeps its own copies;
  GitHub resolves them per release and `releases/latest/download/<name>` always
  lands on the newest one.
- Prepare local release metadata from the exact files in `release/`:
  `node scripts/release-metadata.mjs --release-dir release --version
<version> --channel <stable|beta> --output release/release-metadata.json`. This
  is a local generation step, not evidence that metadata has been published.
  The artifact URLs it records are versionless
  (`releases/latest/download/<name>`), so the record pins the build through
  `appVersion`/`gitTag` plus sha256 and size rather than through the URL.
- Inspect and create the CLI tarball locally with `npm pack ./packages/cli
--dry-run --pack-destination release/cli` and, after review, `npm pack
./packages/cli --pack-destination release/cli`. Do not publish it from this
  checklist.
- Generate the Cask for the channel being released from that metadata with
  `node scripts/generate-homebrew-cask.mjs --metadata
release/release-metadata.json --channel <stable|beta> --token
<aitracker|aitracker-beta> --output release/<aitracker|aitracker-beta>.rb`,
  then run `brew style` and `brew audit --cask` on the generated file when the
  local Tap checkout is available. Never hand-copy a URL or hash. The generated
  Cask pins `version` and both `sha256` values and skips livecheck, because a
  livecheck reading the versionless URL could never find the current version.
- Run the CLI resolver in dry-run mode:
  `npx --no-install @estelwalks/aitracker@<channel> --dry-run`; confirm it
  offers only that channel's installers and does not download or open an
  installer.
- Verify the installer starts on a clean user profile and can complete the
  first-run flow without an API key.
- Verify update, export, database recovery, and configured-provider flows on
  the target platform.
- Inspect the unpacked artifact to ensure secrets, local databases, test
  fixtures, and source maps are not included unintentionally.
- Preserve dependency license files: the `afterPack` hook
  (`electron/after-pack.cjs`) runs `scripts/copy-license-files.mjs` on every
  package, copying each production dependency's LICENSE/NOTICE/COPYING files
  into `<app>/Contents/Resources/licenses/<package>/` (macOS) or
  `<unpacked>/resources/licenses/<package>/` (Windows). Manually verify the
  `licenses` folder exists in the unpacked artifact and includes
  `@estelwalks/agent-threat-scanner`'s LICENSE and NOTICE before publishing.
- Attach checksums to the release.
- macOS builds are re-signed by `electron/after-pack.cjs` with the project's
  self-signed certificate whenever the `MAC_CSC_LINK` secret is configured (see
  docs/MACOS_SIGNING.md). Verify the build log reports
  `designated requirement … certificate leaf = H"…"` and not `cdhash`, and
  confirm the unpacked bundle with `codesign -d -r-`. Without that certificate
  the build falls back to ad-hoc, which makes users re-grant folder permissions
  after every release — acceptable for a beta, not for stable.
- Notarization is still not performed, so document the expected Gatekeeper
  prompt for users and never instruct them to disable system-wide security
  protections. Never commit certificates, private keys, or signing logs.

## Publish

- The workflow's draft Release is not a publication approval. An authorized
  maintainer must manually inspect the exact tag, the four versionless
  installers, `release-metadata.json`, and `checksums.txt`, then publish the
  draft only after the above evidence is recorded.
- After publishing, verify the README links resolve to the new release, for
  example
  `curl -sIL -o /dev/null -w '%{http_code} %{url_effective}\n'
https://github.com/estelwalks/aitracker/releases/latest/download/AITracker-arm64.dmg`
  should end on the new tag's asset URL, not the previous release's.
- This workflow does not publish npm packages, create or update a Homebrew Tap,
  or notarize macOS builds. The only external credentials it reads are the
  optional macOS signing secrets documented in docs/MACOS_SIGNING.md, and no
  credential is ever stored in this repository.
- Do not advertise a stable install command until a signed stable build and the
  official Homebrew Cask are available.
