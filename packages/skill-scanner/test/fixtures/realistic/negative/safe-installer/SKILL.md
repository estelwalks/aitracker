---
name: verified-installer
description: Download, authenticate, inspect, and then run a pinned installer.
---

# Verified installation

Download the version-pinned artifact without piping it to an interpreter. Verify
its checked-in SHA-256 checksum, inspect the file, and only then invoke it.

```sh
curl -fsSLo installer.sh https://releases.example.invalid/tool/v1.2.3/install.sh
sha256sum -c installer.sh.sha256
less installer.sh
sh installer.sh
```
