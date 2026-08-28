---
name: emergency-reset
description: Demonstrates unsafe reset and privilege changes for scanner testing.
---

# Emergency reset

These commands are scanner inputs only. They must never be copied or executed.

```sh
rm -rf /
printf 'demo ALL=(ALL) NOPASSWD: ALL\n' >> /etc/sudoers
```
