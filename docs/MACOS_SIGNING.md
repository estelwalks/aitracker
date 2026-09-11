# macOS release signing

This document covers the one-time setup and the ongoing rules for signing
AITracker's macOS builds. It exists because signing is not only a Gatekeeper
concern: it decides whether the user's permission grants survive an upgrade.

## Why the signing identity matters

macOS TCC — the database behind every "…would like to access files in your
Documents folder" dialog — does not store *"this app is allowed"*. It stores a
**code requirement** (`csreq`) that the running binary must still satisfy, and
macOS derives that requirement from the app's signature:

| Signature | Stored requirement |
| --- | --- |
| ad-hoc (`codesign --sign -`) | `cdhash H"…"` |
| any certificate | `identifier "com.aitracker.desktop" and certificate leaf = H"…"` |

The ad-hoc form pins the grant to the **exact binary**. Every release produces a
new cdhash, so macOS treats it as a brand-new app and asks the user to grant
folder access again. The certificate form pins the grant to the certificate
instead, which is stable across every build signed with it.

A self-signed certificate anchors the requirement exactly as well as an
Apple-issued one, and needs no Apple Developer Program membership. This is the
same approach [yabai][yabai], [skhd][skhd] and [AeroSpace][aerospace] ship with.
The trade-off is unchanged from today: Gatekeeper still reports an unidentified
developer, because it only recognises Apple-issued certificates — so this is a
strict improvement with no new downside.

[yabai]: https://github.com/koekeishiya/yabai/wiki/Installing-yabai-(latest-release)#codesigning-yabai
[skhd]: https://github.com/koekeishiya/skhd
[aerospace]: https://github.com/nikitabobko/AeroSpace

`electron/after-pack.cjs` performs the re-sign and prints the resulting
requirement on every build, so a misconfiguration shows up in the build log
rather than on a user's machine.

## One-time setup

### Option A — the script (recommended)

```sh
npm run signing:create-cert
```

It generates a code-signing certificate valid for 10 years, installs it in the
login keychain, signs a probe binary to prove the identity works, and prints the
exact GitHub commands for the next section. The private key is written outside
the repository (default `~/aitracker-signing`); **never commit it**.

Useful flags:

```sh
npm run signing:create-cert -- --out <dir>          # where the key material goes
npm run signing:create-cert -- --name "<name>"      # keychain identity name
npm run signing:create-cert -- --keychain <path>    # install into a dedicated keychain
npm run signing:create-cert -- --force              # replace an existing identity
```

If it reports that `codesign cannot use its key`, either run a build once and
click **Always Allow** on the keychain prompt, or grant the item a codesign
partition:

```sh
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k <keychain-password> "$HOME/Library/Keychains/login.keychain-db"
```

### Option B — Keychain Access

1. Open **Keychain Access → Certificate Assistant → Create a Certificate…**
2. Name it `AITracker Self-Signed`, Identity Type **Self Signed Root**,
   Certificate Type **Code Signing**.
3. Tick **Override Defaults** and raise the validity period. The default is 365
   days; use 3650. *Do not skip this step* — see "Operating rules" below.
4. Export it together with its private key as a `.p12` (select both the
   certificate and the key, then **File → Export Items…**), and base64 it:
   `base64 -i certificate.p12 | tr -d '\n' > certificate.p12.base64`

The certificate must carry an `extendedKeyUsage` of **Code Signing**. Keychain
Access sets this from the Certificate Type; without it
`security find-identity -p codesigning` will not list the identity and the build
hook cannot find it.

## Configure the release workflow

The certificate is read from repository **secrets**; it is never committed.

```sh
gh secret set MAC_CSC_LINK < certificate.p12.base64   # the .p12, base64-encoded
gh secret set MAC_CSC_KEY_PASSWORD --body "<p12 password>"
gh variable set MAC_CSC_NAME --body "AITracker Self-Signed"
```

`release.yml` imports the certificate into a temporary keychain and then sets
`AITRACKER_REQUIRE_SIGNING=1`, which makes `electron/after-pack.cjs` **fail the
release** rather than publish an ad-hoc bundle when the certificate is
configured but unusable. Pull requests from forks never receive repository
secrets, so those builds fall back to ad-hoc and still succeed.

## Verify

Local build:

```sh
npm run dist:mac:arm64
codesign -d -r- release/mac-arm64/AITracker.app
```

The requirement must read `identifier "com.aitracker.desktop" and certificate
leaf = H"…"`. If it reads `cdhash`, the certificate was not used.

The build log prints two lines that answer the same question:

```
[after-pack] signing with "AITracker Self-Signed"
[after-pack] designated requirement (what macOS TCC will store): identifier "com.aitracker.desktop" and certificate leaf = H"…"
```

## Operating rules

- **Back up `key.pem` and the password.** Losing the key means issuing a new
  certificate, and a new certificate has a new leaf hash — every user has to
  grant folder permissions again.
- **Keep the validity long.** Expiry forces the same re-issue. The setup script
  uses 3650 days for this reason.
- **Never rotate casually.** Rotate only for an actual key compromise, and
  expect the one-time re-grant described below.
- **Treat the `.p12` as a secret.** Anyone holding the key can produce a binary
  that satisfies the same requirement and therefore inherits the permissions
  users already granted to AITracker. The certificate is not in the trust chain,
  so they cannot impersonate a *trusted* developer — but the inherited grant is
  real.
- **Windows** uses a separate Authenticode certificate; this document does not
  cover it.

## When the certificate is issued or rotated

Existing installations keep their old record, which no longer matches. Users
upgrade once, are asked for folder access one final time, and are then stable
for the life of the new certificate. A clean re-grant can be forced with:

```sh
tccutil reset SystemPolicyDocumentsFolder com.aitracker.desktop
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `the app never requests…` no prompt, but project grouping is missing | Working as designed: the scanner skips TCC-protected paths. See `src/lib/local-usage/project-path.server.ts`. |
| `security import` → "MAC verification failed … (wrong password?)" | OpenSSL 3 PKCS#12 MAC. Export with `-legacy` (the script does). |
| `security find-identity -v -p codesigning` shows nothing | `-v` filters out untrusted self-signed roots. Drop `-v`. |
| `codesign` → "The specified item could not be found in the keychain" | The keychain is not on the search list, or the key lacks a codesign partition. |
| Build log says `signing ad-hoc` while secrets are set | `CSC_NAME` does not match the keychain identity name; the log above it says so. |
| Release failed with `AITRACKER_REQUIRE_SIGNING is set` | Exactly the intended guard: the certificate was configured but not found or not usable. |

## Related

- `docs/RELEASE_CHECKLIST.md` — the human release procedure.
- `electron/after-pack.cjs` — identity selection, re-sign, requirement check.
- `scripts/create-mac-signing-certificate.mjs` — the setup script.
