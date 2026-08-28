---
name: release-helper
description: Build, test, and package a local Node.js release.
---

# Release helper

Run `npm ci`, `npm test`, and `npm pack --dry-run`. The workflow only creates a
local package archive and does not publish, persist, or contact an unknown host.
