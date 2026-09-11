const { execFileSync, spawnSync } = require("node:child_process");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

// License bundling lives in scripts/copy-license-files.mjs (kept out of this
// CommonJS hook so it can be unit-tested standalone with node --test).
const COPY_LICENSE_SCRIPT = join(
  __dirname,
  "..",
  "scripts",
  "copy-license-files.mjs",
);

/**
 * Re-sign the whole .app after electron-builder unpacks it.
 *
 * Why the identity matters beyond Gatekeeper: macOS TCC (the permission
 * database behind every "…would like to access files in your Documents folder"
 * dialog) does not store "this app is allowed". It stores a *code requirement*
 * that the running binary must still satisfy, and macOS derives that
 * requirement from the signature:
 *
 *   ad-hoc (`--sign -`) => designated => cdhash H"…"
 *   any certificate     => designated => identifier "com.aitracker.desktop"
 *                                       and certificate leaf = H"<cert>"
 *
 * The ad-hoc form pins the grant to the exact binary, so every rebuild looks
 * like a brand-new app and the user is asked again. The certificate form is
 * stable across rebuilds — and it does not have to be an Apple-issued
 * Developer ID: a self-signed Keychain certificate anchors the requirement just
 * as well, which is how yabai, skhd and AeroSpace ship. So the self-signed
 * identity is a first-class choice here, not a fallback.
 *
 * Hardened runtime: macOS 15 (Sequoia) refuses to launch an app whose
 * frameworks carry a different Team ID than the process, and Electron's
 * prebuilt frameworks are not signed by this project's identity. The
 * hardened-runtime flag (`--options runtime`) is therefore kept only when a
 * Developer ID certificate is available. electron-builder documents
 * `com.apple.security.cs.disable-library-validation` as the way to keep
 * hardened runtime with a non-Developer-ID identity;
 * build/entitlements.mac.plist can adopt it if this project ever wants that,
 * but the ad-hoc/self-signed build is verified to launch without it.
 *
 * TCC-protected directories: the scanners no longer resolve project paths
 * inside Documents/Desktop/Downloads on disk (see
 * src/lib/local-usage/project-path.server.ts). macOS only asks when the user
 * picks or drops a file in one of them, which is the OS-mandated behavior for
 * any non-sandboxed app.
 */

/**
 * Keychain certificate names this project claims as its own self-signed
 * release identity, in addition to any Developer ID certificate. Name the
 * certificate accordingly (e.g. "AITracker Self-Signed").
 */
const SELF_SIGNED_IDENTITY_PATTERN = /aitracker/i;

/**
 * List the keychain identities usable for code signing.
 *
 * `-v` is deliberately omitted: it filters to identities that are also valid
 * for *trust evaluation*, and a self-signed root reports
 * `CSSMERR_TP_NOT_TRUSTED` because it is not chained to a system trust anchor —
 * so `-v` hides exactly the certificate this project relies on. `codesign`
 * does not consult trust state when signing.
 */
