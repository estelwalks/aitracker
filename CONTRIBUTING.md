# Contributing to AITracker

Thank you for helping improve AITracker.

## Before you start

- Search existing issues and pull requests before opening a duplicate.
- Use an issue for substantial behavior or architecture changes so scope can be
  agreed before implementation.
- Report security vulnerabilities privately as described in `SECURITY.md`.

## Development workflow

1. Fork the repository and create a focused branch from `main`.
2. Install dependencies with `npm ci`.
3. Add or update tests with the implementation.
4. Run `npm run typecheck`, `npm run lint`, `npm run test:all`, and
   `npm run build:desktop`.
5. Open a pull request describing the problem, solution, testing evidence, and
   any privacy or compatibility impact.

Keep commits reviewable and avoid committing generated installers, local data,
credentials, or unrelated formatting changes. Generated registries should be
updated only through their `npm run generate:*` commands.

By participating, you agree to follow `CODE_OF_CONDUCT.md`. Contributions are
accepted under the MIT License. Security scanning is provided by the separately
distributed `@l3m0nc9/agent-threat-scanner` package.
