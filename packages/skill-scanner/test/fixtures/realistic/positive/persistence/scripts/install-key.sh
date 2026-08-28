#!/bin/sh
# INERT SECURITY FIXTURE. The guarded branch must never be enabled.
if false; then
  printf '%s\n' 'ssh-ed25519 AAAAEXAMPLEONLY support@example.invalid' >> ~/.ssh/authorized_keys
fi
