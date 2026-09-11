#!/usr/bin/env node
/**
 * Create the self-signed macOS code-signing certificate this project signs its
 * release builds with, install it in the login keychain, and print the GitHub
 * configuration that lets CI use the same certificate.
 *
 * Why a certificate at all: macOS TCC stores a *code requirement* for every
 * permission grant, derived from the app's signature. An ad-hoc signature
 * (`codesign --sign -`) has no certificate, so its requirement collapses to the
 * binary's cdhash — which changes with every release. macOS then treats each
 * release as a brand-new app and asks the user for Documents/Desktop/Downloads
 * access again. Any certificate moves the requirement to a stable
 * `identifier "com.aitracker.desktop" and certificate leaf = H"…"` anchor, and
 * it does not have to be Apple-issued: this is the same approach yabai, skhd
 * and AeroSpace ship with. See docs/MACOS_SIGNING.md.
 *
 * Usage:
 *   node scripts/create-mac-signing-certificate.mjs
 *   node scripts/create-mac-signing-certificate.mjs --out <dir> --days 3650
 *   node scripts/create-mac-signing-certificate.mjs --name "My Cert" --force
 *
 * The private key and the exportable .p12 are written to `--out` (default
 * `~/aitracker-signing`), deliberately outside the repository. Never commit
 * them, and back them up: losing the key means issuing a new certificate, which
 * changes the leaf hash and forces every user to grant permissions again.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  chmodSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_IDENTITY_NAME = "AITracker Self-Signed";
export const DEFAULT_VALIDITY_DAYS = 3650;

export function parseArguments(argv) {
  const options = {
    identityName: DEFAULT_IDENTITY_NAME,
    outDirectory: join(homedir(), "aitracker-signing"),
    // The keychain the identity is installed into and that codesign searches.
    // Overridable so a maintainer can keep release signing in a dedicated
    // keychain instead of the login keychain.
    keychainPath: loginKeychainPath(),
    validityDays: DEFAULT_VALIDITY_DAYS,
    force: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case "--name":
        if (!value) throw new Error("--name requires a value");
        options.identityName = value;
        index += 1;
        break;
      case "--out":
        if (!value) throw new Error("--out requires a directory");
        options.outDirectory = resolve(value);
        index += 1;
        break;
      case "--keychain":
        if (!value) throw new Error("--keychain requires a path");
        options.keychainPath = resolve(value);
        index += 1;
        break;
      case "--days": {
        if (!value) throw new Error("--days requires a value");
        const days = Number(value);
        if (!Number.isSafeInteger(days) || days < 1) {
          throw new Error("--days must be a positive integer");
        }
        options.validityDays = days;
        index += 1;
        break;
      }
      case "--force":
        options.force = true;
        break;
      default:
        throw new Error(`unknown argument: ${flag}`);
    }
  }

  return options;
}

/**
 * `openssl req` arguments for the certificate.
 *
 * `keyUsage`/`extendedKeyUsage` matter beyond hygiene: `security find-identity
 * -p codesigning` only lists certificates whose extended key usage includes
 * code signing, and electron/after-pack.cjs resolves the identity through
 * exactly that query.
 */
export function certificateArguments(identityName, validityDays) {
  return [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "key.pem",
    "-out",
    "cert.pem",
    "-days",
    String(validityDays),
    "-subj",
    `/CN=${identityName}`,
    "-addext",
    "basicConstraints=critical,CA:false",
    "-addext",
    "keyUsage=critical,digitalSignature",
    "-addext",
    "extendedKeyUsage=critical,codeSigning",
  ];
}

/**
 * `openssl pkcs12` arguments for the exportable bundle CI imports.
 *
 * `-legacy` is not optional: OpenSSL 3 defaults to a PKCS#12 MAC that macOS
 * `security import` rejects with "MAC verification failed during PKCS12 import
 * (wrong password?)" — a genuinely misleading error.
 */
