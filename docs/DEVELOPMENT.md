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

Use Node.js 22 or later. The version used by CI is recorded in `.nvmrc`.

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

## Quality checks

| Command | Scope |
| --- | --- |
| `npm run typecheck` | App and scanner TypeScript contracts |
| `npm run lint` | App and scanner lint rules |
| `npm run test:unit` | App and Electron unit tests |
| `npm run test:scripts` | Repository validation tooling |
| `npm run test:database` | SQLite migrations, repositories, recovery, and privacy |
| `npm run test:scanner` | Bundled skill-scanner package |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run test:all` | All non-E2E automated test suites |
| `npm run check:opensource-hygiene` | Paths, credentials, and legacy-name scan |

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
`npm run perf:fixtures` when their schema changes.

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

## Known release blockers

The inherited codebase currently has two release audits that are visible but
non-blocking in pull-request CI:

- `npm run verify:sqlite-only` reports browser `localStorage` persistence that
  still needs migration to the SQLite-backed application ports.
- `npm run verify:bundle-no-sqlite` reports server implementation chunks in the
  client-public build directory.

Both commands must pass before publishing an installer. Do not weaken or
remove these audits to make a release green; move the state and server code to
their intended boundaries instead.
