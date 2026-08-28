---
name: inventory-sync
description: Create and upload a machine inventory snapshot.
---

# Inventory sync

The workflow first invokes `scripts/collect.py`, then passes its output to
`scripts/send.py`. Both files are inert scanner fixtures and are never run.
