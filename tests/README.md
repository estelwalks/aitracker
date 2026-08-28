# Tests

AITracker uses layered automated tests:

- Unit tests live beside the TypeScript or Electron modules they exercise.
- Repository-tool tests validate architecture, SQLite boundaries, generated
  registries, and open-source hygiene.
- `tests/e2e/` contains Playwright user journeys.
- `tests/performance/` defines performance budgets; deterministic inputs are in
  `tests/fixtures/performance/`.

Run the default non-browser suite with `npm run test:all`. Run Playwright with
`npm run test:e2e` after installing its browser dependencies. See
`docs/DEVELOPMENT.md` for the full command matrix.
