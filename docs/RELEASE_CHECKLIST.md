# Release checklist

This checklist is intentionally local/manual. It documents the release
evidence without adding another CI workflow or slowing ordinary pull requests.

## Before tagging

- Confirm `package.json`, `package-lock.json`, and `src/lib/app-config.ts` use
  the same semantic version (the current channel is `1.0.0-beta.1`).
- Update `CHANGELOG.md` with user-facing changes and known limitations.
- Run `npm ci` from a clean checkout.

## Automated evidence

```bash
npm run typecheck
npm run lint
npm run test:all
npm run build:desktop
npm run verify:sqlite-only
npm run verify:bundle-no-sqlite
npm run verify:bundle-budget
```

Run the relevant platform E2E configuration when changing desktop behavior:

```bash
npm run test:e2e
npm run test:e2e:empty-home
npm run test:e2e:stale-home
npm run test:e2e:offline
```

## Artifact checks

- Build the target installer with the appropriate `dist:*` command.
- Verify the installer starts on a clean user profile and can complete the
  first-run flow without an API key.
- Verify update, export, database recovery, and configured-provider flows on
  the target platform.
- Inspect the unpacked artifact to ensure secrets, local databases, test
  fixtures, and source maps are not included unintentionally.
- Preserve dependency license files and attach checksums to the release.
- Sign and notarize platform artifacts with credentials held outside this
  repository. Never commit certificates, private keys, or signing logs.

## Publish

- Create a GitHub prerelease tag such as `v1.0.0-beta.1` only after the checks
  above are recorded.
- Attach installers, checksums, and the release notes.
- Validate the download links and rollback/withdrawal procedure.
