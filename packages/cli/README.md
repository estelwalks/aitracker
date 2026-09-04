# aitracker

The standalone `npx` launcher for AITracker desktop releases. It is a thin
Node.js launcher; it does not contain or copy the Electron application.

```bash
npx @estelwalks/aitracker                 # use this CLI's default channel
npx @estelwalks/aitracker --channel stable
npx @estelwalks/aitracker 1.0.0          # exact release
npx @estelwalks/aitracker --version 1.0.0 --channel stable
npx @estelwalks/aitracker --dry-run       # resolve and print, without downloading installer
npx @estelwalks/aitracker --download-only # download and verify in a temporary directory
npx @estelwalks/aitracker --download-only ./downloads # save verified installer in ./downloads
npx @estelwalks/aitracker --download-only=./downloads # equivalent directory form
```

The CLI supports macOS arm64/x64 and Windows x64. Linux and unsupported
architectures are rejected; the installer is selected from the public GitHub
Release metadata, streamed with a 30-minute total timeout and a two-minute
no-progress timeout, and verified with its SHA-256 and byte size before it is
opened. During a download, the CLI reports percentage, transferred size, and
current speed. Set `AITRACKER_DOWNLOAD_TIMEOUT_MS` or
`AITRACKER_DOWNLOAD_IDLE_TIMEOUT_MS` to override the defaults (up to 24 hours).

`--download-only` without a directory keeps the legacy behavior: it downloads
and verifies the installer, does not open it, and removes the temporary file
when the command exits. When a directory is supplied, the directory is created
if needed and the installer is saved there under the release-provided safe
filename. Existing target files, symlink directories, filesystem roots, empty
directory arguments, and repeated `--download-only` options are rejected; a
failed download removes only a file created by that invocation.

The first channel is an unsigned beta. macOS Gatekeeper or Windows
SmartScreen may show a warning when the installer is opened. Verify the
release source and checksum and use the operating system's normal per-file
confirmation flow if you choose to continue. Do not disable global security
settings.
