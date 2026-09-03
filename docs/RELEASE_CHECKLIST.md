# Release checklist

This checklist is intentionally local/manual. It documents the release
evidence without adding another CI workflow or slowing ordinary pull requests.

## Before tagging

- Confirm `package.json`, `package-lock.json`, and `src/lib/app-config.ts` use
  the same semantic version (the current channel is `1.0.0-beta.1`).
- Update `CHANGELOG.md` with user-facing changes and known limitations.
- Run `npm ci` from a clean checkout.
- Run the release contract gate against the exact beta tag. It checks that the
  root and CLI package versions match and that the tag/channel are consistent:
  `npm run verify:release-contract -- --tag v1.0.0-beta.1 --channel beta`.

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
- For Phase 1, confirm the target set is macOS x64/arm64 and Windows x64;
  Linux is out of scope. Keep the beta channel separate from stable.
- The tag-triggered [unsigned beta release workflow](../.github/workflows/release.yml)
  runs the version gate first, builds the three installers on platform
  runners, verifies their electron-builder names, and generates
  `release/release-metadata.json` plus `release/checksums.txt`.
- The workflow creates a draft prerelease and uploads assets without the
  clobber option. If the tag or build gate fails, the draft-release job is not
  run and no formal/stable channel is published. An existing release name is
  refused rather than overwritten.
- Prepare local release metadata from the exact files in `release/`:
  `node scripts/release-metadata.mjs --release-dir release --version
1.0.0-beta.1 --channel beta --output release/release-metadata.json`. This is
  a local generation step, not evidence that metadata has been published.
- Inspect and create the CLI tarball locally with `npm pack ./packages/cli
--dry-run --pack-destination release/cli` and, after review, `npm pack
./packages/cli --pack-destination release/cli`. Do not publish it from this
  checklist.
- Generate the beta Cask from that metadata with `node
scripts/generate-homebrew-cask.mjs --metadata release/release-metadata.json
--channel beta --token aitracker-beta --output release/aitracker-beta.rb`,
  then run `brew style release/aitracker-beta.rb`
  and `brew audit --cask release/aitracker-beta.rb` when the local Tap checkout
  is available. Never hand-copy a URL or hash.
- Run the CLI resolver in dry-run mode: `npx --no-install aitracker@beta
--dry-run`; confirm it selects only the beta channel and does not download or
  open an installer.
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
- For stable releases, sign platform artifacts and notarize macOS artifacts
  with credentials held outside this repository. For unsigned beta releases,
  document the expected Gatekeeper/SmartScreen prompt and never instruct users
  to disable system-wide security protections. Never commit certificates,
  private keys, or signing logs.

## Publish

- The workflow's draft Release is not a publication approval. An authorized
  maintainer must manually inspect the exact tag, three installers,
  `release-metadata.json`, and `checksums.txt`, then publish the draft only
  after the above evidence is recorded. Keep it marked as a prerelease beta.
- This workflow does not publish npm packages, create or update a Homebrew Tap,
  sign artifacts, or notarize macOS builds. No external credentials should be
  added to this repository.
- Do not advertise a stable install command until a signed stable build and the
  official Homebrew Cask are available.