function listCodesigningIdentities() {
  try {
    const out = execFileSync(
      "security",
      ["find-identity", "-p", "codesigning"],
      { stdio: "pipe", encoding: "utf8" },
    );
    return [...out.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  } catch {
    return [];
  }
}

/**
 * Pick the re-signing identity from the available keychain identities: an
 * explicit `CSC_NAME`, then a Developer ID certificate, then this project's
 * self-signed certificate, then ad-hoc.
 *
 * Pure so the precedence is unit-testable without a keychain; the Developer ID
 * check also decides whether the hardened-runtime flag is safe to keep.
 */
function chooseSigningIdentity(identities, requestedName) {
  const isDeveloperId = (name) => /Developer ID Application:/.test(name);

  const requested = (requestedName ?? "").trim();
  if (requested) {
    // A keychain identity displays as `Name (TEAMID)`, and `CSC_NAME` is
    // commonly set to the bare name, so accept both spellings.
    const match = identities.find(
      (name) => name === requested || name.startsWith(`${requested} (`),
    );
    if (match) return { name: match, hardenedRuntime: isDeveloperId(match) };
    console.warn(
      `[after-pack] CSC_NAME="${requested}" is not in the keychain; falling back to discovery`,
    );
  }

  const developerId = identities.find(isDeveloperId);
  if (developerId) return { name: developerId, hardenedRuntime: true };

  const selfSigned = identities.find((name) =>
    SELF_SIGNED_IDENTITY_PATTERN.test(name),
  );
  if (selfSigned) return { name: selfSigned, hardenedRuntime: false };

  return { name: "-", hardenedRuntime: false };
}

function resolveSigningIdentity() {
  return chooseSigningIdentity(
    listCodesigningIdentities(),
    process.env.CSC_NAME,
  );
}

/**
 * Read the requirement macOS will store as the TCC `csreq` blob for this
 * bundle, from `codesign -d -r-` output.
 *
 * `codesign` writes the requirement table to stderr, and an ad-hoc signature
 * has no explicit requirement, so it prints the implicit one commented out:
 * `# designated => cdhash H"…"`. Both forms are handled here.
 */
function describeDesignatedRequirement(output) {
  const line =
    output
      .split("\n")
      .map((entry) => entry.trim())
      .find((entry) => entry.includes("designated =>")) ?? "";
  const requirement = line
    .replace(/^#\s*/u, "")
    .replace(/^designated\s*=>\s*/u, "");
  return {
    requirement,
    // Only a certificate (or an Apple anchor) pins the requirement to something
    // that outlives a rebuild. A cdhash-pinned requirement changes with every
    // build, so macOS sees a brand-new app and asks the user to grant access
    // again.
    pinnedToCdhash: requirement.includes("cdhash"),
  };
}

/**
 * Decide whether the freshly signed bundle is acceptable, returning the failure
 * message for the build or `null` when it is fine.
 *
 * `AITRACKER_REQUIRE_SIGNING` is the release-workflow guard: without it a
 * misconfigured certificate secret would silently publish an ad-hoc bundle, and
 * every user would have to re-grant permissions after each release. It is
 * unset for ordinary builds and for pull requests from forks, which never
 * receive repository secrets.
 */
function signingFailure(identity, designation, requireSigning) {
  if (identity.name !== "-" && designation.pinnedToCdhash) {
    return (
      `signed with "${identity.name}" but the designated requirement is still ` +
      `cdhash-pinned (${designation.requirement}); the certificate is not ` +
      "anchoring the signature, so user permission grants would not survive"
    );
  }
  if (requireSigning && identity.name === "-") {
    return (
      "AITRACKER_REQUIRE_SIGNING is set but no usable signing certificate was " +
      "found — refusing to publish an ad-hoc bundle that would make users " +
      "re-grant Documents/Desktop/Downloads access after every release"
    );
  }
  return null;
}

exports.chooseSigningIdentity = chooseSigningIdentity;
exports.describeDesignatedRequirement = describeDesignatedRequirement;
exports.signingFailure = signingFailure;
// TCC usage descriptions shipped by the default Electron Info.plist template
// that this app never uses — strip them so the bundle declares only the
// permissions it actually needs (no camera/microphone/bluetooth, no directory
// access).
const UNUSED_USAGE_DESCRIPTIONS = [
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

// Where extraResources-style files live inside the packed app: macOS bundles
// them under Contents/Resources, Windows/Linux under a top-level resources
// directory next to app.asar.
function resourcesDirectory(context) {
  if (context.electronPlatformName === "darwin") {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      "Contents",
      "Resources",
    );
  }
  return join(context.appOutDir, "resources");
}

exports.default = async function afterPack(context) {
  // Audit P1-4: the NOTICE file promises that binary distributions preserve
  // third-party package license files, but nothing copied them into the
  // bundle. Run the bundler on every platform before the app is archived or
  // signed. On macOS electron-builder has already signed the .app by the time
  // this hook runs, so the copy must stay ahead of the re-sign at the bottom
  // of this function — otherwise the freshly added files would invalidate the
  // code signature.
  const { copyLicenseFiles } = await import(
    pathToFileURL(COPY_LICENSE_SCRIPT).href
  );
  const licensesRoot = join(resourcesDirectory(context), "licenses");
  const licenseSummary = await copyLicenseFiles({
    projectDir: context.packager.projectDir,
    licensesRoot,
  });
  console.log(
    `[after-pack] preserved license files for ${licenseSummary.copied.length} production dependencies in ${licensesRoot}`,
  );

  if (context.electronPlatformName !== "darwin") return;

  const appPath = join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const entitlementsPath = join(
    context.packager.projectDir,
    "build",
    "entitlements.mac.plist",
  );

  const infoPlistPath = join(appPath, "Contents", "Info.plist");
  for (const key of UNUSED_USAGE_DESCRIPTIONS) {
    try {
      execFileSync("plutil", ["-remove", key, infoPlistPath], {
        stdio: "pipe",
      });
    } catch {
      // key already absent — fine
    }
  }
  const identity = resolveSigningIdentity();
  if (identity.name === "-") {
    console.warn(
      "[after-pack] no signing certificate found — signing ad-hoc. macOS TCC " +
        "cannot remember permission grants for an ad-hoc bundle, so users are " +
        "asked again after every rebuild. Create a self-signed 'Code Signing' " +
        "certificate in Keychain Access (or set CSC_NAME) to fix this.",
    );
  } else {
    console.log(
      `[after-pack] signing with "${identity.name}"${
        identity.hardenedRuntime ? " (hardened runtime)" : ""
      }`,
    );
  }

  const codesignArgs = ["--force", "--deep"];
  if (identity.hardenedRuntime) {
    codesignArgs.push(
      "--options",
      "runtime",
      "--entitlements",
      entitlementsPath,
    );
  }
  codesignArgs.push("--sign", identity.name, appPath);
  execFileSync("codesign", codesignArgs, { stdio: "inherit" });

  // Read the requirement back and report it. This string is what macOS stores
  // as the TCC `csreq` blob when a user grants a permission, so it is the value
  // that decides whether that grant survives the next release.
  const verification = spawnSync("codesign", ["-d", "-r-", appPath], {
    encoding: "utf8",
  });
  const designation = describeDesignatedRequirement(
    `${verification.stdout ?? ""}${verification.stderr ?? ""}`,
  );
  console.log(
    `[after-pack] designated requirement (what macOS TCC will store): ${
      designation.requirement || "<unavailable>"
    }`,
  );

  const failure = signingFailure(
    identity,
    designation,
    process.env.AITRACKER_REQUIRE_SIGNING === "1",
  );
  if (failure != null) throw new Error(`[after-pack] ${failure}`);
};
