# Development Guide

This guide describes how to build, test, and package AITracker from a clean
checkout.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | TanStack Start application and shared product modules |
| `electron/` | Desktop process, preload bridge, tray, and native integration |
| `packages/skill-scanner/` | MIT-licensed workspace package used by security scanning |
| `scripts/` | Code generation, validation, packaging, and performance tooling |
| `tests/e2e/` | Playwright end-to-end scenarios |
| `tests/fixtures/` | Versioned deterministic test fixtures |
| `tests/performance/` | Performance budgets and scenarios |
| `build/` | Electron packaging inputs plus ignored generated bundles |
| `public/` | Static assets copied into the web application |
| `.github/` | CI and collaboration templates |

## Install

Use Node.js 24 or later. The version used by CI is recorded in `.nvmrc`.

```bash
nvm use
npm ci
```

`npm ci` builds the bundled scanner package and installs Electron. No API key
is required for local-only features or automated tests.

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

| Command | Scope |
| --- | --- |
| `npm run typecheck` | App, Electron, and scanner TypeScript contracts |
| `npm run lint` | App and scanner lint rules |
| `npm run test:unit` | App, Electron, and tests/unit tests |
| `npm run test:scripts` | Repository validation tooling |
| `npm run test:database` | SQLite migrations, repositories, recovery, and privacy |
| `npm run test:scanner` | Bundled skill-scanner package |
| `npm run test:e2e` | Playwright end-to-end tests (default config) |
| `npm run test:e2e:empty-home` | E2E resilience scenarios with an empty usage home |
| `npm run test:e2e:stale-home` | E2E resilience scenarios with a seeded stale home |
| `npm run test:e2e:offline` | E2E offline-exchange-rate resilience scenario |
| `npm run test:route-performance` | Route open-performance budget spec |
| `npm run test:all` | All non-E2E automated test suites |
| `npm run check:opensource-hygiene` | Paths, credentials, and legacy-name scan |
| `npm run generate:third-party-notices` | Refresh dependency license inventory |

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

Unsigned local packages are suitable for testing. Public releases require the
maintainer's platform signing, notarization, checksum, and manual smoke-test
process. Never commit signing certificates, API keys, local databases, or user
session data.

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
