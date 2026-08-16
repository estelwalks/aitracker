const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

/**
 * Re-sign the whole .app after electron-builder unpacks it.
 *
 * macOS 15 (Sequoia) regression: an ad-hoc signed app (no Developer ID cert)
 * that keeps the hardened-runtime flag (`--options runtime`) fails to launch —
 * dyld refuses to load its own frameworks with "mapping process and mapped
 * file (non-platform) have different Team IDs", because hardened runtime
 * enables dyld's Team-ID check and every ad-hoc signature has its own implicit
 * team. So when no Developer ID identity is available, the app is re-signed
 * WITHOUT hardened runtime (the pre-46b9cdd behavior — launches fine once
 * Gatekeeper is bypassed). With a real Developer ID certificate, the
 * hardened-runtime flag and the minimal entitlements are preserved:
 *   - `--options runtime` keeps `com.apple.security.cs.allow-jit` etc. active;
 *   - `--entitlements` re-applies build/entitlements.mac.plist — the minimal
 *     set (Chromium JIT only, no App Sandbox, no files.* directory grants).
 *
 * The app never requests TCC-protected directories; macOS only asks the user
 * at the moment they pick/drop a file inside 文稿/桌面/下载, which is the
 * OS-mandated behavior for any non-sandboxed app.
 */
function hasDeveloperIdIdentity() {
  try {
    const out = execFileSync(
      "security",
      ["find-identity", "-v", "-p", "codesigning"],
      { stdio: "pipe", encoding: "utf8" },
    );
    return /Developer ID Application:/.test(out);
  } catch {
    return false;
  }
}
// Electron 默认模板 Info.plist 自带、但本应用完全不使用的 TCC usage
// descriptions —— 删除,确保"仅声明必要权限"(应用不使用摄像头/麦克风/
// 蓝牙,也不请求任何目录权限)。
const UNUSED_USAGE_DESCRIPTIONS = [
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

exports.default = async function afterPack(context) {
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
  const hardenedRuntime = hasDeveloperIdIdentity();
  const codesignArgs = ["--force", "--deep"];
  if (hardenedRuntime) {
    codesignArgs.push(
      "--options",
      "runtime",
      "--entitlements",
      entitlementsPath,
    );
  }
  codesignArgs.push("--sign", "-", appPath);
  execFileSync("codesign", codesignArgs, { stdio: "inherit" });
};
