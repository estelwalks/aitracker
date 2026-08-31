# Tests

AITracker uses layered automated tests:

- Unit tests live beside the TypeScript or Electron modules they exercise.
- `tests/unit/` holds unit tests that cannot live beside their subject:
  route-level structural checks (`tests/unit/routes/`) and tests that were
  historically placed in `src/routes/` with a `-` prefix to dodge file-based
  routing.
- Repository-tool tests validate architecture, SQLite boundaries, generated
  registries, and open-source hygiene.
- `tests/e2e/` contains Playwright user journeys.
- `tests/performance/` defines performance budgets; deterministic inputs are in
  `tests/fixtures/performance/`.

Run the default non-browser suite with `npm run test:all`. Run Playwright with
`npm run test:e2e` after installing its browser dependencies (dedicated
resilience scenarios use `npm run test:e2e:empty-home`, `test:e2e:stale-home`,
and `test:e2e:offline`). See `docs/DEVELOPMENT.md` for the full command matrix.
