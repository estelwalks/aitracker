# Development Guide

This guide describes how to build, test, and package AITracker from a clean
checkout.

## Repository layout

| Path                            | Purpose                                                         |
| ------------------------------- | --------------------------------------------------------------- |
| `src/`                          | TanStack Start application and shared product modules           |
| `electron/`                     | Desktop process, preload bridge, tray, and native integration   |
| `@estelwalks/agent-threat-scanner` | Published npm package used by security scanning                 |
| `scripts/`                      | Code generation, validation, packaging, and performance tooling |
| `tests/e2e/`                    | Playwright end-to-end scenarios                                 |
| `tests/fixtures/`               | Versioned deterministic test fixtures                           |
| `tests/performance/`            | Performance budgets and scenarios                               |
| `build/`                        | Electron packaging inputs plus ignored generated bundles        |
| `public/`                       | Static assets copied into the web application                   |
| `.github/`                      | CI and collaboration templates                                  |

## Install

Use Node.js 24 or later. The version used by CI is recorded in `.nvmrc`.

```bash
nvm use
npm ci
```

`npm ci` installs the published scanner package and Electron. No API key is
required for local-only features or automated tests.

## Development

```bash
npm run dev             # Browser development server
npm run dev:desktop     # Browser server plus Electron shell
```

The first-run lab uses an isolated, ignored home directory:

```bash
npm run dev:desktop:first-run
```

The lab helpers prepare and seed that throwaway home separately:

```bash
npm run lab:first-run:prepare   # generate the isolated lab home
npm run lab:first-run:seed      # seed the isolated lab home
```

## Quality checks

| Command                            | Scope                                                  |
| ---------------------------------- | ------------------------------------------------------ |
| `npm run typecheck`                | App and Electron TypeScript contracts                  |
| `npm run lint`                     | App lint rules                                         |
| `npm run test:unit`                | App, Electron, and tests/unit tests                    |
| `npm run test:scripts`             | Repository validation tooling                          |
| `npm run test:database`            | SQLite migrations, repositories, recovery, and privacy |
| `npm run test:scanner`             | Published scanner import and CLI smoke tests           |
| `npm run test:e2e`                 | Playwright end-to-end tests (default config)           |
| `npm run test:e2e:empty-home`      | E2E resilience scenarios with an empty usage home      |
| `npm run test:e2e:stale-home`      | E2E resilience scenarios with a seeded stale home      |
| `npm run test:e2e:offline`         | E2E offline-exchange-rate resilience scenario          |
| `npm run test:route-performance`   | Route open-performance budget spec                     |
| `npm run test:all`                 | All non-E2E automated test suites                      |
| `npm run check:opensource-hygiene` | Paths, credentials, and legacy-name scan               |

Run focused checks while developing, then run `npm run test:all`,
`npm run typecheck`, `npm run lint`, and `npm run build:desktop` before opening
a pull request.

## Generated files

Generated application bundles belong in `.output/`, `build/electron/`,
`dist/`, `out/`, or `release/`; these paths are ignored and must not be
committed. Native tray assets under `public/build/` are intentional source
assets and are versioned.

The generated TypeScript registries and route tree are committed because CI
verifies that they match their source definitions. Regenerate them through the
corresponding `npm run generate:*` command; do not edit them manually.

Performance fixtures under `tests/fixtures/performance/` are deterministic and
versioned so benchmarks are reproducible. Rebuild them with
`npm run perf:fixtures` when their schema changes. The 10x performance fixture
is intentionally generated on demand and ignored by Git; both
`npm run perf:benchmark` and `npm run verify:read-model-budgets` regenerate it
before running.

## Packaging

```bash
npm run build:desktop
npm run dist:mac
npm run dist:win:x64
```

Before packaging or tagging, run the release contract gate. It reads the root
and CLI package manifests, requires matching strict semantic versions, and
prints the three electron-builder artifact names. `--tag` and `--channel` are
optional for local checks; `--release-dir` additionally requires all three
installers to be present:

```bash
npm run verify:release-contract
npm run verify:release-contract -- --tag v1.0.0-beta.1 --channel beta
npm run verify:release-contract -- --tag v1.0.0-beta.1 --channel beta \
  --release-dir release
```

The tag-triggered [unsigned beta release workflow](../.github/workflows/release.yml)
uses Node 24 and `npm ci` to build macOS arm64/x64 and Windows x64 installers.
It runs the same gate before packaging, assembles the installers, and creates
only a GitHub draft prerelease with metadata and checksums. It does not sign or
notarize artifacts, publish npm packages, or update a Homebrew Tap. A
maintainer must inspect the draft, installers, metadata, and checksums before
manually publishing it; a failed workflow does not publish a formal/stable
release channel.

Unsigned local packages are suitable for testing. Phase 1 is limited to an
unsigned beta for macOS x64/arm64 and Windows x64. The CLI tarball, release
metadata, and Cask generator are release-tooling inputs and are not yet
published to npm or a Tap by this checkout. When those local tools are
available, the expected dry-run sequence is:

```bash
# Build local installers, then generate one local source of release metadata.
npm run dist:mac
npm run dist:win:x64
node scripts/release-metadata.mjs --release-dir release \
  --version 1.0.0-beta.1 --channel beta \
  --output release/release-metadata.json

# Inspect/package the CLI without publishing it.
npm pack ./packages/cli --dry-run --pack-destination release/cli
npm pack ./packages/cli --pack-destination release/cli

# Generate the beta Cask from metadata; do not copy URLs or hashes by hand.
node scripts/generate-homebrew-cask.mjs \
  --metadata release/release-metadata.json --channel beta \
  --token aitracker-beta --output release/aitracker-beta.rb

# Validate CLI selection without downloading or opening an installer.
npx --no-install aitracker@beta --dry-run

# Download and verify without opening; the directory is retained.
npx --no-install aitracker@beta --download-only release/downloads
```

`--download-only` without a directory remains the legacy temporary-directory
mode. With a directory, the CLI creates a real directory when needed and saves
the verified installer under its safe metadata filename. It refuses empty or
repeated arguments, filesystem roots, symlink directories, and existing target
files; failed downloads clean up only files created by that invocation.

The metadata and Cask commands above are local-only and do not publish
anything. The CLI package and release artifacts must exist before running the
tarball and resolver checks. A local Homebrew validation, when the generated
Cask and Tap checkout are present, is
`brew style release/aitracker-beta.rb` followed by
`brew audit --cask release/aitracker-beta.rb`. No npm/GitHub publication or CI
release credentials are assumed here.

Stable public releases require platform signing, macOS notarization, checksum,
and manual smoke-test evidence. Never commit signing certificates, API keys,
local databases, or user session data. Do not disable global security
protections to test an unsigned beta.

## Release gates

The SQLite-only persistence and public-bundle privacy audits are blocking in
CI and must pass before publishing an installer:

```bash
npm run build
npm run verify:sqlite-only
npm run verify:bundle-no-sqlite
```

The build prunes unreachable server implementation chunks from
`.output/public`; do not weaken or remove that step or either audit.

For the complete human release procedure, including signing, notarization,
checksums, and smoke tests, see [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md).