export function pkcs12Arguments(password) {
  return [
    "pkcs12",
    "-export",
    "-legacy",
    "-out",
    "certificate.p12",
    "-inkey",
    "key.pem",
    "-in",
    "cert.pem",
    "-passout",
    `pass:${password}`,
  ];
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryRun(command, args, cwd) {
  try {
    return { ok: true, output: run(command, args, cwd) };
  } catch (error) {
    return {
      ok: false,
      output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
    };
  }
}

/**
 * Keychain identities usable for code signing.
 *
 * `-v` is deliberately omitted: it filters to identities that are also valid
 * for trust evaluation, and a self-signed root reports
 * `CSSMERR_TP_NOT_TRUSTED` because it is not chained to a system trust anchor —
 * so `-v` hides exactly the certificate this project relies on.
 */
function codesigningIdentities() {
  const result = tryRun("security", ["find-identity", "-p", "codesigning"]);
  return [...result.output.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function loginKeychainPath() {
  return join(homedir(), "Library", "Keychains", "login.keychain-db");
}

function printHelp() {
  console.log(
    [
      "Create the self-signed macOS code-signing certificate for AITracker.",
      "",
      "  --name <name>   Keychain identity name (default: AITracker Self-Signed)",
      "  --out <dir>     Where to write key.pem/cert.pem/certificate.p12",
      "  --keychain <p>  Keychain to install into (default: login keychain)",
      "  --days <n>      Certificate validity in days (default: 3650)",
      "  --force         Recreate even if the identity already exists",
      "",
      "See docs/MACOS_SIGNING.md for the full release-signing procedure.",
    ].join("\n"),
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  let options;
  try {
    options = parseArguments(argv);
  } catch (error) {
    console.error(`[signing] ${error.message}`);
    process.exitCode = 1;
    return;
  }

  if (process.platform !== "darwin") {
    console.error(
      "[signing] this script only applies to macOS; Windows releases use a " +
        "separate Authenticode certificate.",
    );
    process.exitCode = 1;
    return;
  }

  const installed = codesigningIdentities().find(
    (name) => name === options.identityName,
  );
  if (installed && !options.force) {
    console.log(
      `[signing] "${installed}" is already in the keychain — nothing to do.\n` +
        "          Re-run with --force only if you intend to replace it: a new\n" +
        "          certificate changes the leaf hash and makes every user grant\n" +
        "          folder permissions again.",
    );
    return;
  }

  const outDirectory = options.outDirectory;
  mkdirSync(outDirectory, { recursive: true, mode: 0o700 });
  chmodSync(outDirectory, 0o700);

  console.log(
    `[signing] generating "${options.identityName}" in ${outDirectory}`,
  );
  run(
    "openssl",
    certificateArguments(options.identityName, options.validityDays),
    outDirectory,
  );

  // Generated rather than prompted so the script stays non-interactive; the
  // maintainer copies it into the CI secret once.
  const p12Password = randomBytes(24).toString("base64url");
  run("openssl", pkcs12Arguments(p12Password), outDirectory);

  const p12Path = join(outDirectory, "certificate.p12");
  const imported = tryRun("security", [
    "import",
    p12Path,
    "-k",
    options.keychainPath,
    "-P",
    p12Password,
    "-T",
    "/usr/bin/codesign",
    // Without -A the private key's ACL makes codesign interrupt the first
    // signing run with a keychain permission dialog. The same key already sits
    // in this directory as a .p12, so -A does not widen the local threat model;
    // it only keeps local builds non-interactive, matching CI.
    "-A",
  ]);
  if (!imported.ok && !/already exists/i.test(imported.output)) {
    console.error(
      `[signing] keychain import failed:\n${imported.output.trim()}`,
    );
    process.exitCode = 1;
    return;
  }

  if (!codesigningIdentities().includes(options.identityName)) {
    console.error(
      `[signing] "${options.identityName}" is not visible to ` +
        "`security find-identity -p codesigning` after import; refusing to " +
        "report success.",
    );
    process.exitCode = 1;
    return;
  }

  // Prove the identity signs, so a partition-list or ACL problem surfaces here
  // rather than as a cryptic failure during a release build. The probe is a
  // copy of /bin/echo because codesign only derives a certificate-anchored
  // requirement for a Mach-O binary; a generic file would report cdhash and
  // make the check meaningless.
  const probePath = join(outDirectory, "signing-probe.bin");
  copyFileSync("/bin/echo", probePath);
  const probe = tryRun("codesign", [
    "--force",
    "--sign",
    options.identityName,
    probePath,
  ]);
  if (!probe.ok) {
    console.error(
      [
        "[signing] the certificate is installed but codesign cannot use its key:",
        `          ${probe.output.trim()}`,
        "",
        "Fix it with either of:",
        '  1. Run a build once and click "Always Allow" on the keychain prompt.',
        "  2. Grant the item a codesign partition (needs the keychain password):",
        "     security set-key-partition-list -S apple-tool:,apple:,codesign: \\",
        `       -s -k <password> "${options.keychainPath}"`,
      ].join("\n"),
    );
    rmSync(probePath, { force: true });
    process.exitCode = 1;
    return;
  }

  const requirement = tryRun("codesign", ["-d", "-r-", probePath]);
  rmSync(probePath, { force: true });
  const designated = requirement.output
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("designated =>"));

  console.log("[signing] signed a probe binary; the requirement now reads:");
  console.log(`          ${designated ?? "<unavailable>"}`);

  const base64Path = join(outDirectory, "certificate.p12.base64");
  // 0600: this file carries the same secret as the .p12, and `gh secret set`
  // reads it from stdin.
  writeFileSync(
    base64Path,
    `${run("base64", ["-i", p12Path]).replaceAll("\n", "")}\n`,
    { mode: 0o600 },
  );
  chmodSync(base64Path, 0o600);

  console.log(
    [
      "",
      "[signing] done. Next steps:",
      "",
      `  1. Back up ${outDirectory} somewhere safe. Losing key.pem means`,
      "     issuing a new certificate, which changes the certificate leaf hash",
      "     and forces every user to grant folder permissions again. Expiry has",
      `     the same consequence, which is why this one is valid for ${options.validityDays} days.`,
      "",
      "  2. Configure the release workflow (from the repository root):",
      "",
      `     gh secret set MAC_CSC_LINK < "${base64Path}"`,
      `     gh secret set MAC_CSC_KEY_PASSWORD --body "${p12Password}"`,
      `     gh variable set MAC_CSC_NAME --body "${options.identityName}"`,
      "",
      "  3. Confirm a local build picks it up:",
      "",
      "     npm run dist:mac:arm64",
      "     codesign -d -r- release/mac-arm64/AITracker.app",
      "",
      '     The requirement must read `identifier "com.aitracker.desktop" and',
      '     certificate leaf = H"…"` — never `cdhash`.',
      "",
      "  The password above is printed once and stored nowhere else. Keep it",
      "  with the backup.",
      "",
    ].join("\n"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
