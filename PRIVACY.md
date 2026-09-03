# AITracker privacy

AITracker is designed as a local-first desktop application. Core usage
analytics, Skills, Rules, knowledge, memories, and application preferences are
stored in a local SQLite database under the AITracker data directory (by
default `~/.aitracker`; platform-specific Electron data directories may be
used by the desktop shell). The application does not require an account.

## What the app reads

When enabled, the local usage scanners read supported AI-tool logs and local
configuration/Skill directories so they can calculate aggregate usage and
discover assets. The scanner stores normalized metadata and aggregates; raw
conversation content is not part of the renderer read models.

## When data leaves the computer

Network access is feature-driven rather than required for local analytics:

- the Skills Market and exchange-rate refreshes may contact the
  project-operated service at `https://ai.trusttools.cn/api`, the same
  developer-operated service that provides the Skills Market listings and
  downloads. The exchange-rate request asks only for the
  USD rate quoted in CNY, JPY, and KRW, and market requests carry only
  catalog parameters such as search terms, tags, pagination, and sort; no
  locally collected usage data, Skills or knowledge content, or account or
  session identifiers are included. These requests are identified with the
  User-Agent header `AITracker/<version> (Electron;
  +https://github.com/estelwalks/aitracker)`;
- when that service is unreachable or the machine is offline, AITracker
  falls back to local data: exchange-rate display keeps the last cached
  snapshot (a stale cache is still used while a background refresh runs, and
  failed refreshes keep the last-known-good values) or falls back to the
  built-in baseline rates shown as "fallback", while the Skills Market shows
  its most recent cached results;
- the optional update check reads the public GitHub releases API for this
  repository; and
- distillation, enhanced insights, or other model features send the selected
  input to the model provider configured by the user.

Provider requests are controlled by the local settings and may include the
text selected for that operation. Do not select sensitive material for a
remote provider unless you are comfortable with that provider's terms.

AITracker has no separate product analytics or advertising telemetry pipeline.
Any network failure is handled as a feature failure or fallback; local data
collection and browsing remain available where their inputs are local.

## Secrets and deletion

Provider credentials are kept in the local encrypted secret store and are not
written to source-controlled files or browser storage. To remove local data,
quit AITracker and delete its data directory after making any exports you
need. You can also remove saved providers and cached update/market data from
the application settings.

This document describes the behavior of the open-source repository. Review the
source and the privacy policy of any model or market provider you configure.
