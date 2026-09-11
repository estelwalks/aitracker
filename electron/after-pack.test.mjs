import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  chooseSigningIdentity,
  describeDesignatedRequirement,
  signingFailure,
} = require("./after-pack.cjs");

/**
 * Re-signing identity precedence.
 *
 * The identity is not only a Gatekeeper concern: macOS TCC stores a code
 * requirement derived from the signature. Ad-hoc signing (`--sign -`) collapses
 * it to the binary's cdhash, so every rebuild invalidates the user's permission
 * grants and macOS asks for Documents/Desktop/Downloads access again. Any
 * certificate — including a self-signed one — moves the requirement to a stable
 * `certificate leaf` anchor. These tests pin the selection order that keeps
 * that working.
 */

const DEVELOPER_ID = "Developer ID Application: Example Corp (UBF8T346G9)";
const SELF_SIGNED = "AITracker Self-Signed";
const UNRELATED = "Some Other Team's Cert (ABCDE12345)";

test("prefers a Developer ID certificate and keeps hardened runtime", () => {
  assert.deepEqual(chooseSigningIdentity([UNRELATED, DEVELOPER_ID]), {
    name: DEVELOPER_ID,
    hardenedRuntime: true,
  });
});

test("uses the project's self-signed certificate without hardened runtime", () => {
  // macOS 15 refuses to launch an app whose frameworks carry a different Team
  // ID, so the hardened-runtime flag stays off for a non-Developer-ID anchor.
  assert.deepEqual(chooseSigningIdentity([UNRELATED, SELF_SIGNED]), {
    name: SELF_SIGNED,
    hardenedRuntime: false,
  });
});

test("an explicit CSC_NAME wins over discovery", () => {
  assert.deepEqual(
    chooseSigningIdentity([DEVELOPER_ID, SELF_SIGNED], SELF_SIGNED),
    {
      name: SELF_SIGNED,
      hardenedRuntime: false,
    },
  );
});

test("CSC_NAME matches a keychain identity's display name with its team suffix", () => {
  // Keychain lists `Name (TEAMID)`; users commonly export only the bare name.
  assert.deepEqual(
    chooseSigningIdentity(
      [DEVELOPER_ID],
      "Developer ID Application: Example Corp",
    ),
    { name: DEVELOPER_ID, hardenedRuntime: true },
  );
});

test("an unknown CSC_NAME falls back to discovery instead of failing the build", () => {
  assert.deepEqual(
    chooseSigningIdentity([SELF_SIGNED], "Not In This Keychain"),
    {
      name: SELF_SIGNED,
      hardenedRuntime: false,
    },
  );
  assert.deepEqual(
    chooseSigningIdentity([DEVELOPER_ID], "Not In This Keychain"),
    {
      name: DEVELOPER_ID,
      hardenedRuntime: true,
    },
  );
});

test("falls back to ad-hoc when no usable certificate exists", () => {
  assert.deepEqual(chooseSigningIdentity([]), {
    name: "-",
    hardenedRuntime: false,
  });
  // A certificate belonging to an unrelated project is never adopted silently:
  // signing an AITracker build with it would still give users no stable grant.
  assert.deepEqual(chooseSigningIdentity([UNRELATED]), {
    name: "-",
    hardenedRuntime: false,
  });
});

/**
 * The requirement read back after signing is what macOS TCC stores as the
 * `csreq` blob, so the release build must never ship a cdhash-pinned one.
 */

test("reads a self-signed requirement as rebuild-stable", () => {
  // Shape produced by a certificate-signed bundle (`codesign -d -r-` writes to
  // stderr).
  const output = [
    "Executable=/tmp/AITracker.app/Contents/MacOS/AITracker",
    'designated => identifier "com.aitracker.desktop" and certificate leaf = H"6451affd59507339853e9f384382e76ad7e589c5"',
    "",
  ].join("\n");

  assert.deepEqual(describeDesignatedRequirement(output), {
    requirement:
      'identifier "com.aitracker.desktop" and certificate leaf = H"6451affd59507339853e9f384382e76ad7e589c5"',
    pinnedToCdhash: false,
  });
});

test("reads an ad-hoc requirement as cdhash-pinned", () => {
  // Ad-hoc bundles have no explicit requirement, so codesign prints the
  // implicit one commented out.
  const output = [
    "Executable=/Applications/AITracker.app/Contents/MacOS/AITracker",
    '# designated => cdhash H"21368539ea9e7d272e35c69a31cace44f0cb0c70"',
    "",
  ].join("\n");

  assert.deepEqual(describeDesignatedRequirement(output), {
    requirement: 'cdhash H"21368539ea9e7d272e35c69a31cace44f0cb0c70"',
    pinnedToCdhash: true,
  });
});

test("reads a Developer ID requirement as rebuild-stable", () => {
  // Captured from a real Developer ID bundle.
  const output = [
    'designated => identifier "com.microsoft.VSCodeInsiders" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[subject.OU] = UBF8T346G9',
  ].join("\n");

  const designation = describeDesignatedRequirement(output);
  assert.equal(designation.pinnedToCdhash, false);
  assert.match(
    designation.requirement,
    /identifier "com\.microsoft\.VSCodeInsiders"/u,
  );
});

test("reports an unavailable requirement instead of failing to parse", () => {
  assert.deepEqual(describeDesignatedRequirement(""), {
    requirement: "",
    pinnedToCdhash: false,
  });
});

test("an ordinary ad-hoc build is allowed to succeed", () => {
  const identity = { name: "-", hardenedRuntime: false };
  const designation = { requirement: 'cdhash H"abc"', pinnedToCdhash: true };
  assert.equal(signingFailure(identity, designation, false), null);
});

test("a release build refuses to ship an ad-hoc bundle", () => {
  const failure = signingFailure(
    { name: "-", hardenedRuntime: false },
    { requirement: 'cdhash H"abc"', pinnedToCdhash: true },
    true,
  );
  assert.match(failure, /AITRACKER_REQUIRE_SIGNING/u);
});

test("a certificate that failed to anchor the signature fails the build", () => {
  // Signing with a certificate must never leave a cdhash-pinned requirement —
  // that would mean the fix silently does nothing for users.
  const failure = signingFailure(
    { name: SELF_SIGNED, hardenedRuntime: false },
    { requirement: 'cdhash H"abc"', pinnedToCdhash: true },
    false,
  );
  assert.match(failure, /cdhash-pinned/u);
});

test("a correctly signed release passes", () => {
  assert.equal(
    signingFailure(
      { name: SELF_SIGNED, hardenedRuntime: false },
      {
        requirement: "certificate leaf = H\u0022abc\u0022",
        pinnedToCdhash: false,
      },
      true,
    ),
    null,
  );
});
