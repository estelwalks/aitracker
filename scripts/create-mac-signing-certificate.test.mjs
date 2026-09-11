import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  certificateArguments,
  DEFAULT_IDENTITY_NAME,
  DEFAULT_VALIDITY_DAYS,
  parseArguments,
  pkcs12Arguments,
} from "./create-mac-signing-certificate.mjs";

test("defaults target the login keychain and a directory outside the repo", () => {
  const options = parseArguments([]);
  assert.equal(options.identityName, DEFAULT_IDENTITY_NAME);
  assert.equal(options.validityDays, DEFAULT_VALIDITY_DAYS);
  assert.equal(
    options.keychainPath,
    join(homedir(), "Library", "Keychains", "login.keychain-db"),
  );
  // The private key must never land in the repository checkout.
  assert.equal(options.outDirectory, join(homedir(), "aitracker-signing"));
  assert.equal(options.force, false);
});

test("parses every override", () => {
  const options = parseArguments([
    "--name",
    "Custom Identity",
    "--out",
    "./somewhere",
    "--keychain",
    "./custom.keychain-db",
    "--days",
    "365",
    "--force",
  ]);
  assert.equal(options.identityName, "Custom Identity");
  assert.equal(options.validityDays, 365);
  assert.equal(options.force, true);
  assert.match(options.outDirectory, /somewhere$/u);
  assert.match(options.keychainPath, /custom\.keychain-db$/u);
});

test("rejects malformed input instead of silently defaulting", () => {
  assert.throws(() => parseArguments(["--days", "abc"]), /positive integer/u);
  assert.throws(() => parseArguments(["--days"]), /requires a value/u);
  assert.throws(() => parseArguments(["--name"]), /requires a value/u);
  assert.throws(() => parseArguments(["--out"]), /requires a directory/u);
  assert.throws(() => parseArguments(["--keychain"]), /requires a path/u);
  assert.throws(() => parseArguments(["--wat"]), /unknown argument/u);
});

test("the certificate declares a code-signing extended key usage", () => {
  const args = certificateArguments("AITracker Self-Signed", 3650);
  const extensions = args.filter((_, index) => args[index - 1] === "-addext");
  // find-identity -p codesigning only lists certificates with this EKU, and
  // electron/after-pack.cjs resolves the identity through that query.
  assert.ok(
    extensions.includes("extendedKeyUsage=critical,codeSigning"),
    "missing the codeSigning EKU",
  );
  assert.ok(extensions.includes("basicConstraints=critical,CA:false"));
  assert.ok(args.includes("-days") && args.includes("3650"));
  assert.ok(args.includes("/CN=AITracker Self-Signed"));
});

test("the PKCS#12 export stays importable by macOS security", () => {
  // OpenSSL 3's default MAC is rejected by `security import` with a misleading
  // "wrong password?" error; -legacy is what makes the export usable.
  assert.ok(pkcs12Arguments("secret").includes("-legacy"));
});
